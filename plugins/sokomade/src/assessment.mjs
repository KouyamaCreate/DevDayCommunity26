import { CITIES, boundsAround, inBounds, distanceMeters } from './spatial.mjs';

// A shared evidence record for shops, properties and directed walking routes.
// Counts describe published reports, never a probability of harm or a safety score.
export function assessTarget({ target, report, city, conditions, center }) {
  const route = target.kind === 'route';
  const row = (route ? report?.routeCounts : report?.areaCounts)?.find(r => (route ? r.routeId : r.placeId) === target.id);
  const unit = report?.precision === 'neighborhood' ? 'neighborhood' : route ? 'corridor' : 'radius';
  const scope = unit === 'neighborhood' ? row?.area || null : unit === 'corridor' ? report?.corridorMeters : conditions.radiusMeters;
  const window = city && CITIES[city]?.bounds;
  const box = !route && window ? boundsAround(target, conditions.radiusMeters) : null;
  const contained = route ? !!window && target.coordinates.every(([lng, lat]) => {
    const b = boundsAround({lat,lng}, report?.corridorMeters || 100);
    return inBounds({lat:b.south,lng:b.west},window) && inBounds({lat:b.north,lng:b.east},window);
  }) : !!box && inBounds({lat:box.south,lng:box.west},window) && inBounds({lat:box.north,lng:box.east},window);
  const count = Number.isInteger(row?.count) && row.count >= 0 ? row.count : null;
  const metadataOK = !!(report?.period?.start && report?.period?.end && report?.sourceURL && report?.fetchedAt);
  const status = !city ? 'unsupported' : !metadataOK || report?.status === 'unavailable' ? 'unavailable' : count === null ? 'unknown' : report.stale ? 'stale' : unit !== 'neighborhood' && !contained ? 'partial' : 'available';
  const canCompareCounts = status === 'available' && unit !== 'neighborhood';
  const comparisonKey = canCompareCounts ? JSON.stringify([city, report.sourceURL, report.period, [...conditions.categories].sort(), unit, scope, route?[target.fromId,target.toId]:null]) : null;
  const scopeLabel = unit === 'neighborhood' ? `${scope || '町丁目不明'}全体` : unit === 'corridor' ? `経路両側${scope}m` : `地点から半径${scope}m`;
  const evidence = {
    count, counts: row?.counts || null, status, city, unit, scope, scopeLabel,
    categories: [...conditions.categories], categoryLabels: report?.categoryLabels || [],
    period: report?.period || null, sourceURL: report?.sourceURL || null, sourceName: report?.sourceName || null,
    fetchedAt: report?.fetchedAt || null, updatedAt: report?.updatedAt || null, stale: !!report?.stale,
    precision: report?.precision || null, coverage: !city ? 'unsupported' : unit === 'neighborhood' ? scope ? 'neighborhood-address-match' : 'unknown' : contained ? 'within-query-window' : 'partial-query-window',
    comparisonKey, canCompareCounts,
    limitations: [...new Set([...(report?.limitations || []), '件数は安全度・被害確率ではありません。',
      ...(report?.error?.message ? [report.error.message] : []),
      '人通り・人口・面積などの違いを補正した危険度ではありません。',
      ...(unit === 'neighborhood' ? ['町丁目の面積や人口が異なるため、件数で店・物件の安全順位を付けません。'] : ['取得範囲は行政境界ではなく、すべての事件の網羅性は未確認です。']),
      ...(status === 'partial' ? ['集計範囲の一部が取得用の地域範囲外です。件数比較から除外します。'] : []),
      ...(status === 'stale' ? ['前回取得したデータです。提案の件数比較には使いません。'] : []),
      ...(count === null ? ['情報不足は0件を意味しません。'] : [])])],
  };
  return { targetId: target.id, kind: target.kind, name: target.name, role: target.role || null,
    placeId: route ? target.destinationId : target.id,
    ...(route ? {fromId:target.fromId,toId:target.toId,leg:target.leg} : {}),
    distanceMeters: !route && center ? Math.round(distanceMeters(center, target)) : null,
    durationSeconds: route ? target.durationSeconds : null,
    openNow: route ? null : target.openingHours?.openNow ?? null,
    priceLevel: target.priceLevel || null, evidence,
    explanation: count === null ? `${scopeLabel}：情報不足` : `${scopeLabel}の公開報告 ${count}件（${report.period?.label || '期間不明'}）`,
  };
}

export function compareEvidence(items, { priority = 'balanced', maxExtraDistanceMeters = 300 } = {}) {
  const places = items.filter(i => i.kind === 'place');
  if (!places.length) return { comparable:false, priority, maxExtraDistanceMeters:null, basis:'route-evidence', recommendedPlaceId:null, shortlistIds:[], excludedIds:[],
    reason:'取得済み経路の時間と公開報告を共通形式で確認できます。向き・期間・種別・沿道幅を揃えて比較してください。',
    limitations:['町丁目集計を沿道の件数に変換しません。','経路の長さによって集計面積が異なります。件数は安全順位ではありません。'] };
  const keys = new Set(places.map(i => i.evidence.comparisonKey));
  const comparable = places.length > 0 && keys.size === 1 && !keys.has(null);
  // Never turn unknown values into zero, rank unlike neighborhoods, or prefer stale data.
  const ready = places.filter(i => i.evidence.status === 'available' && i.openNow !== false);
  let candidates = ready;
  if (comparable && priority === 'fewer-reports') {
    const minimum = Math.min(...ready.map(i => i.evidence.count));
    candidates = ready.filter(i => i.evidence.count === minimum);
  } else if (comparable && priority === 'balanced') {
    const nearest = Math.min(...ready.map(i=>i.distanceMeters));
    const nearby = ready.filter(i=>i.distanceMeters <= nearest + maxExtraDistanceMeters);
    const minimum = Math.min(...nearby.map(i=>i.evidence.count));
    candidates = nearby.filter(i=>i.evidence.count === minimum);
  }
  candidates = [...candidates].sort((a,b) => a.distanceMeters - b.distanceMeters || a.targetId.localeCompare(b.targetId));
  const proposed = candidates[0];
  const basis = !proposed ? 'insufficient-evidence' : comparable && priority !== 'nearby' ? 'published-reports-and-distance' : 'distance-with-area-context';
  const reason = !proposed ? '周辺情報を確認できる営業中・営業時間不明の候補がありません。検索条件やデータの状態を確認してください。'
    : basis === 'published-reports-and-distance' ? `${proposed.name}を参考候補にします。同じ期間・種別・半径の公開報告${proposed.evidence.count}件と検索中心からの直線距離${proposed.distanceMeters}mを比較しました。${priority === 'fewer-reports' ? '公開報告が少ない候補を優先し、同数なら近い候補を選んでいます。' : `最も近い候補から直線距離が${maxExtraDistanceMeters}m余分以内の候補に絞り、その中で公開報告が少ないものを選んでいます。同数なら近さを優先します。`}安全性の順位ではありません。`
    : `${proposed.name}を距離からの参考候補にします（検索中心から直線${proposed.distanceMeters}m）。${comparable ? '近さを優先しています。' : '町丁目単位の情報や条件・取得状態が異なる情報は、件数による順位付けはしていません。'}${proposed.explanation}。`;
  return { comparable, priority, maxExtraDistanceMeters:comparable && priority==='balanced'?maxExtraDistanceMeters:null, basis, recommendedPlaceId: proposed?.targetId || null, shortlistIds: candidates.map(i=>i.targetId),
    reason, excludedIds: places.filter(i => !ready.includes(i)).map(i=>i.targetId),
    limitations: ['対象は今回取得した候補のみです。', '直線距離は徒歩時間ではありません。', '営業状態は店舗検索の取得時点です。',
      ...(!comparable ? ['町丁目件数・異なる条件・情報不足を共通の安全ランキングへ変換しません。'] : [])] };
}
