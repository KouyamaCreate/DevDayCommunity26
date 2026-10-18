import {test} from 'node:test';
import assert from 'node:assert/strict';
import {constrainCamera,INITIAL_CAMERA,MAP_CENTER,CAMERA_LIMITS} from '../src/camera-limits.ts';
import fs from 'node:fs';

test('all Shibuya buildings remain reachable within the camera bounds',()=>{
 const {buildings}=JSON.parse(fs.readFileSync('public/data/map.json','utf8'));
 for(const b of buildings){
  const result=constrainCamera({...INITIAL_CAMERA,lng:b.lng,lat:b.lat,distance:850});
  assert(Math.abs(result.lng-b.lng)<1e-10&&Math.abs(result.lat-b.lat)<1e-10,b.id);
 }
});
test('large pan, wheel and tilt inputs cannot leave the local map',()=>{
 for(const [lng,lat] of [[180,80],[-180,-80],[139.701636,90],[0,0]]){
  const result=constrainCamera({lng,lat,distance:1e9,pitch:0,heading:720});
  const meters=Math.hypot((result.lng-MAP_CENTER.lng)*111320*Math.cos(MAP_CENTER.lat*Math.PI/180),(result.lat-MAP_CENTER.lat)*111320);
  assert(meters<=CAMERA_LIMITS.maxCenterDistance+1e-6);
  assert.equal(result.distance,3200);assert.equal(result.pitch,-30);
 }
 assert.equal(constrainCamera({...INITIAL_CAMERA,distance:-10,pitch:-120}).distance,200);
 assert.deepEqual(constrainCamera({...INITIAL_CAMERA,lng:NaN}),INITIAL_CAMERA);
});
