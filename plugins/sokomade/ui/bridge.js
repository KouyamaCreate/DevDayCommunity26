import { App } from '@modelcontextprotocol/ext-apps';

const ACTION_TO_TOOL = { open: 'open_map', resolve: 'resolve_location', search: 'search_places', select: 'select_on_map', plan: 'plan_walk', analyze: 'analyze_reports', remove: 'remove_location', clear: 'close_map' };
const boot = window.__SOKOMADE__ || { mode: 'browser' };
export const isEmbedded = boot.mode === 'mcp';
let app;
let latest;
let workspaceId;
let interval;
const listeners = new Set();
const publish = value => {
  if (!value) return;
  if (value.workspace && latest?.workspace?.id === value.workspace.id && value.workspace.version < latest.workspace.version) return;
  if (value.workspace && latest?.workspace?.id === value.workspace.id && value.workspace.version === latest.workspace.version && value.browserKey === latest.browserKey && !latest.connectionError) return;
  latest = value;
  if (!isEmbedded && value.workspace) { const url = new URL(location.href); url.searchParams.set('workspace', value.workspace.id); history.replaceState(null, '', url); }
  workspaceId = value.workspace?.id || workspaceId;
  for (const listener of listeners) listener(value);
};
function unwrap(result) {
  if (result.isError || result.structuredContent?.error) {
    let error = result.structuredContent?.error;
    if (!error) { try { error = JSON.parse(result.content?.[0]?.text); } catch {} }
    throw Object.assign(new Error(error?.message || '操作を完了できませんでした。'), { code: error?.code });
  }
  const value = result._meta?.snapshot || result.structuredContent;
  if (value) publish({ ...value, browserKey: result._meta?.browserKey, setupURL: result._meta?.setupURL, viewURL: result._meta?.viewURL });
  return value;
}
async function browserFetch(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${boot.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const value = await response.json();
  if (!response.ok || value.error) throw Object.assign(new Error(value.error?.message || '接続できませんでした。'), { code: value.error?.code });
  return value;
}
export async function connect() {
  if (isEmbedded) {
    app = new App({ name: 'sokomade-map', version: '0.1.0' }, {});
    app.ontoolresult = result => { try { unwrap(result); } catch (error) { publish({ ...latest, error: error.message }); } };
    await app.connect();
    return;
  }
  const id = new URLSearchParams(location.search).get('workspace');
  if (id) {
    try { publish(await browserFetch(`/api/state?workspace=${encodeURIComponent(id)}`)); }
    catch (error) { if (error.code !== 'SESSION_EXPIRED') throw error; publish({ expired: true }); }
  } else await action('open', { city: 'shibuya' });
  interval = setInterval(async () => {
    if (!workspaceId || !latest?.workspace) return;
    try { publish(await browserFetch(`/api/state?workspace=${encodeURIComponent(workspaceId)}`)); }
    catch (error) {
      if (error.code === 'SESSION_EXPIRED') { workspaceId = null; publish({ expired: true }); }
      else publish({ ...latest, connectionError: 'ローカルサーバーへの接続が切れています。ページを開き直してください。' });
    }
  }, 2000);
}
export function subscribe(callback) { listeners.add(callback); if (latest) callback(latest); return () => listeners.delete(callback); }
export async function action(name, args = {}) {
  if (isEmbedded) {
    const result = await app.callServerTool({ name: ACTION_TO_TOOL[name], arguments: args });
    const value = unwrap(result);
    if (value?.workspace) await updateContext(value.workspace);
    if (value?.closed) { workspaceId = null; await app.updateModelContext({ content: [{ type: 'text', text: 'Sokomadeの相談データは破棄済みです。再開するにはopen_mapを呼んでください。' }] }); }
    return value;
  }
  const result = await browserFetch('/api/action', { method: 'POST', body: JSON.stringify({ action: name, args }) });
  publish(result);
  if (result.closed) { workspaceId = null; publish({ closed: true }); }
  return result;
}
export async function updateContext(state) {
  if (!app || !state) return;
  const place = state.places.find(p => p.id === state.selectedPlaceId);
  await app.updateModelContext({ content: [{ type: 'text', text: JSON.stringify({ plugin: 'sokomade', workspaceId: state.id, version: state.version, selectedPlaceId: state.selectedPlaceId, selectedPlaceName: place?.name, originId: state.originId, leg: state.leg, selectedRouteId: state.selectedRoutes[`${state.selectedPlaceId}:${state.leg}`] || null }) }] });
}
export async function openExternal(url) {
  if (app) return app.openLink({ url });
  window.open(url, '_blank', 'noopener,noreferrer');
}
export async function saveSettings(keys) {
  if (isEmbedded) throw new Error('APIキーはローカル設定画面で登録してください。');
  return browserFetch('/api/config', { method: 'POST', body: JSON.stringify(keys) });
}
let pendingViewport;
let viewportTimer;
let mapQueue = Promise.resolve();
const enqueue = operation => {
  const next = mapQueue.then(operation);
  mapQueue = next.catch(() => {});
  return next;
};
export function queueViewport(args) {
  if (isEmbedded) return;
  pendingViewport = args;
  clearTimeout(viewportTimer);
  viewportTimer = setTimeout(() => { flushMap().catch(error => publish({ ...latest, error: error.message })); }, 250);
}
export function flushMap() {
  clearTimeout(viewportTimer);
  const viewport = pendingViewport; pendingViewport = null;
  if (!viewport) return mapQueue;
  return enqueue(async () => {
    if (latest?.workspace?.id !== viewport.workspaceId) return;
    if ((latest.workspace.mapView.command?.id || 0) !== viewport.commandId) return;
    return action('viewport', { ...viewport, baseRevision: latest.workspace.mapView.revision });
  });
}
export async function focusMap(args) {
  if (isEmbedded) return;
  await flushMap();
  return enqueue(() => action('focus', args));
}
export function disconnect() { clearInterval(interval); clearTimeout(viewportTimer); pendingViewport = null; app?.close(); }

export async function sendMessage(args) {
  await flushMap();
  const result = await browserFetch('/api/chat', { method: 'POST', body: JSON.stringify(args) });
  publish(result);
  return result;
}
