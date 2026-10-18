import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';import * as turf from '@turf/turf';
import {normalizeTown,areaReferenceScore,matchBuildingArea} from '../server/area-context.mjs';
import {resolveArea} from '../src/area-context.ts';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),context=read('public/data/area-context.json'),dataset=read('data/buildings.json'),raw=read('data/open-data/crime-2025.json');
test('regional values preserve official counts, year, source bytes and full-town area',()=>{
 assert.equal(context.metadata.periodStart,'2025-01-01');assert.equal(context.metadata.periodEnd,'2025-12-31');assert.equal(context.metadata.boundaryYear,2020);
 for(const source of context.metadata.sources){assert(source.url.startsWith('https://'));assert(source.license&&source.attribution);assert.equal(createHash('sha256').update(fs.readFileSync('data/open-data/'+source.file)).digest('hex'),source.sha256)}
 for(const a of context.areas){const record=raw.find(r=>r['市区町丁']===a.crimeTown);assert(record);assert.equal(a.total,record['総合計']);assert.equal(a.total,Object.values(a.counts).reduce((x,y)=>x+y,0));assert(Math.abs(a.areaKm2-turf.area(a.geometry)/1e6)<1e-10);assert.equal(a.density,a.total/a.areaKm2);assert(a.score>=20&&a.score<=80)}
 assert(!context.areas.some(a=>a.name==='目黒区八雲四丁目'),'missing record must not be interpreted as zero incidents');
});
test('spatial coverage fills missing facility buildings without changing their facility records',()=>{
 let fallback=0,unknown=0;
 for(const b of dataset.buildings){const area=resolveArea(context,b.id);if(!b.pois.length){if(area)fallback++;else unknown++}if(area){const intersection=turf.intersect(turf.featureCollection([turf.feature(b.geometry),turf.feature(area.geometry)]));assert(intersection);const coverage=turf.area(intersection)/turf.area(b.geometry);assert(coverage>=.8-1e-8,b.id);assert(Math.abs(coverage-context.assignments[b.id].coverage)<1e-7)}}
 assert.equal(fallback,3770);assert.equal(unknown,2);assert.equal(fallback,context.metadata.fallbackBuildings);
});
test('ambiguous boundaries and buildings outside a town never receive the nearest town value',()=>{
 const square=(x,y,w,h)=>turf.polygon([[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]);
 const town=square(0,0,1,1),areas=[{id:'a',feature:town,bbox:turf.bbox(town)}];
 assert.equal(matchBuildingArea({geometry:square(.8,.1,.4,.1).geometry},areas),null);
 assert.equal(matchBuildingArea({geometry:square(1.01,.1,.1,.1).geometry},areas),null);
 assert.equal(matchBuildingArea({geometry:square(.1,.1,.1,.1).geometry},areas).areaId,'a');
 assert.equal(resolveArea(context,'missing-building'),undefined);
});
test('regional index preserves ties and direction without asserting 0 or 100 percent safety',()=>{
 const distribution=[0,1,1,5,20];assert.equal(areaReferenceScore(1,distribution),58);assert(areaReferenceScore(5,distribution)>areaReferenceScore(20,distribution));
 assert.equal(areaReferenceScore(0,distribution),80);assert.equal(areaReferenceScore(20,distribution),20);assert.equal(areaReferenceScore(NaN,distribution),null);
 assert.equal(normalizeTown('渋谷区松濤１丁目'),normalizeTown('渋谷区松涛一丁目'));
});
