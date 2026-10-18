import { useEffect, useRef, useState } from 'react';
import { GearSix, Plus, X, ArrowRight, ArrowUpRight, MapPin, Trash, ArrowClockwise, Check, MagnifyingGlass } from '@phosphor-icons/react';
import { Consultation } from './Consultation';
import { MapCanvas } from './Map';
import { action, connect, disconnect, subscribe, isEmbedded, openExternal, saveSettings, queueViewport, focusMap, flushMap } from './bridge';

const PRICE = { PRICE_LEVEL_FREE: '無料', PRICE_LEVEL_INEXPENSIVE: '低価格帯', PRICE_LEVEL_MODERATE: '中価格帯', PRICE_LEVEL_EXPENSIVE: '高価格帯', PRICE_LEVEL_VERY_EXPENSIVE: '最高価格帯' };
const money = value => PRICE[value] || '価格情報なし';
const minutes = seconds => Math.ceil(seconds / 60);
const initialSettings = !isEmbedded && new URLSearchParams(location.search).has('settings');

function Dialog({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current; dialog.showModal();
    const cancel = e => { e.preventDefault(); onClose(); };
    dialog.addEventListener('cancel', cancel);
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close(); };
  }, []);
  return <dialog ref={ref} className="dialog" onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="dialog-title"><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button aria-label="閉じる" className="icon-button" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}

function ReportDetails({ report }) {
  if (!report || report.status === 'unavailable') return <><p>{report?.error?.message || '報告情報をまだ取得していません。'}</p><p>取得できない情報を0件として表示しません。</p></>;
  return <><dl className="details"><div><dt>対象期間</dt><dd>{report.period.label}</dd></div><div><dt>対象種別</dt><dd>{report.categoryLabels.join('・')}</dd></div><div><dt>位置の精度</dt><dd>{report.precision === 'neighborhood' ? '町丁目単位' : '匿名化された交差点の公開位置'}</dd></div><div><dt>集計範囲</dt><dd>{report.basis === 'viewport' ? '表示範囲の参考情報。地図全域の網羅性は未確認です。' : report.comparable ? `経路両側${report.corridorMeters}m内の公開位置。重なる区間・複数分類は同じ報告を重複集計しません。` : '町丁目全体の認知件数。経路沿道の件数ではありません。'}</dd></div><div><dt>出典</dt><dd><button className="text-button" onClick={() => openExternal(report.sourceURL)}>{report.sourceName}<ArrowUpRight size={14}/></button></dd></div><div><dt>取得日時</dt><dd>{new Date(report.fetchedAt).toLocaleString('ja-JP')}</dd></div>{report.updatedAt && <div><dt>公開データ記載の更新</dt><dd>{report.updatedAt}</dd></div>}</dl>{report.stale && <p className="warning">最新データを取得できず、前回取得した公開データを表示しています。</p>}{report.limitations.map(text => <p className="small-note" key={text}>{text}</p>)}{report.city === 'sf' && <p className="small-note">位置の欠損・対象外位置による除外行：データ全体で{report.missingPositionRows}行。地図上の同じ公開位置はまとめて表示します。</p>}</>;
}

function Settings({ configuration, onClose, onSaved, setupURL }) {
  const [serverKey, setServerKey] = useState('');
  const [browserKey, setBrowserKey] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title="接続設定" onClose={onClose}><p>地図・店舗・徒歩経路にGoogle Maps Platform、会話にOpenAI APIを使用します。</p><div className="settings-status"><span>AI会話 {configuration?.aiConfigured ? 'サーバーにキー設定済み' : '未設定'}</span></div><p className="small-note">AIキーはサーバーの環境変数で管理します。会話が利用制限になる場合は、キーの所属プロジェクトと課金設定を確認してください。</p><button className="text-button" onClick={() => openExternal('https://platform.openai.com/settings/organization/billing')}>OpenAIの課金設定を開く<ArrowUpRight size={13}/></button><div className="settings-status"><span>サーバー用 {configuration?.serverConfigured ? '設定済み' : '未設定'}</span><span>ブラウザ用 {configuration?.browserConfigured ? '設定済み' : '未設定'}</span></div>{isEmbedded ? <button className="primary-button" onClick={() => openExternal(setupURL)}>ローカル設定画面を開く<ArrowUpRight size={16}/></button> : <form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await saveSettings({ serverKey, browserKey }); setServerKey(''); setBrowserKey(''); setMessage('保存しました。ページを開き直すと反映されます。'); onSaved(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }}><label>サーバー用APIキー<input type="password" value={serverKey} onChange={e => setServerKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="設定済みの場合は空欄で維持"/></label><label>ブラウザ用APIキー<input type="password" value={browserKey} onChange={e => setBrowserKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="設定済みの場合は空欄で維持"/></label><button className="primary-button" disabled={busy}>{busy ? '保存中…' : 'このMacに保存する'}</button></form>}<p role="status">{message}</p><details><summary>新規設定とキーの制限</summary><p className="small-note">Google Cloudで請求先を設定し、Maps JavaScript API、Places API (New)、Routes API、Geocoding APIを有効にします。サーバー用はPlaces・Routes・Geocodingに、ブラウザ用はMaps JavaScript APIに用途を制限します。</p><p className="small-note">キーはこのMacの設定ファイルだけに保存します。相談の住所・URL・比較結果は保存しません。</p><button type="button" className="text-button" onClick={() => openExternal('https://console.cloud.google.com/apis/credentials')}>Google Cloudの認証情報を開く<ArrowUpRight size={13}/></button></details></Dialog>;
}

export function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState(initialSettings ? 'settings' : null);
  const [formMode, setFormMode] = useState('address');
  const [role, setRole] = useState('candidate');
  const [query, setQuery] = useState('');
  const [radius, setRadius] = useState(2000);
  const [openNow, setOpenNow] = useState(false);
  const [reportCategories, setReportCategories] = useState(['assault', 'robbery', 'theft']);
  useEffect(() => { if (data?.workspace?.conditions) setReportCategories(data.workspace.conditions.categories); }, [data?.workspace?.conditions?.categories.join(',')]);
  const [newCity, setNewCity] = useState('shibuya');
  useEffect(() => {
    const unsubscribe = subscribe(value => { setData(previous => ({ ...value, browserKey: value.browserKey ?? previous?.browserKey, setupURL: value.setupURL || previous?.setupURL })); if (value.error) setError(value.error); });
    connect().catch(error => setError(error.message));
    return () => { unsubscribe(); disconnect(); };
  }, []);
  const workspace = data?.workspace;
  const configuration = data?.configuration;
  const city = data?.cities?.find(c => c.id === workspace?.city);
  const mapCity = data?.cities?.find(c => { const p = workspace?.mapView?.center; return p && p.lat >= c.bounds.south && p.lat <= c.bounds.north && p.lng >= c.bounds.west && p.lng <= c.bounds.east; });
  const origin = workspace?.places.find(p => p.id === workspace.originId);
  const destinations = workspace?.places.filter(p => p.id !== workspace.originId) || [];
  const selected = destinations.find(p => p.id === workspace?.selectedPlaceId);
  const routes = workspace?.routes.filter(r => r.destinationId === selected?.id && r.leg === workspace.leg && r.extraSeconds <= (workspace.conditions?.maxDetourMinutes ?? 5) * 60) || [];
  const selectedRoute = routes.find(r => r.id === workspace?.selectedRoutes[`${selected?.id}:${workspace?.leg}`]) || routes[0];
  const report = workspace?.report;
  const evaluation = workspace?.walkEvaluations?.find(e => e.comparisonId === selected?.id);
  const timeLimitFailed = workspace?.conditions?.maxRoundTripMinutes != null && evaluation?.status !== 'within';
  const busy = pending || workspace?.busy || workspace?.chatBusy;
  const run = async (name, args) => {
    if (pending) return;
    setPending(true); setError('');
    try { await flushMap(); return await action(name, args); }
    catch (error) { setError(error.message); }
    finally { setPending(false); }
  };
  const select = args => run('select', { workspaceId: workspace.id, ...args });
  const sourceCount = route => report?.comparable ? report.routeCounts.find(r => r.routeId === route.id)?.count ?? null : null;
  const nearby = report?.areaCounts?.find(a => a.placeId === selected?.id);
  const plan = () => workspace.activePairId ? run('compare', { workspaceId: workspace.id, pairs: workspace.routePairs.map(({ fromId, toId, comparisonId }) => ({ fromId, toId, comparisonId })) }) : run('plan', { workspaceId: workspace.id, destinationIds: [selected.id] });
  const addForm = mode => { setFormMode(mode); setRole('candidate'); setQuery(''); setDialog('add'); };
  const routeFor = leg => workspace?.routes.find(r => r.id === workspace.selectedRoutes[`${selected?.id}:${leg}`]);
  const out = routeFor('out');
  const back = routeFor('back');
  const externalRoute = mode => {
    const from = selectedRoute ? workspace.places.find(p => p.id === selectedRoute.fromId) : workspace.leg === 'out' ? origin : selected;
    const to = selectedRoute ? workspace.places.find(p => p.id === selectedRoute.toId) : workspace.leg === 'out' ? selected : origin;
    if (!from || !to) return;
    const params = new URLSearchParams({ api: '1', origin: `${from.lat},${from.lng}`, destination: `${to.lat},${to.lng}`, travelmode: mode });
    openExternal(`https://www.google.com/maps/dir/?${params}`);
  };
  return <main className={`sokomade ${isEmbedded ? 'embedded' : ''}`}>
    <header className="app-header"><h1>そこまで行って大丈夫？</h1><div className="header-tools">{workspace && <select aria-label="地域へ移動" disabled={busy} value={mapCity?.id || ''} onChange={e => run('move', { workspaceId: workspace.id, city: e.target.value })}><option value="" disabled>その他の地域</option><option value="shibuya">渋谷</option><option value="sf">SF</option></select>}<span className="privacy-label">相談中のみ保持</span><button className="icon-button" aria-label="設定" onClick={() => setDialog('settings')}><GearSix size={20}/></button></div></header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="エラーを閉じる" onClick={() => setError('')}><X size={16}/></button></div>}
    {data?.connectionError && <div className="error-banner" role="alert">{data.connectionError}</div>}
    {!workspace ? <div className="empty-workspace"><MapPin size={36} weight="light"/><h2>{data?.closed || data?.expired ? '相談データを破棄しました' : '地図を開いて、場所を比べる'}</h2><p>{isEmbedded ? '行き先や調べたいことを会話で伝えてください。' : '住所・店名・物件URLを追加して、徒歩と周辺情報を比較できます。'}</p><select aria-label="新しく開く地域" value={newCity} onChange={e => setNewCity(e.target.value)}><option value="shibuya">渋谷</option><option value="sf">SF</option></select><button className="primary-button" disabled={pending} onClick={() => run('open', { city: newCity })}>地図を開く<ArrowRight size={17}/></button></div> : <div className="app-workspace"><aside className="comparison-panel" aria-label="地点と経路の比較">
      <div className="panel-content"><div className="origin-bar"><span className="eyebrow">出発地</span>{origin ? <div><strong title={origin.name}>{origin.name}</strong><button className="text-button" onClick={() => { setRole('origin'); setQuery(''); setFormMode('address'); setDialog('add'); }}>変更</button></div> : <button className="origin-placeholder" onClick={() => addForm('address')}><Plus size={15}/>出発地を追加</button>}</div>
      <section className="destination-section"><div className="section-heading"><h2>行き先・比較する場所</h2><button className="icon-button" aria-label="住所・物件を追加" onClick={() => addForm('address')} disabled={busy}><Plus size={18}/></button></div><div className="place-list" role="group" aria-label="比較する場所を選ぶ">{destinations.map((place, index) => <div className="place-entry" key={place.id}><button className={`place-choice ${place.id === selected?.id ? 'selected' : ''}`} aria-pressed={place.id === selected?.id} onClick={() => select({ placeId: place.id })} disabled={busy}><span className="place-radio" aria-hidden="true"/><span className="place-copy"><strong title={place.name}>{place.name}</strong><small>{place.role === 'property' ? '物件候補' : place.primaryType || '候補地点'}{place.source === 'google-places' ? ` · ${money(place.priceLevel)}` : ''}</small>{place.openingHours?.openNow !== undefined && place.openingHours?.openNow !== null && <small>{place.openingHours.openNow ? '現在営業中（取得時点）' : '現在営業時間外（取得時点）'}</small>}</span><span className="place-number">{index + 1}</span></button><button className="remove-place" aria-label={`${place.name}を外す`} disabled={busy} onClick={() => run('remove', { workspaceId: workspace.id, placeId: place.id })}><X size={13}/></button></div>)}{!destinations.length && <div className="empty-places"><p>行きたい店や、比較したい物件を追加。</p><button className="text-button" onClick={() => addForm('search')}><MagnifyingGlass size={14}/>近くの店・施設を探す</button></div>}</div>{destinations.length > 0 && <button className="text-button find-more" onClick={() => addForm('search')}>近くの別の店を探す<ArrowUpRight size={13}/></button>}</section>
      <section className="route-section" aria-label="徒歩の往復"><div className="leg-switch" role="group" aria-label="行きと帰り"><button aria-pressed={workspace.leg === 'out'} onClick={() => select({ leg: 'out' })} disabled={busy}>行き</button><button aria-pressed={workspace.leg === 'back'} onClick={() => select({ leg: 'back' })} disabled={busy}>帰り</button></div><div className="route-columns"><span>徒歩</span><span>{report?.comparable ? '公開位置の報告' : '報告情報'}</span></div><div className="route-list">{routes.map((route, index) => <button key={route.id} className={`route-choice ${selectedRoute?.id === route.id ? 'selected' : ''}`} style={{ '--route-color': index === 0 ? '#0969f5' : '#9461dc' }} aria-pressed={selectedRoute?.id === route.id} onClick={() => select({ routeId: route.id, leg: route.leg })} disabled={busy}><span><small>{route.name}</small><strong>{route.minutes}<span>分</span></strong>{route.extraMinutes > 0 && <b>＋{route.extraSeconds < 60 ? '1分未満' : `${route.extraMinutes}分`}</b>}<span className="distance">{(route.distanceMeters / 1000).toFixed(1)} km</span></span><span className="route-report">{sourceCount(route) === null ? <small>{report?.precision === 'neighborhood' ? '沿道比較不可' : '情報不足'}</small> : <><i/>{sourceCount(route)}<small>件</small></>}</span></button>)}{!routes.length && <p className="empty-route">{busy ? '徒歩経路・報告情報を確認しています…' : origin && selected ? '出発地と行き先から、徒歩の往復を調べます。' : '出発地と行き先を選ぶと、経路を比較できます。'}</p>}</div></section>
      <section className="report-section">{report ? <>{report.status === 'unavailable' ? <p>報告情報を取得できませんでした。</p> : <><p>{report.period.label}</p><p>{report.basis === 'viewport' ? '表示範囲の参考情報（網羅性は未確認）' : report.comparable ? `公開位置を経路両側${report.corridorMeters}mで参考集計` : nearby?.area ? `${nearby.area}の地域情報` : '町丁目単位の情報。沿道は比較不可'}</p>{nearby?.count !== null && nearby?.count !== undefined && <p className="area-stat">{report.comparable ? `周囲${nearby.radiusMeters}mの公開位置` : nearby.area}：{nearby.count}件</p>}{report.stale && <p className="warning">前回取得データを表示中</p>}</>}<p>件数は安全性を示すものではありません。</p><button className="text-button" onClick={() => setDialog('reports')}>出典・集計条件を見る<ArrowUpRight size={13}/></button></> : <><p>報告情報は、取得できた範囲だけ表示します。</p><button className="text-button" disabled={busy || !destinations.length} onClick={() => run('analyze', { workspaceId: workspace.id, categories: reportCategories })}>周辺の報告情報を調べる<ArrowRight size={13}/></button></>}</section>
      </div><div className="decision-area"><button className="primary-button" disabled={busy || (!origin && !selectedRoute) || !selected} onClick={routes.length ? () => setDialog('decision') : plan}>{busy ? '確認中…' : selectedRoute ? `${workspace.leg === 'out' ? 'この場所へ' : '出発地へ'} · ${selectedRoute.minutes}分の道で行く` : '徒歩の往復を調べる'}{!busy && <ArrowRight size={18}/>}</button>{routes.length > 0 && <button className="text-button" disabled={busy} onClick={plan}><ArrowClockwise size={13}/>経路を更新</button>}<button className="text-button" disabled={(!origin && !selectedRoute) || !selected} onClick={() => setDialog('transport')}>徒歩以外を検討</button></div>
      <div className="panel-footer">{isEmbedded ? <p>条件の変更や詳しい相談は、Codexの会話へ。</p> : <p>店・道・周辺情報を地図で比較します。</p>}<button className="text-button muted" onClick={() => setDialog('clear')}><Trash size={12}/>相談データを破棄</button></div>
    </aside><section className="main-map" aria-label="連動する地図"><MapCanvas workspace={workspace} browserKey={data.browserKey} city={city} onSelect={select} onViewport={queueViewport} onFocus={args => focusMap(args).catch(error => setError(error.message))}/>{workspace.notices?.length > 0 && <div className="map-notice" role="status">{workspace.notices[0]}</div>}{busy && <div className="loading-indicator" role="status">{workspace.chatStatus || '地図と情報を更新しています…'}</div>}</section></div>}
    {!isEmbedded && workspace && <Consultation workspace={workspace} ai={data.ai} onError={setError}/> }
    {dialog === 'settings' && <Settings configuration={configuration} setupURL={data?.setupURL} onClose={() => setDialog(null)} onSaved={() => {}}/>}
    {dialog === 'add' && workspace && <Dialog title={formMode === 'search' ? '近くの店・施設を探す' : '住所・店名・物件を追加'} onClose={() => setDialog(null)}><form onSubmit={async e => { e.preventDefault(); if (!query.trim()) return; const result = await run(formMode === 'search' ? 'search' : 'resolve', formMode === 'search' ? { workspaceId: workspace.id, query, radiusMeters: radius, openNow, limit: 5 } : { workspaceId: workspace.id, query, role }); if (result) { setQuery(''); setDialog(null); } }}><label>{formMode === 'search' ? '探したいもの' : '住所・店名・公開物件URL'}<input autoFocus aria-label={formMode === 'search' ? '探したいもの' : '追加する住所・店名・物件URL'} placeholder={formMode === 'search' ? 'バーガー、カフェ、スーパーなど' : '渋谷駅、物件の住所・URLなど'} value={query} onChange={e => setQuery(e.target.value)} maxLength={2000} required/></label>{formMode === 'address' ? <label>この地点の使い方<select aria-label="追加する地点の役割" value={role} onChange={e => setRole(e.target.value)}><option value="origin">出発地</option><option value="candidate">行き先・比較候補</option><option value="property">物件候補</option></select></label> : <><label>注目地点・表示範囲からの検索範囲<select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value="500">500m</option><option value="1000">1km</option><option value="2000">2km</option><option value="5000">5km</option></select></label><label className="check-label"><input type="checkbox" checked={openNow} onChange={e => setOpenNow(e.target.checked)}/>現在営業中の候補に絞る</label></>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={pending}>{pending ? '取得中…' : formMode === 'search' ? '候補を探す' : '地図に追加'}<ArrowRight size={17}/></button></form><p className="small-note">物件は公開住所の読み取りに対応します。読めないURLでは住所を入力してください。店舗・地名の候補が複数ある場合は地図上で確認してください。</p></Dialog>}
    {dialog === 'reports' && <Dialog title="報告情報と比較条件" onClose={() => setDialog(null)}><ReportDetails report={report}/><fieldset disabled={busy}><legend>集計する種別</legend>{[['assault','暴行・傷害'],['robbery','強盗'],['theft','窃盗（車内盗等を含む）']].map(([value, label]) => <label className="check-label" key={value}><input type="checkbox" checked={reportCategories.includes(value)} onChange={e => setReportCategories(prev => e.target.checked ? [...prev, value] : prev.filter(x => x !== value))}/>{label}</label>)}<button className="secondary-button" disabled={!reportCategories.length} onClick={async () => { await run('analyze', { workspaceId: workspace.id, categories: reportCategories }); }}>この条件で再集計</button></fieldset></Dialog>}
    {dialog === 'decision' && selected && <Dialog title="このプランで行こう" onClose={() => setDialog(null)}><div className="confirmation-icon"><Check size={24}/></div><h3>{selected.name}</h3>{[['行き', out],['帰り', back]].map(([label, route]) => <div className="plan-row" key={label}><span>{label}</span><strong>{route ? `${route.name} · ${route.minutes}分` : '未取得'}</strong></div>)}<div className="plan-row total"><span>徒歩の往復</span><strong>{out && back ? `${minutes(out.durationSeconds + back.durationSeconds)}分` : '情報不足'}</strong></div>{[...new Set([...(out?.warnings || []), ...(back?.warnings || [])])].map(warning => <p className="small-note" key={warning}>{warning}</p>)}<p className="small-note">徒歩時間は推定です。食事・滞在時間は含みません。報告件数は安全を保証しません。</p><p className="small-note">{timeLimitFailed ? `徒歩往復${workspace.conditions.maxRoundTripMinutes}分以内の条件を満たせていません。条件や経路を見直してください。` : ''}</p><button className="primary-button" disabled={timeLimitFailed} onClick={() => externalRoute('walking')}>Google Mapsで徒歩経路を検索<ArrowUpRight size={16}/></button><p className="small-note">外部では経路を再検索します。ここで選んだ道は引き継がれません。</p></Dialog>}
    {dialog === 'transport' && <Dialog title="徒歩以外も検討する" onClose={() => setDialog(null)}><p>運行時刻・料金・配車の可否は外部サービスで確認します。</p><button className="secondary-button" onClick={() => externalRoute('transit')}>公共交通の経路を開く<ArrowUpRight size={16}/></button><button className="secondary-button" onClick={() => externalRoute('driving')}>車・タクシーでの経路を開く<ArrowUpRight size={16}/></button><p className="small-note">配車・予約・決済は行いません。</p></Dialog>}
    {dialog === 'clear' && <Dialog title="相談データを破棄しますか？" onClose={() => setDialog(null)}><p>このプラグインがメモリに保持する住所・物件URL・比較結果を消去します。Codex自身の会話履歴は別の扱いです。</p><button className="primary-button" onClick={async () => { await run('clear', { workspaceId: workspace.id }); setDialog(null); }}>破棄する</button></Dialog>}
  </main>;
}
