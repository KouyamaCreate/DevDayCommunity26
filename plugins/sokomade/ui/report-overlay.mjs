import { GRID_STYLES } from './report-grid.mjs';

// Only soften the inside edge of each published aggregate. Never spread a
// count into adjacent cells or imply a more precise centre of occurrence.
export const GRID_EDGE_RATIO = .12; // ~30m of a 250m cell
export function gridStamp(document, { color, opacity }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  for (const [x, y] of [[size, 0], [0, size]]) {
    const fade = ctx.createLinearGradient(0, 0, x, y);
    fade.addColorStop(0, 'transparent');
    fade.addColorStop(GRID_EDGE_RATIO, '#000');
    fade.addColorStop(1 - GRID_EDGE_RATIO, '#000');
    fade.addColorStop(1, 'transparent');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

export function googleReportOverlay(maps, map, cells) {
  const overlay = new maps.OverlayView();
  const canvas = document.createElement('canvas');
  canvas.className = 'report-grid-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const stamps = GRID_STYLES.map(style => gridStamp(document, style));
  overlay.onAdd = () => overlay.getPanes().mapPane.append(canvas);
  overlay.draw = () => {
    const projection = overlay.getProjection();
    const bounds = map.getBounds();
    if (!projection || !bounds) return;
    const topLeft = projection.fromLatLngToDivPixel(new maps.LatLng(bounds.getNorthEast().lat(), bounds.getSouthWest().lng()));
    const bottomRight = projection.fromLatLngToDivPixel(new maps.LatLng(bounds.getSouthWest().lat(), bounds.getNorthEast().lng()));
    const width = Math.ceil(bottomRight.x - topLeft.x), height = Math.ceil(bottomRight.y - topLeft.y);
    if (width <= 0 || height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * dpr); canvas.height = Math.ceil(height * dpr);
    Object.assign(canvas.style, { left: `${topLeft.x}px`, top: `${topLeft.y}px`, width: `${width}px`, height: `${height}px` });
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    for (const cell of cells) {
      const a = projection.fromLatLngToDivPixel(new maps.LatLng(cell.bounds.north, cell.bounds.west));
      const b = projection.fromLatLngToDivPixel(new maps.LatLng(cell.bounds.south, cell.bounds.east));
      ctx.drawImage(stamps[cell.level], a.x - topLeft.x, a.y - topLeft.y, b.x - a.x, b.y - a.y);
    }
  };
  overlay.onRemove = () => canvas.remove();
  overlay.setMap(map);
  return overlay;
}
