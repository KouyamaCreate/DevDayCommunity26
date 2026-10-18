const base=process.env.APP_URL||'http://127.0.0.1:4317';
const r=await fetch(base+'/api/evaluate-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});const result=await r.json();if(!r.ok){console.error(result.error);process.exit(1)}console.log('Evaluation started:',result.total,'results.');
while(true){await new Promise(r=>setTimeout(r,5000));const s=await fetch(base+'/api/status').then(r=>r.json());console.log(JSON.stringify(s.job));if(!s.job?.running){process.exitCode=s.job?.failed?1:0;break}}
