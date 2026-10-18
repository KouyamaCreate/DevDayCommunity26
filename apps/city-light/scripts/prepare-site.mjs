import fs from 'node:fs';import assert from 'node:assert/strict';import {validCache} from '../server/evaluation.mjs';
const dataset=JSON.parse(fs.readFileSync('data/buildings.json','utf8'));
const evaluations=validCache(JSON.parse(fs.readFileSync('data/evaluations.json','utf8')),dataset.buildings);
const areaContext=JSON.parse(fs.readFileSync('public/data/area-context.json','utf8'));
assert.equal(Object.keys(evaluations).length,dataset.metadata.evaluableCount,'Complete the evaluations before publishing');
const target='public/snapshot';fs.mkdirSync(target+'/buildings',{recursive:true});
for(const b of dataset.buildings){assert(/^gsi-\d+-\d+-\d+-\d+$/.test(b.id));fs.writeFileSync(target+'/buildings/'+b.id+'.json',JSON.stringify(b))}
fs.writeFileSync(target+'/evaluations.json',JSON.stringify(evaluations));
fs.writeFileSync(target+'/status.json',JSON.stringify({snapshot:true,decisionsConfigured:false,model:'gpt-6-luna',metadata:dataset.metadata,evaluated:Object.keys(evaluations).length,job:null}));
fs.writeFileSync(target+'/search.json',JSON.stringify(dataset.buildings.map(b=>({id:b.id,text:[b.name,b.address,...b.pois.map(p=>p.name)].join('\n').normalize('NFKC').toLowerCase()}))));
fs.writeFileSync(target+'/export.json',JSON.stringify({...dataset,evaluations,areaContext}));
console.log(`Shared Site snapshot prepared: ${dataset.buildings.length} buildings, ${Object.keys(evaluations).length} actual evaluations.`);
