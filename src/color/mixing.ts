import { GROUNDS, TONERS } from '../data/toners.ts';
import { POWDERS } from '../data/powders.ts';
import type { Calibration, Mix, RGB, Toner } from '../types.ts';
import { hexToLinear } from './space.ts';

/** Kubelka-Munk: reflectance <-> K/S. */
export const reflToKS = (R: number): number => {
  const r = Math.min(0.998, Math.max(0.002, R));
  return (1 - r) ** 2 / (2 * r);
};
export const ksToRefl = (k: number): number => 1 + k - Math.sqrt(k * k + 2 * k);

export const EMPTY_CAL: Calibration = { t: {}, checks: [] };

export const tonerHex = (x: Toner, cal: Calibration): string => cal.t[x.id]?.hex ?? x.hex;
export const tonerStrength = (x: Toner, cal: Calibration): number[] => cal.t[x.id]?.str ?? [1, 1, 1];

export interface MixResult {
  /** total parts */
  tot: number;
  /** hiding per coat, 0..1 */
  hide: number;
  /** linear sRGB reflectance of the full-hide mix */
  rgb: RGB;
}

/**
 * Two-constant Kubelka-Munk mix per RGB channel.
 * Each toner contributes absorption K = S·(K/S) and scattering S, weighted by parts and
 * any calibrated tint strength.
 */
export function mixToners(parts: Record<string, number>, cal: Calibration = EMPTY_CAL, toners: Toner[] = TONERS): MixResult {
  let tot = 0, hide = 0;
  const K = [0, 0, 0], S = [0, 0, 0];
  for (const x of toners) {
    const w = parts[x.id];
    if (!(w > 0)) continue;
    tot += w;
    hide += x.h * w;
    const st = tonerStrength(x, cal);
    hexToLinear(tonerHex(x, cal)).forEach((R, i) => {
      const sc = w * st[i] * x.s;
      S[i] += sc;
      K[i] += sc * reflToKS(R);
    });
  }
  if (!tot) return { tot: 0, hide: 0, rgb: [0, 0, 0] };
  return { tot, hide: hide / tot, rgb: K.map((k, i) => ksToRefl(k / S[i])) as RGB };
}

/** Strength of a mid-coat powder layer, 0..1, from load (g/L) and number of coats. */
export const midFactor = (load: number, coats: number): number => 1 - Math.exp((-load * coats) / 45);

export interface FinalColour {
  m: MixResult;
  /** fraction of the ground hidden by the base coats */
  cov: number;
  /** flat colour of the whole system, linear sRGB */
  rgb: RGB;
}

export type ViewAngle = 'face' | 'mid' | 'grazing';

/** Flat colour of the paint system: ground → base coats → mid-coat → candy. */
export function finalColour(mix: Mix, cal: Calibration = EMPTY_CAL): FinalColour {
  const m = mixToners(mix.t, cal);
  const g = hexToLinear(GROUNDS[mix.g][1]);
  const cov = m.tot ? 1 - (1 - m.hide) ** mix.bc : 0;
  let rgb = g.map((c, i) => c * (1 - cov) + m.rgb[i] * cov) as RGB;

  ([[mix.m1, mix.m1l], [mix.m2, mix.m2l]] as [string, number][]).forEach(([k, load]) => {
    const P = POWDERS[k];
    const f = midFactor(load, mix.mic);
    if (!P || k === 'none' || !f) return;
    const col = hexToLinear(P.colour);
    if (P.kind === 'int') rgb = rgb.map((c, i) => c * (1 - f * 0.5 * col[i])) as RGB; // transmits the complement
    else if (P.kind === 'col' || P.kind === 'spark') rgb = rgb.map((c, i) => c + (col[i] - c) * f * (P.kind === 'col' ? 0.6 : 0.2)) as RGB;
    else if (P.kind !== 'glass') rgb = rgb.map((c) => c + (0.55 - c) * f * (P.kind === 'alu' ? 0.5 : 0.4)) as RGB;
  });

  if (mix.cc > 0) {
    const t = hexToLinear(mix.cd);
    rgb = rgb.map((c, i) => c * Math.max(t[i], 0.001) ** (mix.cc / 3)) as RGB;
  }
  return { m, cov, rgb };
}

/**
 * Approximate the paint's angle-dependent appearance from its effect materials.
 * This is a comparison model for photo matching, not a spectral or OEM paint simulation.
 */
export function colourAtViewAngle(mix: Mix, angle: ViewAngle, cal: Calibration = EMPTY_CAL): RGB {
  const viewFactor: Record<ViewAngle, number> = { face: 0, mid: 0.55, grazing: 1 };
  const factor = viewFactor[angle];
  let rgb = finalColour(mix, cal).rgb.slice() as RGB;
  if (factor === 0) return rgb;

  const blend = (tint: RGB, amount: number) => {
    const f = Math.max(0, Math.min(0.4, amount));
    rgb = rgb.map((channel, i) => channel + (tint[i] - channel) * f) as RGB;
  };
  const silver = hexToLinear('#cfd3d8');
  blend(silver, (mix.fl / 100) * 0.18 * factor);

  const pearlTint: Record<string, string> = {
    white: '#e8e8ea',
    gold: '#e8c45d',
    blue: '#658bd8',
  };
  if (mix.p !== 'none') {
    blend(hexToLinear(pearlTint[mix.p]), (mix.pa / 100) * 0.12 * factor);
  }

  for (const [id, load, isFlop] of [
    [mix.m1, mix.m1l, false],
    [mix.m2, mix.m2l, true],
  ] as [string, number, boolean][]) {
    const powder = POWDERS[id];
    if (!powder || id === 'none') continue;
    const strength = midFactor(load, mix.mic);
    const kindWeight: Record<string, number> = {
      int: 0.3,
      col: isFlop ? 0.32 : 0.22,
      spark: 0.16,
      diff: 0.2,
      holo: 0.22,
      alu: 0.16,
      glass: 0.1,
    };
    blend(hexToLinear(powder.colour), strength * (kindWeight[powder.kind] ?? 0) * factor);
  }
  return rgb;
}
