import { DEFAULT_MIX, PRESETS } from '../data/presets.ts';
import { PEARLS, TONERS } from '../data/toners.ts';
import { POWDERS } from '../data/powders.ts';
import type { BoothTemp, Calibration, Mix } from '../types.ts';
import type { ShapeId } from '../render/booth.ts';
import type { LightId } from '../render/lighting.ts';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Browser storage can be missing or throw; never let it break the app. */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

export interface ViewState { shape: ShapeId; light: LightId; spin: 'on' | 'off'; temp: BoothTemp }

export const view: ViewState = { shape: 'panel', light: 'booth', spin: 'on', temp: 'warm' };
export const mix: Mix = { ...structuredClone(PRESETS[0]) };
export const cal: Calibration = { t: {}, checks: [], ...storage.get<Partial<Calibration>>('pbs-cal', {}) };
export const saveCal = () => storage.set('pbs-cal', cal);

/** Load a preset or saved mix, filling fields older saves may lack. */
export function loadMix(p: Mix) {
  Object.assign(mix, DEFAULT_MIX, structuredClone(p));
  mix.t = Object.fromEntries(TONERS.map((x) => [x.id, p.t[x.id] || 0]));
  if (!PEARLS[mix.p]) mix.p = 'none';
  if (!POWDERS[mix.m1]) mix.m1 = 'none';
  if (!POWDERS[mix.m2]) mix.m2 = 'none';
}

type Listener = () => void;
const listeners: Listener[] = [];
export const onChange = (f: Listener) => listeners.push(f);
export const changed = () => listeners.forEach((f) => f());
