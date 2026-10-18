// Fixed geographic bins: ~250m north/south, same ground area at SF's latitude.
// No smoothing or per-viewport normalization; clipped edge cells are excluded.
const LAT = 250 / 111320;
const LNG = LAT / Math.cos(37.77 * Math.PI / 180);
export const GRID_STYLES = [
  { color: '#ffe6a0', opacity: .12 },
  { color: '#ffda78', opacity: .22 },
  { color: '#ffca55', opacity: .34 },
  { color: '#ffb936', opacity: .48 },
];
export const GRID_LABEL = '約250m区画内の公開位置の報告件数';
export function reportGrid(layer) {
  if (!layer || !layer.regions?.some(r => r.city === 'sf' && r.status === 'available')) return [];
  const b = layer.bounds;
  if (!b) return [];
  const groups = new Map();
  for (const p of layer.incidents || []) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !Number.isSafeInteger(p.count) || p.count < 1) continue;
    const y = Math.floor(p.lat / LAT), x = Math.floor(p.lng / LNG);
    const bounds = { south:y*LAT,north:(y+1)*LAT,west:x*LNG,east:(x+1)*LNG };
    if (bounds.south < b.south || bounds.north > b.north || bounds.west < b.west || bounds.east > b.east) continue;
    const key = `${x}:${y}`;
    if (!groups.has(key)) groups.set(key,{id:key,bounds,count:0});
    groups.get(key).count += p.count;
  }
  return [...groups.values()].map(cell => {
    const level = cell.count >= 20 ? 3 : cell.count >= 10 ? 2 : cell.count >= 5 ? 1 : 0;
    return { ...cell, level, ...GRID_STYLES[level] };
  });
}
export function layerMessage(layer) {
  if (!layer || layer.status === 'loading') return '公開報告を確認中';
  if (layer.status === 'unsupported') return 'この地域の報告データは未対応';
  if (layer.status === 'unavailable') return '報告情報を取得できません';
  if (layer.regions?.some(r => r.city === 'sf' && r.status === 'available')) return '匿名化された公開位置を約250m区画で集計';
  return '町丁目単位の情報のみ・境界未接続のため濃淡表示なし';
}
