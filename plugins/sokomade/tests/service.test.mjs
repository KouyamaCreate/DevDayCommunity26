import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Sessions } from '../src/state.mjs';
import { MapService } from '../src/service.mjs';
import { allowedPropertyURL, isPublicIP, fetchPropertyHTML, extractListingAddress } from '../src/network.mjs';
const config={status:async()=>({serverConfigured:false,browserConfigured:false})};
const route=(durationSeconds)=>({id:randomUUID(),durationSeconds,minutes:Math.ceil(durationSeconds/60),coordinates:[[-122.42,37.78],[-122.41,37.78]],distanceMeters:1000});
async function fixture(t,google={walking:async()=>[route(600),route(901),route(1200)]}) {
 const sessions=new Sessions();t.after(()=>sessions.close());
 const reports={context:async()=>{throw Error('source down');}};
 const service=new MapService({sessions,config,google,reports});
 const id=(await service.open({city:'sf'})).workspace.id;
 await service.resolve({workspaceId:id,lat:37.78,lng:-122.42,role:'origin'});
 await service.resolve({workspaceId:id,lat:37.79,lng:-122.41});
 return {sessions,service,id};
}
test('session expiry is not extended by passive polling, and clear isolates consultations',()=>{
 let now=0;const sessions=new Sessions({now:()=>now,ttlMs:100});
 try {const a=sessions.create('sf'),b=sessions.create('sf');now=99;sessions.snapshot(a.id,{touch:false});now=100;assert.throws(()=>sessions.get(a.id),{code:'SESSION_EXPIRED'});assert.throws(()=>sessions.get(b.id),{code:'SESSION_EXPIRED'});const c=sessions.create('sf');sessions.delete(c.id);assert.throws(()=>sessions.get(c.id),{code:'SESSION_EXPIRED'});}finally{sessions.close();}
});
test('walk alternatives obey exact detour limit; failed reports remain unknown; leg selections are independent',async t=>{
 const {service,id}=await fixture(t); const result=await service.plan({workspaceId:id,maxDetourMinutes:5});
 const w=result.workspace;assert.equal(w.routes.length,2);assert.equal(w.report.status,'unavailable');assert.equal(w.report.comparable,false);
 assert.equal(w.routes.filter(r=>r.leg==='out').length,1);assert.equal(w.routes.filter(r=>r.leg==='back').length,1);
 const out=w.selectedRoutes[`${w.selectedPlaceId}:out`];await service.select({workspaceId:id,leg:'back'});
 assert.equal((await service.view(id)).workspace.selectedRoutes[`${w.selectedPlaceId}:out`],out);
 await assert.rejects(service.select({workspaceId:id,expectedVersion:0,leg:'out'}),{code:'STALE_VIEW'});
 await service.clear({workspaceId:id});await assert.rejects(service.view(id),{code:'SESSION_EXPIRED'});
});
test('an old async result cannot overwrite a newer origin',async t=>{
 let release; const gate=new Promise(resolve=>release=resolve);
 const {service,id}=await fixture(t,{walking:async()=>{await gate;return[route(600)];}});
 const pending=service.plan({workspaceId:id});
 await service.resolve({workspaceId:id,lat:37.775,lng:-122.43,role:'origin'});release();
 await assert.rejects(pending,{code:'STALE_RESULT'});assert.equal((await service.view(id)).workspace.routes.length,0);
});
test('property URLs validate host, protocol and all resolved addresses; extraction uses structured address only',async()=>{
 for(const url of ['http://suumo.jp/a','https://suumo.jp.evil.test/','https://127.0.0.1/','https://user:pass@suumo.jp/a'])assert.throws(()=>allowedPropertyURL(url));
 for(const ip of ['127.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','10.0.0.1'])assert.equal(isPublicIP(ip),false);
 await assert.rejects(fetchPropertyHTML('https://suumo.jp/a',{resolver:async()=>[{address:'127.0.0.1',family:4}]}),{code:'URL_NOT_SUPPORTED'});
 assert.equal(extractListingAddress('<script type="application/ld+json">{"@type":"Apartment","address":{"streetAddress":"1 Main St","addressLocality":"SF"}}</script>'),'1 Main St, SF');
 assert.throws(()=>extractListingAddress('<script type="application/ld+json">{"@type":"Organization","address":"Corporate office"}</script>'),{code:'ADDRESS_NOT_EXTRACTED'});
 assert.throws(()=>extractListingAddress('<h1>guess this location</h1>'),{code:'ADDRESS_NOT_EXTRACTED'});
});
