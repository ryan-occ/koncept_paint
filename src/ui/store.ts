import { DEFAULT_MIX, PRESETS } from '../data/presets.ts';
import { PEARLS, TONERS } from '../data/toners.ts';
import { POWDERS } from '../data/powders.ts';
import type { BoothTemp, Calibration, Mix } from '../types.ts';
import type { ShapeId } from '../render/booth.ts';
import type { LightId } from '../render/lighting-presets.ts';

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

export interface ViewState { shape: ShapeId; light: LightId; spin: 'on' | 'off'; temp: BoothTemp; hasCar?: boolean }

export const view: ViewState = { shape: 'panel', light: 'booth', spin: 'on', temp: 'warm' };
export const mix: Mix = { ...structuredClone(PRESETS[0]) };
export const cal: Calibration = { t: {}, checks: [], ...storage.get<Partial<Calibration>>('pbs-cal', {}) };
export const saveCal = () => storage.set('pbs-cal', cal);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isHexColour = (value: unknown): value is string =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);

/** Return a fresh calibration only when every imported value is safe to render and use. */
export function parseCalibrationBackup(value: unknown): Calibration | null {
  if (!isRecord(value) || !isRecord(value.t) || !Array.isArray(value.checks)) return null;

  const tonerIds = new Set(TONERS.map((toner) => toner.id));
  const t: Calibration['t'] = {};
  for (const [id, raw] of Object.entries(value.t)) {
    if (!tonerIds.has(id) || !isRecord(raw)) return null;
    const entry: Calibration['t'][string] = {};
    if (raw.hex !== undefined) {
      if (!isHexColour(raw.hex)) return null;
      entry.hex = raw.hex;
    }
    if (raw.str !== undefined) {
      if (!Array.isArray(raw.str) || raw.str.length !== 3 ||
        !raw.str.every((strength) => typeof strength === 'number' && Number.isFinite(strength) && strength >= 0.05 && strength <= 20)) {
        return null;
      }
      entry.str = [...raw.str] as number[];
    }
    if (entry.hex === undefined && entry.str === undefined) return null;
    t[id] = entry;
  }

  const checks: Calibration['checks'] = [];
  for (const raw of value.checks) {
    if (!isRecord(raw) || typeof raw.n !== 'string' || !raw.n.trim() ||
      !isHexColour(raw.p) || !isHexColour(raw.m) ||
      typeof raw.de !== 'number' || !Number.isFinite(raw.de) || raw.de < 0) {
      return null;
    }
    checks.push({ n: raw.n, p: raw.p, m: raw.m, de: raw.de });
  }

  return { t, checks };
}

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
