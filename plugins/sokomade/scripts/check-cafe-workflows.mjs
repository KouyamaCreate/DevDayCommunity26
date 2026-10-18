// Explicit opt-in. Both modes call OpenAI and incur its normal API charges.
// Default: real Google and public reports. --agent-fixtures: synthetic upstreams.
import assert from 'node:assert/strict';
import { Config } from '../src/config.mjs';
import { webEnvironment } from '../src/web-env.mjs';
import { Sessions } from '../src/state.mjs';
import { Google } from '../src/google.mjs';
import { Reports } from '../src/reports.mjs';
import { MapService } from '../src/service.mjs';
import { ChatAgent } from '../src/chat.mjs';
import { publicError } from '../src/errors.mjs';
import { cafeAdapters } from '../tests/fixtures/cafe-data.mjs';
const fixtureMode=process.argv.includes('--agent-fixtures');
const config=new Config({env:await webEnvironment()});
const sessions=new Sessions();
try {
  const status=await config.status();
  assert.ok(status.aiConfigured,'OpenAI key is required');
  if(!fixtureMode) assert.ok(status.serverConfigured,'Google Maps server key is required');
  const adapters=fixtureMode?cafeAdapters():{google:new Google(config),reports:new Reports()};
  const service=new MapService({config,sessions,...adapters});
  const agent=new ChatAgent({service,sessions,env:config.env});
  for(const city of ['shibuya','sf']) {
    const id=(await service.open({city})).workspace.id;
    try {
      const w=(await agent.send({workspaceId:id,message:`${city==='sf'?'SF':'渋谷'}のこの表示範囲の近くのカフェを3軒探し、周辺の公開報告と距離の両方を使って比較・提案してください。出発地はありません。徒歩経路は不要です。対象期間・集計範囲・情報の限界も短く添えてください。`})).workspace;
      assert.ok(w.assessment,'Agent must call discover/assess, not just describe capability');
      assert.ok(w.assessment.items.length>0,'At least one cafe result is required');
      assert.ok(w.assessment.items.every(i=>i.evidence.status==='available'),'All candidates must have current report evidence in this live verification');
      assert.equal(w.originId,null);assert.equal(w.routes.length,0);
      assert.equal(w.selectedPlaceId,w.assessment.proposal.recommendedPlaceId);
      assert.ok(w.assessment.items.every(i=>i.evidence.sourceURL&&i.evidence.period?.start));
      if(city==='shibuya') {assert.equal(w.assessment.proposal.comparable,false);assert.ok(w.assessment.items.every(i=>i.evidence.unit==='neighborhood'));}
      console.log(JSON.stringify({city,status:'passed',upstreamMode:fixtureMode?'synthetic-google-and-reports':'live-google-and-reports',agent:'live-openai',items:w.assessment.items.map(i=>({name:i.name,count:i.evidence.count,scope:i.evidence.scopeLabel,status:i.evidence.status})),basis:w.assessment.proposal.basis,reply:w.chatMessages.at(-1).text}));
    } finally {await service.clear({workspaceId:id});}
  }
} catch(error) {
  console.error(JSON.stringify({status:'failed',upstreamMode:fixtureMode?'synthetic-google-and-reports':'live-google-and-reports',error:publicError(error),assertion:error.code==='ERR_ASSERTION'?error.message:undefined}));
  process.exitCode=1;
} finally {sessions.close();}
