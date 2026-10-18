import test, {after} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {App} from './ui/App.jsx';export const render=data=>renderToStaticMarkup(<App initialData={data}/>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx'},bundle:true,platform:'node',format:'esm',write:false,jsx:'automatic',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},plugins:[{name:'server-ui-boundaries',setup(b){
  b.onResolve({filter:/^\.\/bridge$/},()=>({path:'bridge',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const isEmbedded=false;export const action=async()=>{};export const connect=async()=>{};export const disconnect=()=>{};export const subscribe=()=>()=>{};export const openExternal=()=>{};export const saveSettings=async()=>{};export const queueViewport=()=>{};export const focusMap=async()=>{};export const flushMap=async()=>{};export const sendMessage=async()=>{};`,loader:'js'}));
  b.onResolve({filter:/^\.\/Map$/},()=>({path:'map',namespace:'map-stub'}));
  b.onLoad({filter:/.*/,namespace:'map-stub'},()=>({contents:`import React from 'react';export const MapCanvas=()=>React.createElement('div',{'aria-label':'map-stub'});`,resolveDir:new URL('..',import.meta.url).pathname,loader:'js'}));
}}]});
globalThis.location={search:''};
const temp=await mkdtemp(join(tmpdir(),'sokomade-render-'));after(()=>rm(temp,{recursive:true,force:true}));
const file=join(temp,'render.mjs');await writeFile(file,result.outputFiles[0].text);
const {render}=await import(pathToFileURL(file).href);
const workspace=()=>({id:'test',city:'sf',places:[],originId:null,selectedPlaceId:null,routePairs:[],searchResultIds:[],routes:[],selectedRoutes:{},leg:'out',conditions:{maxDetourMinutes:5,maxRoundTripMinutes:null,categories:['assault']},walkEvaluations:[],focus:{type:'viewport'},mapView:{center:{lat:37.78,lng:-122.42}},reportLayer:{status:'unsupported',regions:[],incidents:[]},report:null,chatMessages:[],notices:[]});
const data=w=>({workspace:w,cities:[{id:'sf',center:{lat:37.78,lng:-122.42},bounds:{south:37.7,north:37.9,west:-122.5,east:-122.3}}],configuration:{},ai:{configured:true}});
test('browse markup has floating consultation, visible data limits and a universal composer without a trip prerequisite',()=>{
 const html=render(data(workspace()));assert.ok(html.includes('conversation-panel'));assert.ok(html.includes('地図への相談'));assert.ok(html.includes('この地域の報告データは未対応'));assert.ok(html.includes('実データ'));assert.ok(!html.includes('comparison-panel'));assert.ok(!html.includes('出発地を追加'));
});
test('return markup selects real direction, reports detours and leaves the full reply available',()=>{
 const w=workspace();w.places=[{id:'hotel',name:'Test hotel',role:'origin'},{id:'food',name:'Test restaurant',role:'candidate'}];w.originId='hotel';w.selectedPlaceId='food';w.leg='back';w.routes=[{id:'back',destinationId:'food',fromId:'food',toId:'hotel',leg:'back',extraSeconds:0,minutes:14,distanceMeters:1000},{id:'other',destinationId:'food',fromId:'food',toId:'hotel',leg:'back',extraSeconds:240,extraMinutes:4,minutes:18,distanceMeters:1200}];w.selectedRoutes={'food:back':'back'};w.chatMessages=[{id:'user',role:'user',text:'ホテルへ帰りたい'},{id:'reply',role:'assistant',text:'2本を比較できます。\n\nDetailed original response'}];
 const html=render(data(w));assert.ok(html.includes('徒歩14分'));assert.ok(html.includes('徒歩18分'));assert.ok(html.includes('＋4分'));assert.ok(html.includes('Test restaurant → Test hotel'));assert.ok(html.includes('回答の全文を見る'));assert.ok(html.includes('この道で行く'));
});
test('property markup shows A/B with commute times and a comparison action rather than a route decision',()=>{
 const w=workspace();w.places=[{id:'a',name:'Property A',role:'property'},{id:'b',name:'Property B',role:'property'},{id:'work',name:'Work',role:'candidate'}];w.selectedPlaceId='a';w.routePairs=[{comparisonId:'a',fromId:'a',toId:'work'},{comparisonId:'b',fromId:'b',toId:'work'}];w.routes=[{id:'a-out',destinationId:'a',fromId:'a',toId:'work',leg:'out',extraSeconds:0,minutes:12,distanceMeters:800},{id:'b-out',destinationId:'b',fromId:'b',toId:'work',leg:'out',extraSeconds:0,minutes:18,distanceMeters:1100}];w.selectedRoutes={'a:out':'a-out','b:out':'b-out'};
 const html=render(data(w));assert.ok(html.includes('A Property A'));assert.ok(html.includes('B Property B'));assert.ok(html.includes('徒歩12分'));assert.ok(html.includes('徒歩18分'));assert.ok(html.includes('両方の徒歩経路を表示'));assert.ok(html.includes('この周辺を詳しく見る'));assert.ok(!html.includes('この道で行く'));
 w.leg='back';w.routes.push({id:'a-back',destinationId:'a',fromId:'work',toId:'a',leg:'back',extraSeconds:0,minutes:13,distanceMeters:800});w.selectedRoutes['a:back']='a-back';assert.ok(render(data(w)).includes('Workから徒歩13分'));
});
