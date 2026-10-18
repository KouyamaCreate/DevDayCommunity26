import boundaries from '../data/shibuya-2020.json' with { type:'json' };
import pointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';

export const boundaryMetadata=boundaries.metadata;
export const normalizeArea=name=>name.normalize('NFKC').replace(/鶯/g,'鴬').replace(/濤/g,'涛').replace(/ヶ/g,'ケ').replace(/[一二三四五六七八九]丁目/g,s=>`${'一二三四五六七八九'.indexOf(s[0])+1}丁目`);
const byName=new Map(boundaries.features.map(f=>[normalizeArea(f.properties.name),f]));
export function joinShibuyaAreas(areas) {
  return areas.map(area=>{
    const f=byName.get(normalizeArea(area.area));
    return {...area,geometry:f?.geometry || null,boundaryCode:f?.properties.code || null};
  });
}
export function shibuyaAreaAt(location) {
  if(!Number.isFinite(location?.lat)||!Number.isFinite(location?.lng))return null;
  const matches=boundaries.features.filter(f=>pointInPolygon(point([location.lng,location.lat]),f,{ignoreBoundary:true}));
  return matches.length===1?normalizeArea(matches[0].properties.name):null;
}
export function visibleGeometry(geometry,bounds) {
  const points=geometry.type==='Polygon'?geometry.coordinates.flat():geometry.coordinates.flat(2);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return Math.min(...xs)<=bounds.east&&Math.max(...xs)>=bounds.west&&Math.min(...ys)<=bounds.north&&Math.max(...ys)>=bounds.south;
}
