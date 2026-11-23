import { TONERS } from '../data/toners.ts';
import { POWDERS } from '../data/powders.ts';
import { DEFAULT_MIX } from '../data/presets.ts';
import type { Calibration, GroundId, Mix, RGB } from '../types.ts';
import { colourAtViewAngle, finalColour, EMPTY_CAL, type ViewAngle } from './mixing.ts';
import { deltaE, hexToLinear, linearToHex, toLab } from './space.ts';

/**
 * Inverse colour matching: find a small set of toners and their parts so that the whole
 * paint system (ground, base, effect layers, candy) lands as close as possible to a target.
 */

export type Finish = 'solid' | 'metallic' | 'pearl' | 'candy' | 'matte' | 'satin';

export interface MatchResult {
  mix: Mix;
  /** ΔE2000 between target and predicted flat colour, after rounding parts */
  de: number;
  predicted: string;
  target: string;
  /** true when the target is outside what these toners can reach */
  outOfGamut: boolean;
  angleAnalysis?: AngleMatchAnalysis;
}

export interface AngleObservation {
  label: string;
  angle: ViewAngle;
  hex: string;
}

export interface AngleMatchAnalysis {
  views: { label: string; angle: ViewAngle; target: string; predicted: string; de: number }[];
  meanDe: number;
  observedShift: number;
  predictedShift: number;
  effectFit: 'stable' | 'explains' | 'partial' | 'unexplained';
}

const HUES: [string, number][] = [['red', 25], ['orange', 55], ['gold', 80], ['green', 150], ['turq', 200], ['blue', 265], ['violet', 300], ['magenta', 345]];
const hueOf = (rgb: readonly number[]) => {
  const [, a, b] = toLab(rgb);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};
const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const nearestHue = (h: number) => HUES.reduce((best, x) => (hueDist(h, x[1]) < hueDist(h, best[1]) ? x : best))[0];

/** Effect-layer settings for a finish, chosen from the target's lightness and hue. */
export function layersFor(finish: Finish, target: RGB): Partial<Mix> {
  const [L, a, b] = toLab(target);
  const chroma = Math.hypot(a, b), hue = nearestHue(hueOf(target));
  const g: GroundId = L < 35 ? 'black' : L > 75 ? 'white' : 'grey';
  const base: Partial<Mix> = { ...DEFAULT_MIX, g, bc: 2, clr: 2, fin: 'gloss', peel: 20 };
  switch (finish) {
    case 'metallic':
      return { ...base, fl: L > 70 ? 80 : 60, fs: L > 70 ? 'fine' : 'medium' };
    case 'pearl': {
      if (L > 75) return { ...base, p: 'white', pa: 60 };
      if (chroma < 8) return { ...base, m1: 'col_white', m1l: 12, mic: 2, mv: 1 };
      // Dark pearls (black cherry, midnight purple): a ghost pearl over a dark base, like the real thing.
      // Mid-tone pearls: a coloured mica matched to the hue.
      const ghost: Record<string, string> = { red: 'int_red', magenta: 'int_red', orange: 'int_copper', gold: 'int_gold', green: 'int_green', turq: 'int_blue', blue: 'int_blue', violet: 'int_violet' };
      const mica: Record<string, string> = { red: 'col_red', magenta: 'col_red', orange: 'col_gold', gold: 'col_gold', green: 'int_green', turq: 'col_turq', blue: 'int_blue', violet: 'int_violet' };
      return { ...base, m1: (L < 35 ? ghost : mica)[hue], m1l: L < 35 ? 20 : 15, mic: 2, mv: 1 };
    }
    case 'candy':
      return { ...base, g: 'grey', fl: 85, fs: 'fine', cc: 3, clr: 3, peel: 15 };
    case 'matte':
      return { ...base, fin: 'matte', peel: 0 };
    case 'satin':
      return { ...base, fin: 'satin', peel: 10 };
    default:
      return base;
  }
}

/** ΔE to target, plus a steep penalty when the base would not hide the ground (no cheating with show-through). */
const err = (mix: Mix, target: RGB, cal: Calibration) => {
  const f = finalColour(mix, cal);
  return deltaE(f.rgb, target) + (f.cov < 0.95 ? (0.95 - f.cov) * 200 : 0);
};

function angleError(mix: Mix, views: readonly AngleObservation[], cal: Calibration) {
  const coverage = finalColour(mix, cal).cov;
  const coveragePenalty = coverage < 0.95 ? (0.95 - coverage) * 200 : 0;
  return views.reduce((sum, view) =>
    sum + deltaE(colourAtViewAngle(mix, view.angle, cal), hexToLinear(view.hex)) + coveragePenalty,
  0) / views.length;
}

/** Coordinate descent on log-weights for a fixed toner set. */
function optimise(ids: string[], layers: Mix, target: RGB, cal: Calibration, views?: readonly AngleObservation[]): [number[], number] {
  const evalW = (ww: number[]) => {
    const candidate = { ...layers, t: Object.fromEntries(ids.map((id, i) => [id, ww[i]])) };
    return views?.length ? angleError(candidate, views, cal) : err(candidate, target, cal);
  };
  // Start from equal parts, or from each toner dominant, whichever is closest.
  const starts = [ids.map(() => 1), ...(ids.length > 1 ? ids.map((_, j) => ids.map((__, i) => (i === j ? 20 : 1))) : [])];
  let w = starts[0], best = evalW(w);
  for (const s of starts.slice(1)) { const e = evalW(s); if (e < best) { best = e; w = s; } }
  for (const step of [2, 1, 0.5, 0.25, 0.1, 0.04]) {
    let improved = true, guard = 0;
    while (improved && guard++ < 40) {
      improved = false;
      for (let i = 0; i < ids.length; i++) {
        for (const dir of [1, -1]) {
          const cand = w.slice();
          cand[i] *= Math.exp(dir * step);
          const e = evalW(cand);
          if (e < best - 1e-4) { best = e; w = cand; improved = true; }
        }
      }
    }
  }
  return [w, best];
}

function subsets<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...subsets(rest, k - 1).map((s) => [first, ...s]), ...subsets(rest, k)];
}

/** Percentages to two decimals, dropping only true traces (< 0.02 %): small tinters matter. */
function toParts(ids: string[], w: number[]): Record<string, number> {
  const tot = w.reduce((a, b) => a + b, 0);
  const kept = ids.map((id, i) => [id, (w[i] / tot) * 100] as const).filter(([, p]) => p >= 0.02);
  const keptTot = kept.reduce((a, [, p]) => a + p, 0);
  return Object.fromEntries(kept.map(([id, p]) => [id, Math.round((p / keptTot) * 10000) / 100]));
}

/**
 * Best paint system for a target colour and finish. Prefers fewer toners: a larger set is only
 * used when it beats the smaller one by more than 0.5 ΔE.
 */
export function matchColour(targetHex: string, finish: Finish, name: string, cal: Calibration = EMPTY_CAL): MatchResult {
  const target = hexToLinear(targetHex);
  const layers = { ...DEFAULT_MIX, ...layersFor(finish, target), n: name, t: {} } as Mix;

  // Candy: the base is a fixed silver; solve the candy tint directly (final = base · tint^(coats/3)).
  if (finish === 'candy') {
    const mix: Mix = { ...layers, t: { white: 10, black: 0.2 }, cd: '#ffffff' };
    const base = finalColour({ ...mix, cc: 0 }, cal).rgb;
    const tint = target.map((c, i) => Math.min(1, Math.max(0.001, c / Math.max(base[i], 1e-3)) ** (3 / mix.cc))) as RGB;
    mix.cd = linearToHex(tint);
    const pred = finalColour(mix, cal).rgb, de = deltaE(pred, target);
    return { mix, de, predicted: linearToHex(pred), target: targetHex, outOfGamut: de > 4 };
  }

  // Bright, low-hiding colours (reds, yellows) need more base coats: try 2, then 3 and 4.
  let result: MatchResult | null = null;
  for (const bc of [2, 3, 4]) {
    const r = solveToners({ ...layers, bc }, target, targetHex, cal);
    if (!result || r.de < result.de - 0.3) result = r;
    if (finalColour(r.mix, cal).cov >= 0.95 && r.de < 2) break;
  }
  return result!;
}

/** Solve a formula against each separately sampled view using the approximate effect-angle model. */
export function matchColourAcrossAngles(
  targetHex: string,
  finish: Finish,
  name: string,
  views: readonly AngleObservation[],
  cal: Calibration = EMPTY_CAL,
): MatchResult {
  if (!views.length) throw new RangeError('At least one angle sample is required.');
  let base: MatchResult;
  if (finish === 'candy') {
    base = matchColour(targetHex, finish, name, cal);
  } else {
    const target = hexToLinear(targetHex);
    const layers = { ...DEFAULT_MIX, ...layersFor(finish, target), n: name, t: {} } as Mix;
    let best: MatchResult | null = null;
    for (const bc of [2, 3, 4]) {
      const candidate = solveToners({ ...layers, bc }, target, targetHex, cal, views);
      if (!best || candidate.de < best.de - 0.3) best = candidate;
      if (candidate.de < 2 && finalColour(candidate.mix, cal).cov >= 0.95) break;
    }
    base = best!;
  }
  return withAngleAnalysis(base, views, cal);
}

function maxPairwiseShift(hexes: readonly string[]) {
  let max = 0;
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      max = Math.max(max, deltaE(hexToLinear(hexes[i]), hexToLinear(hexes[j])));
    }
  }
  return max;
}

function withAngleAnalysis(result: MatchResult, views: readonly AngleObservation[], cal: Calibration): MatchResult {
  const scoredViews = views.map((view) => {
    const predicted = linearToHex(colourAtViewAngle(result.mix, view.angle, cal));
    return {
      label: view.label,
      angle: view.angle,
      target: view.hex,
      predicted,
      de: deltaE(hexToLinear(predicted), hexToLinear(view.hex)),
    };
  });
  const meanDe = scoredViews.reduce((sum, view) => sum + view.de, 0) / scoredViews.length;
  const observedShift = maxPairwiseShift(scoredViews.map((view) => view.target));
  const predictedShift = maxPairwiseShift(scoredViews.map((view) => view.predicted));
  const shiftGap = Math.abs(observedShift - predictedShift);
  const hasAngleEffects = result.mix.fl > 0 ||
    (result.mix.p !== 'none' && result.mix.pa > 0) ||
    (result.mix.mic > 0 && (result.mix.m1 !== 'none' || result.mix.m2 !== 'none'));
  const effectFit: AngleMatchAnalysis['effectFit'] =
    observedShift < 3 && meanDe <= 4.5 ? 'stable'
      : !hasAngleEffects ? 'unexplained'
        : meanDe <= 5 && shiftGap <= 4 ? 'explains'
          : meanDe <= 8 && shiftGap <= 8 ? 'partial'
            : 'unexplained';
  return {
    ...result,
    predicted: linearToHex(finalColour(result.mix, cal).rgb),
    de: meanDe,
    outOfGamut: meanDe > 4,
    angleAnalysis: { views: scoredViews, meanDe, observedShift, predictedShift, effectFit },
  };
}

function solveToners(
  layers: Mix,
  target: RGB,
  targetHex: string,
  cal: Calibration,
  views?: readonly AngleObservation[],
): MatchResult {
  const ids = TONERS.map((x) => x.id);
  type Cand = { set: string[]; w: number[]; e: number };
  let best: Cand | null = null as Cand | null;
  for (const k of [1, 2, 3]) {
    let bestK: Cand | null = null as Cand | null;
    for (const set of subsets(ids, k)) {
      const [w, e] = optimise(set, layers, target, cal, views);
      if (!bestK || e < bestK.e) bestK = { set, w, e };
    }
    if (!best || bestK!.e < best.e - 0.5) best = bestK;
    if (best!.e < 1) break;
  }
  // Try one more toner on top of the best three when still off.
  if (best!.e >= 1 && best!.set.length === 3) {
    for (const extra of ids.filter((id) => !best!.set.includes(id))) {
      const set = [...best!.set, extra];
      const [w, e] = optimise(set, layers, target, cal, views);
      if (e < best!.e - 0.5) best = { set, w, e };
    }
  }

  const mix: Mix = { ...layers, t: toParts(best!.set, best!.w) };
  const pred = finalColour(mix, cal).rgb;
  const de = views?.length
    ? views.reduce((sum, view) => sum + deltaE(colourAtViewAngle(mix, view.angle, cal), hexToLinear(view.hex)), 0) / views.length
    : deltaE(pred, target);
  return { mix, de, predicted: linearToHex(pred), target: targetHex, outOfGamut: de > 4 };
}

/** Labels for the powder a pearl finish picked, for display. */
export const powderLabel = (id: string) => POWDERS[id]?.label ?? id;
