import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import { AppError } from './errors.mjs';
import { fetchJSON } from './network.mjs';
import { CITIES, routeReportIDs, distanceMeters, inBounds, intersectsBounds, validateBounds } from './spatial.mjs';

export const SF_SOURCE = 'https://data.sfgov.org/Public-Safety/Police-Department-Incident-Reports-2018-to-Present/wg3w-h783';
export const TOKYO_SOURCE = 'https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html';
export const REPORT_CATEGORIES = { assault: '暴行・傷害', robbery: '強盗', theft: '窃盗（車内盗等を含む）' };
const SF_CATEGORIES = { Assault: 'assault', Robbery: 'robbery', 'Larceny Theft': 'theft' };
export const REPORT_LIMITS = ['公開された報告は、発生したすべての事件を網羅しません。', '件数は被害に遭う確率ではなく、安全を保証しません。'];

export function sfPeriod(now = new Date()) {
  const end = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const endDate = new Date(`${end}T00:00:00Z`);
  const start = new Date(endDate.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  return { start, end, endExclusive: true, label: `${start}〜${end}未満（SF現地日付）` };
}
export function normalizeSF(rows) {
  const byID = new Map(); let missingPosition = 0;
  for (const row of rows) {
    if (!row.incident_category) throw new AppError('REPORT_SCHEMA_CHANGED', 'SF報告データの種別を確認できません。');
    if (!SF_CATEGORIES[row.incident_category]) continue;
    if (/supplement/i.test(row.report_type_description || '')) continue;
    const id = row.incident_number || row.incident_id;
    if (!id || !row.incident_date) throw new AppError('REPORT_SCHEMA_CHANGED', 'SF報告データの形式が変わっています。件数比較を停止しました。');
    const lat = Number(row.latitude), lng = Number(row.longitude);
    if (!row.latitude || !row.longitude || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 37.7 || lat > 37.84 || lng < -122.53 || lng > -122.34) { missingPosition++; continue; }
    const previous = byID.get(id);
    if (previous) {
      if (!previous.categories.includes(SF_CATEGORIES[row.incident_category])) previous.categories.push(SF_CATEGORIES[row.incident_category]);
      // Location conflicts are excluded rather than choosing an arbitrary point.
      if (distanceMeters(previous, { lat, lng }) > 1) previous.conflictingPosition = true;
    } else byID.set(id, { id, date: row.incident_date.slice(0, 10), lat, lng, categories: [SF_CATEGORIES[row.incident_category]], precision: 'anonymized-intersection' });
  }
  const all = [...byID.values()];
  return { incidents: all.filter(row => !row.conflictingPosition), missingPositionRows: missingPosition, conflictingPositionReports: all.filter(r => r.conflictingPosition).length };
}
export function parseTokyoCSV(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = iconv.decode(Buffer.from(bytes), 'cp932'); }
  const rows = parse(text, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: false });
  const required = ['市区町丁', '総合計', '粗暴犯暴行', '粗暴犯傷害', '凶悪犯強盗', '侵入窃盗計', '非侵入窃盗計'];
  if (!rows.length || required.some(key => !(key in rows[0]))) throw new AppError('REPORT_SCHEMA_CHANGED', '警視庁の集計形式が変わっています。地域情報の表示を停止しました。');
  const number = value => {
    const normalized = String(value).replace(/,/g, '').trim();
    if (!/^\d+$/.test(normalized)) throw new AppError('REPORT_INCOMPLETE', '警視庁の件数に未確定・欠損があるため、集計できません。');
    return Number(normalized);
  };
  const result = rows.filter(r => r['市区町丁'].startsWith('渋谷区') && r['市区町丁'] !== '渋谷区' && !/合計|総計/.test(r['市区町丁'])).map(r => ({
    area: r['市区町丁'].normalize('NFKC'), total: number(r['総合計']),
    counts: { assault: number(r['粗暴犯暴行']) + number(r['粗暴犯傷害']), robbery: number(r['凶悪犯強盗']), theft: number(r['侵入窃盗計']) + number(r['非侵入窃盗計']) },
  }));
  if (!result.length) throw new AppError('REPORT_SCHEMA_CHANGED', '渋谷区の集計を確認できませんでした。');
  return result;
}
export function tokyoMetadata(html) {
  const normalized = html.normalize('NFKC');
  const match = normalized.match(/href=["']([^"']+\.csv)["'][^>]*>\s*(\d+)月累計/i);
  const year = normalized.match(/月累計[（(]令和(\d+)年/);
  const updated = normalized.match(/更新日[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match || !year || !updated) throw new AppError('REPORT_SCHEMA_CHANGED', '警視庁の最新公開期間を確認できませんでした。');
  const y = 2018 + Number(year[1]), month = Number(match[2]);
  if (month < 1 || month > 12) throw new AppError('REPORT_SCHEMA_CHANGED', '公開期間が不正です。');
  const end = new Date(Date.UTC(y, month, 0)).toISOString().slice(0, 10);
  const url = new URL(match[1], TOKYO_SOURCE);
  if (url.hostname !== 'www.keishicho.metro.tokyo.lg.jp' || url.protocol !== 'https:') throw new AppError('REPORT_SCHEMA_CHANGED', '取得元を確認できません。');
  return { csvURL: url.href, period: { start: `${y}-01-01`, end, endExclusive: false, label: `${y}年1〜${month}月累計` }, updatedAt: `${updated[1]}-${updated[2].padStart(2, '0')}-${updated[3].padStart(2, '0')}` };
}

export class Reports {
  constructor({ cacheDirectory, request = fetchJSON, fetchImpl = fetch, now = () => new Date() } = {}) { this.cacheDirectory = cacheDirectory; this.request = request; this.fetchImpl = fetchImpl; this.now = now; this.cache = new Map(); }
  async cached(key, load) {
    const memory = this.cache.get(key);
    if (memory && this.now().getTime() - Date.parse(memory.fetchedAt) < 12 * 3600000) return memory;
    let disk;
    if (this.cacheDirectory) {
      try { disk = JSON.parse(await readFile(join(this.cacheDirectory, `${key}.json`), 'utf8')); } catch {}
      if (disk?.schemaVersion === 1 && this.now().getTime() - Date.parse(disk.fetchedAt) < 12 * 3600000) { this.cache.set(key, disk); return disk; }
    }
    try {
      const value = { ...await load(), schemaVersion: 1, fetchedAt: this.now().toISOString(), stale: false };
      this.cache.set(key, value);
      if (this.cacheDirectory) { try { await mkdir(this.cacheDirectory, { recursive: true, mode: 0o700 }); await writeFile(join(this.cacheDirectory, `${key}.json`), JSON.stringify(value), { mode: 0o600 }); } catch {} }
      return value;
    } catch (error) {
      // A schema change must never fall back to potentially incompatible data.
      if (error.code?.startsWith('REPORT_')) throw error;
      const previous = memory || disk;
      if (previous?.schemaVersion === 1) return { ...previous, stale: true };
      throw error;
    }
  }
  async sf() {
    const period = sfPeriod(this.now());
    return this.cached(`sf-${period.start}-${period.end}`, async () => {
      // One response avoids offset pagination drifting while the source changes.
      const url = new URL('https://data.sfgov.org/resource/wg3w-h783.json');
      url.search = new URLSearchParams({ '$select': 'row_id,incident_number,incident_id,incident_date,incident_category,incident_subcategory,report_type_description,latitude,longitude,data_as_of', '$where': `incident_date >= '${period.start}T00:00:00' AND incident_date < '${period.end}T00:00:00' AND incident_category in ('Assault','Robbery','Larceny Theft')`, '$order': 'row_id', '$limit': '50000' });
      const rows = await this.request(url);
      if (!Array.isArray(rows)) throw new AppError('REPORT_SCHEMA_CHANGED', 'SFの報告データを読み取れません。');
      if (!rows.length) throw new AppError('REPORT_INCOMPLETE', '対象期間の報告データを確認できないため、件数比較を停止しました。');
      if (rows.length >= 50000) throw new AppError('REPORT_TRUNCATED', '取得上限に達したため、件数比較を停止しました。');
      const result = normalizeSF(rows);
      if (!result.incidents.length) throw new AppError('REPORT_INCOMPLETE', '比較に使える公開位置を確認できません。');
      return { ...result, period, sourceURL: SF_SOURCE, sourceName: 'SFPD公開インシデント報告', precision: 'anonymized-intersection', updatedAt: rows.map(r => r.data_as_of || '').sort().at(-1) || null };
    });
  }
  async tokyo() {
    return this.cached('tokyo-latest', async () => {
      const request = async url => {
        let response;
        try { response = await this.fetchImpl(url, { signal: AbortSignal.timeout(20000) }); } catch { throw new AppError('UPSTREAM_UNAVAILABLE', '警視庁データに接続できません。'); }
        if (!response.ok) throw new AppError('UPSTREAM_HTTP_ERROR', '警視庁データを取得できません。');
        return response;
      };
      const html = await (await request(TOKYO_SOURCE)).text();
      const metadata = tokyoMetadata(html);
      const bytes = new Uint8Array(await (await request(metadata.csvURL)).arrayBuffer());
      return { areas: parseTokyoCSV(bytes), ...metadata, sourceURL: TOKYO_SOURCE, sourceName: '警視庁 町丁別認知件数', precision: 'neighborhood' };
    });
  }
  async layer(bounds, { categories = Object.keys(REPORT_CATEGORIES) } = {}) {
    validateBounds(bounds);
    const regions = await Promise.all(Object.values(CITIES).filter(city => intersectsBounds(bounds, city.bounds)).map(async city => {
      try {
        const summary = await this.context(city.id, [], [], { categories });
        if (city.id === 'sf') {
          const source = await this.sf();
          const groups = new Map();
          for (const incident of source.incidents.filter(p => inBounds(p, bounds) && p.categories.some(c => categories.includes(c)))) {
            const key = `${incident.lat},${incident.lng}`;
            if (!groups.has(key)) groups.set(key, { id: key, lat: incident.lat, lng: incident.lng, count: 0 });
            groups.get(key).count++;
          }
          summary.incidents = [...groups.values()];
          summary.visiblePublicReportCount = summary.incidents.reduce((n, p) => n + p.count, 0);
        }
        // CSV totals have no geometry. Never invent point positions or a viewport total.
        summary.areas = summary.areas?.map(a => ({ ...a, geometry: null }));
        return { ...summary, status: 'available', queryBounds: city.bounds, boundaryPrecision: 'query-window-not-jurisdiction', viewportCount: city.id === 'sf' ? undefined : null };
      } catch (error) {
        return { city: city.id, status: 'unavailable', incidents: [], areas: [], viewportCount: null, limitations: [error instanceof AppError ? error.message : '報告情報を取得できません。'] };
      }
    }));
    const available = regions.filter(r => r.status === 'available');
    return { bounds, status: !regions.length ? 'unsupported' : !available.length ? 'unavailable' : 'partial',
      regions, incidents: available.flatMap(r => r.incidents), areas: available.flatMap(r => r.areas || []),
      // We do not have jurisdiction/CSV polygons proving complete viewport coverage.
      coverage: 'not-verified', limitations: [...REPORT_LIMITS, '地図全域のデータ網羅性は確認できません。情報がない場所を安全とは扱いません。', '渋谷の町丁目集計は境界データ未接続のため地図上の位置や範囲内合計に変換しません。'] };
  }
  async context(city, places, routes, { categories = ['assault', 'robbery', 'theft'], radiusMeters = 500 } = {}) {
    if (!categories.length || categories.some(c => !(c in REPORT_CATEGORIES))) throw new AppError('INVALID_CATEGORIES', '対象種別を選んでください。');
    if (city === 'sf') {
      const source = await this.sf();
      const incidents = source.incidents.filter(r => r.categories.some(c => categories.includes(c)));
      const routeMatches = routes.map(route => ({ routeId: route.id, ids: routeReportIDs(route.coordinates, incidents, 100) }));
      const routeCounts = routeMatches.map(r => ({ routeId: r.routeId, count: r.ids.length }));
      const routeIncidentIDs = new Set(routeMatches.flatMap(r => r.ids));
      const areaCounts = places.map(place => ({ placeId: place.id, radiusMeters, count: incidents.filter(i => distanceMeters(place, i) <= radiusMeters).length }));
      const visible = incidents.filter(i => places.some(p => distanceMeters(p, i) <= radiusMeters) || routeIncidentIDs.has(i.id));
      // Public positions only. Do not expose source rows describing individuals.
      return { city, comparable: true, basis: 'published-position', precision: source.precision, routeCounts, areaCounts,
        incidents: visible.map(i => ({ id: i.id, lat: i.lat, lng: i.lng, date: i.date, categories: i.categories })), period: source.period,
        categories, categoryLabels: categories.map(c => REPORT_CATEGORIES[c]), corridorMeters: 100, sourceURL: source.sourceURL, sourceName: source.sourceName,
        updatedAt: source.updatedAt, fetchedAt: source.fetchedAt, stale: source.stale,
        limitations: [...REPORT_LIMITS, '位置は匿名化された交差点です。発生地点そのものではありません。', '公開位置に基づく参考集計で、細かな道ごとの危険性を示しません。', '時刻帯による絞り込みや夜間リスクの推定は行っていません。'],
        missingPositionRows: source.missingPositionRows, conflictingPositionReports: source.conflictingPositionReports };
    }
    const source = await this.tokyo();
    const normalize = text => text.normalize('NFKC').replace(/[\s,、]/g, '').replace(/東京都|日本|Japan/gi, '');
    const summaries = places.map(place => {
      const address = normalize(place.address);
      const area = source.areas.find(a => address.includes(normalize(a.area)));
      return { placeId: place.id, area: area?.area || null, count: area ? categories.reduce((sum, category) => sum + area.counts[category], 0) : null,
        counts: area ? Object.fromEntries(categories.map(c => [c, area.counts[c]])) : null };
    });
    return { city, comparable: false, basis: 'neighborhood', precision: 'neighborhood', routeCounts: routes.map(r => ({ routeId: r.id, count: null })), areaCounts: summaries,
      areas: source.areas.map(a => ({ area: a.area, counts: Object.fromEntries(categories.map(c => [c, a.counts[c]])) })), incidents: [], period: source.period, categories,
      categoryLabels: categories.map(c => REPORT_CATEGORIES[c]), sourceURL: source.sourceURL, sourceName: source.sourceName, updatedAt: source.updatedAt, fetchedAt: source.fetchedAt, stale: source.stale,
      limitations: [...REPORT_LIMITS, '町丁目単位の認知件数です。ルート沿道の件数比較には使用できません。', '同じ町丁目の物件には同じ地域情報を表示します。', '時刻帯による絞り込みや夜間リスクの推定は行っていません。'] };
  }
}
