import test from 'node:test';
import assert from 'node:assert/strict';
import { Sessions } from '../src/state.mjs';
import { ChatAgent, CHAT_TOOLS } from '../src/chat.mjs';
import { MapService } from '../src/service.mjs';
const final = text => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const call = (name, args, id='call_1') => ({ status:'completed', output:[{type:'function_call',name,arguments:JSON.stringify(args),call_id:id}] });
async function setup(t, fetchImpl) {
 const sessions = new Sessions(); t.after(()=>sessions.close());
 const config = {status:async()=>({serverConfigured:true}),env:{OPENAI_API_KEY:'test-secret'}};
 const service = new MapService({sessions,config,google:{},reports:{}});
 const id = (await service.open({city:'sf'})).workspace.id;
 const agent = new ChatAgent({service,sessions,env:config.env,fetchImpl});
 return {agent,sessions,service,id};
}
test('AI requests disable storage; current map and dialogue remain in memory, private internals stay out of views',async t=>{
 const requests=[];const {agent,sessions,id}=await setup(t,async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>final('出発地を教えてください。')};});
 const result=await agent.send({workspaceId:id,message:'バーガーを食べたい'});
 assert.equal(requests[0].store,false);assert.equal(requests[0].parallel_tool_calls,false);assert.deepEqual(requests[0].include,['reasoning.encrypted_content']);
 assert.equal(requests[0].input.at(-1).content,'バーガーを食べたい');
 assert.equal(result.workspace.chatMessages.length,2);assert.equal('aiHistory' in result.workspace,false);assert.equal('chatController' in result.workspace,false);
 assert.equal(JSON.stringify(result).includes('test-secret'),false);
 assert.equal(sessions.get(id).chatBusy,false);
 await agent.send({workspaceId:id,message:'Union Squareです'});assert.ok(requests[1].input.some(i=>i.role==='assistant' && i.content==='出発地を教えてください。'));
});
test('tool output is returned to the model and route direction updates the shared map',async t=>{
 let step=0;const requests=[];
 const {agent,sessions,id}=await setup(t,async(url,options)=>{requests.push(JSON.parse(options.body));return{ok:true,json:async()=>++step===1?call('select',{leg:'back'}):final('帰り道に切り替えました。')};});
 await agent.send({workspaceId:id,message:'帰り道を見せて'});
 assert.equal(sessions.get(id).leg,'back');const toolOutput=requests[1].input.find(i=>i.type==='function_call_output');assert.equal(JSON.parse(toolOutput.output).workspace.leg,'back');
});
test('tools cannot cross workspace boundaries or accept invented coordinates',async t=>{
 let step=0;let second;
 const {agent,sessions,id}=await setup(t,async(url,options)=>{second=JSON.parse(options.body);return{ok:true,json:async()=>++step===1?call('select',{workspaceId:'another',leg:'back'}):final('現在の相談を確認してください。')};});
 await agent.send({workspaceId:id,message:'切り替えて'});
 assert.equal(sessions.get(id).leg,'out');assert.equal(JSON.parse(second.input.find(i=>i.type==='function_call_output').output).error.code,'INVALID_INPUT');
 for(const tool of CHAT_TOOLS){assert.ok(!tool.parameters.properties.workspaceId);assert.ok(!tool.parameters.properties.lat);assert.deepEqual(tool.parameters.required,Object.keys(tool.parameters.properties));}
});
test('concurrent requests are rejected; clearing a consultation aborts in-flight work and prevents recreation',async t=>{
 let enter;const started=new Promise(resolve=>enter=resolve);
 const {agent,sessions,id}=await setup(t,(url,options)=>new Promise((resolve,reject)=>{enter(); options.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true});}));
 const pending=agent.send({workspaceId:id,message:'検索して'});await started;
 await assert.rejects(agent.send({workspaceId:id,message:'もう一件'}),{code:'CHAT_BUSY'});
 sessions.delete(id);await assert.rejects(pending,{code:'CHAT_CANCELLED'});assert.equal(sessions.items.has(id),false);
});
test('API authentication errors are sanitized and leave the workspace usable',async t=>{
 const {agent,sessions,id}=await setup(t,async()=>({ok:false,status:401,json:async()=>({error:{message:'test-secret'}})}));
 await assert.rejects(agent.send({workspaceId:id,message:'店を探して'}),{code:'AI_AUTH_FAILED'});
 const state=sessions.snapshot(id);assert.equal(state.chatBusy,false);assert.equal(JSON.stringify(state).includes('test-secret'),false);
});

test('exhausted credits are distinguished from retryable rate limits',async t=>{
 const quota=await setup(t,async()=>({ok:false,status:429,json:async()=>({error:{code:'credit_balance_exhausted',type:'insufficient_quota'}})}));
 await assert.rejects(quota.agent.send({workspaceId:quota.id,message:'検索して'}),{code:'AI_QUOTA_EXHAUSTED'});
 const rate=await setup(t,async()=>({ok:false,status:429,json:async()=>({error:{code:'rate_limit_exceeded'}})}));
 await assert.rejects(rate.agent.send({workspaceId:rate.id,message:'検索して'}),{code:'AI_RATE_LIMITED'});
});
