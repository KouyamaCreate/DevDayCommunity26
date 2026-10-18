import { useEffect, useRef, useState } from 'react';
import { GearSix, Plus, X, ArrowRight, ArrowUpRight, MapPin, Trash, ArrowClockwise, Check, MagnifyingGlass, SlidersHorizontal, CaretRight, MapTrifold } from '@phosphor-icons/react';
import { Consultation } from './Consultation';
import { MapCanvas } from './Map';
import { presentation, candidateLetter } from './presentation.mjs';
import { layerMessage, DENSITY_LABEL, DENSITY_MAX, AREA_MAX, areaColor, densityColor, pointInspection } from './report-density.mjs';
import { action, connect, disconnect, subscribe, isEmbedded, openExternal, saveSettings, queueViewport, focusMap, flushMap } from './bridge';

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
  return <><dl className="details"><div><dt>対象期間</dt><dd>{report.period.label}</dd></div><div><dt>対象種別</dt><dd>{report.categoryLabels.join('・')}</dd></div><div><dt>位置の精度</dt><dd>{report.precision === 'neighborhood' ? '町丁目単位' : '匿名化された交差点の公開位置'}</dd></div><div><dt>集計範囲</dt><dd>{report.basis === 'viewport' ? '表示範囲の参考情報。地図全域の網羅性は未確認です。' : report.comparable ? `経路両側${report.corridorMeters}m内の公開位置。重なる区間・複数分類は同じ報告を重複集計しません。` : '町丁目全体の認知件数。経路沿道の件数ではありません。'}</dd></div><div><dt>出典</dt><dd><button className="text-button" onClick={() => openExternal(report.sourceURL)}>{report.sourceName}<ArrowUpRight size={14}/></button></dd></div><div><dt>取得日時</dt><dd>{new Date(report.fetchedAt).toLocaleString('ja-JP')}</dd></div>{report.updatedAt && <div><dt>公開データ記載の更新</dt><dd>{report.updatedAt}</dd></div>}</dl>{report.boundaries && <div className="boundary-source small-note"><p>{report.boundaries.credit}</p><p>{report.boundaries.limitation}</p><button className="text-button" onClick={()=>openExternal(report.boundaries.sourcePage)}>境界の出典（2020年）<ArrowUpRight size={14}/></button><button className="text-button" onClick={()=>openExternal(report.boundaries.licenseURL)}>CC BY 4.0</button>{report.unmatchedBoundaryAreas?.length>0 && <p>境界未対応：{report.unmatchedBoundaryAreas.join('・')}</p>}</div>}{report.stale && <p className="warning">最新データを取得できず、前回取得した公開データを表示しています。</p>}{report.limitations.map(text => <p className="small-note" key={text}>{text}</p>)}{report.city === 'sf' && <p className="small-note">位置の欠損・対象外位置による除外行：データ全体で{report.missingPositionRows}行。地図上の同じ公開位置はまとめて表示します。</p>}</>;
}

function Settings({ configuration, onClose, onSaved, setupURL }) {
  const [serverKey, setServerKey] = useState('');
  const [browserKey, setBrowserKey] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title="接続設定" onClose={onClose}><p>地図・店舗・徒歩経路にGoogle Maps Platform、会話にOpenAI APIを使用します。</p><div className="settings-status"><span>AI会話 {configuration?.aiConfigured ? 'サーバーにキー設定済み' : '未設定'}</span></div><p className="small-note">AIキーはサーバーの環境変数で管理します。会話が利用制限になる場合は、キーの所属プロジェクトと課金設定を確認してください。</p><button className="text-button" onClick={() => openExternal('https://platform.openai.com/settings/organization/billing')}>OpenAIの課金設定を開く<ArrowUpRight size={13}/></button><div className="settings-status"><span>サーバー用 {configuration?.serverConfigured ? '設定済み' : '未設定'}</span><span>ブラウザ用 {configuration?.browserConfigured ? '設定済み' : '未設定'}</span></div>{isEmbedded ? <button className="primary-button" onClick={() => openExternal(setupURL)}>ローカル設定画面を開く<ArrowUpRight size={16}/></button> : <form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await saveSettings({ serverKey, browserKey }); setServerKey(''); setBrowserKey(''); setMessage('保存しました。ページを開き直すと反映されます。'); onSaved(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }}><label>サーバー用APIキー<input type="password" value={serverKey} onChange={e => setServerKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="設定済みの場合は空欄で維持"/></label><label>ブラウザ用APIキー<input type="password" value={browserKey} onChange={e => setBrowserKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="設定済みの場合は空欄で維持"/></label><button className="primary-button" disabled={busy}>{busy ? '保存中…' : 'このMacに保存する'}</button></form>}<p role="status">{message}</p><details><summary>新規設定とキーの制限</summary><p className="small-note">Google Cloudで請求先を設定し、Maps JavaScript API、Places API (New)、Routes API、Geocoding APIを有効にします。サーバー用はPlaces・Routes・Geocodingに、ブラウザ用はMaps JavaScript APIに用途を制限します。</p><p className="small-note">キーはこのMacの設定ファイルだけに保存します。相談の住所・URL・比較結果は保存しません。</p><button type="button" className="text-button" onClick={() => openExternal('https://console.cloud.google.com/apis/credentials')}>Google Cloudの認証情報を開く<ArrowUpRight size={13}/></button></details></Dialog>;
}

export function App({ initialData = null } = {}) {
  const [data, setData] = useState(initialData);
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
  const view = workspace ? presentation(workspace) : null;
  const [allPlaces,setAllPlaces] = useState(false);
  const [bothPaths,setBothPaths] = useState(false);
  const [layerVisible,setLayerVisible] = useState(true);
  const [densityRadius,setDensityRadius] = useState(250);
  const [densityOpacity,setDensityOpacity] = useState(1);
  const [inspecting,setInspecting] = useState(false);
  const [inspectionError,setInspectionError] = useState('');
  const inspection=pointInspection(workspace);
  const tokyoLayer=workspace?.reportLayer?.regions?.find(r=>r.city==='shibuya' && r.status==='available');
  const sfLayer=workspace?.reportLayer?.regions?.find(r=>r.city==='sf' && r.status==='available');
  useEffect(()=>{
    let cancelled=false;
    setInspecting(false);setInspectionError('');
    if(!workspace || workspace.focus.type!=='point' || isEmbedded || pointInspection(workspace))return;
    setInspecting(true);
    action('analyze',{workspaceId:workspace.id}).catch(error=>{if(!cancelled && error.code!=='STALE_RESULT')setInspectionError(error.message);}).finally(()=>{if(!cancelled)setInspecting(false);});
    return ()=>{cancelled=true;};
  },[workspace?.id,workspace?.focus?.type,workspace?.focus?.point?.lat,workspace?.focus?.point?.lng,workspace?.conditions?.categories.join(','),workspace?.conditions?.radiusMeters]);
  useEffect(()=>{setAllPlaces(false);setBothPaths(false);setLayerVisible(true);setDensityRadius(250);setDensityOpacity(1);},[workspace?.id]);
  const displayed = allPlaces ? destinations : view?.candidates || [];
  const plan = () => workspace.activePairId ? run('compare', { workspaceId:workspace.id,pairs:workspace.routePairs.map(({fromId,toId,comparisonId})=>({fromId,toId,comparisonId})) }) : run('plan',{workspaceId:workspace.id,destinationIds:[selected.id]});
  const addForm = mode => {setFormMode(mode);setRole('candidate');setQuery('');setDialog('add');};
  const routeFor = leg => workspace?.routes.find(r => r.id === workspace.selectedRoutes[`${selected?.id}:${leg}`]);
  const out=routeFor('out'), back=routeFor('back');
  const externalRoute = mode => {
    const from = selectedRoute ? workspace.places.find(p => p.id === selectedRoute.fromId) : workspace.leg === 'out' ? origin : selected;
    const to = selectedRoute ? workspace.places.find(p => p.id === selectedRoute.toId) : workspace.leg === 'out' ? selected : origin;
    if (!from || !to) return;
    const params = new URLSearchParams({ api: '1', origin: `${from.lat},${from.lng}`, destination: `${to.lat},${to.lng}`, travelmode: mode });
    openExternal(`https://www.google.com/maps/dir/?${params}`);
  };
  const toolbar = workspace && (<div className="conversation-tools"><button className="text-button" onClick={()=>addForm('address')} disabled={busy}><Plus size={13}/>場所を追加</button><button className="text-button" onClick={()=>addForm('search')} disabled={busy}>周辺検索</button>{destinations.length>view.candidates.length && <button className="text-button" aria-pressed={allPlaces} onClick={()=>setAllPlaces(!allPlaces)}>{allPlaces?'今回の候補':'保持中の地点'}</button>}<button className="text-button" aria-label="相談データを破棄" onClick={()=>setDialog('clear')}><Trash size={13}/></button></div>);
  return <main className={`sokomade ${isEmbedded ? 'embedded' : ''}`}>
    <header className="app-header"><span className="brand"><MapTrifold size={20}/>そこまで</span>{workspace && <select aria-label="地域へ移動" disabled={busy} value={mapCity?.id || ''} onChange={e=>run('move',{workspaceId:workspace.id,city:e.target.value})}><option value="" disabled>その他の地域</option><option value="shibuya">渋谷</option><option value="sf">SF</option></select>}<div className="header-tools"><button className="conditions-button" onClick={()=>setDialog('reports')}><SlidersHorizontal size={18}/>表示条件</button><span className="data-badge">実データ</span><button className="icon-button" aria-label="設定" onClick={()=>setDialog('settings')}><GearSix size={20}/></button></div></header>
    {(error || data?.connectionError) && <div className="error-banner" role="alert"><span>{error || data.connectionError}</span><button aria-label="エラーを閉じる" onClick={()=>setError('')}><X size={16}/></button></div>}
    {!workspace?<div className="empty-workspace"><MapPin size={36}/><h2>{data?.closed || data?.expired?'相談データを破棄しました':'地図を開いて相談する'}</h2><select aria-label="新しく開く地域" value={newCity} onChange={e=>setNewCity(e.target.value)}><option value="shibuya">渋谷</option><option value="sf">SF</option></select><button className="primary-button" onClick={()=>run('open',{city:newCity})}>地図を開く</button></div>:<div className="map-workspace">
      <MapCanvas workspace={workspace} browserKey={data.browserKey} city={city} onSelect={select} onViewport={queueViewport} onFocus={args=>focusMap(args).catch(e=>setError(e.message))} bothPaths={bothPaths} layerVisible={layerVisible} densityRadius={densityRadius} densityOpacity={densityOpacity} inspecting={inspecting} onInspect={()=>run('analyze',{workspaceId:workspace.id})}/>
      <Consultation tools={toolbar} compactResults={displayed.length>0 || view.routes.length>0} workspace={workspace} ai={data.ai} onError={setError} scopeLabel={workspace.focus.type==='point'?'地図で選んだ地点について相談中':workspace.focus.type==='place'?`注目地点：${workspace.places.find(p=>p.id===workspace.focus.placeId)?.name || '選択地点'}`:'いま見ている範囲で相談できます'}>
        {displayed.length>0 && (view.propertyMode || !view.routes.length || displayed.length>1) && <div className="result-list" role="group" aria-label="比較する場所を選ぶ">{displayed.map(place=>{
          const pair=workspace.routePairs.find(p=>p.comparisonId===place.id);
          const commute=workspace.routes.find(r=>r.id===workspace.selectedRoutes[`${place.id}:${workspace.leg}`]);
          const endpoint=workspace.places.find(p=>p.id===(pair?.comparisonId===pair?.fromId?pair?.toId:pair?.fromId));
          return <button key={place.id} className={`result-choice ${selected?.id===place.id?'selected':''}`} aria-pressed={selected?.id===place.id} onClick={()=>select({placeId:place.id})} disabled={busy}><span className="choice-indicator">{selected?.id===place.id && <Check size={17} weight="bold"/>}</span><span><strong>{candidateLetter(workspace,place.id)} {place.name}</strong><small>{commute?`${endpoint?.name || '行き先'}${commute.fromId===place.id?'まで':'から'}徒歩${commute.minutes}分`:place.role==='property'?'物件候補':place.primaryType || place.address || '候補地点'}</small></span><CaretRight size={18}/></button>;
        })}</div>}
        {view.routes.length>0 && <section className="walking-results" aria-label="徒歩ルートの比較"><div className="route-context"><span>{view.from?.name} → {view.to?.name}</span><div className="leg-switch" role="group" aria-label="行きと帰り">{['out','back'].map(leg=><button key={leg} aria-pressed={workspace.leg===leg} disabled={busy} onClick={()=>select({leg})}>{leg==='out'?'行き':'帰り'}</button>)}</div></div>{!view.propertyMode && view.routes.map((route,i)=><button key={route.id} className={`result-choice route-result ${selectedRoute?.id===route.id?'selected':''} ${i?'alternate':''}`} aria-pressed={selectedRoute?.id===route.id} disabled={busy} onClick={()=>select({routeId:route.id,leg:route.leg})}><span className="choice-indicator">{selectedRoute?.id===route.id && <Check size={17} weight="bold"/>}</span><strong>{i?'別の道':'最短候補'} · 徒歩{route.minutes}分 {route.extraSeconds>0 && <em>＋{route.extraSeconds<60?'1分未満':`${route.extraMinutes}分`}</em>}</strong><CaretRight size={18}/></button>)}<p className="result-note">{workspace.reportLayer?.regions?.some(r=>r.city==='sf'&&r.status==='available')?'公開位置の報告分布を地図に重ねています。':workspace.reportLayer?.regions?.some(r=>r.city==='shibuya'&&r.status==='available')?'町丁目の情報です。沿道件数は比較しません。':'この範囲の報告情報は確認できません。'}</p>{timeLimitFailed && <p className="warning small-note">徒歩往復{workspace.conditions.maxRoundTripMinutes}分以内：{view.evaluation?.status==='exceeds'?'条件外':'情報不足で未判定'}</p>}</section>}
        {workspace.focus.type==='point' && <section className="point-inspection" aria-label="選んだ地点の公開報告" aria-live="polite"><strong>{inspecting?'周辺の報告を集計中…':inspectionError || inspection?.label || 'この地点の報告は未確認'}</strong>{inspection && <><p>{inspection.report.period?.label}</p><p>{inspection.report.categoryLabels?.join('・')}</p><p>{inspection.area?.area?'町丁目全体の値です。選んだ点の周囲や沿道件数ではありません。':'匿名化された公開位置による実集計です。分布の色から計算した件数ではありません。'}</p>{inspection.area?.boundaryBasis==='census-2020-reference' && <p>2020年国勢調査の参考境界で対応づけています。現在の住所・集計区域との完全一致は未確認です。</p>}{inspection.report.stale && <p className="warning">最新取得に失敗し、前回取得データを表示しています。</p>}</>}<div className="point-inspection-actions">{inspection?.report.city!=='shibuya' && <label>確認範囲<select aria-label="選択地点の集計範囲" value={workspace.conditions.radiusMeters || 500} disabled={busy || inspecting} onChange={e=>run('conditions',{workspaceId:workspace.id,radiusMeters:Number(e.target.value)})}>{[250,500,1000].map(m=><option key={m} value={m}>半径{m}m</option>)}</select></label>}<button className="text-button" disabled={busy || inspecting} onClick={()=>run('analyze',{workspaceId:workspace.id})}>再確認</button><button className="text-button" onClick={()=>setDialog('reports')}>出典・条件</button></div></section>}
        {workspace.focus.type!=='point' && workspace.focusReport?.areaCounts?.length>0 && <p className="result-note">{workspace.focusReport.areaCounts.map(a=>a.area?`${a.area}：${a.count}件（町丁目全体）`:a.count!=null?`周囲${a.radiusMeters}mの公開位置：${a.count}件`:'この地点は情報不足').join('／')}。期間・出典は表示条件へ。</p>}
        {(selected || routes.length>0) && <div className="result-actions"><button className="primary-button" disabled={busy || (view.propertyMode?false:!selectedRoute && !origin)} onClick={()=>view.propertyMode?run('analyze',{workspaceId:workspace.id}):selectedRoute?setDialog('decision'):plan()}>{view.propertyMode?'この周辺を詳しく見る':selectedRoute?(workspace.leg==='back'?'この道で戻る':'この道で行く'):'徒歩の往復を調べる'}</button>{view.propertyMode?<button className="text-button" aria-pressed={bothPaths} onClick={()=>setBothPaths(!bothPaths)}>{bothPaths?'選択中の徒歩経路だけ表示':workspace.routePairs.filter(p=>workspace.places.some(place=>place.id===p.comparisonId && place.role==='property')).length===2?'両方の徒歩経路を表示':'比較中の徒歩経路を表示'}</button>:selectedRoute?<button className="text-button" onClick={()=>setDialog('transport')}>徒歩以外も見る</button>:<button className="text-button" onClick={()=>{setRole('origin');setQuery('');setFormMode('address');setDialog('add');}}>出発地を指定</button>}</div>}
        {workspace.notices?.length>0 && <p className="result-note" role="status">{workspace.notices[0]}</p>}

      </Consultation>
      <button className="report-legend" onClick={()=>setDialog('reports')} aria-label="報告分布の表示条件を確認"><strong>公開報告の分布</strong>{layerVisible && (sfLayer || tokyoLayer)?<><span className="legend-scale"><span>少ない</span>{(sfLayer?[0,100,300,750,DENSITY_MAX]:[0,10,50,150,AREA_MAX]).map((value,i)=>{const color=sfLayer?densityColor(value,densityOpacity):areaColor(value,densityOpacity);return <i key={i} style={{backgroundColor:`rgba(${color.slice(0,3).join(',')},${color[3]/255})`}}/>;})}<span>多い</span></span><small>{sfLayer?`参考密度 0〜${DENSITY_MAX.toLocaleString()}件/km²以上`:`町丁目全体 0〜${AREA_MAX}件以上`}</small><small>{sfLayer?`平滑化の半径${densityRadius}m・安全度ではありません`:`${tokyoLayer.period.label}・種別は表示条件へ`}</small>{tokyoLayer && <small>境界：CODH / e-Stat 2020（参考）</small>}</>:null}<small>{layerVisible?(sfLayer || tokyoLayer?'期間・種別・出典は表示条件へ':layerMessage(workspace.reportLayer)):'分布レイヤーは非表示'}</small><small>安全性を示すものではありません</small></button>
    </div>}
    {dialog === 'settings' && <Settings configuration={configuration} setupURL={data?.setupURL} onClose={() => setDialog(null)} onSaved={() => {}}/>}
    {dialog === 'add' && workspace && <Dialog title={formMode === 'search' ? '近くの店・施設を探す' : '住所・店名・物件を追加'} onClose={() => setDialog(null)}><form onSubmit={async e => { e.preventDefault(); if (!query.trim()) return; const result = await run(formMode === 'search' ? 'search' : 'resolve', formMode === 'search' ? { workspaceId: workspace.id, query, radiusMeters: radius, openNow, limit: 5 } : { workspaceId: workspace.id, query, role }); if (result) { setQuery(''); setDialog(null); } }}><label>{formMode === 'search' ? '探したいもの' : '住所・店名・公開物件URL'}<input autoFocus aria-label={formMode === 'search' ? '探したいもの' : '追加する住所・店名・物件URL'} placeholder={formMode === 'search' ? 'バーガー、カフェ、スーパーなど' : '渋谷駅、物件の住所・URLなど'} value={query} onChange={e => setQuery(e.target.value)} maxLength={2000} required/></label>{formMode === 'address' ? <label>この地点の使い方<select aria-label="追加する地点の役割" value={role} onChange={e => setRole(e.target.value)}><option value="origin">出発地</option><option value="candidate">行き先・比較候補</option><option value="property">物件候補</option></select></label> : <><label>注目地点・表示範囲からの検索範囲<select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value="500">500m</option><option value="1000">1km</option><option value="2000">2km</option><option value="5000">5km</option></select></label><label className="check-label"><input type="checkbox" checked={openNow} onChange={e => setOpenNow(e.target.checked)}/>現在営業中の候補に絞る</label></>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={pending}>{pending ? '取得中…' : formMode === 'search' ? '候補を探す' : '地図に追加'}<ArrowRight size={17}/></button></form><p className="small-note">物件は公開住所の読み取りに対応します。読めないURLでは住所を入力してください。店舗・地名の候補が複数ある場合は地図上で確認してください。</p></Dialog>}
    {dialog === 'reports' && workspace && <Dialog title="表示条件と公開報告" onClose={()=>setDialog(null)}><label className="check-label"><input type="checkbox" checked={layerVisible} onChange={e=>setLayerVisible(e.target.checked)}/>公開報告の分布を表示</label><p>{layerMessage(workspace.reportLayer)}</p>{(sfLayer || tokyoLayer) && <div className="density-settings">{sfLayer && <label>分布のまとめ方<select aria-label="分布のまとめ方" value={densityRadius} onChange={e=>setDensityRadius(Number(e.target.value))}><option value={250}>半径250m</option><option value={500}>半径500m</option></select></label>}<label>色の濃さ<select aria-label="分布の色の濃さ" value={densityOpacity} onChange={e=>setDensityOpacity(Number(e.target.value))}><option value={.65}>薄く</option><option value={1}>標準</option><option value={1.3}>濃く</option></select></label><p className="small-note">表示の調整です。選択地点の実件数・集計範囲は変わりません。</p></div>}<p className="small-note">{sfLayer?`${DENSITY_LABEL}。色は匿名化された公開位置を半径${densityRadius}mで平滑化した参考密度で、実件数や被害確率ではありません。地図移動・拡大で色の基準は変えません。参考密度${DENSITY_MAX}件/km²以上は同じ色です。周辺500mまでの公開位置を追加取得して表示端の影響を抑えますが、データ対応範囲の境界では過小表示となる場合があります。`:`渋谷は町丁目全体の対象種別の認知件数で色分けし、${AREA_MAX}件以上は同じ色です。町丁目の面積や人口で補正した値ではありません。2020年国勢調査の参考境界と現在の住所・集計区域との完全一致は未確認です。名前が対応しない区域は着色しません。`}無着色は安全や0件を意味しません。行政境界・網羅性は未確認です。</p>{workspace.reportLayer?.regions?.filter(r=>r.status==='available').map(r=><ReportDetails key={r.city} report={{...r,basis:'viewport'}}/>)}{!workspace.reportLayer?.regions?.some(r=>r.status==='available') && <p>この範囲の報告情報は確認できません。0件とは扱いません。</p>}<fieldset disabled={busy}><legend>集計する種別</legend>{[['assault','暴行・傷害'],['robbery','強盗'],['theft','窃盗']].map(([value,label])=><label className="check-label" key={value}><input type="checkbox" checked={reportCategories.includes(value)} onChange={e=>setReportCategories(prev=>e.target.checked?[...prev,value]:prev.filter(x=>x!==value))}/>{label}</label>)}<button className="secondary-button" disabled={!reportCategories.length} onClick={()=>run('conditions',{workspaceId:workspace.id,categories:reportCategories})}>この条件で再集計</button></fieldset><p className="small-note">遠回り：{workspace.conditions.maxDetourMinutes}分まで ／ 徒歩往復：{workspace.conditions.maxRoundTripMinutes===null?'上限なし':`${workspace.conditions.maxRoundTripMinutes}分以内`}。変更は相談欄から指定できます。</p><button className="text-button" onClick={()=>{setDialog('settings');}}>API接続設定<GearSix size={14}/></button></Dialog>}
    {dialog === 'decision' && selected && <Dialog title="このプランで行こう" onClose={() => setDialog(null)}><div className="confirmation-icon"><Check size={24}/></div><h3>{view.to?.name || selected.name}</h3>{[['行き', out],['帰り', back]].map(([label, route]) => <div className="plan-row" key={label}><span>{label}</span><strong>{route ? `${route.name} · ${route.minutes}分` : '未取得'}</strong></div>)}<div className="plan-row total"><span>徒歩の往復</span><strong>{out && back ? `${minutes(out.durationSeconds + back.durationSeconds)}分` : '情報不足'}</strong></div>{[...new Set([...(out?.warnings || []), ...(back?.warnings || [])])].map(warning => <p className="small-note" key={warning}>{warning}</p>)}<p className="small-note">徒歩時間は推定です。食事・滞在時間は含みません。報告件数は安全を保証しません。</p><p className="small-note">{timeLimitFailed ? `徒歩往復${workspace.conditions.maxRoundTripMinutes}分以内の条件を満たせていません。条件や経路を見直してください。` : ''}</p><button className="primary-button" disabled={timeLimitFailed} onClick={() => externalRoute('walking')}>Google Mapsで徒歩経路を検索<ArrowUpRight size={16}/></button><p className="small-note">外部では経路を再検索します。ここで選んだ道は引き継がれません。</p></Dialog>}
    {dialog === 'transport' && <Dialog title="徒歩以外も検討する" onClose={() => setDialog(null)}><p>運行時刻・料金・配車の可否は外部サービスで確認します。</p><button className="secondary-button" onClick={() => externalRoute('transit')}>公共交通の経路を開く<ArrowUpRight size={16}/></button><button className="secondary-button" onClick={() => externalRoute('driving')}>車・タクシーでの経路を開く<ArrowUpRight size={16}/></button><p className="small-note">配車・予約・決済は行いません。</p></Dialog>}
    {dialog === 'clear' && <Dialog title="相談データを破棄しますか？" onClose={() => setDialog(null)}><p>この相談の地点・住所・履歴・比較結果を破棄します。外部サービスへ送信済みの情報は削除できません。</p><button className="primary-button" onClick={async () => { await run('clear', { workspaceId: workspace.id }); setDialog(null); }}>破棄する</button></Dialog>}
  </main>;
}
