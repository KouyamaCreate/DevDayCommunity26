import test from 'node:test';
import assert from 'node:assert/strict';
import { Sessions } from '../src/state.mjs';
import { MapService } from '../src/service.mjs';
import { assessTarget, compareEvidence } from '../src/assessment.mjs';
import { cafeAdapters } from './fixtures/cafe-data.mjs';
import { ChatAgent } from '../src/chat.mjs';
import { validateAction } from '../src/validation.mjs';

async function setup(t,city='sf') {
  const sessions=new Sessions();t.after(()=>sessions.close());
  const service=new MapService({sessions,config:{status:async()=>({})},...cafeAdapters()});
  const id=(await service.open({city})).workspace.id;
  return {sessions,service,id};
}
test('SF search → real aggregation contract → balanced proposal → shared map selection without an origin',async t=>{
  const {service,id}=await setup(t);
  const w=(await service.discover(validateAction('discover',{workspaceId:id,query:'カフェ'}))).workspace;
  const {items,proposal}=w.assessment;
  assert.equal(w.originId,null);assert.equal(w.routes.length,0);assert.equal(items.length,3);
  assert.ok(proposal.comparable);assert.equal(proposal.basis,'published-reports-and-distance');
  assert.equal(w.selectedPlaceId,proposal.recommendedPlaceId);assert.equal(w.focus.placeId,proposal.recommendedPlaceId);
  assert.ok(w.mapView.command.id>0);assert.deepEqual(w.mapView.command.center,w.assessment.center);assert.ok(w.mapView.command.zoom<=14);
  assert.deepEqual(items.map(i=>i.evidence.count),[2,1,0]);
  for(const i of items){assert.equal(i.evidence.unit,'radius');assert.ok(i.evidence.period.start);assert.ok(i.evidence.sourceURL);assert.equal(i.evidence.status,'available');}
  const fewer=(await service.assess({workspaceId:id,priority:'fewer-reports'})).workspace.assessment;
  assert.equal(fewer.proposal.recommendedPlaceId,fewer.items[2].targetId);
  const nearby=(await service.assess({workspaceId:id,priority:'nearby'})).workspace.assessment;
  assert.equal(nearby.proposal.recommendedPlaceId,nearby.items[0].targetId);
});
test('Shibuya same neighborhood has same count; different neighborhoods never become safety rankings',async t=>{
  const {service,id}=await setup(t,'shibuya');
  const w=(await service.discover({workspaceId:id,query:'カフェ',priority:'fewer-reports'})).workspace;
  const a=w.assessment;assert.deepEqual(a.items.map(i=>i.evidence.count),[12,12,1]);
  assert.equal(a.proposal.comparable,false);assert.equal(a.proposal.basis,'distance-with-area-context');
  assert.equal(a.proposal.maxExtraDistanceMeters,null);
  assert.equal(a.proposal.recommendedPlaceId,a.items[0].targetId);
  assert.ok(a.items.every(i=>i.evidence.unit==='neighborhood'&&!i.evidence.canCompareCounts));
  assert.ok(a.proposal.reason.includes('順位付けはしていません'));
});
test('unresolved neighborhoods, unsupported regions, stale and failed sources cannot become zero or safe recommendations',async t=>{
  const {service,id}=await setup(t,'shibuya');
  const original=service.google.search;
  service.google.search=async(...args)=>(await original(...args)).map(p=>({...p,address:''}));
  let w=(await service.discover({workspaceId:id,query:'カフェ'})).workspace;
  assert.deepEqual(w.assessment.items.map(i=>i.evidence.count),[12,12,1]);
  service.google.search=async(...args)=>(await original(...args)).map(p=>({...p,address:'',lat:35.670,lng:139.701}));
  w=(await service.discover({workspaceId:id,query:'カフェ'})).workspace;
  assert.ok(w.assessment.items.every(i=>i.evidence.count===null&&i.evidence.status==='unknown'));
  assert.ok(w.assessment.items.every(i=>i.evidence.coverage==='unknown'));
  assert.equal(w.assessment.proposal.recommendedPlaceId,null);
  service.reports.tokyo=async()=>{throw Error('offline');};
  w=(await service.assess({workspaceId:id})).workspace;assert.ok(w.assessment.items.every(i=>i.evidence.status==='unavailable'));
  const p=(await service.resolve({workspaceId:id,lat:51.5,lng:-0.12,label:'Unsupported'})).candidates[0];
  w=(await service.assess({workspaceId:id,placeIds:[p.id]})).workspace;assert.equal(w.assessment.items[0].evidence.status,'unsupported');
  const sf=await setup(t);const source=sf.service.reports.sf;
  sf.service.reports.sf=async()=>({...await source(),stale:true});
  w=(await sf.service.discover({workspaceId:sf.id,query:'カフェ'})).workspace;
  assert.ok(w.assessment.items.every(i=>i.evidence.status==='stale'));assert.equal(w.assessment.proposal.recommendedPlaceId,null);
});
test('partial circles and unlike periods cannot be compared; genuinely known zero remains zero',()=>{
  const conditions={radiusMeters:500,categories:['theft']};
  const target={id:'p',name:'Boundary',kind:'place',lat:37.704,lng:-122.419};
  const report={areaCounts:[{placeId:'p',count:0}],period:{start:'a',end:'b',label:'test'},sourceURL:'https://example.com',fetchedAt:'2026-10-18',precision:'anonymized-intersection'};
  const partial=assessTarget({target,report,city:'sf',conditions,center:target});
  assert.equal(partial.evidence.status,'partial');assert.equal(partial.evidence.count,0);assert.equal(partial.evidence.canCompareCounts,false);
  const valid=assessTarget({target:{...target,lat:37.78},report,city:'sf',conditions,center:target});
  assert.equal(valid.evidence.status,'available');assert.equal(valid.evidence.count,0);
  const different=structuredClone(valid);different.targetId='another';different.evidence.comparisonKey='different-period';
  assert.equal(compareEvidence([valid,different]).comparable,false);
});
test('balanced actually trades distance for published reports within an explicit extra-distance budget',()=>{
 const item=(id,distance,count)=>({targetId:id,kind:'place',name:id,distanceMeters:distance,openNow:true,evidence:{comparisonKey:'same-scope',status:'available',count}});
 const items=[item('nearest',100,8),item('middle',300,2),item('far',900,0)];
 assert.equal(compareEvidence(items).recommendedPlaceId,'middle');
 assert.equal(compareEvidence(items,{maxExtraDistanceMeters:100}).recommendedPlaceId,'nearest');
 assert.equal(compareEvidence(items,{priority:'fewer-reports'}).recommendedPlaceId,'far');
 assert.equal(compareEvidence(items,{priority:'nearby'}).recommendedPlaceId,'nearest');
 assert.ok(compareEvidence(items).reason.includes('300m余分以内'));
});
test('closed or missing-evidence candidates cannot outrank an available candidate with known reports',()=>{
 const item=(id,distance,count,status='available',openNow=true)=>({targetId:id,kind:'place',name:id,distanceMeters:distance,openNow,evidence:{comparisonKey:status==='available'?'same-scope':null,status,count},explanation:'test'});
 const valid=item('known',400,4);
 const unknown=item('unknown',0,null,'unknown');
 const closed=item('closed',50,0,'available',false);
 const p=compareEvidence([unknown,closed,valid],{priority:'fewer-reports'});
 assert.equal(p.comparable,false);assert.equal(p.recommendedPlaceId,'known');assert.deepEqual(p.excludedIds,['unknown','closed']);
 assert.equal(compareEvidence([closed]).recommendedPlaceId,null);
});
test('changed categories and report radius are reflected in new evidence while search scope stays independent',async t=>{
 const {service,id}=await setup(t);
 let w=(await service.discover({workspaceId:id,query:'カフェ',radiusMeters:2000})).workspace;
 const ids=w.searchResultIds;
 await service.conditions({workspaceId:id,categories:['theft'],radiusMeters:100});
 w=(await service.assess({workspaceId:id,placeIds:ids})).workspace;
 assert.deepEqual(w.assessment.conditions.categories,['theft']);assert.equal(w.assessment.items[0].evidence.count,1);
 assert.ok(w.assessment.items.every(i=>i.evidence.scope===100));assert.equal(w.assessment.search.radiusMeters,2000);
});
test('properties and directed routes reuse evidence without destroying existing route comparison',async t=>{
  const {service,id}=await setup(t);
  const property=(await service.resolve({workspaceId:id,lat:37.775,lng:-122.419,label:'物件',role:'property'})).candidates[0];
  const work=(await service.resolve({workspaceId:id,lat:37.780,lng:-122.419,label:'職場'})).candidates[0];
  let w=(await service.compare({workspaceId:id,pairs:[{fromId:property.id,toId:work.id}]})).workspace;
  const routeIds=w.routes.map(r=>r.id);
  w=(await service.assess({workspaceId:id,placeIds:[property.id],routeIds})).workspace;
  assert.equal(w.assessment.items[0].role,'property');assert.ok(w.assessment.items.filter(i=>i.kind==='route').every(i=>i.evidence.unit==='corridor'));
  const paths=w.assessment.items.filter(i=>i.kind==='route');assert.notEqual(paths[0].evidence.comparisonKey,paths[1].evidence.comparisonKey);
  const selected=w.selectedPlaceId;
  w=(await service.assess({workspaceId:id,routeIds})).workspace;
  assert.equal(w.assessment.proposal.basis,'route-evidence');assert.equal(w.assessment.proposal.recommendedPlaceId,null);assert.equal(w.selectedPlaceId,selected);
  await service.discover({workspaceId:id,query:'カフェ'});
  w=(await service.view(id)).workspace;assert.deepEqual(w.routes.map(r=>r.id),routeIds);assert.ok(w.places.some(p=>p.id===property.id));
});
test('new search, changed conditions and expired consultations cannot receive old assessment responses',async t=>{
  const {service,sessions,id}=await setup(t);
  await service.search({workspaceId:id,query:'カフェ'});
  let release;const gate=new Promise(r=>release=r);const original=service.reports.context.bind(service.reports);
  service.reports.context=async(...args)=>{await gate;return original(...args);};
  const pending=service.assess({workspaceId:id});
  await service.search({workspaceId:id,query:'別のカフェ'});release();
  await assert.rejects(pending,{code:'STALE_RESULT'});assert.equal(sessions.snapshot(id).assessment,null);
  await service.assess({workspaceId:id});await service.conditions({workspaceId:id,maxRoundTripMinutes:30});
  assert.equal(sessions.snapshot(id).assessment,null);
  await service.clear({workspaceId:id});await assert.rejects(service.assess({workspaceId:id}),{code:'SESSION_EXPIRED'});
});
test('agent discover tool receives actual evidence and map choice before composing its response',async t=>{
  const {service,sessions,id}=await setup(t,'shibuya');
  const requests=[];
  const agent=new ChatAgent({service,sessions,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    return {ok:true,json:async()=>requests.length===1?{output:[{type:'function_call',name:'discover',call_id:'c',arguments:JSON.stringify({query:'カフェ'})}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'町丁目の情報を添えて参考候補を選びました。'}]}]}};
  }});
  await agent.send({workspaceId:id,message:'渋谷のカフェを治安情報も踏まえて提案して'});
  const data=JSON.parse(requests[1].input.find(i=>i.type==='function_call_output').output);
  assert.equal(data.workspace.assessment.items.length,3);assert.ok(data.workspace.assessment.items[0].evidence.sourceURL);
  assert.equal(data.workspace.selectedPlaceId,data.workspace.assessment.proposal.recommendedPlaceId);
});

test('analyze filter changes clear completed evidence and invalidate in-flight assessments',async t=>{
  const {service,sessions,id}=await setup(t);
  await service.discover({workspaceId:id,query:'カフェ'});
  await service.analyze({workspaceId:id,categories:['theft'],scope:'viewport'});
  assert.equal(sessions.snapshot(id).assessment,null);
  await service.assess({workspaceId:id});
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const original=service.reports.context.bind(service.reports);let pauseNext=true;
  service.reports.context=async(...args)=>{if(pauseNext){pauseNext=false;entered();await gate;}return original(...args);};
  const pending=service.assess({workspaceId:id});const rejected=assert.rejects(pending,{code:'STALE_RESULT'});
  await started;
  try {await service.analyze({workspaceId:id,categories:['robbery'],radiusMeters:100,scope:'viewport'});} finally {release();}
  await rejected;
  assert.equal(sessions.snapshot(id).assessment,null);
  const fresh=(await service.assess({workspaceId:id})).workspace.assessment;
  assert.deepEqual(fresh.conditions.categories,['robbery']);assert.equal(fresh.conditions.radiusMeters,100);
});

test('analyze without a filter change retains completed evidence',async t=>{
  const {service,id}=await setup(t);
  const before=(await service.discover({workspaceId:id,query:'カフェ'})).workspace.assessment;
  await service.analyze({workspaceId:id,categories:before.conditions.categories,radiusMeters:before.conditions.radiusMeters,scope:'viewport'});
  assert.deepEqual((await service.view(id)).workspace.assessment,before);
});

test('an older discover cannot assess newer search results or replace their map command',async t=>{
  const {service,id}=await setup(t);
  const search=service.search.bind(service);let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  service.search=async args=>{const result=await search(args);if(args.query==='old'){entered();await gate;}return result;};
  const old=service.discover({workspaceId:id,query:'old',priority:'fewer-reports'});
  await started;
  const latest=(await service.discover({workspaceId:id,query:'new',priority:'nearby'})).workspace;
  release();await assert.rejects(old,{code:'STALE_RESULT'});
  const actual=(await service.view(id)).workspace;
  assert.deepEqual(actual.assessment,latest.assessment);assert.deepEqual(actual.mapView.command,latest.mapView.command);
});

test('a cross-region route cannot erase evidence for supported places or local routes in the same assessment',async t=>{
  const {service,id}=await setup(t);
  const from=(await service.resolve({workspaceId:id,lat:37.775,lng:-122.419,label:'Local property',role:'property'})).candidates[0];
  const local=(await service.resolve({workspaceId:id,lat:37.780,lng:-122.419,label:'Local work'})).candidates[0];
  const other=(await service.resolve({workspaceId:id,lat:51.5,lng:-0.12,label:'Unsupported work'})).candidates[0];
  const w=(await service.compare({workspaceId:id,pairs:[{fromId:from.id,toId:local.id,comparisonId:local.id},{fromId:from.id,toId:other.id,comparisonId:other.id}]})).workspace;
  const assessment=(await service.assess({workspaceId:id,placeIds:[from.id],routeIds:w.routes.map(r=>r.id)})).workspace.assessment;
  assert.equal(assessment.items.find(i=>i.targetId===from.id).evidence.status,'available');
  for(const route of w.routes) {
    const evidence=assessment.items.find(i=>i.targetId===route.id).evidence;
    const supported=[route.fromId,route.toId].every(id=>[from.id,local.id].includes(id));
    assert.equal(evidence.status==='available',supported);
    if(!supported) assert.equal(evidence.count,null);
  }
});

test('a newer standalone assessment supersedes a discover paused after search',async t=>{
  const {service,id}=await setup(t);
  const search=service.search.bind(service);let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  service.search=async args=>{const result=await search(args);entered();await gate;return result;};
  const old=service.discover({workspaceId:id,query:'カフェ',priority:'fewer-reports'});
  await started;
  let latest;
  try {latest=(await service.assess({workspaceId:id,priority:'nearby'})).workspace;} finally {release();}
  await assert.rejects(old,{code:'STALE_RESULT'});
  const actual=(await service.view(id)).workspace;
  assert.deepEqual(actual.assessment,latest.assessment);assert.deepEqual(actual.mapView.command,latest.mapView.command);
});

test('duplicate categories count each published category once across conditions, analyze and direct reports',async t=>{
  const {service,id}=await setup(t,'shibuya');
  const found=(await service.search({workspaceId:id,query:'カフェ'})).workspace;
  const report=await service.reports.context('shibuya',found.places,[],{categories:['theft','theft','assault']});
  assert.equal(report.areaCounts[0].count,11);assert.deepEqual(report.categories,['theft','assault']);
  for(const update of ['conditions','analyze']) {
    await service[update]({workspaceId:id,categories:['theft','theft','assault']});
    const w=(await service.assess({workspaceId:id})).workspace;
    assert.deepEqual(w.conditions.categories,['theft','assault']);
    assert.deepEqual(w.assessment.items[0].evidence.categories,['theft','assault']);
    assert.equal(w.assessment.items[0].evidence.count,11);
  }
});

test('refreshing a cafe position discards only routes using its old coordinates',async t=>{
  const {service,id}=await setup(t);
  let w=(await service.search({workspaceId:id,query:'カフェ'})).workspace;
  const [a,b,c]=w.searchResultIds;
  const work=(await service.resolve({workspaceId:id,lat:37.79,lng:-122.42,label:'Work'})).candidates[0];
  w=(await service.compare({workspaceId:id,pairs:[{fromId:a,toId:b},{fromId:c,toId:work.id}]})).workspace;
  const removed=w.routes.find(r=>r.fromId===a).id;
  const unaffected=w.routes.filter(r=>r.fromId===c||r.toId===c);
  const original=service.google.search;
  service.google.search=async(...args)=>(await original(...args)).map((p,i)=>i===0?{...p,lat:p.lat+0.001}:p);
  w=(await service.search({workspaceId:id,query:'カフェ'})).workspace;
  assert.equal(w.places.find(p=>p.id===a).lat,37.775+0.001);
  assert.deepEqual(w.routes,unaffected);
  assert.equal(w.routePairs.length,1);assert.equal(w.routePairs[0].fromId,c);
  assert.ok(Object.values(w.selectedRoutes).every(id=>unaffected.some(r=>r.id===id)));
  assert.equal(w.report,null);assert.equal(w.activePairId,null);
  await assert.rejects(service.assess({workspaceId:id,routeIds:[removed]}),{code:'ROUTE_NOT_FOUND'});
});
