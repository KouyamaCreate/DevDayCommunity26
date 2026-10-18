// Opt-in: real Google, OpenAI and freshly fetched public reports; normal API charges apply.
// Property scenarios use public landmarks as hypothetical addresses, not actual listings.
import assert from 'node:assert/strict';
import { Config } from '../src/config.mjs';
import { webEnvironment } from '../src/web-env.mjs';
import { Sessions } from '../src/state.mjs';
import { Google } from '../src/google.mjs';
import { Reports } from '../src/reports.mjs';
import { MapService } from '../src/service.mjs';
import { ChatAgent } from '../src/chat.mjs';
import { publicError } from '../src/errors.mjs';

const scenarios = ['sf', 'shibuya'].flatMap(city => {
  const sf = city === 'sf';
  const from = sf ? 'Ferry Building, San Francisco, CA, USA' : '東京都渋谷区渋谷2丁目21番1号';
  const to = sf ? '415 Mission Street, San Francisco, CA 94105, USA' : '東京都渋谷区宇田川町21番1号';
  return [
    { id: `cafe-${city}`, city, kind: 'cafe', message: 'この辺で治安情報も考慮してカフェを3軒探して提案して。近さと周辺の公開報告を両方使って、選んだ理由と他の候補との違いを説明して。出発地はなく、徒歩経路は不要です。期間・集計範囲・出典と判断の限界も添えて。' },
    { id: `route-${city}`, city, kind: 'route', message: `${from}から${to}へ徒歩で往復したい。治安情報も参考に行き方を相談したいです。遠回りは5分まで。取得した往路・復路の全候補について所要時間と公開報告を確認して比較し、地図にも反映して。期間・集計範囲・出典と、判断できないことも教えて。` },
    { id: `property-${city}`, city, kind: 'property', message: `${from}を物件の検討住所と仮定して、周辺の治安について軽く教えて。これは公開施設を使った検証用住所で、空き物件探しや経路検索は不要です。住所を地図で確認し、周辺の公開報告を調べ、対象期間・種別・集計範囲・出典と、この情報から判断できないことを添えて。` },
  ];
});
const selected = process.argv.find(a => a.startsWith('--case='))?.slice(7);
assert.ok(!selected || scenarios.some(s => s.id === selected), 'Unknown --case');
const config = new Config({ env: await webEnvironment() });
const sessions = new Sessions();
// No disk cache: each run retrieves both public sources, then shares their in-memory snapshot.
const service = new MapService({ config, sessions, google: new Google(config), reports: new Reports() });
const agent = new ChatAgent({ service, sessions, env: config.env });
let calls = [];
const request = agent.request.bind(agent);
agent.request = async (...args) => {
  const response = await request(...args);
  calls.push(...response.output.filter(o => o.type === 'function_call').map(o => ({ name: o.name, arguments: JSON.parse(o.arguments) })));
  return response;
};
function verifyEvidence(evidence, city) {
  assert.equal(evidence.status, 'available');
  assert.ok(evidence.sourceURL && evidence.period?.start && evidence.period?.end && evidence.fetchedAt);
  assert.ok(Number.isInteger(evidence.count));
  assert.equal(evidence.city, city);
}
function verifyReply(reply, evidence) {
  assert.ok(reply.length > 30, 'A substantive final answer is required');
  assert.ok(reply.includes(evidence.sourceName) || reply.includes(new URL(evidence.sourceURL).hostname), 'Reply must identify the actual report source');
  assert.match(reply, /安全|確率|危険|判断|保証/, 'Reply must explain the limits of safety inference');
  assert.match(reply, /\d{4}|年|月|日/, 'Reply must identify the report period');
  if (evidence.count !== null) {
    assert.ok(reply.normalize('NFKC').replace(/[,\s]/g, '').includes(`${evidence.count}件`), 'Reply must use the actual report count');
  }
}
try {
  const status = await config.status();
  assert.ok(status.aiConfigured && status.serverConfigured, 'Existing OpenAI and Google server keys are required');
  for (const scenario of scenarios.filter(s => !selected || s.id === selected)) {
    const id = (await service.open({ city: scenario.city })).workspace.id;
    calls = [];
    let w;
    try {
      w = (await agent.send({ workspaceId: id, message: scenario.message })).workspace;
      const reply = w.chatMessages.at(-1).text;
      const items = w.assessment?.items || [];
      let evidence;
      if (scenario.kind === 'cafe') {
        assert.ok(items.length >= 2, 'At least two cafes must be assessed for comparison');
        assert.ok(items.every(i => i.kind === 'place'));
        const available = items.filter(i => i.evidence.status === 'available');
        assert.ok(available.length >= 2, 'At least two cafes must have current report evidence');
        for (const i of available) verifyEvidence(i.evidence, scenario.city);
        for (const i of items.filter(i => i.evidence.status !== 'available')) {
          assert.equal(i.evidence.count, null, 'Missing neighborhood matches must remain unknown');
          assert.ok(w.assessment.proposal.excludedIds.includes(i.targetId));
          assert.ok(reply.includes(i.name), 'Missing evidence must be disclosed for the affected cafe');
          assert.match(reply, /不足|不明|確認でき|未対応|取得でき/);
        }
        assert.equal(w.originId, null); assert.equal(w.routes.length, 0);
        const chosen = items.find(i => i.targetId === w.assessment.proposal.recommendedPlaceId);
        assert.ok(chosen, 'A supported proposal is required');
        assert.equal(w.selectedPlaceId, chosen.targetId);
        assert.ok(reply.includes(chosen.name), 'Reply must name the proposed cafe');
        if (scenario.city === 'shibuya') assert.equal(w.assessment.proposal.comparable, false);
        evidence = chosen.evidence;
      } else if (scenario.kind === 'property') {
        const property = w.places.find(p => p.role === 'property');
        assert.ok(property?.address && property.source === 'google-geocoding', 'Property address must be geocoded');
        const item = items.find(i => i.targetId === property.id);
        assert.ok(item, 'The property itself must be assessed');
        verifyEvidence(item.evidence, scenario.city);
        assert.equal(w.routes.length, 0);
        evidence = item.evidence;
      } else {
        assert.equal(w.routePairs.length, 1);
        const pair = w.routePairs[0];
        for (const leg of ['out', 'back']) {
          const routes = w.routes.filter(r => r.leg === leg);
          assert.ok(routes.length, `Actual ${leg} routes are required`);
          for (const route of routes) {
            assert.equal(route.source, 'google-routes'); assert.ok(route.durationSeconds > 0);
            assert.equal(route.fromId, leg === 'out' ? pair.fromId : pair.toId);
            assert.equal(route.toId, leg === 'out' ? pair.toId : pair.fromId);
            const item = items.find(i => i.targetId === route.id);
            assert.ok(item, 'Every fetched route must have shared evidence');
            if (scenario.city === 'sf') verifyEvidence(item.evidence, scenario.city);
            else { assert.equal(item.evidence.count, null); assert.equal(item.evidence.canCompareCounts, false); }
          }
        }
        assert.equal(w.conditions.maxDetourMinutes, 5);
        evidence = items.find(i => i.kind === 'route').evidence;
        assert.match(reply, /分|秒/, 'Route answer must use the actual travel times');
        if (scenario.city === 'shibuya') assert.match(reply, /沿道|町丁|比較でき|比較不可/, 'Neighborhood data cannot rank routes');
      }
      verifyReply(reply, evidence);
      console.log(JSON.stringify({ scenario: scenario.id, status: 'passed', checkedAt: new Date().toISOString(), upstreamMode: 'live-google-public-reports-openai', model: agent.status().model,
        input: scenario.message, calls, places: w.places.map(({name,address,role,source}) => ({name,address,role,source})),
        routes: w.routes.map(({leg,durationSeconds,distanceMeters,source}) => ({leg,durationSeconds,distanceMeters,source})),
        items, proposal: w.assessment.proposal, reply }));
    } catch (error) {
      console.error(JSON.stringify({ scenario: scenario.id, status: 'failed', calls, error: publicError(error), assertion: error.code === 'ERR_ASSERTION' ? error.message : undefined, reply: w?.chatMessages.at(-1)?.text, assessment: w?.assessment }));
      process.exitCode = 1;
    } finally { await service.clear({ workspaceId: id }); }
  }
} finally { sessions.close(); }
