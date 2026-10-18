import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Minus, Crosshair } from '@phosphor-icons/react';

let googlePromise;
function loadGoogle(key) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (!googlePromise) googlePromise = new Promise((resolve, reject) => {
    window.__sokomadeGoogleReady = () => resolve(window.google.maps);
    window.gm_authFailure = () => { googlePromise = null; reject(new Error('地図のAPIキー・参照元制限・請求設定を確認してください。')); };
    const script = document.createElement('script');
    const params = new URLSearchParams({ key, callback: '__sokomadeGoogleReady', v: 'weekly', loading: 'async', language: 'ja' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onerror = () => { googlePromise = null; reject(new Error('地図サービスに接続できません。ネットワークを確認してください。')); };
    document.head.append(script);
  });
  return googlePromise;
}
const COLORS = ['#0969f5', '#9461dc'];
function groupReports(incidents) {
  const groups = new Map();
  for (const incident of incidents || []) {
    const key = `${incident.lat},${incident.lng}`;
    if (!groups.has(key)) groups.set(key, { ...incident, count: 0 });
    groups.get(key).count += incident.count ?? 1;
  }
  return [...groups.values()];
}
export function MapCanvas({ workspace, browserKey, city, onSelect, onViewport, onFocus }) {
  const container = useRef(null);
  const engine = useRef(null);
  const overlays = useRef([]);
  const fitKey = useRef('');
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
    const resize = new ResizeObserver(() => { const e = engine.current; if (e?.type === 'google') e.maps.event.trigger(e.map, 'resize'); else e?.map.invalidateSize(); });
    resize.observe(container.current);
    const start = async () => {
      if (browserKey) {
        const maps = await loadGoogle(browserKey);
        if (cancelled) return;
        engine.current = { type: 'google', maps, map: new maps.Map(container.current, { center: workspace.mapView?.center || city.center, zoom: workspace.mapView?.zoom || 14, disableDefaultUI: true, clickableIcons: false, gestureHandling: 'cooperative', mapTypeControl: false, styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f1f3f2' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
          { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7b8797' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dce8ee' }] },
          { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#7b8797' }] },
        ] }) };
      } else {
        const map = L.map(container.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false }).setView([workspace.mapView?.center.lat || city.center.lat, workspace.mapView?.center.lng || city.center.lng], workspace.mapView?.zoom || 14);
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
    const places = workspace.places.filter(p => e.type === 'google' || !p.source?.startsWith('google'));
    const routes = workspace.routes.filter(r => r.destinationId === workspace.selectedPlaceId && r.leg === workspace.leg && r.extraSeconds <= (workspace.conditions?.maxDetourMinutes ?? 5) * 60 && e.type === 'google');
    const selectedId = workspace.selectedRoutes[`${workspace.selectedPlaceId}:${workspace.leg}`] || routes[0]?.id;
    const bounds = [];
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const selected = route.id === selectedId;
      const color = COLORS[i % COLORS.length];
      const path = route.coordinates.map(([lng, lat]) => ({ lat, lng }));
      bounds.push(...path);
      if (e.type === 'google') {
        add(new e.maps.Polyline({ map: e.map, path, strokeColor: '#fff', strokeOpacity: 1, strokeWeight: selected ? 11 : 8, zIndex: selected ? 5 : 2, clickable: false }));
        const line = add(new e.maps.Polyline({ map: e.map, path, strokeColor: color, strokeOpacity: selected ? 1 : 0.65, strokeWeight: selected ? 7 : 4, zIndex: selected ? 6 : 3 }));
        line.addListener('click', () => currentSelect.current({ routeId: route.id, leg: route.leg }));
        const halfway = path[Math.floor(path.length / 2)];
        const timeLabel = add(new e.maps.Marker({ map: e.map, position: halfway, title: `${route.minutes}分のルートを選択`, label: { text: `${route.minutes}分`, color, fontSize: '14px', fontWeight: '700' }, icon: { path: e.maps.SymbolPath.CIRCLE, scale: 22, fillColor: '#fff', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }, zIndex: 10 }));
        timeLabel.addListener('click', () => currentSelect.current({ routeId: route.id, leg: route.leg }));
      }
    }
    for (const incident of groupReports(workspace.reportLayer?.incidents || workspace.report?.incidents)) {
      if (e.type === 'google') {
        add(new e.maps.Marker({ map: e.map, position: incident, title: `匿名化された公開位置の報告 ${incident.count}件`, icon: { path: e.maps.SymbolPath.CIRCLE, scale: Math.min(12, 5 + Math.sqrt(incident.count)), fillColor: '#d5a046', fillOpacity: 0.8, strokeColor: '#fff', strokeWeight: 1.5 }, label: incident.count > 1 ? { text: String(incident.count), color: '#5b421e', fontSize: '10px' } : null, zIndex: 1 }));
      } else add(L.circleMarker([incident.lat, incident.lng], { radius: Math.min(12, 5 + Math.sqrt(incident.count)), color: '#fff', weight: 1.5, fillColor: '#d5a046', fillOpacity: 0.8 }).bindTooltip(`匿名化された公開位置の報告 ${incident.count}件`).addTo(e.map));
    }
    for (const place of places) {
      const origin = place.id === workspace.originId;
      const selected = place.id === workspace.selectedPlaceId;
      if (origin || selected) bounds.push(place);
      if (e.type === 'google') {
        const marker = add(new e.maps.Marker({ map: e.map, position: place, title: `${place.name}${origin ? '（出発地）' : ''}`, label: { text: origin ? '発' : String(workspace.places.filter(p => p.id !== workspace.originId).findIndex(p => p.id === place.id) + 1), color: '#fff', fontWeight: '700', fontSize: '12px' }, icon: { path: e.maps.SymbolPath.CIRCLE, scale: selected || origin ? 15 : 11, fillColor: origin ? '#34445c' : selected ? '#0969f5' : '#7b8697', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }, zIndex: 20 }));
        if (!origin) marker.addListener('click', () => currentSelect.current({ placeId: place.id }));
        if (selected || origin) {
          const label = add(new e.maps.Marker({ map: e.map, position: place, title: place.name, label: { text: place.name.length > 17 ? place.name.slice(0, 16) + '…' : place.name, color: '#263247', fontSize: '13px', fontWeight: '600' }, icon: { path: e.maps.SymbolPath.CIRCLE, scale: 0, labelOrigin: new e.maps.Point(0, 34) }, zIndex: 21 }));
          if (!origin) label.addListener('click', () => currentSelect.current({ placeId: place.id }));
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
        const box = new e.maps.LatLngBounds(); bounds.forEach(p => box.extend(p)); e.map.fitBounds(box, 90);
        if (bounds.length === 1) e.maps.event.addListenerOnce(e.map, 'idle', () => { if (e.map.getZoom() > 16) e.map.setZoom(16); });
      } else e.map.fitBounds(bounds.map(p => [p.lat, p.lng]), { padding: [50, 50], maxZoom: 16 });
    }
  }, [workspace, ready, city.id]);
  const reportCity = workspace.reportLayer?.regions?.[0]?.city || workspace.report?.city;
  const zoom = value => { userInteraction.current = true; const e = engine.current; if (!e) return; if (e.type === 'google') e.map.setZoom(e.map.getZoom() + value); else e.map.setZoom(e.map.getZoom() + value); };
  const reset = () => {
    userInteraction.current = true;
    const e = engine.current;
    if (!e) return;
    if (e.type === 'google') { e.map.setCenter(city.center); e.map.setZoom(14); }
    else e.map.setView([workspace.mapView?.center.lat || city.center.lat, workspace.mapView?.center.lng || city.center.lng], workspace.mapView?.zoom || 14);
  };
  return <div className="map-area"><div className="map-surface" ref={container} onPointerDown={() => { userInteraction.current = true; }} onWheel={() => { userInteraction.current = true; }} onKeyDown={() => { userInteraction.current = true; }} role="region" aria-label={`表示中の地図。${workspace.leg === 'out' ? '行き' : '帰り'}を表示中`}/>{error && <div className="map-error" role="alert">{error}</div>}<div className="map-controls"><button aria-label="地図を拡大" onClick={() => zoom(1)}><Plus size={19}/></button><button aria-label="地図を縮小" onClick={() => zoom(-1)}><Minus size={19}/></button><button aria-label="地域全体を表示" onClick={reset}><Crosshair size={19}/></button></div><div className="map-caption">{reportCity === 'sf' ? 'アンバーの点は匿名化された交差点の公開位置です' : reportCity === 'shibuya' ? '報告情報は町丁目単位です。沿道の件数は比較しません' : '報告情報は取得した範囲だけ表示します'}</div></div>;
}
