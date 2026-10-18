import { useEffect, useState } from 'react';
import { PaperPlaneRight, Minus, Plus, Sparkle, UserCircle, ClockCounterClockwise, MapPin } from '@phosphor-icons/react';
import { sendMessage, isEmbedded } from './bridge';

export function Consultation({ workspace, ai, onError, children, scopeLabel }) {
  const [text,setText]=useState('');
  const [sending,setSending]=useState(false);
  const [collapsed,setCollapsed]=useState(false);
  const [history,setHistory]=useState(false);
  const messages=workspace.chatMessages || [];
  const user=messages.findLast(m=>m.role==='user');
  const assistant=messages.findLast(m=>m.role==='assistant');
  const busy=sending || workspace.chatBusy;
  const summary=assistant?.text.split('\n\n')[0];
  useEffect(()=>{setText('');setCollapsed(false);setHistory(false);},[workspace.id]);
  const submit=async value=>{
    if(!value.trim() || busy || isEmbedded)return;
    setText('');setSending(true);setCollapsed(false);
    try{await sendMessage({workspaceId:workspace.id,message:value.trim()});}
    catch(error){setText(value);onError(error.message);}
    finally{setSending(false);}
  };
  return <section className={`conversation-panel ${collapsed?'collapsed':''}`} aria-label="地図と相談">
    <div className="conversation-heading"><h1>地図と相談</h1><div>{messages.length>0 && !collapsed && <button className="icon-button" aria-label={history?'最新の結果に戻る':'相談履歴を表示'} aria-pressed={history} onClick={()=>setHistory(!history)}><ClockCounterClockwise size={20}/></button>}<button className="collapse-button" aria-label={collapsed?'相談窓を開く':'相談窓を小さくする'} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<Plus size={18}/>:<Minus size={18}/>}</button></div></div>
    {!collapsed && <><div className="conversation-content">
      {history?<div role="log" aria-label="相談履歴">{messages.map(m=><div key={m.id} className={`history-message ${m.role}`}><small>{m.role==='user'?'あなた':'地図アシスタント'}</small><p>{m.text}</p></div>)}</div>:<>
        {user && <div className="message-row user-message"><UserCircle size={32} weight="fill"/><p>{user.text}</p></div>}
        <div className="message-row assistant-message"><Sparkle size={27} weight="fill"/><p aria-live="polite">{busy?workspace.chatStatus || '相談内容を確認しています…':summary || '気になる場所を選んで、そのまま聞けます。'}</p></div>
        {assistant && summary !== assistant.text && <button className="text-button answer-details" onClick={()=>setHistory(true)}>回答の全文を見る</button>}
        {!user && !isEmbedded && <div className="suggestions"><button disabled={busy} onClick={()=>submit('いま見ている範囲の駅の周辺を見たい')}>駅の周辺を見たい</button><button disabled={busy} onClick={()=>submit('この辺で夕食のお店を探して。経路はまだ不要')}>この辺で夕食</button></div>}
        {children}
      </>}
    </div><div className="composer-area">{isEmbedded?<p className="scope-note">条件の変更はCodexの会話へ。</p>:<form className="composer" onSubmit={e=>{e.preventDefault();submit(text);}}><textarea rows={user?1:2} aria-label="地図への相談" placeholder={user?'条件を追加して聞く…':'この辺について聞く…'} value={text} onChange={e=>setText(e.target.value)} maxLength={3000} disabled={busy} onKeyDown={e=>{if(e.key==='Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode!==229){e.preventDefault();submit(text);}}}/><button aria-label="相談を送信" disabled={busy || !text.trim()}><PaperPlaneRight size={22}/></button></form>}<p className="scope-note"><MapPin size={14} weight="fill"/>{scopeLabel || 'いま見ている範囲で相談できます'}{ai?.configured===false && <span>・AI未設定</span>}</p></div></>}
  </section>;
}
