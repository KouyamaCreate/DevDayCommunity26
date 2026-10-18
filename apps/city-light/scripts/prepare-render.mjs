/** Rendering-only topology repair. Source footprints, facility matching and evaluations stay intact. */
import fs from 'node:fs';import * as turf from '@turf/turf';
const dataset=JSON.parse(fs.readFileSync('data/buildings.json','utf8'));
const grid=new Map(),cell=.0005;const output=new Map();let trimmed=0,covered=0,inset=0;
const cells=([a,b,c,d])=>{const keys=[];for(let x=Math.floor(a/cell);x<=Math.floor(c/cell);x++)for(let y=Math.floor(b/cell);y<=Math.floor(d/cell);y++)keys.push(`${x}:${y}`);return keys};
const overlaps=(a,b)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
// A higher detailed shape is kept before a lower one; ties favour the record with matched facilities.
const sorted=[...dataset.buildings].sort((a,b)=>b.height-a.height||b.pois.length-a.pois.length||a.id.localeCompare(b.id));
for(const b of sorted){
 let feature=turf.feature(b.geometry);const bbox=turf.bbox(feature);const keys=cells(bbox);const candidates=new Set(keys.flatMap(k=>grid.get(k)||[]));let changed=false;
 for(const other of candidates){
  if(!feature||!overlaps(bbox,other.bbox))continue;
  // All volumetric footprints are made disjoint, avoiding coincident roofs and walls.
  const intersection=turf.intersect(turf.featureCollection([feature,other.feature]));
  if(!intersection||turf.area(intersection)<.005)continue;
  feature=turf.difference(turf.featureCollection([feature,other.feature]));changed=true;
 }
 if(changed)trimmed++;
 if(feature&&turf.area(feature)>.02){
  const kept={feature,bbox:turf.bbox(feature)};for(const k of cells(kept.bbox)){if(!grid.has(k))grid.set(k,[]);grid.get(k).push(kept)}
  // A 10 cm display-only inset separates adjacent walls and avoids float precision contact.
  const buffered=turf.buffer(feature,-.10,{units:'meters',steps:1});
  if(buffered&&turf.area(buffered)>.02){feature=buffered;inset++}
  output.set(b.id,feature.geometry);
 }else{covered++;output.set(b.id,null)}
}
const map={...dataset,metadata:{...dataset.metadata,rendering:{version:2,overlapTrimmed:trimmed,coveredShapes:covered,insetMeters:.10}},buildings:dataset.buildings.map(({pois,...b})=>({...b,poiCount:pois.length,renderGeometry:output.get(b.id)}))};
fs.writeFileSync('public/data/map.json',JSON.stringify(map));
fs.writeFileSync('data/render-verification.json',JSON.stringify({version:2,sourceCount:dataset.buildings.length,renderedCount:dataset.buildings.length-covered,overlapTrimmed:trimmed,coveredShapes:covered,insetCount:inset,insetMeters:.10,sourceGeometryChanged:false},null,2));
console.log(JSON.stringify(map.metadata.rendering));
