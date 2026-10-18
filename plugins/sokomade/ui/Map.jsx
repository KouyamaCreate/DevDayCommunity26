import { createElement, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import { reportGrid } from './report-grid.mjs';
import { candidateLetter } from './presentation.mjs';
import { Plus, Minus, Crosshair, House, Briefcase, Bed } from '@phosphor-icons/react';

let googlePromise;
function loadGoogle(key) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (!googlePromise) googlePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { googlePromise = null; reject(new Error('地図の読み込みに時間がかかっています。ネットワークを確認してページを再読み込みしてください。')); }, 20000);
    window.__sokomadeGoogleReady = () => { clearTimeout(timeout); resolve(window.google.maps); };
    window.gm_authFailure = () => { clearTimeout(timeout); googlePromise = null; reject(new Error('地図のAPIキー・参照元制限・請求設定を確認してください。')); };
    const script = document.createElement('script');
    const params = new URLSearchParams({ key, callback: '__sokomadeGoogleReady', v: 'weekly', loading: 'async', language: 'ja' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onerror = () => { clearTimeout(timeout); googlePromise = null; reject(new Error('地図サービスに接続できません。ネットワークを確認してください。')); };
    document.head.append(script);
  });
  return googlePromise;
}
const COLORS = ['#0969f5', '#9461dc'];
function labelOverlay(maps,map,position,element,dispose) {
  const overlay=new maps.OverlayView();
  overlay.onAdd=()=>{overlay.getPanes().floatPane.append(element);maps.OverlayView.preventMapHitsAndGesturesFrom(element);};
  overlay.draw=()=>{const p=overlay.getProjection()?.fromLatLngToDivPixel(new maps.LatLng(position));if(p){element.style.left=`${p.x}px`;element.style.top=`${p.y}px`;}};
  overlay.onRemove=()=>{element.remove();if(dispose)queueMicrotask(dispose);};
  overlay.setMap(map);return overlay;
}
export function MapCanvas({ workspace, browserKey, city, onSelect, onViewport, onFocus, bothPaths = false, layerVisible = true, onInspect }) {
  const container = useRef(null);
  const engine = useRef(null);
  const overlays = useRef([]);
  const fitKey = useRef('');
  const sizeBucket = useRef(null);
  const currentSelect = useRef(onSelect);
  const current = useRef({ workspace, onViewport, onFocus });
  const appliedCommand = useRef(0);
  const userInteraction = useRef(false);
  current.current = { workspace, onViewport, onFocus };
  const [ready, setReady] = useState(0);
  const [error, setError] = useState('');
  currentSelect.current = args => { userInteraction.current = false; return onSelect(args); };
  useEffect(() => {
    let cancelled = false;
    setError('');
    const resize = new ResizeObserver(() => { const node=container.current;if(!node)return;const width=node.clientWidth; const bucket=width>1000?'desktop':width>700?'tablet':'mobile'; if(sizeBucket.current!==bucket){sizeBucket.current=bucket;fitKey.current='';if(engine.current)setReady(v=>v+1);} const e = engine.current; if (e?.type === 'google') e.maps.event.trigger(e.map, 'resize'); else e?.map.invalidateSize(); });
    resize.observe(container.current);
    const start = async () => {
      if (browserKey) {
        const maps = await loadGoogle(browserKey);
        if (cancelled) return;
        engine.current = { type: 'google', maps, map: new maps.Map(container.current, { center: workspace.mapView?.center || city.center, zoom: workspace.mapView?.zoom || 16, disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy', mapTypeControl: false, styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
          { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
          { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#deedcf' }] },
          { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f1f3f2' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
          { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7b8797' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9e8f6' }] },
          { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#7b8797' }] },
        ] }) };
      } else {
        const map = L.map(container.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false }).setView([workspace.mapView?.center.lat || city.center.lat, workspace.mapView?.center.lng || city.center.lng], workspace.mapView?.zoom || 16);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
        engine.current = { type: 'leaflet', map };
      }
      appliedCommand.current = current.current.workspace.mapView?.command?.id || 0;
      const e = engine.current;
      const emitViewport = () => {
        if (cancelled || !e.map) return;
        const w = current.current.workspace;
        const bounds = e.map.getBounds(); const center = e.map.getCenter();
        if (!bounds || !center) return;
        const box = e.type === 'google' ? bounds.toJSON() : { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() };
        box.south = Math.max(-85, box.south); box.north = Math.min(85, box.north);
        // Very wide/world-wrap views have no single supported rectangular query.
        if (box.west < -180 || box.east > 180 || box.west >= box.east) { box.west = -180; box.east = 180; }
        const point = e.type === 'google' ? center.toJSON() : { lat: center.lat, lng: ((center.lng + 180) % 360 + 360) % 360 - 180 };
        const interaction = userInteraction.current; userInteraction.current = false;
        current.current.onViewport?.({ workspaceId: w.id, center: point, bounds: box, zoom: e.map.getZoom(), commandId: appliedCommand.current, interaction });
      };
      if (e.type === 'google') {
        e.map.addListener('idle', emitViewport);
        e.map.addListener('click', event => { userInteraction.current = false; if (event.latLng) current.current.onFocus?.({ workspaceId: current.current.workspace.id, point: event.latLng.toJSON() }); });
      } else {
        e.map.on('moveend', emitViewport);
        e.map.on('click', event => { userInteraction.current = false; current.current.onFocus?.({ workspaceId: current.current.workspace.id, point: { lat: event.latlng.lat, lng: ((event.latlng.lng + 180) % 360 + 360) % 360 - 180 } }); });
        emitViewport();
      }
      setReady(value => value + 1);
    };
    start().catch(e => { if (!cancelled) setError(e.message); });
    return () => {
      cancelled = true; resize.disconnect();
      for (const item of overlays.current) item.setMap ? item.setMap(null) : item.remove?.();
      overlays.current = [];
      if (engine.current?.type === 'leaflet') engine.current.map.remove();
      engine.current = null;
      fitKey.current = ''; appliedCommand.current = 0; userInteraction.current = false;
    };
  }, [browserKey, workspace.id]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    for (const item of overlays.current) item.setMap ? item.setMap(null) : item.remove?.();
    overlays.current = [];
    const add = item => { overlays.current.push(item); return item; };
    // Google-provided places/routes are never placed on a non-Google basemap.
    const propertyMode = workspace.places.find(p=>p.id===workspace.selectedPlaceId)?.role === 'property';
    const propertyPairs = workspace.routePairs.filter(pair=>workspace.places.some(p=>p.id===pair.comparisonId && p.role==='property'));
    const contextIds = new Set(propertyPairs.flatMap(p=>[p.fromId,p.toId]));
    const places = workspace.places.filter(p => (e.type === 'google' || !p.source?.startsWith('google')) && (!propertyMode || !propertyPairs.length || contextIds.has(p.id)));
    const routes = workspace.routes.filter(r => r.leg === workspace.leg && r.extraSeconds <= (workspace.conditions?.maxDetourMinutes ?? 5) * 60 && e.type === 'google' && (bothPaths && propertyMode ? workspace.places.some(p=>p.id===r.destinationId && p.role==='property') && r.id === workspace.selectedRoutes[`${r.destinationId}:${r.leg}`] : r.destinationId === workspace.selectedPlaceId && (!propertyMode || r.id === workspace.selectedRoutes[`${r.destinationId}:${r.leg}`])));
    const selectedId = workspace.selectedRoutes[`${workspace.selectedPlaceId}:${workspace.leg}`] || routes[0]?.id;
    const bounds = [];
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const selected = route.id === selectedId;
      const color = bothPaths && propertyMode ? (route.destinationId === workspace.selectedPlaceId ? COLORS[0] : '#8592a8') : COLORS[i % COLORS.length];
      const path = route.coordinates.map(([lng, lat]) => ({ lat, lng }));
      bounds.push(...path);
      if (e.type === 'google') {
        add(new e.maps.Polyline({ map: e.map, path, strokeColor: '#fff', strokeOpacity: 1, strokeWeight: selected ? 11 : 8, zIndex: selected ? 5 : 2, clickable: false }));
        const line = add(new e.maps.Polyline({ map: e.map, path, strokeColor: color, strokeOpacity: i > 0 && !propertyMode ? 0 : selected ? 1 : .65, icons: i > 0 && !propertyMode ? [{ icon: { path:e.maps.SymbolPath.CIRCLE, scale:3, fillColor:color,fillOpacity:1,strokeOpacity:0 },offset:'0',repeat:'12px'}] : undefined, strokeWeight: selected ? 6 : 4, zIndex: selected ? 6 : 3 }));
        line.addListener('click', () => currentSelect.current({ routeId: route.id, leg: route.leg }));
        const halfway = path[Math.floor(path.length / 2)];
        const chip=document.createElement('button');chip.className=`map-route-label ${i && !propertyMode?'alternate':''}`;
        chip.textContent=`徒歩 ${route.minutes}分${route.extraSeconds>0?` ＋${route.extraSeconds<60?'1分未満':`${route.extraMinutes}分`}`:''}`;
        chip.setAttribute('aria-label',`${route.minutes}分のルートを選択`);
        chip.onclick=()=>currentSelect.current({placeId:route.destinationId,routeId:route.id,leg:route.leg});
        add(labelOverlay(e.maps,e.map,halfway,chip));
      }
    }
    if(layerVisible) for(const cell of reportGrid(workspace.reportLayer)) {
      if(e.type==='google') add(new e.maps.Rectangle({map:e.map,bounds:cell.bounds,fillColor:'#da9224',fillOpacity:cell.opacity,strokeWeight:0,clickable:false,zIndex:0}));
      else add(L.rectangle([[cell.bounds.south,cell.bounds.west],[cell.bounds.north,cell.bounds.east]],{fillColor:'#da9224',fillOpacity:cell.opacity,weight:0,interactive:false}).addTo(e.map));
    }
    if(workspace.focus.type==='point') {
      const p=workspace.focus.point;
      if(e.type==='google') {
        add(new e.maps.Marker({map:e.map,position:p,icon:{path:e.maps.SymbolPath.CIRCLE,scale:7,fillColor:COLORS[0],fillOpacity:1,strokeColor:'#fff',strokeWeight:3},zIndex:30,title:'選んだ地点'}));
        const callout=document.createElement('div');callout.className='point-callout';
        const title=document.createElement('strong');title.textContent='選んだ地点';callout.append(title);
        const button=document.createElement('button');button.textContent='ここについて調べる →';button.onclick=()=>onInspect?.();callout.append(button);
        add(labelOverlay(e.maps,e.map,p,callout));
      } else add(L.circleMarker([p.lat,p.lng],{radius:7,color:'#fff',weight:3,fillColor:COLORS[0],fillOpacity:1}).addTo(e.map).bindTooltip('選んだ地点'));
    }
    for (const place of places) {
      const origin = !propertyMode && place.id === workspace.originId;
      const selected = place.id === workspace.selectedPlaceId;
      const work = propertyMode && propertyPairs.some(p=>p.toId===place.id && place.role!=='property');
      const Icon = place.role==='property'?House:work?Briefcase:/hotel|ホテル|宿泊/i.test(place.name)?Bed:null;
      if (origin || selected) bounds.push(place);
      if (e.type === 'google') {
        const marker = add(new e.maps.Marker({ map: e.map, position: place, title: `${place.name}${origin ? '（出発地）' : ''}`, label: Icon ? undefined : { text: origin ? '発' : candidateLetter(workspace,place.id) || String(workspace.places.filter(p => p.id !== workspace.originId).findIndex(p => p.id === place.id) + 1), color: '#fff', fontWeight: '700', fontSize: '12px' }, icon: { path: e.maps.SymbolPath.CIRCLE, scale: selected || origin || work ? 18 : 14, fillColor: origin || work ? '#34445c' : selected ? '#0969f5' : '#7b8697', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }, zIndex: 20 }));
        if(Icon) {
          const glyph=document.createElement(origin?'span':'button');glyph.className='map-place-icon';glyph.setAttribute('aria-label',place.name);
          if(!origin)glyph.onclick=()=>currentSelect.current({placeId:place.id});
          const root=createRoot(glyph);root.render(createElement(Icon,{size:21,weight:'fill',color:'#fff'}));
          add(labelOverlay(e.maps,e.map,place,glyph,()=>root.unmount()));
        }
        if (!origin) marker.addListener('click', () => currentSelect.current({ placeId: place.id }));
        if (selected || origin || workspace.routePairs.some(p=>p.fromId===place.id || p.toId===place.id)) {
          const label=document.createElement(origin?'span':'button');label.className='map-place-name';
          label.textContent=`${candidateLetter(workspace,place.id) || ''} ${place.name.length > 17 ? place.name.slice(0,16)+'…' : place.name}`.trim();
          if(!origin)label.onclick=()=>currentSelect.current({placeId:place.id});
          add(labelOverlay(e.maps,e.map,place,label));
        }
      } else {
        const marker = add(L.circleMarker([place.lat, place.lng], { radius: selected || origin ? 11 : 8, color: '#fff', weight: 3, fillColor: origin ? '#34445c' : selected ? '#0969f5' : '#7b8697', fillOpacity: 1 }).addTo(e.map));
        const label = document.createElement('span'); label.textContent = place.name;
        marker.bindTooltip(label, { permanent: selected || origin, direction: 'bottom', offset: [0, 10] });
        if (!origin) marker.on('click', event => { L.DomEvent.stopPropagation(event); currentSelect.current({ placeId: place.id }); });
      }
    }
    const key = `${city.id}:${places.map(p => p.id).join(',')}:${workspace.selectedPlaceId}:${routes.map(r => r.id).join(',')}`;
    const command = workspace.mapView?.command;
    if (command && appliedCommand.current !== command.id) {
      appliedCommand.current = command.id; fitKey.current = key;
      if (e.type === 'google') { e.map.setCenter(command.center); e.map.setZoom(command.zoom); }
      else e.map.setView([command.center.lat, command.center.lng], command.zoom);
    }
    if (bounds.length && fitKey.current !== key) {
      fitKey.current = key;
      if (e.type === 'google') {
        const box = new e.maps.LatLngBounds(); bounds.forEach(p => box.extend(p)); e.map.fitBounds(box, {top:65,right:Math.min(320,container.current.clientWidth*.2),bottom:container.current.clientWidth<=700?Math.min(container.current.clientHeight*.6,450):100,left:container.current.clientWidth>1000?620:container.current.clientWidth>700?500:55});
        if (bounds.length === 1) e.maps.event.addListenerOnce(e.map, 'idle', () => { if (e.map.getZoom() > 16) e.map.setZoom(16); });
      } else e.map.fitBounds(bounds.map(p => [p.lat, p.lng]), {paddingTopLeft:[container.current.clientWidth>1000?620:container.current.clientWidth>700?500:50,65],paddingBottomRight:[70,container.current.clientWidth<=700?Math.min(container.current.clientHeight*.6,450):110],maxZoom:16});
    }
  }, [workspace, ready, city.id, bothPaths, layerVisible]);
  const reportCity = workspace.reportLayer?.regions?.[0]?.city || workspace.report?.city;
  const zoom = value => { userInteraction.current = true; const e = engine.current; if (!e) return; if (e.type === 'google') e.map.setZoom(e.map.getZoom() + value); else e.map.setZoom(e.map.getZoom() + value); };
  const reset = () => {
    userInteraction.current = true;
    const e = engine.current;
    if (!e) return;
    if (e.type === 'google') { e.map.setCenter(city.center); e.map.setZoom(16); }
    else e.map.setView([workspace.mapView?.center.lat || city.center.lat, workspace.mapView?.center.lng || city.center.lng], workspace.mapView?.zoom || 16);
  };
  return <div className="map-area"><div className="map-surface" ref={container} onPointerDown={() => { userInteraction.current = true; }} onWheel={() => { userInteraction.current = true; }} onKeyDown={() => { userInteraction.current = true; }} role="region" aria-busy={!ready && !error} aria-label={`表示中の地図。${workspace.leg === 'out' ? '行き' : '帰り'}を表示中`}/>{!ready && !error && <div className="map-loading" role="status">地図を読み込んでいます…</div>}{error && <div className="map-error" role="alert">{error}</div>}<div className="map-controls"><button aria-label="地図を拡大" onClick={() => zoom(1)}><Plus size={19}/></button><button aria-label="地図を縮小" onClick={() => zoom(-1)}><Minus size={19}/></button><button aria-label="地域全体を表示" onClick={reset}><Crosshair size={19}/></button></div><div className="map-caption">{reportCity === 'sf' ? '濃淡は約250m区画の公開位置の件数。無着色は安全を意味しません' : reportCity === 'shibuya' ? '報告情報は町丁目単位です。沿道の件数は比較しません' : '報告情報は取得した範囲だけ表示します'}</div></div>;
}
