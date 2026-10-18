// Opt-in live checks: uses configured Google/OpenAI APIs and incurs their normal charges.
// All locations are public SF/Tokyo landmarks, not personal addresses or listings.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Config } from '../src/config.mjs';
import { webEnvironment } from '../src/web-env.mjs';
import { Sessions } from '../src/state.mjs';
import { Google } from '../src/google.mjs';
import { Reports } from '../src/reports.mjs';
import { MapService } from '../src/service.mjs';
import { ChatAgent } from '../src/chat.mjs';
import { presentation } from '../ui/presentation.mjs';

import { publicError } from '../src/errors.mjs';
const config = new Config({ env: await webEnvironment() });
const sessions = new Sessions();
const service = new MapService({ config, sessions, google: new Google(config), reports: new Reports({ cacheDirectory: join(config.directory,'public-reports') }) });
const agent = new ChatAgent({ service, sessions, env: config.env });
const passed = (scenario, details) => console.log(JSON.stringify({ scenario, status:'passed', ...details }));
try {
  const workspaceId = (await service.open({city:'sf'})).workspace.id;
  await service.layer({workspaceId});
  let w = (await service.view(workspaceId)).workspace;
  assert.equal(w.places.length,0); assert.equal(w.originId,null); assert.ok(w.reportLayer.regions.some(r=>r.status==='available'));
  assert.equal(w.reportLayer.smoothingHaloMeters,500);assert.ok(w.reportLayer.incidents.length>0);assert.equal(presentation(w).candidates.length,0);
  passed('initial-report-layer',{layerStatus:w.reportLayer.status,positions:w.reportLayer.incidents.length});
  w = (await agent.send({workspaceId,message:'SFを見せて。表示範囲の公開報告について短く教えて。店や経路はまだ不要。'})).workspace;
  assert.equal(w.originId,null);assert.equal(w.routes.length,0);assert.equal(w.focus.type,'viewport');
  passed('natural-language-map-move',{city:w.city,reply:w.chatMessages.at(-1).text});
  w = (await agent.send({workspaceId,message:'この辺でカフェを2軒探して。徒歩経路はまだ不要。'})).workspace;
  assert.equal(w.originId,null);assert.equal(w.routes.length,0);assert.ok(w.searchResultIds.length>0);
  passed('search-without-origin',{results:w.searchResultIds.length,reply:w.chatMessages.at(-1).text});
  const landmarks = [];
  for (const [query,label,role,prefix] of [['1 Ferry Building, San Francisco, CA 94111, USA','検証地点A','property','Ferry Building, San Francisco'],['4 Embarcadero Center, San Francisco, CA 94111, USA','検証地点B','property','Four Embarcadero Center, 4 Embarcadero Ctr'],['415 Mission Street, San Francisco, CA 94105, USA','検証勤務先','candidate','415 Mission St, San Francisco']]) {
    const matches = (await service.google.geocode(query,'sf')).filter(p=>p.address.startsWith(prefix));
    assert.equal(matches.length,1,`Public landmark fixture must match exactly: ${query}`);
    // The harness supplies explicitly verified public coordinates, never chooses an ambiguous address silently.
    const {lat,lng,address}=matches[0];
    const result=await service.resolve({workspaceId,lat,lng,address,label,role});landmarks.push(result.candidates[0]);
  }
  w = (await agent.send({workspaceId,message:'検証地点Aと検証地点Bから検証勤務先への徒歩通勤を、行きと帰りの両方で比較して。遠回りは5分、徒歩往復30分以内にしたい。'})).workspace;
  assert.equal(w.conditions.maxDetourMinutes,5);assert.equal(w.conditions.maxRoundTripMinutes,30);assert.equal(w.routePairs.length,2);
  for (const p of landmarks.slice(0,2)) {
    const pair=w.routePairs.find(pair=>pair.fromId===p.id && pair.toId===landmarks[2].id);assert.ok(pair);
    assert.ok(w.routes.some(r=>r.pairId===pair.id && r.leg==='out' && r.fromId===p.id));
    assert.ok(w.routes.some(r=>r.pairId===pair.id && r.leg==='back' && r.toId===p.id));
  }
  const cardView=presentation(w);assert.equal(cardView.propertyMode,true);assert.equal(cardView.candidates.length,2);assert.equal(cardView.to.id,landmarks[2].id);
  passed('directed-commute-comparison',{pairs:w.routePairs.length,evaluations:w.walkEvaluations.map(({totalSeconds,status})=>({totalSeconds,status})),reply:w.chatMessages.at(-1).text});
  const routeIds=w.routes.map(r=>r.id);
  w = (await agent.send({workspaceId,message:'比較は残したまま、この表示範囲でスーパーを2軒探して。経路は更新しなくていい。'})).workspace;
  assert.ok(landmarks.every(p=>w.places.some(current=>current.id===p.id)));assert.deepEqual(w.routes.map(r=>r.id),routeIds);assert.equal(w.conditions.maxRoundTripMinutes,30);
  passed('search-preserves-comparison',{retained:landmarks.length,results:w.searchResultIds.length});
  await service.move({workspaceId,city:'shibuya'});
  await service.focus({workspaceId,point:{lat:35.6580,lng:139.7016}});
  w=(await service.analyze({workspaceId})).workspace;
  assert.equal(w.focusReport.comparable,false);assert.equal(w.focusReport.precision,'neighborhood');assert.ok(w.focusReport.areaCounts[0].area);assert.equal(w.focusReport.boundaries.year,2020);
  assert.equal(w.reportLayer.incidents.length,0);assert.ok(w.reportLayer.areas.some(a=>a.geometry));
  passed('tokyo-point-neighborhood',{area:w.focusReport.areaCounts[0].area,count:w.focusReport.areaCounts[0].count,period:w.focusReport.period.label});
  const london=(await service.resolve({workspaceId,lat:51.5,lng:-0.12,label:'London public test point'})).candidates[0];
  w=(await service.move({workspaceId,placeId:london.id})).workspace;
  assert.equal(w.reportLayer.status,'unsupported');assert.ok(w.mapView.center.lat>50 && w.mapView.center.lng>-1 && w.mapView.center.lng<1);
  passed('global-map-unsupported-reports',{layerStatus:w.reportLayer.status});
} catch(error) {
  console.error(JSON.stringify({status:'failed',error:publicError(error),assertion:error.code==='ERR_ASSERTION'?error.message:undefined}));process.exitCode=1;
} finally {sessions.close();}
