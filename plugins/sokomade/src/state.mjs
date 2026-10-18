import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';
import { defaultConditions } from './conditions.mjs';
import { CITIES, boundsAround } from './spatial.mjs';

export class Sessions {
  constructor({ now = Date.now, ttlMs = 60 * 60 * 1000 } = {}) {
    this.now = now; this.ttlMs = ttlMs; this.items = new Map(); this.listeners = new Map();
    this.timer = setInterval(() => this.sweep(), 60000); this.timer.unref();
  }
  create(city) {
    if (!CITIES[city]) throw new AppError('INVALID_CITY', '渋谷またはSFを選んでください。');
    this.sweep();
    const id = randomUUID();
    const state = { id, city, version: 0, createdAt: this.now(), touchedAt: this.now(), places: [], originId: null, selectedPlaceId: null, leg: 'out', routes: [], selectedRoutes: {}, report: null, notices: [], busy: false, contextGeneration: 0, operationGeneration: 0, layerGeneration: 0, mapView: { center: { ...CITIES[city].center }, zoom: 14, bounds: boundsAround(CITIES[city].center), revision: 0, command: null }, focus: { type: 'viewport' }, comparisonIds: [], searchResultIds: [], routePairs: [], activePairId: null, conditions: defaultConditions(), reportLayer: null, chatMessages: [], chatBusy: false, chatStatus: '', aiHistory: [], chatController: null };
    this.items.set(id, state); return state;
  }
  get(id, { touch = true } = {}) {
    const state = this.items.get(id);
    if (!state || this.now() - state.touchedAt >= this.ttlMs) {
      this.delete(id); throw new AppError('SESSION_EXPIRED', '相談データは破棄されました。新しい地図を開いてください。');
    }
    if (touch) state.touchedAt = this.now();
    return state;
  }
  update(id, fn) {
    const state = this.get(id); fn(state); state.version++;
    for (const listener of this.listeners.get(id) || []) listener(state);
    return state;
  }
  snapshot(id, options) {
    const { contextGeneration, operationGeneration, layerGeneration, aiHistory, chatController, ...state } = this.get(id, options);
    return structuredClone(state);
  }
  subscribe(id, callback) {
    this.get(id);
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    this.listeners.get(id).add(callback);
    return () => this.listeners.get(id)?.delete(callback);
  }
  delete(id) {
    this.items.get(id)?.chatController?.abort();
    this.items.delete(id);
    for (const listener of this.listeners.get(id) || []) listener(null);
    this.listeners.delete(id);
  }
  sweep() { for (const [id, state] of this.items) if (this.now() - state.touchedAt >= this.ttlMs) this.delete(id); }
  close() { clearInterval(this.timer); for (const id of this.items.keys()) this.delete(id); }
}
