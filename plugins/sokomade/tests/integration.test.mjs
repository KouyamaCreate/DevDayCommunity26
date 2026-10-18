import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRuntime } from '../src/runtime.mjs';
import { Config } from '../src/config.mjs';
import { transform } from 'esbuild';
import { UI_URI } from '../src/mcp.mjs';

test('HTTP rejects external origins, unknown methods, oversized input and missing auth',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sokomade-http-'));const config=new Config({directory,env:{}});
 const runtime=await createRuntime({config,reports:{layer:async bounds=>({bounds,status:'unsupported',regions:[],incidents:[],limitations:[]})}});t.after(async()=>{await runtime.close();await rm(directory,{recursive:true,force:true});});
 const base=runtime.http.baseURL;
 const html=await(await fetch(base)).text(); const token=html.match(/"token":"([a-f0-9]+)"/)[1];
 const headers={'Authorization':`Bearer ${token}`,'Content-Type':'application/json'};
 assert.equal((await fetch(`${base}/api/config`)).status,401);
 assert.equal((await fetch(`${base}/api/config`,{headers:{...headers,Origin:'https://evil.example'}})).status,403);
 const post=body=>fetch(`${base}/api/action`,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await post({action:'constructor',args:{}})).status,400);
 assert.equal((await post({action:'open',args:{city:'x'.repeat(17000)}})).status,400);
 assert.equal((await post({action:'resolve',args:{workspaceId:'bad',query:'x'}})).status,400);
 const opened=await(await post({action:'open',args:{city:'sf'}})).json(); const workspaceId=opened.workspace.id;
 const bounds={south:37.77,north:37.80,west:-122.45,east:-122.40};
 const viewport=await(await post({action:'viewport',args:{workspaceId,center:{lat:37.78,lng:-122.42},bounds,zoom:15}})).json();assert.equal(viewport.workspace.focus.type,'viewport');
 assert.equal((await post({action:'focus',args:{workspaceId,point:{lat:91,lng:0}}})).status,400);
 assert.equal((await post({action:'viewport',args:{workspaceId,center:{lat:37.78,lng:-122.42},bounds:{...bounds,west:1,east:-1},zoom:15}})).status,400);
 const conditions=await(await post({action:'conditions',args:{workspaceId,maxRoundTripMinutes:30,maxDetourMinutes:0}})).json();assert.equal(conditions.workspace.conditions.maxRoundTripMinutes,30);
 const added=await(await post({action:'resolve',args:{workspaceId,lat:37.78,lng:-122.42,label:'Private test address'}})).json();assert.equal(added.workspace.places.length,1);
 assert.deepEqual(await readdir(directory),[]); // Personal workspace data never reached disk.
 await post({action:'clear',args:{workspaceId}});assert.equal((await fetch(`${base}/api/state?workspace=${workspaceId}`,{headers})).status,410);
 const save=await fetch(`${base}/api/config`,{method:'POST',headers,body:JSON.stringify({serverKey:'a'.repeat(30),browserKey:'b'.repeat(30)})});assert.equal(save.status,200);
 assert.equal((await stat(config.file)).mode & 0o777,0o600);
 assert.equal(JSON.stringify(await save.json()).includes('a'.repeat(30)),false);
});

test('installed-style bundled server works over STDIO with UI resource, and process restart loses sessions',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sokomade-mcp-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=resolve(import.meta.dirname,'../dist/server.mjs');
 const start=async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[file],cwd:tmpdir(),env:{PATH:process.env.PATH,SOKOMADE_CONFIG_DIR:directory,NODE_OPTIONS:`--import=${new URL('./fixtures/offline-fetch.mjs',import.meta.url).href}`},stderr:'pipe'});
  const client=new Client({name:'sokomade-test',version:'1.0.0'});await client.connect(transport);return client;
 };
 const client=await start();t.after(()=>client.close());
 const tools=await client.listTools();assert.equal(tools.tools.length,9);assert.ok(tools.tools.find(t=>t.name==='open_map')._meta.ui.resourceUri);
 const resource=await client.readResource({uri:UI_URI}); assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.ok(resource.contents[0].text.includes('mode:"mcp"'));assert.ok(!resource.contents[0].text.includes('/*__BOOTSTRAP__*/'));
 const opened=await client.callTool({name:'open_map',arguments:{city:'sf'}});const id=opened.structuredContent.workspace.id;
 const result=await client.callTool({name:'resolve_location',arguments:{workspaceId:id,lat:37.78,lng:-122.42,role:'origin'}});assert.equal(result.structuredContent.workspace.places.length,1);
 assert.ok(result._meta.viewURL.startsWith('http://127.0.0.1:'));
 await client.close();const restarted=await start();t.after(()=>restarted.close());
 const expired=await restarted.callTool({name:'get_map',arguments:{workspaceId:id}});assert.equal(expired.isError,true);assert.equal(expired.structuredContent.error.code,'SESSION_EXPIRED');
});

test('self-contained UI scripts remain syntactically valid after HTML inlining',async()=>{
 const html=await readFile(new URL('../dist/ui.html',import.meta.url),'utf8');
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,2);
 for(const script of scripts) await transform(script[1],{loader:'js'});
});
