import { join } from 'node:path';
import { Config } from '../src/config.mjs';
import { Google } from '../src/google.mjs';
import { Reports } from '../src/reports.mjs';
import { publicError } from '../src/errors.mjs';
const config = new Config();
const google = new Google(config);
const reports = new Reports({ cacheDirectory: join(config.directory, 'public-reports') });
let failures = 0;
for (const [city, a, b] of [['shibuya', '渋谷駅', '代々木公園'], ['sf', 'Union Square San Francisco', 'Ferry Building San Francisco']]) {
  try {
    const [origins, destinations] = await Promise.all([google.geocode(a, city), google.geocode(b, city)]);
    if (!origins[0] || !destinations[0]) throw new Error('No geocoding result');
    const routes = await google.walking(origins[0], destinations[0]);
    if (!routes.length) throw new Error('No walking route');
    const [report, places] = await Promise.all([reports.context(city, [destinations[0]], routes), google.search(city === 'sf' ? 'burger near Union Square San Francisco' : '渋谷駅 バーガー', city, { center: origins[0], limit: 2 })]);
    console.log(JSON.stringify({ city, geocoding: 'passed', walkingRoutes: routes.length, shortestMinutes: routes[0].minutes, places: places.length, reports: { comparable: report.comparable, precision: report.precision, period: report.period, routeCounts: report.routeCounts.map(r => r.count), areaCount: report.areas?.length, fetchedAt: report.fetchedAt, stale: report.stale } }));
  } catch (error) { failures++; console.log(JSON.stringify({ city, error: publicError(error) })); }
}
process.exitCode = failures ? 1 : 0;
