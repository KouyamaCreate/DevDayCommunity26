import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { publicError } from './errors.mjs';
import { mapContext } from './chat.mjs';
import { actionSchemas } from './validation.mjs';

export const UI_URI = 'ui://sokomade/map.html';
const workspaceId = z.string().uuid().describe('open_mapで取得した、この相談のworkspaceId');
const pointRole = z.enum(['origin', 'candidate', 'property']);
const category = z.enum(['assault', 'robbery', 'theft']);

export function modelView(result) {
  if (!result.workspace) return result;
  const { workspace, ...rest } = result;
  return { ...rest, workspace: mapContext(workspace) };
}
export function createMCP({ service, config, localURL }) {
  const server = new McpServer({ name: 'sokomade', version: '0.1.0' });
  const uiPath = fileURLToPath(new URL('../dist/ui.html', import.meta.url));
  registerAppResource(server, 'sokomade-map', UI_URI, { description: '地図・徒歩経路・公開報告情報の比較。相談データはメモリ内のみ。' }, async () => ({ contents: [{
    uri: UI_URI, mimeType: RESOURCE_MIME_TYPE,
    text: (await readFile(uiPath, 'utf8')).replace('/*__BOOTSTRAP__*/', 'window.__SOKOMADE__={mode:"mcp"};'),
    _meta: { ui: { prefersBorder: false, csp: {
      connectDomains: ['https://maps.googleapis.com', 'https://*.googleapis.com', 'https://maps.gstatic.com', 'https://*.google.com', 'https://*.gstatic.com', 'https://tile.openstreetmap.org'],
      resourceDomains: ['https://maps.googleapis.com', 'https://*.googleapis.com', 'https://maps.gstatic.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://tile.openstreetmap.org'],
    } } },
  }] }));
  const tool = (name, title, description, inputSchema, handler, { appOnly = false, openWorld = true } = {}) => {
    registerAppTool(server, name, {
      title, description, inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: openWorld },
      _meta: { ui: { resourceUri: UI_URI, ...(appOnly ? { visibility: ['app'] } : {}) },
        'openai/outputTemplate': UI_URI,
        'openai/ui': { entrypoints: name === 'open_map' ? [{ type: 'thread' }] : [] },
      },
    }, async args => {
      try {
        const result = await handler(args);
        const viewURL = result.workspace ? `${localURL}/?workspace=${result.workspace.id}` : localURL;
        const keys = await config.keys();
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...modelView(result), viewURL }) }],
          structuredContent: modelView(result),
          _meta: { snapshot: result, browserKey: keys.browser, viewURL, setupURL: `${localURL}/?settings=1` },
        };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(publicError(error)) }], structuredContent: { error: publicError(error) } }; }
    });
  };
  tool('open_map', '地図を開く', '渋谷またはSFの相談用地図を開く。新しい相談の最初だけ呼ぶ。既存の相談ではget_mapを使う。ユーザーの相談データは保存されない。', { city: z.enum(['shibuya', 'sf']).default('shibuya') }, args => service.open(args), { openWorld: false });
  tool('get_map', '現在の地図と選択を確認', '会話と地図で共有する現在の地点・選択・経路・報告情報を読む。「ここ」「この物件」などの指示を解釈する前に使う。', { workspaceId }, ({ workspaceId: id }) => service.view(id), { openWorld: false });
  tool('resolve_location', '住所・物件URLを地図に追加', '指定された住所または公開物件URLを解決する。緯度経度はユーザー提供または取得済みの根拠があるときのみ渡す。複数候補ではユーザーに確認し、select_on_mapで選ぶ。', {
    workspaceId, query: z.string().min(1).max(2000).optional(), label: z.string().max(150).optional(), address: z.string().max(500).optional(),
    lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), role: pointRole.default('candidate'),
  }, args => service.resolve(args));
  tool('search_places', '近くの店・施設を探す', '注目地点・表示範囲の周辺で目的に合う店や施設を実データ検索する。出発地は不要。初版は店舗検索で、空き物件を検索する機能ではない。営業時間は取得時点の情報である。', {
    workspaceId, query: z.string().min(1).max(300), radiusMeters: z.number().int().min(100).max(10000).default(2000), limit: z.number().int().min(1).max(5).default(5), openNow: z.boolean().default(false),
    priceLevels: z.array(z.enum(['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'])).max(5).optional(),
  }, args => service.search(args));
  tool('select_on_map', '地点・行き帰り・経路を選ぶ', '取得済みIDを使って地図の選択を変更する。originを変えたら経路は再取得が必要。行きと帰りの経路選択は個別に保持する。', {
    workspaceId, placeId: z.string().uuid().optional(), role: z.enum(['origin', 'destination']).optional(), routeId: z.string().uuid().optional(), leg: z.enum(['out', 'back']).optional(), expectedVersion: z.number().int().nonnegative().optional(),
  }, args => service.select(args), { openWorld: false });
  tool('plan_walk', '往復の徒歩経路を比較', '選択中の出発地から最大5件の行き先について往復の実際の徒歩経路を取得する。条件内の別経路がない場合は1本だけ返す。報告情報を同一条件で集計し、安全性スコアや最も安全という判定はしない。', {
    workspaceId, destinationIds: z.array(z.string().uuid()).min(1).max(5).optional(), maxDetourMinutes: z.number().int().min(0).max(30).optional(),
  }, args => service.plan(args));
  tool('analyze_reports', '周辺の公開報告情報を確認', '現在の地点と経路に対して公開報告情報を取得・集計。SFは匿名化された公開位置による参考集計。渋谷は町丁目単位で沿道件数比較不可。情報不足のcountはnullであり0ではない。', {
    workspaceId, categories: z.array(category).min(1).max(3).optional(), radiusMeters: z.number().int().min(100).max(2000).optional(),
  }, args => service.analyze(args));
  tool('remove_location', '地点を比較から外す', 'この相談の地点と関連経路をメモリから削除する。', { workspaceId, placeId: z.string().uuid() }, args => service.remove(args), { openWorld: false });
  tool('close_map', '相談データを破棄', 'この相談の地点・住所・URL・比較結果をプラグインのメモリから即時破棄する。Codex自体の会話履歴を削除する機能ではない。', { workspaceId }, args => service.clear(args), { openWorld: false });
  for (const [name,action,title,description,appOnly] of [
    ['discover_places','discover','店と周辺情報を一緒に比較','カフェなどの店舗を検索し、各候補の公開報告・根拠付き提案を返して地図へ反映。出発地不要。balancedは比較可能なSFで最寄りから追加直線300m以内の候補の件数を比較。maxExtraDistanceMetersで変更可。渋谷は町丁目情報を添えて近さから提案。件数は安全順位ではない。',false],
    ['assess_locations','assess','場所・物件・経路の根拠を比較','取得済みplaceIds/routeIdsを共通形式で評価。期間・精度・出典・欠損・比較可否を返す。渋谷の町丁目件数で安全順位を付けない。',false],
    ['update_map_conditions','conditions','比較条件を変更','報告種別・集計半径・徒歩条件を変更。変更後の候補比較はassess_locationsを呼ぶ。',false],
    ['move_map','move','地図を移動','地域・住所・取得済み地点へ移動し、既存の比較候補は保持する。',false],
    ['compare_walks','compare','任意の端点の往復を比較','取得済み地点の組から向きごとの徒歩を比較する。物件から職場にも使用できる。',false],
  ]) tool(name,title,description,actionSchemas[action].shape,args=>service[action](args),{appOnly});
  return server;
}
