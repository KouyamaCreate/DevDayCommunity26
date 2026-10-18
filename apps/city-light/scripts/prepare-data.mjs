import fs from 'node:fs';import * as turf from '@turf/turf';import {CENTER,distance} from '../server/geo.mjs';
const snapshot=JSON.parse(fs.readFileSync('data/pois.json'));const geo=JSON.parse(fs.readFileSync('data/geography.json'));
const grid=new Map(),size=.001;
const key=(x,y)=>`${x}:${y}`;
const buildings=geo.buildings.map(f=>{const [lng,lat]=turf.centroid(f).geometry.coordinates;return{id:f.properties.id,name:'建物 '+f.properties.id.split('-').slice(-1),address:'渋谷駅周辺',lat,lng,distance:Math.round(distance(lat,lng)),geometry:f.geometry,area:turf.area(f),height:f.properties.ftCode===3103?30:f.properties.ftCode===3102?18:9,heightSource:'建物種別による模式高さ（実測値ではありません）',pois:[],categories:{},method:'施設情報なし',quality:'none',bbox:turf.bbox(f)}});
for(const b of buildings){const [a,c,d,e]=b.bbox;for(let x=Math.floor((a-.0002)/size);x<=Math.floor((d+.0002)/size);x++)for(let y=Math.floor((c-.0002)/size);y<=Math.floor((e+.0002)/size);y++){const k=key(x,y);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(b)}}
const unassigned=[];
for(const p of snapshot.results){if(distance(p.lat,p.lng)>1000)continue;const point=turf.point([p.lng,p.lat]);const candidates=grid.get(key(Math.floor(p.lng/size),Math.floor(p.lat/size)))||[];let matched=candidates.filter(b=>turf.booleanPointInPolygon(point,b.geometry)).sort((a,b)=>a.area-b.area)[0];let method='contains',gap=0;
 if(!matched){const nearby=candidates.map(b=>({b,d:turf.pointToPolygonDistance(point,b.geometry,{units:'meters'})})).sort((a,b)=>a.d-b.d);if(nearby[0]?.d<=12){matched=nearby[0].b;method='nearest';gap=nearby[0].d}}
 if(!matched){unassigned.push(p);continue}
 matched.pois.push({...p,assignment:method,assignmentDistance:Math.round(gap*10)/10});matched.categories[p.category]=(matched.categories[p.category]||0)+1;
}
function norm(s){return s.normalize('NFKC').replace(/[−‐‑–—ー－]/g,'-')}
for(const b of buildings){const names=new Map(),addrs=new Map();for(const p of b.pois){const a=norm(p.address||'');const m=a.match(/(?:\d[\s,、-]*)([^\d\s,、-]*(?:ビル|スクエア|マークシティ|ヒカリエ|タワー|プラザ|センター|モディ|フクラス|109|ハイツ|マンション))/);if(m&&m[1].length>1)names.set(m[1],(names.get(m[1])||0)+1);const v=a.match(/(?:渋谷区)?((?:渋谷|道玄坂|宇田川町|神南|桜丘町|円山町|神泉町|神宮前|南平台町|猿楽町|鶯谷町)[\d丁目番地号-]+)/)?.[1];if(v)addrs.set(v,(addrs.get(v)||0)+1)}
 const common=m=>[...m].sort((a,b)=>b[1]-a[1])[0]?.[0];b.address=common(addrs)?'東京都渋谷区'+common(addrs):b.pois[0]?.address||'渋谷駅周辺';b.name=common(names)||common(addrs)||(b.pois.length?b.pois[0].name+' 付近':b.name);
 const inside=b.pois.filter(p=>p.assignment==='contains').length;b.quality=b.pois.length?(inside===b.pois.length?'contains':'mixed'):'none';b.method=b.pois.length?`座標内包 ${inside}件 / 12m以内の近接候補 ${b.pois.length-inside}件。入居先は未確認。`:'施設の記録がないため未評価';delete b.bbox;
}
const metadata={center:CENTER,radius:1000,fetchedAt:snapshot.fetchedAt,requestCount:snapshot.requestCount,truncatedCells:snapshot.truncatedCells,poiCount:snapshot.results.length,buildingCount:buildings.length,matchedCount:buildings.reduce((n,b)=>n+b.pois.length,0),unassignedCount:unassigned.length,evaluableCount:buildings.filter(b=>b.pois.length).length,geographyFetchedAt:geo.fetchedAt,geometrySource:geo.source};
const dataset={metadata,buildings,roads:{type:'FeatureCollection',features:geo.roads},rails:{type:'FeatureCollection',features:geo.rails}};
fs.mkdirSync('public/data',{recursive:true});fs.writeFileSync('data/buildings.json',JSON.stringify(dataset));fs.writeFileSync('data/unassigned.json',JSON.stringify(unassigned));
// Full facility records and licenses are served by /api/buildings/:id, keep the map payload small.
fs.writeFileSync('public/data/map.json',JSON.stringify({...dataset,buildings:buildings.map(({pois,...b})=>({...b,poiCount:pois.length}))}));
console.log(JSON.stringify(metadata,null,2));
