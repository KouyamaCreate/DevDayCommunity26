import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {VectorTile} from '@mapbox/vector-tile';import {PbfReader} from 'pbf';import * as turf from '@turf/turf';
fs.mkdirSync('data/tiles',{recursive:true});
const center=[139.701636,35.658034],z=16;
const tile=(lng,lat)=>[Math.floor((lng+180)/360*2**z),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z)];
const [x0,y0]=tile(center[0]-.0113,center[1]+.0093),[x1,y1]=tile(center[0]+.0113,center[1]-.0093);
const buildings=[],roads=[],rails=[];let count=0;
for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
 const path=`data/tiles/${z}-${x}-${y}.pbf`;
 if(!fs.existsSync(path))fs.writeFileSync(path,execFileSync('curl',['-fLsS','--max-time','30',`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${z}/${x}/${y}.pbf`]));
 const t=new VectorTile(new PbfReader(fs.readFileSync(path)));count++;
 for(const [kind,out] of [['building',buildings],['road',roads],['railway',rails]]){
  const l=t.layers[kind];if(!l)continue;
  for(let i=0;i<l.length;i++){
   const f=l.feature(i).toGeoJSON(x,y,z);const c=turf.centroid(f).geometry.coordinates;
   if(turf.distance(center,c,{units:'meters'})>(kind==='building'?1000:1400))continue;
   if(kind==='building'&&!['Polygon','MultiPolygon'].includes(f.geometry.type))continue;
   f.properties={...f.properties,id:`gsi-${z}-${x}-${y}-${i}`};out.push(f);
  }
 }
}
fs.writeFileSync('data/geography.json',JSON.stringify({fetchedAt:new Date().toISOString(),source:'国土地理院ベクトルタイル提供実験',url:'https://maps.gsi.go.jp/development/vt.html',tiles:count,buildings,roads,rails}));
console.log(JSON.stringify({tiles:count,buildings:buildings.length,roads:roads.length,rails:rails.length}));
