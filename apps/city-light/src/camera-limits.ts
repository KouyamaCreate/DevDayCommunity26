export const MAP_CENTER={lng:139.701636,lat:35.658034};
export const CAMERA_LIMITS={minDistance:200,maxDistance:3200,maxCenterDistance:1100,minPitch:-90,maxPitch:-30};
export type MapCamera={lng:number;lat:number;distance:number;pitch:number;heading:number};
export const INITIAL_CAMERA:MapCamera={...MAP_CENTER,distance:2600,pitch:-48,heading:-24};
const metersPerDegree=111320;
const longitudeScale=metersPerDegree*Math.cos(MAP_CENTER.lat*Math.PI/180);

/** Local tangent-plane bounds cover the entire 1 km dataset, with a 100 m margin. */
export function constrainCamera(candidate:MapCamera,fallback:MapCamera=INITIAL_CAMERA):MapCamera{
 if(!Object.values(candidate).every(Number.isFinite))return {...fallback};
 const east=(candidate.lng-MAP_CENTER.lng)*longitudeScale,north=(candidate.lat-MAP_CENTER.lat)*metersPerDegree;
 const scale=Math.min(1,CAMERA_LIMITS.maxCenterDistance/Math.max(Math.hypot(east,north),1));
 return{lng:MAP_CENTER.lng+east*scale/longitudeScale,lat:MAP_CENTER.lat+north*scale/metersPerDegree,
  distance:Math.max(CAMERA_LIMITS.minDistance,Math.min(CAMERA_LIMITS.maxDistance,candidate.distance)),
  pitch:Math.max(CAMERA_LIMITS.minPitch,Math.min(CAMERA_LIMITS.maxPitch,candidate.pitch)),
  heading:((candidate.heading+180)%360+360)%360-180};
}
