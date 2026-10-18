import express from 'express';import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {evaluateBatch,loadCache,saveCache,validCache} from './evaluation.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
let apiKey=process.env.OPENAI_API_KEY||'';
if(process.argv.includes('--credential-stdin')){
 if(process.stdin.isTTY)spawnSync('stty',['-echo'],{stdio:'inherit'});console.log('Ready for API credential on hidden stdin.');
 const rl=readline.createInterface({input:process.stdin,terminal:false});apiKey=await new Promise(resolve=>rl.once('line',resolve));rl.close();if(process.stdin.isTTY)spawnSync('stty',['echo'],{stdio:'inherit'});
}
const dataset=JSON.parse(fs.readFileSync('data/buildings.json'));let cache=validCache(loadCache(),dataset.buildings);let job=null;
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(req.method==='POST'){const origin=req.get('origin');if(origin&&origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'このサイトから操作してください'});if(!req.is('application/json'))return res.status(415).json({error:'JSONが必要です'})}next()});
app.get('/api/status',(_req,res)=>res.json({decisionsConfigured:!!apiKey,model:'gpt-6-luna',metadata:dataset.metadata,evaluated:Object.keys(cache).length,job}));
app.get('/api/search',(req,res)=>{const q=String(req.query.q||'').normalize('NFKC').toLowerCase().slice(0,100);res.json(q?dataset.buildings.filter(b=>[b.name,b.address,...b.pois.map(p=>p.name)].some(v=>v.normalize('NFKC').toLowerCase().includes(q))).map(b=>b.id):[])});
app.get('/api/evaluations',(_req,res)=>res.json(cache));
app.get('/api/buildings/:id',(req,res)=>{const b=dataset.buildings.find(b=>b.id===req.params.id);return b?res.json(b):res.status(404).json({error:'建物がありません'})});
app.get('/api/export',(_req,res)=>res.attachment('shibuya-safety-map.json').json({...dataset,evaluations:cache,areaContext:JSON.parse(fs.readFileSync('public/data/area-context.json','utf8'))}));
app.post('/api/evaluate',async(req,res)=>{
 if(!apiKey)return res.status(503).json({error:'OPENAI_API_KEYを設定してサーバーを起動してください。キーはブラウザには送信されません。'});
 if(job?.running)return res.status(409).json({error:'一括評価の完了をお待ちください'});
 const {id}=req.body;
 const b=dataset.buildings.find(b=>b.id===id);if(!b?.pois.length)return res.status(400).json({error:'施設情報のある建物を選んでください'});
 const k=id;if(cache[k])return res.json(cache[k]);
 try{const [v]=await evaluateBatch([b],apiKey);if(v.error)throw Error(v.error);cache[k]=v;saveCache(cache);res.json(v)}catch(e){res.status(502).json({error:e.message})}
});
app.post('/api/evaluate-all',(req,res)=>{
 if(!apiKey)return res.status(503).json({error:'Decisions APIキーが未設定です'});
 if(job?.running)return res.status(409).json({error:'すでに評価中です'});
 const tasks=[];let batch=[],n=0;for(const b of dataset.buildings.filter(b=>b.pois.length).sort((a,b)=>b.pois.length-a.pois.length)){if(cache[b.id])continue;if(batch.length>=25||n+b.pois.length>400){if(batch.length)tasks.push({batch});batch=[];n=0}batch.push(b);n+=b.pois.length}if(batch.length)tasks.push({batch});
 job={running:true,total:tasks.reduce((n,t)=>n+t.batch.length,0),completed:0,failed:0,errors:[],startedAt:new Date().toISOString()};res.status(202).json(job);
 const run=async()=>{while(tasks.length){const {batch}=tasks.shift();try{const values=await evaluateBatch(batch,apiKey);for(const v of values){if(v.error){job.failed++;job.errors.push({buildingId:v.buildingId,error:v.error})}else{cache[v.buildingId]=v;job.completed++}}saveCache(cache)}catch(e){job.failed+=batch.length;job.errors.push({error:e.message});if(/HTTP (401|403|429)/.test(e.message)){tasks.length=0;job.stopped=e.message}}if(job.completed%250===0||!tasks.length)console.log(JSON.stringify({evaluationProgress:job.completed,failed:job.failed,total:job.total}));await new Promise(r=>setTimeout(r,750))}};
 Promise.all([run()]).finally(()=>{job.running=false;job.finishedAt=new Date().toISOString();saveCache(cache);console.log('Evaluation finished')});
});
if(process.env.NODE_ENV==='production')app.use(express.static(path.join(root,'dist')));else{const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares)}
app.use((err,req,res,next)=>{res.status(400).json({error:'リクエストを処理できませんでした'})});
const port=Number(process.env.PORT)||4317;app.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
