import { densityField, densityColor, DENSITY_RADIUS } from './report-density.mjs';

export function googleReportOverlay(maps, map, points, { radiusMeters = DENSITY_RADIUS, opacity = 1 } = {}) {
  const overlay = new maps.OverlayView();
  const canvas = document.createElement('canvas');
  canvas.className = 'report-density-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  overlay.onAdd = () => overlay.getPanes().mapPane.append(canvas);
  overlay.draw = () => {
    const projection = overlay.getProjection(), bounds = map.getBounds();
    if (!projection || !bounds) return;
    const topLeft = projection.fromLatLngToDivPixel(new maps.LatLng(bounds.getNorthEast().lat(), bounds.getSouthWest().lng()));
    const bottomRight = projection.fromLatLngToDivPixel(new maps.LatLng(bounds.getSouthWest().lat(), bounds.getNorthEast().lng()));
    const width = Math.ceil(bottomRight.x - topLeft.x), height = Math.ceil(bottomRight.y - topLeft.y);
    if (width <= 0 || height <= 0) return;
    const center = map.getCenter();
    const pixelsPerMeter = 256 * 2 ** map.getZoom() / (40075016.686 * Math.cos(center.lat() * Math.PI / 180));
    const projected = points.map(p => { const xy = projection.fromLatLngToDivPixel(new maps.LatLng(p.lat, p.lng)); return { x:xy.x - topLeft.x,y:xy.y - topLeft.y,count:p.count }; });
    const field = densityField(projected, { width,height,pixelsPerMeter,radiusMeters });
    canvas.width = field.columns; canvas.height = field.rows;
    Object.assign(canvas.style, { left:`${topLeft.x}px`,top:`${topLeft.y}px`,width:`${width}px`,height:`${height}px` });
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(field.columns, field.rows);
    field.values.forEach((value,i) => image.data.set(densityColor(value, opacity),i * 4));
    ctx.putImageData(image,0,0);
  };
  overlay.onRemove = () => canvas.remove();
  overlay.setMap(map);
  return overlay;
}
