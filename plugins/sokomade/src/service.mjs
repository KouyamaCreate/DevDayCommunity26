import { randomUUID } from 'node:crypto';
import { AppError, invariant } from './errors.mjs';
import { CITIES, validateWorldCoordinate, validateBounds, boundsAround, reportRegion, inBounds } from './spatial.mjs';
import { evaluateWalks } from './conditions.mjs';
import { fetchPropertyHTML, extractListingAddress } from './network.mjs';
import { assessTarget, compareEvidence } from './assessment.mjs';

export class MapService {
  constructor({ sessions, google, reports, config, propertyFetch = fetchPropertyHTML }) {
    Object.assign(this, { sessions, google, reports, config, propertyFetch });
  }
  async view(id, { touch = true } = {}) {
    const workspace = this.sessions.snapshot(id, { touch });
    workspace.walkEvaluations = evaluateWalks(workspace);
    return { workspace, cities: Object.values(CITIES), configuration: await this.config.status() };
  }
  place(state, id) {
    const value = state.places.find(place => place.id === id);
    invariant(value, 'PLACE_NOT_FOUND', 'この相談で取得した地点を選んでください。'); return value;
  }
  center(state, scope = 'focus') {
    if (scope === 'origin') {
      invariant(state.originId, 'ORIGIN_REQUIRED', '出発地を選んでください。');
      return this.place(state, state.originId);
    }
    if (scope === 'focus' && state.focus.type === 'place') return this.place(state, state.focus.placeId);
    if (scope === 'focus' && state.focus.type === 'point') return state.focus.point;
    return state.mapView.center;
  }
  pin(state, ids) { state.comparisonIds = [...new Set([...state.comparisonIds, ...ids])]; }
  invalidate(state, { routes = false, external = false } = {}) {
    state.assessmentGeneration = (state.assessmentGeneration || 0) + 1;
    state.operationGeneration++; state.contextGeneration++; state.busy = false; state.focusReport = null;
    if (routes) { state.routes = []; state.routePairs = []; state.activePairId = null; state.selectedRoutes = {}; state.report = null; state.assessment = null; }
    if (external) state.chatController?.abort();
  }
  async open({ city = 'shibuya' } = {}) {
    const state = this.sessions.create(city);
    void this.layer({ workspaceId: state.id }).catch(() => {});
    return this.view(state.id);
  }
  async viewport({ workspaceId, center, bounds, zoom, commandId = 0, baseRevision, interaction = true }) {
    validateWorldCoordinate(center); validateBounds(bounds);
    const state = this.sessions.get(workspaceId);
    // Ignore acknowledgements from a camera that has not applied the latest command.
    if ((state.mapView.command?.id || 0) !== commandId || (baseRevision !== undefined && baseRevision !== state.mapView.revision)) return this.view(workspaceId);
    this.sessions.update(workspaceId, s => {
      s.mapView = { ...s.mapView, center, bounds, zoom, revision: s.mapView.revision + 1 };
      if (interaction) { s.focus = { type: 'viewport' }; this.invalidate(s, { external: true }); }
    });
    void this.layer({ workspaceId }).catch(() => {});
    return this.view(workspaceId);
  }
  async focus({ workspaceId, placeId, point, scope, _fromChat = false }) {
    invariant([!!placeId, !!point, !!scope].filter(Boolean).length === 1, 'FOCUS_REQUIRED', '地点または表示範囲を1つ指定してください。');
    const state = this.sessions.get(workspaceId);
    if (placeId) this.place(state, placeId);
    if (point) validateWorldCoordinate(point);
    this.sessions.update(workspaceId, s => {
      s.focus = placeId ? { type: 'place', placeId } : point ? { type: 'point', point } : { type: 'viewport' };
      this.invalidate(s, { external: !_fromChat });
    });
    return this.view(workspaceId);
  }
  async move({ workspaceId, query, city, placeId, zoom = 14 }) {
    invariant([!!query, !!city, !!placeId].filter(Boolean).length === 1, 'LOCATION_REQUIRED', '移動先の地域名か取得済み地点を1つ指定してください。');
    const state = this.sessions.get(workspaceId);
    this.invalidate(state);
    const generation = state.operationGeneration;
    let center;
    if (city) center = CITIES[city].center;
    else if (placeId) center = this.place(state, placeId);
    else {
      const matches = await this.google.geocode(query, state.city, { biasBounds: state.mapView.bounds });
      invariant(matches.length, 'NO_LOCATION_FOUND', '移動先が見つかりませんでした。');
      if (matches.length > 1) return { ...await this.view(workspaceId), candidates: matches, needsSelection: true, notice: '移動先を住所で絞ってください。まだ地図は移動していません。' };
      center = matches[0];
    }
    invariant(this.sessions.get(workspaceId).operationGeneration === generation, 'STALE_RESULT', '新しい地図操作を優先しました。');
    this.sessions.update(workspaceId, s => {
      this.invalidate(s);
      const region = reportRegion(center);
      if (region) s.city = region;
      const command = { id: (s.mapView.command?.id || 0) + 1, center: { lat: center.lat, lng: center.lng }, zoom };
      s.mapView = { ...s.mapView, center: command.center, zoom, bounds: boundsAround(center), revision: s.mapView.revision + 1, command };
      s.focus = placeId ? { type: 'place', placeId } : { type: 'viewport' };
      s.reportLayer = null;
    });
    await this.layer({ workspaceId });
    return this.view(workspaceId);
  }
  async layer({ workspaceId }) {
    const state = this.sessions.get(workspaceId), generation = ++state.layerGeneration;
    this.sessions.update(workspaceId, s => { s.reportLayer = { status: 'loading', bounds: s.mapView.bounds, regions: [], incidents: [], areas: [], limitations: [] }; });
    let layer;
    try { layer = await this.reports.layer(state.mapView.bounds, state.conditions); }
    catch (error) { layer = { status: 'unavailable', bounds: state.mapView.bounds, incidents: [], regions: [], limitations: [this.unavailableReport(error).error.message] }; }
    const current = this.sessions.get(workspaceId, { touch: false });
    if (current.layerGeneration !== generation) return this.view(workspaceId);
    this.sessions.update(workspaceId, s => {
      s.reportLayer = layer;
      // Keep the existing source-details UI usable before any shop is selected.
      if (!s.report || s.report.basis === 'viewport') {
        const region = layer.regions?.find(r => r.status === 'available');
        s.report = region ? { ...region, basis: 'viewport', comparable: false, incidents: [], areaCounts: [], routeCounts: [], limitations: [...region.limitations, ...layer.limitations] } : { ...this.unavailableReport(new AppError(layer.status === 'unsupported' ? 'REPORT_UNSUPPORTED' : 'REPORT_UNAVAILABLE', layer.status === 'unsupported' ? 'この範囲の報告情報は未対応です。安全性は判断できません。' : '報告情報を取得できません。')), basis: 'viewport' };
      }
    });
    return this.view(workspaceId);
  }
  async resolve({ workspaceId, query, lat, lng, label, address, fromFocus = false, role = 'candidate' }) {
    const state = this.sessions.get(workspaceId);
    this.invalidate(state);
    const generation = state.operationGeneration;
    let places;
    if (fromFocus) {
      invariant(!query && lat === undefined && lng === undefined && state.focus.type === 'point', 'FOCUS_REQUIRED', '地図上で地点を選んでください。');
      ({lat,lng} = state.focus.point);
      label ||= '地図で選んだ地点';
    }
    if (lat !== undefined || lng !== undefined) {
      const coordinate = validateWorldCoordinate({ lat, lng });
      places = [{ id: randomUUID(), name: label || '指定した地点', address: address || '', ...coordinate, source: 'user-coordinate', precision: 'user-provided', providerId: null, openingHours: null, priceLevel: null }];
    } else {
      invariant(query?.trim(), 'LOCATION_REQUIRED', '住所・店名・物件URLを指定してください。');
      let input = query.trim(), sourceURL;
      if (/^https?:\/\//i.test(input)) { sourceURL = input; input = extractListingAddress(await this.propertyFetch(input)); }
      places = await this.google.geocode(input, state.city, { biasBounds: state.mapView.bounds });
      if (sourceURL) places = places.map(place => ({ ...place, sourceURL, name: label || place.name }));
      else if (label && places.length === 1) places[0].name = label;
    }
    invariant(places.length, 'NO_LOCATION_FOUND', '地点が見つかりません。住所をもう少し詳しく指定してください。');
    invariant(this.sessions.get(workspaceId).operationGeneration === generation, 'STALE_RESULT', '新しい操作を優先しました。');
    this.sessions.update(workspaceId, current => {
      // Preserve identifiers already referenced by a route or comparison.
      current.assessment = null;
      places = places.map(p => ({ ...p, id: current.places.find(old => p.providerId && old.providerId === p.providerId)?.id || p.id, role }));
      const additions = places.filter(p => !current.places.some(old => old.id === p.id));
      invariant(current.places.length + additions.length <= 20, 'TOO_MANY_PLACES', '比較地点は20件までです。不要な地点を除いてください。');
      current.places = current.places.map(old => places.find(p => p.id === old.id) || old);
      current.places.push(...additions); this.pin(current, places.map(p => p.id));
      if (places.length === 1) {
        if (role === 'origin') { current.originId = places[0].id; this.invalidate(current, { routes: true }); }
        else { current.selectedPlaceId = places[0].id; current.focus = { type: 'place', placeId: places[0].id }; }
      }
    });
    return { ...await this.view(workspaceId), candidates: places, needsSelection: places.length > 1 };
  }
  async search({ workspaceId, query, scope = 'focus', radiusMeters = 2000, limit = 5, openNow = false, priceLevels }) {
    const state = this.sessions.get(workspaceId);
    this.invalidate(state);
    const generation = state.operationGeneration;
    const center = this.center(state, scope);
    const places = await this.google.search(query, reportRegion(center) || state.city, { center, radiusMeters, limit, openNow, priceLevels });
    invariant(this.sessions.get(workspaceId).operationGeneration === generation, 'STALE_RESULT', '新しい地図操作を優先しました。');
    this.sessions.update(workspaceId, current => {
      const protectedIds = new Set([...current.comparisonIds, current.originId, current.selectedPlaceId, ...current.routePairs.flatMap(p => [p.fromId, p.toId])]);
      const retained = current.places.filter(p => !current.searchResultIds.includes(p.id) || protectedIds.has(p.id));
      const results = places.map(p => ({ ...p, id: retained.find(old => p.providerId && old.providerId === p.providerId)?.id || p.id, role: 'search-result' }));
      const additions = results.filter((p, i) => !retained.some(old => old.id === p.id) && results.findIndex(other => other.id === p.id) === i);
      invariant(retained.length + additions.length <= 20, 'TOO_MANY_PLACES', '比較地点は20件までです。不要な地点を除いてください。');
      const movedIds = new Set(retained.filter(old => results.some(p => p.id === old.id && (p.lat !== old.lat || p.lng !== old.lng))).map(p => p.id));
      const removedRoutes = current.routes.some(r => movedIds.has(r.fromId) || movedIds.has(r.toId));
      if (movedIds.size) {
        current.routes = current.routes.filter(r => !movedIds.has(r.fromId) && !movedIds.has(r.toId));
        current.routePairs = current.routePairs.filter(p => !movedIds.has(p.fromId) && !movedIds.has(p.toId));
        current.selectedRoutes = Object.fromEntries(Object.entries(current.selectedRoutes).filter(([, id]) => current.routes.some(r => r.id === id)));
        current.report = null;
      }
      current.places = [...retained.map(old => { const fresh = results.find(p=>p.id===old.id); return fresh ? { ...old, ...fresh, role: old.role } : old; }), ...additions]; current.searchResultIds = [...new Set(results.map(p => p.id))];
      current.assessment = null;
      current.searchContext = { query, center: {lat:center.lat,lng:center.lng}, radiusMeters, openNow, fetchedAt: new Date().toISOString() };
      current.selectedPlaceId = results[0]?.id || current.selectedPlaceId;
      if (results.length) current.focus = { type: 'place', placeId: results[0].id };
      if (movedIds.size) current.activePairId = current.routePairs.find(p => p.comparisonId === current.selectedPlaceId)?.id || null;
      current.notices = results.length ? [] : ['条件に合う候補が見つかりません。検索範囲や条件を変えてください。'];
      if (removedRoutes) current.notices.push('地点の位置情報が更新されたため、その地点を通る経路を破棄しました。経路を再取得してください。');
    });
    return this.view(workspaceId);
  }
  async discover({ workspaceId, priority = 'balanced', maxExtraDistanceMeters = 300, ...search }) {
    const before = this.sessions.get(workspaceId);
    const generation = before.operationGeneration + 1, assessmentGeneration = (before.assessmentGeneration || 0) + 1;
    await this.search({ workspaceId, ...search });
    const state = this.sessions.get(workspaceId);
    invariant(state.operationGeneration === generation && state.assessmentGeneration === assessmentGeneration, 'STALE_RESULT', '新しい操作を優先したため、以前の検索からの提案を反映しませんでした。');
    if (!state.searchResultIds.length) return this.view(workspaceId);
    return this.assess({ workspaceId, placeIds: [...state.searchResultIds], priority, maxExtraDistanceMeters, _showAll:true });
  }
  async assess({ workspaceId, placeIds, routeIds = [], priority = 'balanced', maxExtraDistanceMeters = 300, _showAll = false }) {
    const state = this.sessions.get(workspaceId);
    const ids = [...new Set(placeIds || (routeIds.length ? [] : state.searchResultIds.length ? state.searchResultIds : state.selectedPlaceId ? [state.selectedPlaceId] : []))];
    const places = ids.map(id => ({...this.place(state,id), kind:'place'}));
    const routes = [...new Set(routeIds)].map(id => {
      const r = state.routes.find(r=>r.id===id);
      invariant(r, 'ROUTE_NOT_FOUND', 'この相談で取得した経路を指定してください。');
      return {...r, kind:'route', name:`${this.place(state,r.fromId).name} → ${this.place(state,r.toId).name}`};
    });
    invariant(places.length + routes.length > 0, 'TARGET_REQUIRED', '比較する店舗・物件・経路を指定してください。');
    invariant(places.length <= 20 && routes.length <= 20, 'TOO_MANY_TARGETS', '比較対象が多すぎます。');
    const operation = state.operationGeneration, generation = (state.assessmentGeneration || 0) + 1;
    state.assessmentGeneration = generation;
    const conditions = structuredClone(state.conditions);
    const useSearch = places.length && ids.every(id=>state.searchResultIds.includes(id));
    const center = structuredClone(useSearch && state.searchContext ? state.searchContext.center : state.mapView.center);
    const groups = new Map();
    for (const target of [...places,...routes]) {
      const city = target.kind === 'route' ? reportRegion(this.place(state,target.fromId)) : reportRegion(target);
      const destinationCity = target.kind === 'route' ? reportRegion(this.place(state,target.toId)) : city;
      // Cross-region routes must not make unrelated local places/routes unavailable.
      const key = JSON.stringify([city,destinationCity]);
      if (!groups.has(key)) groups.set(key,{city,targets:[]});
      groups.get(key).targets.push(target);
    }
    const items = (await Promise.all([...groups.values()].map(async ({city,targets}) => {
      const points = targets.filter(t=>t.kind==='place');
      const paths = targets.filter(t=>t.kind==='route');
      const endpoints = paths.flatMap(r=>[this.place(state,r.fromId),this.place(state,r.toId)]);
      const report = city ? await this.reportContext([...points,...endpoints],paths,conditions) : this.unavailableReport(new AppError('REPORT_UNSUPPORTED','この地域の公開報告は未対応です。'));
      return targets.map(target=>assessTarget({target,report,city,conditions,center}));
    }))).flat();
    const current = this.sessions.get(workspaceId, {touch:false});
    invariant(current.assessmentGeneration === generation && current.operationGeneration === operation, 'STALE_RESULT', '新しい操作を優先したため、比較結果を更新しませんでした。');
    invariant(routes.every(route=>current.routes.some(r=>r.id===route.id)), 'STALE_RESULT', '経路が更新されたため、古い経路の比較を反映しませんでした。');
    const assessment = { items, proposal: compareEvidence(items,{priority,maxExtraDistanceMeters}), conditions, center,
      search: useSearch ? structuredClone(state.searchContext) : null, createdAt:new Date().toISOString() };
    this.sessions.update(workspaceId, s => {
      s.assessment = assessment;
      const chosen = assessment.proposal.recommendedPlaceId;
      if (chosen) { s.selectedPlaceId=chosen; s.focus={type:'place',placeId:chosen}; s.activePairId=s.routePairs.find(p=>p.comparisonId===chosen)?.id || null; }
      if (_showAll && places.length) {
        // Reuse the existing camera protocol so all discovered candidates are visible.
        const extent = Math.max(300, ...assessment.items.filter(i=>i.kind==='place').map(i=>i.distanceMeters));
        const zoom = Math.max(3,Math.min(16,Math.floor(Math.log2(156543.03392*Math.cos(center.lat*Math.PI/180)*180/(2*extent)))));
        const command = {id:(s.mapView.command?.id || 0)+1,center,zoom};
        s.mapView={...s.mapView,center,zoom,bounds:boundsAround(center,extent),revision:s.mapView.revision+1,command};
      }
    });
    return this.view(workspaceId);
  }
  async select({ workspaceId, placeId, role, routeId, leg, expectedVersion }) {
    const state = this.sessions.get(workspaceId);
    if (expectedVersion !== undefined && expectedVersion !== state.version) throw new AppError('STALE_VIEW', '候補が更新されています。最新の画面を確認して選び直してください。');
    if (placeId) this.place(state, placeId);
    if (routeId) {
      const route = state.routes.find(r => r.id === routeId);
      invariant(route, 'ROUTE_NOT_FOUND', 'この相談で取得したルートを選んでください。');
      invariant(route.extraSeconds <= state.conditions.maxDetourMinutes * 60, 'DETOUR_EXCEEDED', '遠回りの上限を超える経路です。条件を変更するか経路を更新してください。');
      invariant(route.destinationId === (placeId || state.selectedPlaceId) && (!leg || route.leg === leg), 'ROUTE_MISMATCH', '選択中の候補と向きに対応するルートを選んでください。');
    }
    this.sessions.update(workspaceId, current => {
      if (placeId) {
        this.pin(current, [placeId]);
        if (role === 'origin') {
          current.originId = placeId; this.invalidate(current, { routes: true });
          if (current.selectedPlaceId === placeId) current.selectedPlaceId = current.places.find(p => p.id !== placeId)?.id || null;
        } else {
          current.selectedPlaceId = placeId; current.focus = { type: 'place', placeId };
          current.operationGeneration++;
          if (current.busy) this.invalidate(current);
        }
      }
      if (leg) current.leg = leg;
      if (routeId) {
        const route = current.routes.find(r => r.id === routeId);
        current.selectedRoutes[`${route.destinationId}:${route.leg}`] = routeId; current.leg = route.leg;
      }
      current.activePairId = current.routePairs.find(p => p.comparisonId === current.selectedPlaceId)?.id || null;
    });
    return this.view(workspaceId);
  }
  async conditions({ workspaceId, resetRoundTripLimit, ...changes }) {
    if (resetRoundTripLimit) changes.maxRoundTripMinutes = null;
    if (changes.categories) changes.categories = [...new Set(changes.categories)];
    this.sessions.update(workspaceId, s => {
      s.conditions = { ...s.conditions, ...changes };
      s.assessment = null;
      this.invalidate(s);
      // Keep returned alternatives for re-evaluation, but never leave an over-limit selection active.
      for (const pair of s.routePairs) for (const leg of ['out', 'back']) {
        const key = `${pair.comparisonId}:${leg}`;
        const selected = s.routes.find(r => r.id === s.selectedRoutes[key]);
        if (selected?.extraSeconds > s.conditions.maxDetourMinutes * 60) s.selectedRoutes[key] = s.routes.find(r => r.pairId === pair.id && r.leg === leg && r.extraSeconds === 0)?.id || null;
      }
      if (changes.categories || changes.radiusMeters) s.report = null;
    });
    if (changes.categories || changes.radiusMeters) {
      void this.layer({ workspaceId }).catch(() => {});
      await this.analyze({ workspaceId, scope: 'comparison' });
    }
    return this.view(workspaceId);
  }
  async plan({ workspaceId, destinationIds, maxDetourMinutes }) {
    const state = this.sessions.get(workspaceId);
    invariant(state.originId, 'ORIGIN_REQUIRED', '徒歩経路の出発地を選んでください。');
    const ids = [...new Set(destinationIds?.length ? destinationIds : state.selectedPlaceId ? [state.selectedPlaceId] : [])];
    invariant(ids.length > 0 && ids.length <= 5, 'DESTINATION_REQUIRED', '比較する行き先を1〜5件選んでください。');
    if (maxDetourMinutes !== undefined) await this.conditions({ workspaceId, maxDetourMinutes });
    return this.compare({ workspaceId, pairs: ids.map(toId => ({ fromId: state.originId, toId, comparisonId: toId })) });
  }
  async compare({ workspaceId, pairs }) {
    const state = this.sessions.get(workspaceId);
    invariant(pairs?.length > 0 && pairs.length <= 5, 'DESTINATION_REQUIRED', '比較する組を1〜5件指定してください。');
    const routePairs = pairs.map(pair => {
      const from = this.place(state, pair.fromId), to = this.place(state, pair.toId), comparisonId = pair.comparisonId || pair.fromId;
      invariant(from.id !== to.id, 'SAME_LOCATION', '異なる2地点を指定してください。');
      invariant([from.id, to.id].includes(comparisonId), 'ROUTE_MISMATCH', '比較対象は経路の端点を指定してください。');
      return { id: randomUUID(), fromId: from.id, toId: to.id, comparisonId };
    });
    invariant(new Set(routePairs.map(p => p.comparisonId)).size === routePairs.length, 'ROUTE_MISMATCH', '同じ比較対象に複数の経路の組は指定できません。');
    const generation = state.contextGeneration + 1;
    const maxDetourMinutes = state.conditions.maxDetourMinutes;
    this.sessions.update(workspaceId, s => { s.contextGeneration = generation; s.busy = true; s.notices = []; if (s.assessment?.items.some(i=>i.kind==='route')) s.assessment=null; s.assessmentGeneration++; });
    const isCurrent = () => this.sessions.get(workspaceId).contextGeneration === generation;
    try {
      const results = await Promise.all(routePairs.flatMap(pair => ['out', 'back'].map(async leg => {
        const fromId = leg === 'out' ? pair.fromId : pair.toId, toId = leg === 'out' ? pair.toId : pair.fromId;
        try {
          const routes = (await this.google.walking(this.place(state, fromId), this.place(state, toId))).sort((a,b) => a.durationSeconds - b.durationSeconds);
          if (!routes.length) return { routes: [], notice: '一部の向きの徒歩経路を取得できません。往復条件は判定できません。' };
          const shortest = routes[0].durationSeconds;
          const filtered = routes.filter(r => r.durationSeconds <= shortest + maxDetourMinutes * 60).slice(0, 2);
          return { routes: filtered.map((route, index) => ({ ...route, pairId: pair.id, fromId, toId, destinationId: pair.comparisonId, originId: pair.fromId, leg, name: index === 0 ? '最短候補' : '別の道', extraSeconds: route.durationSeconds - shortest, extraMinutes: Math.ceil((route.durationSeconds - shortest) / 60) })), notice: filtered.length < 2 ? '条件内の別経路を取得できない向きがあります。' : null };
        } catch (error) { return { routes: [], error }; }
      })));
      const routes = results.flatMap(r => r.routes);
      if (!routes.length && results.find(r => r.error)) throw results.find(r => r.error).error;
      const targets = [...new Set(routePairs.flatMap(p => [p.fromId, p.toId]))].map(id => this.place(state, id));
      const report = await this.reportContext(targets, routes, state.conditions);
      invariant(isCurrent(), 'STALE_RESULT', '新しい操作を優先したため、古い結果は反映しませんでした。');
      this.sessions.update(workspaceId, s => {
        s.routes = routes; s.routePairs = routePairs; s.report = report; s.selectedRoutes = {};
        this.pin(s, targets.map(p => p.id));
        for (const route of routes) {
          const key = `${route.destinationId}:${route.leg}`;
          if (!s.selectedRoutes[key]) s.selectedRoutes[key] = route.id;
        }
        const ids = routePairs.map(p => p.comparisonId);
        s.selectedPlaceId = ids.includes(s.selectedPlaceId) ? s.selectedPlaceId : ids[0];
        s.activePairId = routePairs.find(p => p.comparisonId === s.selectedPlaceId).id;
        s.busy = false; s.notices = [...new Set(results.map(r => r.notice || (r.error ? '一部の徒歩経路を取得できませんでした。' : null)).filter(Boolean))];
      });
      return this.view(workspaceId);
    } catch (error) {
      try { if (isCurrent()) this.sessions.update(workspaceId, s => { s.busy = false; }); } catch {}
      throw error;
    }
  }
  unavailableReport(error) {
    return { comparable: false, status: 'unavailable', incidents: [], routeCounts: [], areaCounts: [], categories: [], limitations: ['報告情報を取得できません。安全性について判断できません。'], error: { code: error.code || 'REPORT_UNAVAILABLE', message: error instanceof AppError ? error.message : '報告情報を取得できません。' } };
  }
  async reportContext(places, routes, conditions) {
    const regionIds = [...new Set(places.map(p => reportRegion(p) || 'unsupported'))];
    if (regionIds.length !== 1 || regionIds[0] === 'unsupported') {
      const regions = await Promise.all(regionIds.filter(id => id !== 'unsupported').map(async city => {
        try { return await this.reports.context(city, places.filter(p => reportRegion(p) === city), [], conditions); }
        catch (error) { return this.unavailableReport(error); }
      }));
      return { ...this.unavailableReport(new AppError('REPORT_NOT_COMPARABLE', '地域や対象期間が異なる、または未対応のため同一条件の件数比較はできません。')), regions, areaCounts: places.map(p => ({ placeId: p.id, count: null })), routeCounts: routes.map(r => ({ routeId: r.id, count: null })) };
    }
    const city = regionIds[0];
    // A path leaving the query region cannot be counted as zero outside it.
    const coveredRoutes = routes.filter(r => r.coordinates.every(([lng,lat]) => inBounds({lat,lng}, CITIES[city].bounds)));
    try {
      const report = await this.reports.context(city, places, coveredRoutes, conditions);
      for (const r of routes.filter(r => !coveredRoutes.includes(r))) report.routeCounts.push({ routeId: r.id, count: null });
      if (coveredRoutes.length !== routes.length) report.limitations.push('情報範囲外を通る経路は件数比較できません。');
      return report;
    } catch (error) { return this.unavailableReport(error); }
  }
  async analyze({ workspaceId, categories, radiusMeters, scope = 'focus' }) {
    const state = this.sessions.get(workspaceId);
    if (categories || radiusMeters) {
      const changed = (categories && [...categories].sort().join(',') !== [...state.conditions.categories].sort().join(',')) || (radiusMeters !== undefined && radiusMeters !== state.conditions.radiusMeters);
      if (changed) {
        // Use the same invalidation and route recount as the explicit conditions action.
        await this.conditions({workspaceId,...(categories ? {categories} : {}),...(radiusMeters !== undefined ? {radiusMeters} : {})});
      } else void this.layer({ workspaceId }).catch(() => {});
    }
    if (scope === 'viewport' || (scope === 'focus' && state.focus.type === 'viewport')) {
      this.sessions.update(workspaceId, s => { s.focusReport = null; if (!s.routes.length) s.report = null; });
      return this.layer({ workspaceId });
    }
    const generation = ++state.contextGeneration;
    let places = scope === 'comparison' ? state.places.filter(p => state.comparisonIds.includes(p.id)) : state.focus.type === 'place' ? [this.place(state, state.focus.placeId)] : [{ id: 'focused-point', name: '地図で指定した地点', address: '', ...state.focus.point }];
    if (scope === 'focus' && state.focus.type === 'point' && reportRegion(places[0]) === 'shibuya') {
      try { const address = await this.google.reverse(places[0], 'shibuya'); if (address) places[0] = { ...places[0], ...address }; } catch {}
    }
    const report = await this.reportContext(places, scope === 'comparison' ? state.routes : [], state.conditions);
    invariant(this.sessions.get(workspaceId).contextGeneration === generation, 'STALE_RESULT', '新しい操作があるため集計を更新できませんでした。');
    this.sessions.update(workspaceId, s => { s.focusReport = { ...report, target: structuredClone(s.focus) }; if (!s.routes.length || scope === 'comparison') s.report = report; s.busy = false; });
    return this.view(workspaceId);
  }
  async remove({ workspaceId, placeId }) {
    const state = this.sessions.get(workspaceId); this.place(state, placeId);
    this.sessions.update(workspaceId, s => {
      s.assessment = null;
      s.places = s.places.filter(p => p.id !== placeId); s.routes = s.routes.filter(r => r.fromId !== placeId && r.toId !== placeId);
      s.routePairs = s.routePairs.filter(p => p.fromId !== placeId && p.toId !== placeId);
      s.comparisonIds = s.comparisonIds.filter(id => id !== placeId); s.searchResultIds = s.searchResultIds.filter(id => id !== placeId);
      s.selectedRoutes = Object.fromEntries(Object.entries(s.selectedRoutes).filter(([, id]) => s.routes.some(r => r.id === id)));
      if (s.originId === placeId) s.originId = null;
      if (s.selectedPlaceId === placeId) s.selectedPlaceId = s.places.find(p => p.id !== s.originId)?.id || null;
      if (s.focus.placeId === placeId) s.focus = { type: 'viewport' };
      s.activePairId = s.routePairs.find(p => p.comparisonId === s.selectedPlaceId)?.id || null;
      s.report = null; this.invalidate(s);
    });
    return this.view(workspaceId);
  }
  async clear({ workspaceId }) { this.sessions.delete(workspaceId); return { closed: true }; }
}
