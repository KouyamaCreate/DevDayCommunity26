import { useEffect, useRef, useState } from 'react';
import { ArrowUp, CaretDown, ChatCircleDots } from '@phosphor-icons/react';
import { sendMessage } from './bridge';

export function Consultation({ workspace, ai, onError }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const end = useRef(null);
  const messages = workspace.chatMessages || [];
  const last = messages.at(-1);
  const busy = sending || workspace.chatBusy;
  useEffect(() => { setText(''); setExpanded(false); }, [workspace.id]);
  useEffect(() => { if (expanded) end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, workspace.chatStatus, expanded]);
  const submit = async value => {
    if (!value.trim() || busy) return;
    setText(''); setSending(true);
    try { await sendMessage({ workspaceId: workspace.id, message: value.trim() }); }
    catch (error) { setText(value); onError(error.message); }
    finally { setSending(false); }
  };
  const samples = workspace.originId ? ['もう少し近い店がいい', '遠回りは5分まで', '帰り道も比べて'] : workspace.city === 'sf' ? ['Union Squareから近くのバーガー店を、徒歩の往復で比べたい'] : ['渋谷駅から近くのバーガー店を、徒歩の往復で比べたい'];
  return <section className="consultation" aria-label="地図に相談する">
    {expanded && <div className="conversation-history" role="log" aria-label="相談の履歴">{messages.map(message => <div className={`conversation-message ${message.role} ${message.error ? 'failed' : ''}`} key={message.id}><span>{message.role === 'user' ? 'あなた' : '地図アシスタント'}</span><p>{message.text}</p></div>)}<div ref={end}/></div>}
    <div className="consultation-inner">
      {last?.role === 'assistant' && !expanded && !busy && <div className="latest-answer" aria-live="polite"><p>{last.text}</p></div>}
      {busy ? <p className="consultation-status" role="status"><span className="activity-dot"/>{workspace.chatStatus || '相談内容を送信しています…'}</p> : !messages.length && <div className="suggestion-list">{samples.map(sample => <button type="button" key={sample} onClick={() => submit(sample)}>{sample}</button>)}</div>}
      <div className="consultation-row"><button className={`conversation-toggle ${expanded ? 'active' : ''}`} disabled={!messages.length} aria-label={expanded ? '相談履歴を閉じる' : '相談履歴を開く'} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <CaretDown size={20}/> : <ChatCircleDots size={22}/>}</button><form onSubmit={event => { event.preventDefault(); submit(text); }}><input aria-label="地図への相談" placeholder="店や物件、行き帰りの道について相談する" value={text} onChange={event => setText(event.target.value)} maxLength={3000} disabled={busy}/><button className="send-consultation" aria-label="相談を送信" disabled={busy || !text.trim()}><ArrowUp size={20} weight="bold"/></button></form><span className="consultation-privacy">{ai?.configured === false ? 'AIの設定が必要です' : 'この相談中だけ保持'}</span></div>
    </div>
  </section>;
}
