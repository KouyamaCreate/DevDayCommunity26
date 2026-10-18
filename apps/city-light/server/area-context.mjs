import * as turf from '@turf/turf';
export const normalizeTown=name=>name.normalize('NFKC').replace(/[ケヶ]/g,'ヶ').replace(/鴬/g,'鶯').replace(/濤/g,'涛').replace(/([一二三四五六七八九十]+)丁目/g,(_,value)=>{
 const n={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 const parts=value.split('十');return(parts.length===2?(n[parts[0]]||1)*10+(n[parts[1]]||0):n[value])+'丁目';
});
/** Midrank avoids assigning different values to ties. A relative index, never a safety probability. */
export function areaReferenceScore(density,reference){
 if(!Number.isFinite(density)||density<0||reference.length<2)return null;
 const below=reference.filter(v=>v<density).length,equal=reference.filter(v=>v===density).length;
 return Math.max(20,Math.min(80,Math.round(80-60*(below+Math.max(0,equal-1)/2)/(reference.length-1))));
}
export function matchBuildingArea(building,areas){
 const feature=turf.feature(building.geometry),bbox=turf.bbox(feature),area=turf.area(feature);
 if(area<=0)return null;
 const candidates=areas.filter(a=>bbox[0]<a.bbox[2]&&a.bbox[0]<bbox[2]&&bbox[1]<a.bbox[3]&&a.bbox[1]<bbox[3]);
 const overlaps=[];
 for(const a of candidates){
  const clipped=turf.intersect(turf.featureCollection([feature,a.feature]));
  if(clipped)overlaps.push({areaId:a.id,coverage:turf.area(clipped)/area});
 }
 overlaps.sort((a,b)=>b.coverage-a.coverage);
 // Do not fill ambiguous boundary buildings or snap buildings to a nearby town.
 return overlaps[0]?.coverage>=.8?{areaId:overlaps[0].areaId,coverage:Math.min(1,overlaps[0].coverage),method:'footprint-overlap-80pct'}:null;
}
