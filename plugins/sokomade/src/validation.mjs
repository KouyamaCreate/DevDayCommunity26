import { z } from 'zod';
import { AppError } from './errors.mjs';
const workspaceId = z.string().uuid();
const bounds = z.object({ south: z.number().min(-85).max(85), north: z.number().min(-85).max(85), west: z.number().min(-180).max(180), east: z.number().min(-180).max(180) }).strict();
const point = z.object({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }).strict();
const categories = z.array(z.enum(['assault','robbery','theft'])).min(1).max(3);
export const actionSchemas = {
  open: z.object({ city: z.enum(['shibuya', 'sf']).default('shibuya') }).strict(),
  resolve: z.object({ workspaceId, query: z.string().min(1).max(2000).optional(), label: z.string().max(150).optional(), address: z.string().max(500).optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), role: z.enum(['origin', 'candidate', 'property']).default('candidate') }).strict(),
  search: z.object({ workspaceId, query: z.string().min(1).max(300), radiusMeters: z.number().int().min(100).max(10000).default(2000), scope: z.enum(['focus','viewport','origin']).default('focus'), limit: z.number().int().min(1).max(5).default(5), openNow: z.boolean().default(false), priceLevels: z.array(z.enum(['PRICE_LEVEL_FREE','PRICE_LEVEL_INEXPENSIVE','PRICE_LEVEL_MODERATE','PRICE_LEVEL_EXPENSIVE','PRICE_LEVEL_VERY_EXPENSIVE'])).max(5).optional() }).strict(),
  select: z.object({ workspaceId, placeId: z.string().uuid().optional(), role: z.enum(['origin','destination']).optional(), routeId: z.string().uuid().optional(), leg: z.enum(['out','back']).optional(), expectedVersion: z.number().int().nonnegative().optional() }).strict(),
  plan: z.object({ workspaceId, destinationIds: z.array(z.string().uuid()).min(1).max(5).optional(), maxDetourMinutes: z.number().int().min(0).max(30).optional() }).strict(),
  analyze: z.object({ workspaceId, categories: categories.optional(), radiusMeters: z.number().int().min(100).max(2000).optional(), scope: z.enum(['focus','viewport','comparison']).default('focus') }).strict(),
  viewport: z.object({ workspaceId, center: point, bounds, zoom: z.number().min(1).max(22), commandId: z.number().int().nonnegative().optional(), baseRevision: z.number().int().nonnegative().optional(), interaction: z.boolean().default(true) }).strict(),
  focus: z.object({ workspaceId, placeId: z.string().uuid().optional(), point: point.optional(), scope: z.enum(['viewport']).optional() }).strict(),
  move: z.object({ workspaceId, query: z.string().min(1).max(500).optional(), city: z.enum(['shibuya','sf']).optional(), placeId: z.string().uuid().optional(), zoom: z.number().min(1).max(20).optional() }).strict(),
  conditions: z.object({ workspaceId, maxDetourMinutes: z.number().int().min(0).max(30).optional(), maxRoundTripMinutes: z.number().int().min(1).max(480).nullable().optional(), resetRoundTripLimit: z.boolean().optional(), categories: categories.optional(), radiusMeters: z.number().int().min(100).max(2000).optional() }).strict(),
  compare: z.object({ workspaceId, pairs: z.array(z.object({ fromId: z.string().uuid(), toId: z.string().uuid(), comparisonId: z.string().uuid().optional() }).strict()).min(1).max(5) }).strict(),
  layer: z.object({ workspaceId }).strict(),
  remove: z.object({ workspaceId, placeId: z.string().uuid() }).strict(),
  clear: z.object({ workspaceId }).strict(),
};
export function validateAction(action, args) {
  const parsed = actionSchemas[action]?.safeParse(args || {});
  if (!parsed?.success) throw new AppError('INVALID_INPUT', '入力の形式・件数・範囲を確認してください。');
  return parsed.data;
}
