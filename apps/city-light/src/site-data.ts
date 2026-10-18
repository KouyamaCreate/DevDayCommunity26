/** The shared Site uses immutable, already-evaluated public data. No API key is shipped. */
export const sharedSite=import.meta.env.VITE_SHARED_SITE==='1';
export const exportURL=sharedSite?'/snapshot/export.json':'/api/export';
let indexPromise:Promise<Array<{id:string;text:string}>>|undefined;
export async function apiFetch(input:string,init?:RequestInit):Promise<Response>{
 if(!sharedSite)return fetch(input,init);
 if(init?.method&&init.method!=='GET')return Response.json({error:'共有版には取得済みの評価を表示しています。'},{status:405});
 if(input==='/api/status')return fetch('/snapshot/status.json');
 if(input==='/api/evaluations')return fetch('/snapshot/evaluations.json');
 if(input.startsWith('/api/buildings/'))return fetch('/snapshot/buildings/'+input.slice('/api/buildings/'.length)+'.json');
 if(input.startsWith('/api/search?')){
  const q=(new URL(input,location.origin).searchParams.get('q')||'').normalize('NFKC').toLowerCase();
  indexPromise??=fetch('/snapshot/search.json').then(r=>{if(!r.ok)throw Error('検索データを取得できません');return r.json()});
  try{return Response.json((await indexPromise).filter(b=>b.text.includes(q)).map(b=>b.id))}catch{return Response.json({error:'検索を再試行してください'},{status:503})}
 }
 return Response.json({error:'Not found'},{status:404});
}
