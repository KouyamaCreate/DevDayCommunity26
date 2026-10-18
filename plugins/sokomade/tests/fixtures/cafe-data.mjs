import { randomUUID } from 'node:crypto';
import { Reports } from '../../src/reports.mjs';

// Synthetic fixtures only. These names/counts are not real business or crime data.
export function cafeAdapters() {
  const periods = {
    sf:{start:'2026-07-01',end:'2026-09-29',endExclusive:true,label:'検証用90日間'},
    shibuya:{start:'2026-01-01',end:'2026-09-30',endExclusive:false,label:'検証用1〜9月累計'},
  };
  const cafes = {
    sf:[['検証カフェSF A',37.775,-122.419,'SF A'],['検証カフェSF B',37.780,-122.419,'SF B'],['検証カフェSF C',37.785,-122.419,'SF C']],
    shibuya:[['検証カフェ渋谷 A',35.661,139.701,'東京都渋谷区神南1丁目1-1'],['検証カフェ渋谷 B',35.665,139.701,'東京都渋谷区神南１丁目2-2'],['検証カフェ渋谷 C',35.660,139.707,'東京都渋谷区渋谷2丁目3-3']],
  };
  const google = {
    async search(query,city,{limit=3}={}) { return cafes[city].slice(0,limit).map(([name,lat,lng,address])=>({id:randomUUID(),providerId:name,name,lat,lng,address,source:'validation-fixture',primaryType:'検証用カフェ',openingHours:{openNow:true},role:'search-result'})); },
    async reverse(){ return null; },
    async walking(a,b){return [{id:randomUUID(),durationSeconds:600,minutes:10,distanceMeters:800,coordinates:[[a.lng,a.lat],[b.lng,b.lat]]}];},
  };
  const reports = new Reports();
  reports.sf = async()=>({period:periods.sf,sourceURL:'https://data.sfgov.org/Public-Safety/Police-Department-Incident-Reports-2018-to-Present/wg3w-h783',sourceName:'検証用SFPDデータ',precision:'anonymized-intersection',fetchedAt:'2026-10-18T00:00:00Z',updatedAt:'2026-10-17',stale:false,incidents:[{id:'fixture-1',lat:37.775,lng:-122.419,categories:['theft']},{id:'fixture-2',lat:37.776,lng:-122.419,categories:['assault']}]});
  reports.tokyo = async()=>({period:periods.shibuya,sourceURL:'https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html',sourceName:'検証用警視庁データ',precision:'neighborhood',fetchedAt:'2026-10-18T00:00:00Z',updatedAt:'2026-10-17',stale:false,areas:[{area:'渋谷区神南1丁目',counts:{theft:9,assault:2,robbery:1}},{area:'渋谷区渋谷2丁目',counts:{theft:1,assault:0,robbery:0}}]});
  return {google,reports};
}
