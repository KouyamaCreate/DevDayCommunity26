import buffer from '@turf/buffer';
import pointInPolygon from '@turf/boolean-point-in-polygon';
import { lineString, point } from '@turf/helpers';
import { AppError } from './errors.mjs';

export const CITIES = {
  shibuya: { id: 'shibuya', name: '渋谷', center: { lat: 35.661, lng: 139.701 }, bounds: { south: 35.641, north: 35.692, west: 139.661, east: 139.724 }, timezone: 'Asia/Tokyo' },
  sf: { id: 'sf', name: 'SF', center: { lat: 37.7749, lng: -122.4194 }, bounds: { south: 37.703, north: 37.833, west: -122.515, east: -122.35 }, timezone: 'America/Los_Angeles' },
};
export function validateCoordinate({ lat, lng }, city) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new AppError('INVALID_LOCATION', '緯度・経度が正しくありません。');
  const bounds = CITIES[city]?.bounds;
  if (!bounds || lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east) throw new AppError('OUT_OF_COVERAGE', 'この地点は初版の対応範囲（渋谷周辺・SF市街地）に含まれていません。');
  return { lat, lng };
}
export function decodePolyline(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 100000) throw new AppError('INVALID_ROUTE', '経路データを読み取れません。');
  let index = 0, lat = 0, lng = 0;
  const coordinates = [];
  const read = () => {
    let result = 0, shift = 0, byte;
    do {
      if (index >= encoded.length || shift > 30) throw new AppError('INVALID_ROUTE', '経路データが不完全です。');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new AppError('INVALID_ROUTE', '経路データが不正です。');
      result |= (byte & 31) << shift; shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) { lat += read(); lng += read(); coordinates.push([lng / 1e5, lat / 1e5]); }
  if (coordinates.length < 2) throw new AppError('INVALID_ROUTE', '経路の座標が不足しています。');
  return coordinates;
}
export function routeReportIDs(coordinates, incidents, widthMeters = 100) {
  const corridor = buffer(lineString(coordinates), widthMeters / 1000, { units: 'kilometers' });
  return [...new Set(incidents.filter(i => pointInPolygon(point([i.lng, i.lat]), corridor)).map(i => i.id))];
}
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function validateWorldCoordinate({ lat, lng }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -85 || lat > 85 || lng < -180 || lng > 180) throw new AppError('INVALID_LOCATION', '緯度・経度が正しくありません。');
  return { lat, lng };
}
export function validateBounds(bounds) {
  if (!bounds || !['south','north','west','east'].every(k => Number.isFinite(bounds[k])) || bounds.south < -85 || bounds.north > 85 || bounds.south >= bounds.north || bounds.west < -180 || bounds.east > 180 || bounds.west >= bounds.east) throw new AppError('INVALID_BOUNDS', '表示範囲を確認してください。日付変更線をまたぐ範囲は分けて指定してください。');
  return { south: bounds.south, north: bounds.north, west: bounds.west, east: bounds.east };
}
export function boundsAround(center, meters = 2500) {
  const dy = meters / 111320, dx = dy / Math.max(0.1, Math.cos(center.lat * Math.PI / 180));
  return { south: Math.max(-85, center.lat-dy), north: Math.min(85, center.lat+dy), west: Math.max(-180, center.lng-dx), east: Math.min(180, center.lng+dx) };
}
export const inBounds = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
export const intersectsBounds = (a, b) => a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
export const reportRegion = p => Object.values(CITIES).find(c => inBounds(p, c.bounds))?.id || null;
