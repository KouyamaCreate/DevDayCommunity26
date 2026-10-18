import test from 'node:test';
import assert from 'node:assert/strict';
import { presentation, candidateLetter } from '../ui/presentation.mjs';
import { layerMessage } from '../ui/report-density.mjs';
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
test('unsupported and unavailable report sources remain explicit',()=>{assert.match(layerMessage({status:'unsupported'}),/未対応/);assert.match(layerMessage({status:'unavailable'}),/取得できません/);});
