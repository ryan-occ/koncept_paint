import { POWDERS } from './data/powders.ts';
import type { Mix } from './types.ts';

/**
 * Paint quantities for a job, from painted area and coats, using the standard coverage formula:
 *   spreading rate (m²/L) = volume solids % × 10 / dry film thickness µm
 * reduced by transfer efficiency (overspray), plus a safety buffer.
 * Defaults are typical refinish values; the paint system's TDS should replace them.
 */
export type LayerKey = 'sealer' | 'base' | 'mid' | 'candy' | 'clear';

export interface LayerSpec {
  /** dry film per coat, µm */
  dft: number;
  /** volume solids of the ready-to-spray mix, % */
  vs: number;
  /** mix ratio paint : hardener : reducer */
  ratio: [number, number, number];
}

export const LAYER_NAMES: Record<LayerKey, string> = {
  sealer: 'Sealer', base: 'Base colour', mid: 'Mid-coat binder', candy: 'Candy', clear: 'Clear coat',
};

export const DEFAULT_SPECS: Record<LayerKey, LayerSpec> = {
  sealer: { dft: 25, vs: 45, ratio: [4, 1, 1] },
  base: { dft: 12, vs: 18, ratio: [1, 0, 1] },
  mid: { dft: 8, vs: 18, ratio: [1, 0, 1] },
  candy: { dft: 8, vs: 20, ratio: [1, 0, 1] },
  clear: { dft: 25, vs: 50, ratio: [2, 1, 0.2] },
};

/** Typical exterior paintable areas (benchmarks: compact 11–15 m², sedan 16–19 m², large > 18.6 m²). */
export const VEHICLES: { id: string; label: string; area: number }[] = [
  { id: 'small', label: 'Small car / compact coupe', area: 12 },
  { id: 'mid', label: 'Mid-size car or coupe', area: 15 },
  { id: 'large', label: 'Large car / small SUV', area: 17 },
  { id: 'pickup', label: 'Pickup / large SUV', area: 20 },
  { id: 'panel', label: 'Single panel (door, bonnet)', area: 1.5 },
];

export const SCOPES: Record<string, { label: string; k: number }> = {
  ext: { label: 'Exterior only', k: 1 },
  jambs: { label: 'Exterior + door jambs', k: 1.2 },
  full: { label: 'Full (jambs, engine bay, boot)', k: 1.8 },
};

export interface JobSettings {
  /** exterior paintable area, m² */
  area: number;
  scope: keyof typeof SCOPES;
  /** extra on top of the estimate, % */
  buffer: number;
  /** transfer efficiency, % */
  te: number;
  /** base colour density, kg/L (for the toner batch in grams) */
  density: number;
  specs: Record<LayerKey, LayerSpec>;
}

export interface LayerUsage {
  key: LayerKey;
  name: string;
  coats: number;
  /** ready-to-spray litres, buffer included */
  rtsL: number;
  paintL: number;
  hardenerL: number;
  reducerL: number;
}

export interface Usage {
  /** area actually painted after scope, m² */
  area: number;
  layers: LayerUsage[];
  /** base colour (toners) to mix, grams, rounded up to 10 g */
  baseGrams: number;
  /** intercoat binder for the mid-coat, litres RTS, rounded up to 0.05 L; 0 when no mid-coat */
  midBinderL: number;
}

/** Ready-to-spray litres for one layer, before buffer. */
export function rtsLitres(area: number, coats: number, spec: LayerSpec, tePct: number): number {
  if (!(area > 0) || !(coats > 0)) return 0;
  return (area * coats * spec.dft) / (10 * spec.vs * (tePct / 100));
}

const midActive = (mix: Mix) => mix.mic > 0 && ([[mix.m1, mix.m1l], [mix.m2, mix.m2l]] as [string, number][]).some(([k, l]) => k !== 'none' && l > 0 && POWDERS[k]);

export function estimateUsage(mix: Mix, job: JobSettings): Usage {
  const area = job.area * (SCOPES[job.scope]?.k ?? 1);
  const coats: [LayerKey, number][] = [
    ['sealer', 1],
    ['base', mix.bc],
    ['mid', midActive(mix) ? mix.mic : 0],
    ['candy', mix.cc],
    ['clear', mix.clr],
  ];
  const k = 1 + Math.max(0, job.buffer) / 100;
  const layers = coats.filter(([, c]) => c > 0).map(([key, c]) => {
    const spec = job.specs[key];
    const rts = rtsLitres(area, c, spec, job.te) * k;
    const [a, b, r] = spec.ratio;
    const sum = a + b + r || 1;
    return { key, name: LAYER_NAMES[key], coats: c, rtsL: rts, paintL: (rts * a) / sum, hardenerL: (rts * b) / sum, reducerL: (rts * r) / sum };
  });
  const base = layers.find((l) => l.key === 'base');
  const mid = layers.find((l) => l.key === 'mid');
  return {
    area,
    layers,
    baseGrams: base ? Math.ceil((base.paintL * job.density * 1000) / 10) * 10 : 0,
    midBinderL: mid ? Math.ceil(mid.rtsL * 20) / 20 : 0,
  };
}
