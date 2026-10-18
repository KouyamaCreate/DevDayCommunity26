import test from 'node:test';
import assert from 'node:assert/strict';
import { Reports, normalizeSF, parseTokyoCSV, tokyoMetadata, sfPeriod } from '../src/reports.mjs';
import { routeReportIDs, decodePolyline, validateCoordinate } from '../src/spatial.mjs';
const row = (id, category = 'Assault', changes = {}) => ({ incident_number: id, incident_category: category, incident_date: '2026-10-01T00:00:00', latitude: '37.78', longitude: '-122.42', ...changes });
test('SF deduplicates reports across categories, excludes supplemental, conflicting and missing positions', () => {
 const result = normalizeSF([row('a'),row('a','Robbery'),row('b','Assault',{report_type_description:'Supplemental'}),row('c'),row('c','Assault',{latitude:'37.79'}),row('d','Assault',{latitude:null})]);
 assert.equal(result.incidents.length,1); assert.deepEqual(result.incidents[0].categories,['assault','robbery']);
 assert.equal(result.conflictingPositionReports,1); assert.equal(result.missingPositionRows,1);
 assert.throws(()=>normalizeSF([row(null)]),{code:'REPORT_SCHEMA_CHANGED'});
 assert.throws(()=>normalizeSF([{}]),{code:'REPORT_SCHEMA_CHANGED'});
});
test('SF time window uses complete local days; empty responses do not mean zero',async()=>{
 assert.deepEqual(sfPeriod(new Date('2026-10-18T05:00Z')), {start:'2026-07-19',end:'2026-10-17',endExclusive:true,label:'2026-07-19〜2026-10-17未満（SF現地日付）'});
 await assert.rejects(new Reports({request:async()=>[]}).sf(),{code:'REPORT_INCOMPLETE'});
 await assert.rejects(new Reports({request:async()=>[row('a','Assault',{latitude:null})]}).sf(),{code:'REPORT_INCOMPLETE'});
});
test('Tokyo uses specified category totals once, and never returns route counts',async()=>{
 const csv='市区町丁,総合計,粗暴犯暴行,粗暴犯傷害,凶悪犯強盗,侵入窃盗計,非侵入窃盗計\n渋谷区神南1丁目,100,2,3,4,5,6\n';
 const areas=parseTokyoCSV(Buffer.from(csv)); assert.deepEqual(areas[0].counts,{assault:5,robbery:4,theft:11});
 const reports=new Reports(); reports.tokyo=async()=>({areas,period:{label:'test'},fetchedAt:new Date().toISOString()});
 const result=await reports.context('shibuya',[{id:'p',address:'東京都渋谷区神南１丁目'}],[{id:'r'}]);
 assert.equal(result.comparable,false);assert.equal(result.routeCounts[0].count,null); assert.equal(result.areaCounts[0].count,20); assert.deepEqual(result.incidents,[]);
 const missing=await reports.context('shibuya',[{id:'p',address:''}],[]);assert.equal(missing.areaCounts[0].count,null);
 assert.throws(()=>parseTokyoCSV(Buffer.from(csv.replace(',2,3,',',,3,'))),{code:'REPORT_INCOMPLETE'});
 assert.throws(()=>tokyoMetadata('unrecognized page'),{code:'REPORT_SCHEMA_CHANGED'});
});
test('100m metric corridor includes near positions once, excludes distant positions',()=>{
 const ids=routeReportIDs([[-122.42,37.78],[-122.41,37.78]],[{id:'near',lng:-122.415,lat:37.7804},{id:'near',lng:-122.415,lat:37.7804},{id:'far',lng:-122.415,lat:37.782}],100);
 assert.deepEqual(ids,['near']); assert.throws(()=>decodePolyline('_'),{code:'INVALID_ROUTE'});
 assert.throws(()=>validateCoordinate({lat:0,lng:0},'sf'),{code:'OUT_OF_COVERAGE'});
});
test('schema change never falls back to cached counts',async()=>{
 let now=0; const reports=new Reports({now:()=>new Date(now)});
 await reports.cached('x',async()=>({count:12}));now=13*3600000;
 const stale=await reports.cached('x',async()=>{throw Error('offline');});assert.equal(stale.stale,true);
 await assert.rejects(reports.cached('x',async()=>{throw Object.assign(Error('schema'),{code:'REPORT_SCHEMA_CHANGED'});}),{code:'REPORT_SCHEMA_CHANGED'});
});
