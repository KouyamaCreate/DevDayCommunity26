import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, publicError } from './errors.mjs';

const sameToken = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };
async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('INVALID_CONTENT_TYPE', 'JSONが必要です。');
  let size = 0, body = '';
  for await (const chunk of request) {
    size += chunk.length; if (size > 16000) throw new AppError('REQUEST_TOO_LARGE', '入力が大きすぎます。'); body += chunk;
  }
  try { return JSON.parse(body); } catch { throw new AppError('INVALID_JSON', '入力を読み取れません。'); }
}
export async function startHTTP({ service, config, sessions, port = 0, chat }) {
  const token = randomBytes(32).toString('hex');
  let baseURL;
  const server = createServer(async (request, response) => {
    const json = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      const host = request.headers.host || '';
      if (!/^127\.0\.0\.1:\d+$/.test(host)) return json(403, { error: { code: 'INVALID_HOST', message: 'ローカル接続のみ利用できます。' } });
      if (request.headers.origin && request.headers.origin !== baseURL) return json(403, { error: { code: 'INVALID_ORIGIN', message: 'このページからの操作は許可されていません。' } });
      const url = new URL(request.url, baseURL);
      if (request.method === 'GET' && url.pathname === '/') {
        const html = await readFile(new URL('../dist/ui.html', import.meta.url), 'utf8');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://tile.openstreetmap.org; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        response.end(html.replace('/*__BOOTSTRAP__*/', `window.__SOKOMADE__=${JSON.stringify({ mode: 'browser', token })};`)); return;
      }
      if (!sameToken(request.headers.authorization?.replace(/^Bearer /, ''), token)) return json(401, { error: { code: 'UNAUTHORIZED', message: 'ページを開き直してください。' } });
      if (request.method === 'GET' && url.pathname === '/api/config') return json(200, await config.status());
      if (request.method === 'POST' && url.pathname === '/api/config') return json(200, await config.save(await readBody(request)));
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const result = await service.view(url.searchParams.get('workspace'), { touch: false });
        return json(200, { ...result, ai: chat?.status(), browserKey: (await config.keys()).browser });
      }
      if (request.method === 'POST' && url.pathname === '/api/chat') {
        if (!chat) throw new AppError('AI_UNAVAILABLE', '会話機能を起動できません。');
        const body = await readBody(request);
        const { z } = await import('zod');
        const parsed = z.object({ workspaceId: z.string().uuid(), message: z.string().trim().min(1).max(3000) }).strict().safeParse(body);
        if (!parsed.success) throw new AppError('INVALID_INPUT', '相談内容は1〜3000文字で入力してください。');
        const controller = new AbortController();
        response.once('close', () => { if (!response.writableEnded) controller.abort(); });
        const result = await chat.send({ ...parsed.data, signal: controller.signal });
        return json(200, { ...result, ai: chat.status(), browserKey: (await config.keys()).browser });
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        const id = url.searchParams.get('workspace'); sessions.get(id, { touch: false });
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
        response.write(': connected\n\n');
        const unsubscribe = sessions.subscribe(id, state => response.write(`data: ${JSON.stringify(state ? { changed: true, version: state.version } : { expired: true })}\n\n`));
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20000);
        request.on('close', () => { clearInterval(heartbeat); unsubscribe(); }); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/action') {
        const { action, args } = await readBody(request);
        const allowed = new Set(['open', 'resolve', 'search', 'select', 'plan', 'analyze', 'remove', 'clear', 'viewport', 'focus', 'move', 'conditions', 'compare', 'layer']);
        if (!allowed.has(action)) throw new AppError('INVALID_ACTION', 'この操作には対応していません。');
        // Use the exact same Zod contract for HTTP and MCP, without accepting arbitrary methods.
        const { validateAction } = await import('./validation.mjs');
        const validated = validateAction(action, args);
        if (!['open', 'clear', 'viewport', 'focus', 'layer'].includes(action) && sessions.get(validated.workspaceId, { touch: false }).chatBusy) throw new AppError('CHAT_BUSY', '相談の処理中です。完了してから操作してください。');
        const result = await service[action](validated);
        return json(200, { ...result, ai: chat?.status(), browserKey: (await config.keys()).browser });
      }
      return json(404, { error: { code: 'NOT_FOUND', message: '見つかりません。' } });
    } catch (error) { return json(error.code === 'SESSION_EXPIRED' ? 410 : 400, { error: publicError(error) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  baseURL = `http://127.0.0.1:${server.address().port}`;
  return { server, baseURL, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
