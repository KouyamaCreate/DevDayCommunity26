import test from 'node:test';
import assert from 'node:assert/strict';
import { presentation, candidateLetter } from '../ui/presentation.mjs';
import { reportGrid, layerMessage } from '../ui/report-grid.mjs';
const state=()=>({places:[],originId:null,selectedPlaceId:null,routePairs:[],searchResultIds:[],routes:[],selectedRoutes:{},leg:'out',conditions:{maxDetourMinutes:5,maxRoundTripMinutes:null},walkEvaluations:[]});
test('browse, return and property views derive only actionable current IDs',()=>{
  const s=state();assert.equal(presentation(s).route,undefined);assert.deepEqual(presentation(s).candidates,[]);
  s.places=[{id:'a',role:'property'},{id:'b',role:'property'},{id:'work',role:'candidate'}];s.selectedPlaceId='a';
  s.routePairs=[{id:'pa',comparisonId:'a',fromId:'a',toId:'work'},{id:'pb',comparisonId:'b',fromId:'b',toId:'work'}];
  s.routes=[{id:'out',destinationId:'a',fromId:'a',toId:'work',leg:'out',extraSeconds:0},{id:'back',destinationId:'a',fromId:'work',toId:'a',leg:'back',extraSeconds:0},{id:'long',destinationId:'a',fromId:'work',toId:'a',leg:'back',extraSeconds:301}];s.selectedRoutes={'a:out':'out','a:back':'back'};
  let p=presentation(s);assert.equal(p.propertyMode,true);assert.deepEqual(p.candidates.map(p=>p.id),['a','b']);assert.equal(p.from.id,'a');
  s.leg='back';p=presentation(s);assert.equal(p.route.id,'back');assert.equal(p.from.id,'work');assert.equal(p.to.id,'a');assert.equal(p.routes.length,1);
  assert.equal(candidateLetter(s,'a'),'A');assert.equal(candidateLetter(s,'b'),'B');assert.equal(candidateLetter(s,'work'),null);
  s.routes=[];s.selectedRoutes={'a:back':'stale-id'};assert.equal(presentation(s).route,undefined);
});
test('new search is shown without removing stored comparisons, and missing time budget evidence stays unknown',()=>{
  const s=state();s.places=[{id:'a',role:'property'},{id:'cafe',role:'search-result'}];s.selectedPlaceId='cafe';s.searchResultIds=['cafe'];s.conditions.maxRoundTripMinutes=30;
  const p=presentation(s);assert.deepEqual(p.candidates.map(p=>p.id),['cafe']);assert.equal(s.places.length,2);assert.equal(p.limitFailed,true);
});
test('report grid preserves counts and fixed intensity, excludes clipped cells and never invents zero/unknown geometry',()=>{
  const layer={status:'partial',regions:[{city:'sf',status:'available'}],bounds:{south:37.7,north:37.84,west:-122.53,east:-122.34},incidents:[{lat:37.78,lng:-122.42,count:3},{lat:37.78001,lng:-122.42001,count:4}]};
  const cells=reportGrid(layer);assert.equal(cells.reduce((s,c)=>s+c.count,0),7);
  const wider=reportGrid({...layer,bounds:{south:37.6,north:37.9,west:-122.6,east:-122.3}});assert.deepEqual(cells,wider);
  const cell=cells[0];assert.equal(reportGrid({...layer,bounds:{...cell.bounds,south:cell.bounds.south+.0001}}).length,0);
  assert.deepEqual(reportGrid({...layer,regions:[{city:'shibuya',status:'available'}]}),[]);
  assert.deepEqual(reportGrid({...layer,incidents:[]}),[]);assert.match(layerMessage({status:'unsupported'}),/未対応/);assert.match(layerMessage({status:'unavailable'}),/取得できません/);
});

test('report intensity uses fixed count thresholds rather than local minimum or maximum',()=>{
  const counts=[1,4,5,9,10,19,20,200];
  const layer={status:'partial',regions:[{city:'sf',status:'available'}],bounds:{south:37.6,north:37.9,west:-122.6,east:-122.3},incidents:counts.map((count,i)=>({lat:37.7+i*.01,lng:-122.42,count}))};
  const cells=reportGrid(layer);
  assert.deepEqual(cells.map(c=>c.count),counts);
  assert.deepEqual(cells.map(c=>c.level),[0,0,1,1,2,2,3,3]);
  assert.deepEqual(reportGrid({...layer,incidents:layer.incidents.slice(0,2)}),cells.slice(0,2));
});
