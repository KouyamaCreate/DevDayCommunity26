import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';
import { fetchJSON } from './network.mjs';
import { CITIES, decodePolyline, validateWorldCoordinate, distanceMeters } from './spatial.mjs';

function normalizePlace(value, city, source = 'google-places') {
  const coordinate = validateWorldCoordinate(value.location || {});
  return {
    id: randomUUID(), providerId: value.id || null,
    name: value.displayName?.text || value.name || value.formattedAddress || '地点',
    address: value.formattedAddress || '', ...coordinate,
    precision: value.precision || 'provider-location', source,
    primaryType: value.primaryTypeDisplayName?.text || '',
    priceLevel: value.priceLevel || null,
    openingHours: value.currentOpeningHours ? { openNow: value.currentOpeningHours.openNow ?? null, weekdayDescriptions: value.currentOpeningHours.weekdayDescriptions || [] } : null,
    attribution: 'Google Maps', providerURL: value.googleMapsUri || null,
  };
}
export class Google {
  constructor(config, { request = fetchJSON } = {}) { this.config = config; this.request = request; }
  async key() {
    const key = (await this.config.keys()).server;
    if (!key) throw new AppError('MAPS_SETUP_REQUIRED', '地図APIの設定が必要です。設定画面でAPIキーを登録してください。');
    return key;
  }
  async geocode(address, city, { biasBounds } = {}) {
    const key = await this.key();
    const { south, west, north, east } = biasBounds || CITIES[city].bounds;
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.search = new URLSearchParams({ address, key, language: 'ja', bounds: `${south},${west}|${north},${east}`, region: city === 'sf' ? 'us' : 'jp' });
    const data = await this.request(url);
    if (data.status === 'ZERO_RESULTS') return [];
    if (data.status !== 'OK') throw new AppError('GEOCODING_UNAVAILABLE', '住所を検索できません。Geocoding APIの有効化・キーの制限・請求設定を確認してください。');
    return (data.results || []).flatMap(p => {
      try {
        const location = p.geometry.location;
        return [normalizePlace({ id: p.place_id, location, displayName: { text: p.formatted_address }, formattedAddress: p.formatted_address, precision: p.geometry.location_type === 'ROOFTOP' ? 'building' : 'approximate' }, city, 'google-geocoding')];
      } catch (e) { if (e.code === 'OUT_OF_COVERAGE') return []; throw e; }
    });
  }
  async search(query, city, { limit = 5, center = CITIES[city].center, radiusMeters = 2000, openNow = false, priceLevels } = {}) {
    const key = await this.key();
    const body = { textQuery: query, languageCode: 'ja', regionCode: city === 'sf' ? 'US' : 'JP', pageSize: limit,
      locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: radiusMeters } }, openNow };
    if (priceLevels?.length) body.priceLevels = priceLevels;
    const data = await this.request('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName,places.googleMapsUri,places.priceLevel,places.currentOpeningHours' }, body: JSON.stringify(body),
    });
    return (data.places || []).flatMap(p => {
      try { const place = normalizePlace({ ...p, location: { lat: p.location.latitude, lng: p.location.longitude } }, city);
        return distanceMeters(center, place) <= radiusMeters ? [place] : []; }
      catch (e) { if (e.code === 'OUT_OF_COVERAGE') return []; throw e; }
    });
  }
  async reverse(point, city) {
    validateWorldCoordinate(point);
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.search = new URLSearchParams({ latlng: `${point.lat},${point.lng}`, key: await this.key(), language: 'ja' });
    const data = await this.request(url);
    if (data.status === 'ZERO_RESULTS') return null;
    if (data.status !== 'OK') throw new AppError('GEOCODING_UNAVAILABLE', 'この地点の住所を確認できませんでした。');
    const p = data.results?.[0];
    return p ? { address: p.formatted_address, precision: 'reverse-geocoded-address' } : null;
  }
  async walking(origin, destination) {
    const key = await this.key();
    const waypoint = place => ({ location: { latLng: { latitude: place.lat, longitude: place.lng } } });
    const data = await this.request('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.description,routes.warnings,routes.routeLabels' },
      body: JSON.stringify({ origin: waypoint(origin), destination: waypoint(destination), travelMode: 'WALK', computeAlternativeRoutes: true, polylineQuality: 'HIGH_QUALITY', languageCode: 'ja', units: 'METRIC' }),
    });
    const seen = new Set();
    return (data.routes || []).flatMap(route => {
      const encoded = route.polyline?.encodedPolyline;
      if (!encoded || seen.has(encoded)) return [];
      seen.add(encoded);
      const seconds = Number.parseFloat(route.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new AppError('INVALID_ROUTE', '徒歩時間を取得できませんでした。');
      return [{ id: randomUUID(), durationSeconds: seconds, minutes: Math.ceil(seconds / 60), distanceMeters: route.distanceMeters,
        coordinates: decodePolyline(encoded), description: route.description || '', warnings: route.warnings || [], source: 'google-routes', report: null }];
    }).sort((a, b) => a.durationSeconds - b.durationSeconds);
  }
}
