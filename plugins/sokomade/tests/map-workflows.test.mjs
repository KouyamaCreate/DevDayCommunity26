import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Sessions } from '../src/state.mjs';
import { MapService } from '../src/service.mjs';
import { Reports } from '../src/reports.mjs';
import { CITIES, boundsAround } from '../src/spatial.mjs';
import { mapContext, ChatAgent } from '../src/chat.mjs';

const config = { status: async () => ({}) };
const route = seconds => ({ id: randomUUID(), durationSeconds: seconds, minutes: Math.ceil(seconds / 60), coordinates: [[-122.42,37.78],[-122.41,37.79]], distanceMeters: 1000 });
const place = (name, extra = {}) => ({ id: randomUUID(), providerId: name, name, address: name, lat: 37.78, lng: -122.42, ...extra });
const emptyLayer = bounds => ({ bounds, status: 'unsupported', regions: [], incidents: [], limitations: [] });
async function setup(t, overrides = {}) {
  const sessions = new Sessions(); t.after(() => sessions.close());
  const service = new MapService({ sessions, config, google: { walking: async () => [route(600), route(900)], ...overrides.google }, reports: { layer: async b => emptyLayer(b), context: async () => ({ comparable: false, routeCounts: [], areaCounts: [], limitations: [] }), ...overrides.reports } });
  const id = (await service.open({city:'sf'})).workspace.id;
  return { service, sessions, id };
}
async function add(service, id, label, role = 'property', lat = 37.78, lng = -122.42) {
  return (await service.resolve({ workspaceId: id, label, role, lat, lng })).candidates[0];
}
test('map opens with a report layer without any origin or candidates; pans and points are separate from walking origin', async t => {
  let layers = 0;
  const { service, sessions, id } = await setup(t, { reports: { layer: async bounds => { layers++; return emptyLayer(bounds); } } });
  await service.layer({ workspaceId:id }); assert.ok(layers > 0);
  const origin = await add(service,id,'hotel','origin'); const shop = await add(service,id,'shop','candidate');
  await service.plan({workspaceId:id});
  const oldRoutes = sessions.snapshot(id).routes;
  const center = {lat:37.80,lng:-122.44};
  await service.viewport({ workspaceId:id,center,bounds:boundsAround(center),zoom:15 });
  await service.focus({workspaceId:id,point:{lat:37.81,lng:-122.45}});
  const w = (await service.view(id)).workspace;
  assert.equal(w.originId,origin.id); assert.equal(w.selectedPlaceId,shop.id); assert.deepEqual(w.routes,oldRoutes);
  assert.equal(w.focus.type,'point'); assert.deepEqual(w.mapView.center,center);
});
test('search follows focus/viewport without an origin, retains properties/selected places and deduplicates provider IDs', async t => {
  const calls=[]; const cafe=place('cafe');
  const {service,sessions,id}=await setup(t,{google:{search:async(q,c,o)=>{calls.push(o.center);return[{...cafe,id:randomUUID()}];}}});
  const property=await add(service,id,'property');
  await service.focus({workspaceId:id,point:{lat:37.80,lng:-122.44}});
  await service.search({workspaceId:id,query:'cafe'}); const first=sessions.snapshot(id).selectedPlaceId;
  assert.deepEqual(calls[0],{lat:37.80,lng:-122.44});
  await service.search({workspaceId:id,query:'cafe',scope:'viewport'});
  const w=sessions.snapshot(id);assert.equal(w.originId,null);assert.ok(w.places.some(p=>p.id===property.id));assert.equal(w.selectedPlaceId,first);assert.equal(w.places.filter(p=>p.providerId==='cafe').length,1);
  assert.deepEqual(calls[1],w.mapView.center);
});
test('arbitrary property-to-work pairs keep actual direction, independent choices and second-accurate persistent limits', async t => {
  const calls=[];
  const {service,id}=await setup(t,{google:{walking:async(a,b)=>{calls.push([a.name,b.name]);return[route(a.name==='work'?901:899),route(a.name==='work'?1201:1199)];}}});
  const a=await add(service,id,'A'), b=await add(service,id,'B'), work=await add(service,id,'work','candidate');
  await service.conditions({workspaceId:id,maxDetourMinutes:5,maxRoundTripMinutes:30});
  let w=(await service.compare({workspaceId:id,pairs:[{fromId:a.id,toId:work.id},{fromId:b.id,toId:work.id}]})).workspace;
  assert.deepEqual(calls,[['A','work'],['work','A'],['B','work'],['work','B']]);
  assert.equal(w.originId,null); assert.ok(w.walkEvaluations.every(v=>v.totalSeconds===1800 && v.status==='within'));
  const extra=w.routes.find(r=>r.destinationId===a.id&&r.leg==='out'&&r.extraSeconds===300);
  w=(await service.select({workspaceId:id,placeId:a.id,routeId:extra.id})).workspace;
  assert.equal(w.walkEvaluations[0].status,'exceeds');assert.equal(w.walkEvaluations[1].status,'within');
  const back=w.routes.find(r=>r.destinationId===a.id&&r.leg==='back');assert.equal(back.fromId,work.id);assert.equal(back.toId,a.id);
  w=(await service.conditions({workspaceId:id,maxDetourMinutes:0})).workspace;
  assert.equal(w.conditions.maxRoundTripMinutes,30);assert.equal(w.walkEvaluations[0].status,'within');
  await assert.rejects(service.select({workspaceId:id,placeId:a.id,routeId:extra.id}),{code:'DETOUR_EXCEEDED'});
  w=(await service.conditions({workspaceId:id,resetRoundTripLimit:true})).workspace;assert.equal(w.conditions.maxRoundTripMinutes,null);
});
test('missing return route is unknown and 1801 seconds exceeds 30 minutes even when each leg rounds differently', async t => {
  const {service,id}=await setup(t,{google:{walking:async(a)=>a.name==='work'?[]:[route(900)]}});
  const a=await add(service,id,'A'),work=await add(service,id,'work');
  await service.conditions({workspaceId:id,maxRoundTripMinutes:30});
  let w=(await service.compare({workspaceId:id,pairs:[{fromId:a.id,toId:work.id}]})).workspace;
  assert.equal(w.walkEvaluations[0].status,'unknown');assert.equal(w.walkEvaluations[0].totalSeconds,null);
  service.google.walking=async()=>[route(900.5)];
  w=(await service.compare({workspaceId:id,pairs:[{fromId:a.id,toId:work.id}]})).workspace;
  assert.equal(w.walkEvaluations[0].totalSeconds,1801);assert.equal(w.walkEvaluations[0].status,'exceeds');
});
test('stale search and layer responses cannot overwrite a new map; stale camera acknowledgements do not move it back', async t => {
  let releaseSearch; const searchGate=new Promise(r=>releaseSearch=r);
  const {service,sessions,id}=await setup(t,{google:{search:async()=>{await searchGate;return[place('old')];}}});
  const pending=service.search({workspaceId:id,query:'old'});
  await service.move({workspaceId:id,city:'shibuya'});releaseSearch();await assert.rejects(pending,{code:'STALE_RESULT'});
  await service.viewport({workspaceId:id,center:CITIES.sf.center,bounds:CITIES.sf.bounds,zoom:10,commandId:0});
  assert.deepEqual(sessions.snapshot(id).mapView.center,CITIES.shibuya.center);
  let releaseLayer; const layerGate=new Promise(r=>releaseLayer=r);
  service.reports.layer=async b=>{await layerGate;return {...emptyLayer(b),marker:'old'};};
  const old=service.layer({workspaceId:id});service.reports.layer=async b=>({...emptyLayer(b),marker:'new'});
  await service.layer({workspaceId:id});releaseLayer();await old;
  assert.equal(sessions.snapshot(id).reportLayer.marker,'new');
});
test('report layer separates sparse public positions, unavailable sources, unsupported regions and geometry-free Tokyo totals', async () => {
  const reports=new Reports();reports.sf=async()=>({incidents:[{id:'1',lat:37.78,lng:-122.42,categories:['theft']},{id:'2',lat:37.78,lng:-122.42,categories:['theft']}],period:{label:'90 days'}});
  reports.tokyo=async()=>({areas:[{area:'渋谷区神南1丁目',counts:{assault:1,robbery:2,theft:3}}],period:{label:'year'}});
  const sf=await reports.layer(CITIES.sf.bounds,{categories:['theft']});assert.equal(sf.incidents.length,1);assert.equal(sf.incidents[0].count,2);assert.equal(sf.regions[0].visiblePublicReportCount,2);assert.equal(sf.coverage,'not-verified');
  const tokyo=await reports.layer(CITIES.shibuya.bounds);assert.equal(tokyo.incidents.length,0);assert.equal(tokyo.areas[0].geometry,null);assert.equal(tokyo.regions[0].viewportCount,null);
  const other=await reports.layer(boundsAround({lat:51.5,lng:0}));assert.equal(other.status,'unsupported');
  reports.sf=async()=>{throw Error('offline');};assert.equal((await reports.layer(CITIES.sf.bounds)).status,'unavailable');
  assert.equal(JSON.stringify(mapContext({places:[],routes:[],report:null,reportLayer:sf})).includes('37.78'),false);
});
test('global map locations remain usable while mixed/unsupported reports are not ranked as equal-period counts', async t=>{
  const {service,id}=await setup(t);
  await add(service,id,'London','property',51.5,-0.12);
  const w=(await service.analyze({workspaceId:id})).workspace;
  assert.equal(w.report.status,'unavailable');assert.equal(w.report.areaCounts[0].count,null);
  await service.move({workspaceId:id,placeId:w.selectedPlaceId});
  assert.equal((await service.view(id)).workspace.reportLayer.status,'unsupported');
});
test('an external focus change cancels in-flight AI and old route work without changing endpoints', async t=>{
  let enter;const started=new Promise(r=>enter=r);
  const {service,sessions,id}=await setup(t);
  const agent=new ChatAgent({service,sessions,env:{OPENAI_API_KEY:'test'},fetchImpl:(url,options)=>new Promise((resolve,reject)=>{enter();options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});
  const pending=agent.send({workspaceId:id,message:'この辺を教えて'});await started;
  await service.focus({workspaceId:id,point:{lat:37.8,lng:-122.4}});
  await assert.rejects(pending,{code:'CHAT_CANCELLED'});assert.equal(sessions.snapshot(id).focus.type,'point');assert.equal(sessions.snapshot(id).chatBusy,false);
});

test('focus analysis retains route evidence and category changes refresh both independent layers',async t=>{
  const seen=[];
  const {service,id}=await setup(t,{reports:{layer:async(b,c)=>{seen.push(c.categories);return emptyLayer(b);},context:async(city,places,routes)=>({city,comparable:true,incidents:[],routeCounts:routes.map(r=>({routeId:r.id,count:3})),areaCounts:places.map(p=>({placeId:p.id,count:2})),limitations:[]})}});
  await add(service,id,'hotel','origin');await add(service,id,'shop','candidate');
  let w=(await service.plan({workspaceId:id})).workspace;const oldCounts=w.report.routeCounts;
  await service.focus({workspaceId:id,point:{lat:37.79,lng:-122.43}});
  w=(await service.analyze({workspaceId:id})).workspace;
  assert.deepEqual(w.report.routeCounts,oldCounts);assert.equal(w.focusReport.areaCounts[0].count,2);
  w=(await service.conditions({workspaceId:id,categories:['robbery']})).workspace;
  assert.deepEqual(w.conditions.categories,['robbery']);assert.ok(seen.some(c=>c.length===1&&c[0]==='robbery'));
});

test('global provider locations are not rejected by report-region bounds',async()=>{
  const {Google}=await import('../src/google.mjs');
  const google=new Google({keys:async()=>({server:'test'})},{request:async()=>({status:'OK',results:[{place_id:'london',formatted_address:'London UK',geometry:{location:{lat:51.5,lng:-0.12},location_type:'APPROXIMATE'}}]})});
  assert.equal((await google.geocode('London UK','sf'))[0].lat,51.5);
});
