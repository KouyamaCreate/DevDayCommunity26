import fs from 'node:fs';import assert from 'node:assert/strict';import {feature} from 'topojson-client';import * as turf from '@turf/turf';
import {normalizeTown,areaReferenceScore,matchBuildingArea} from '../server/area-context.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sources=read('data/open-data/sources.json'),rows=read('data/open-data/crime-2025.json'),dataset=read('data/buildings.json');
const rowIndex=new Map();for(const row of rows.filter(r=>/^(渋谷区|港区|目黒区)/.test(r['市区町丁']))){const key=normalizeTown(row['市区町丁']);assert(!rowIndex.has(key),'Duplicate town in crime data');rowIndex.set(key,row)}
const areas=[],excluded=[];
for(const code of ['13113','13103','13110']){
 const topology=read(`data/open-data/towns-${code}.topojson`),towns=feature(topology,topology.objects.town);
 const groups=new Map();for(const f of towns.features){const id=f.properties.KEY_CODE;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(f)}
 for(const [id,pieces] of groups){
  const p=pieces[0].properties,name=p.CITY_NAME+p.S_NAME,row=rowIndex.get(normalizeTown(name));
  if(!row||!Number.isSafeInteger(row['総合計'])){excluded.push({id,name,reason:'no-exact-crime-town-name'});continue}
  const geometry=pieces.length===1?pieces[0]:turf.union(turf.featureCollection(pieces));
  const areaKm2=turf.area(geometry)/1e6;if(areaKm2<=0){excluded.push({id,name,reason:'no-area'});continue}
  const counts=Object.fromEntries(['凶悪犯計','粗暴犯計','侵入窃盗計','非侵入窃盗計','その他計'].map(k=>[k,row[k]]));
  assert(Object.values(counts).every(Number.isSafeInteger));assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),row['総合計'],name);
  areas.push({id,name,crimeTown:row['市区町丁'],total:row['総合計'],counts,areaKm2,density:row['総合計']/areaKm2,geometry:geometry.geometry});
 }
}
const densities=areas.map(a=>a.density);for(const a of areas)a.score=areaReferenceScore(a.density,densities);
const indexed=areas.map(a=>({id:a.id,feature:turf.feature(a.geometry),bbox:turf.bbox(a.geometry)}));
const assignments={},unmatched=[];
for(const b of dataset.buildings){const match=matchBuildingArea(b,indexed);if(match)assignments[b.id]=match;else unmatched.push(b.id)}
const fallbackBuildings=dataset.buildings.filter(b=>!b.pois.length&&assignments[b.id]).length;
const metadata={...sources,version:'town-crime-density-2025-v1',comparisonWards:['渋谷区','港区','目黒区'],comparisonAreaCount:areas.length,
 formula:'density = annual total / full town area km²; score = round(80 - 60 × midrank / (N - 1))',
 scope:'町丁目全域。建物内の犯罪件数・個人の被害確率ではない。Decisions APIの施設評価とは尺度が異なる。',
 assignment:'元の建物形状の80%以上を含む町丁目に限り対応付け。近隣からの外挿なし。',
 fallbackBuildings,assignedBuildings:Object.keys(assignments).length,unmatchedBuildings:unmatched.length,excludedTownCount:excluded.length};
fs.writeFileSync('public/data/area-context.json',JSON.stringify({metadata,areas,assignments}));
fs.writeFileSync('data/open-data/verification.json',JSON.stringify({comparisonAreas:areas.length,excluded,assignedBuildings:metadata.assignedBuildings,fallbackBuildings,unmatched},null,2));
console.log(JSON.stringify({comparisonAreas:areas.length,excluded:excluded.length,fallbackBuildings,unmatched:unmatched.length}));
