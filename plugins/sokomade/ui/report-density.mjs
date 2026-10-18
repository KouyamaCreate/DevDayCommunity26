// A fixed, metre-based reference density, never normalized to the viewport.
export const DENSITY_MAX = 1500;
export const DENSITY_RADIUS = 250;
export const DENSITY_COLORS = [[255,244,211,0],[255,233,171,35],[255,210,110,82],[255,185,60,135],[230,155,32,165]];
export const DENSITY_LABEL = '公開位置を平滑化した参考分布';
export function layerMessage(layer) {
  if (!layer || layer.status === 'loading') return '公開報告を確認中';
  if (layer.status === 'unsupported') return 'この地域の報告データは未対応';
  if (layer.status === 'unavailable') return '報告情報を取得できません';
  if (layer.regions?.some(r => r.city === 'sf' && r.status === 'available')) return '色は参考分布。選んだ地点の周囲は実件数で確認';
  return '町丁目全体の認知件数・2020年の参考境界';
}

// Compact quartic kernel. Its integral is one report, with support radius R.
// Position weights are already deduplicated reports, not counts of source rows.
export function densityField(points, { width, height, pixelsPerMeter, radiusMeters = DENSITY_RADIUS, step = 4 }) {
  const columns = Math.ceil(width / step), rows = Math.ceil(height / step);
  const values = new Float32Array(columns * rows);
  const radius = radiusMeters * pixelsPerMeter;
  const norm = 3 / (Math.PI * (radiusMeters / 1000) ** 2);
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isSafeInteger(p.count) || p.count < 1) continue;
    const minX = Math.max(0, Math.ceil((p.x - radius) / step - .5)), maxX = Math.min(columns - 1, Math.floor((p.x + radius) / step - .5));
    const minY = Math.max(0, Math.ceil((p.y - radius) / step - .5)), maxY = Math.min(rows - 1, Math.floor((p.y + radius) / step - .5));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const d2 = (((x + .5) * step - p.x) ** 2 + ((y + .5) * step - p.y) ** 2) / radius ** 2;
      if (d2 < 1) values[y * columns + x] += p.count * norm * (1 - d2) ** 2;
    }
  }
  return { values, columns, rows };
}
export function densityColor(value, opacity = 1) {
  const t = Math.sqrt(Math.min(1, Math.max(0, value) / DENSITY_MAX)) * (DENSITY_COLORS.length - 1);
  const i = Math.min(DENSITY_COLORS.length - 2, Math.floor(t)), f = t - i;
  return DENSITY_COLORS[i].map((v, channel) => Math.min(255, Math.round((v + (DENSITY_COLORS[i + 1][channel] - v) * f) * (channel === 3 ? opacity : 1))));
}

// Only the latest report for the currently selected point is usable.
export function pointInspection(workspace) {
  if (workspace?.focus?.type !== 'point') return null;
  const report = workspace.focusReport, target = report?.target;
  if (!report || target?.type !== 'point' || target.point.lat !== workspace.focus.point.lat || target.point.lng !== workspace.focus.point.lng || (report.status !== 'unavailable' && report.categories?.join(',') !== workspace.conditions.categories.join(','))) return null;
  const area = report.areaCounts?.find(a=>a.placeId==='focused-point');
  return { report, area, label: area?.count == null ? 'この地点は情報不足' : area.area ? `${area.area}：${area.count}件（町丁目全体）` : `周囲${area.radiusMeters}mの公開報告：${area.count}件` };
}

export const AREA_MAX = 300;
export function areaColor(count, opacity = 1) {
  if (!Number.isSafeInteger(count) || count < 0) return [185,190,198,20];
  if (count === 0) return [255,244,211,Math.round(20*opacity)];
  return densityColor(count / AREA_MAX * DENSITY_MAX,opacity);
}
