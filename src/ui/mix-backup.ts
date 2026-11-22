import { GROUNDS, PEARLS, TONERS } from '../data/toners.ts';
import { POWDERS } from '../data/powders.ts';
import type { Mix } from '../types.ts';

const FORMAT = 'koncept-paint-mixes';
const VERSION = 1;
const tonerIds = new Set(TONERS.map((toner) => toner.id));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function isMix(value: unknown): value is Mix {
  if (!isRecord(value) || typeof value.n !== 'string' || !value.n.trim()) return false;
  if (!isRecord(value.t) || !Object.keys(value.t).every((id) => tonerIds.has(id))) return false;
  if (!Object.values(value.t).every((parts) => inRange(parts, 0, 1_000_000))) return false;

  return Object.hasOwn(GROUNDS, String(value.g))
    && inRange(value.bc, 1, 5)
    && inRange(value.fl, 0, 100)
    && ['fine', 'medium', 'coarse'].includes(String(value.fs))
    && Object.hasOwn(PEARLS, String(value.p))
    && inRange(value.pa, 0, 100)
    && typeof value.cd === 'string'
    && /^#[\da-f]{6}$/i.test(value.cd)
    && inRange(value.cc, 0, 6)
    && inRange(value.clr, 0, 4)
    && ['gloss', 'satin', 'matte'].includes(String(value.fin))
    && inRange(value.peel, 0, 100)
    && Object.hasOwn(POWDERS, String(value.m1))
    && inRange(value.m1l, 0, 60)
    && Object.hasOwn(POWDERS, String(value.m2))
    && inRange(value.m2l, 0, 60)
    && inRange(value.mic, 0, 5)
    && inRange(value.mv, 0.25, 3)
    && (value.hex === undefined || (typeof value.hex === 'string' && /^#[\da-f]{6}$/i.test(value.hex)));
}

export function serializeMixBackup(mixes: Mix[]): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, mixes }, null, 2);
}

export function parseMixBackup(text: string): Mix[] {
  let backup: unknown;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }

  if (!isRecord(backup) || backup.format !== FORMAT || backup.version !== VERSION || !Array.isArray(backup.mixes)) {
    throw new Error('This is not a supported paint mix backup.');
  }
  if (!backup.mixes.every(isMix)) {
    throw new Error('The backup contains an invalid mix. No saved mixes were changed.');
  }
  const names = backup.mixes.map((mix) => (mix as Mix).n);
  if (new Set(names).size !== names.length) {
    throw new Error('The backup contains duplicate mix names. No saved mixes were changed.');
  }

  return structuredClone(backup.mixes) as Mix[];
}

/** Merge by name: imported recipes update matching entries and add new ones. */
export function mergeMixes(current: Mix[], imported: Mix[]): Mix[] {
  const merged = structuredClone(current);
  for (const mix of imported) {
    const existing = merged.findIndex((item) => item.n === mix.n);
    if (existing < 0) merged.push(structuredClone(mix));
    else merged[existing] = structuredClone(mix);
  }
  return merged;
}
