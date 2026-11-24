import { POWDERS } from '../data/powders.ts';
import type { Calibration, Mix, RGB } from '../types.ts';
import { EMPTY_CAL, finalColour, midFactor } from './mixing.ts';
import { deltaE2000, hexToLinear, linearToHex, toLab } from './space.ts';

/**
 * Colour travel: how the finish looks at the standard multi-angle measuring geometries
 * (degrees from the specular reflection, as used by multi-angle spectrophotometers).
 * 15° is the near-highlight, 45° the face, 110° the flop. Simulated from the paint system:
 * estimates for a colour spec, to be confirmed by measuring a sprayed panel.
 */
export const ANGLES = [15, 25, 45, 75, 110] as const;

/** −1 … 1: near-specular highlight (positive) to deep flop (negative). */
const HL = [1, 0.6, 0, -0.5, -0.8];
const FACE_W = [0.5, 0.35, 0.15, 0.05, 0];
const FLOP_W = [0, 0.05, 0.15, 0.35, 0.5];
const PEARL_COLOUR: Record<string, string> = { white: '#e8e8ea', gold: '#d9a43a', blue: '#3d7bf5' };

export interface TravelPoint { angle: number; rgb: RGB; hex: string; lab: RGB }
export type TravelSource = 'measured' | 'simulated';
export interface TravelSpecification {
  source: TravelSource;
  savedAt?: string;
  points: TravelPoint[];
  summary: { text: string; de: number; effect: boolean };
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Validate five CIELAB readings in the standard 15°, 25°, 45°, 75°, 110° order. */
export function parseMeasuredReadings(value: unknown): RGB[] | null {
  if (!Array.isArray(value) || value.length !== ANGLES.length) return null;
  const readings: RGB[] = [];
  for (const raw of value) {
    if (!Array.isArray(raw) || raw.length !== 3 ||
      !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [L, a, b] = raw as number[];
    if (L < 0 || L > 100 || a < -128 || a > 127 || b < -128 || b > 127) return null;
    readings.push([L, a, b]);
  }
  return readings;
}

/** Convert D65 CIELAB to linear sRGB for an approximate screen/print swatch. */
export function labToLinear([L, a, b]: readonly number[]): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const finv = (t: number) => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
  const X = 0.95047 * finv(fx), Y = finv(fy), Z = 1.08883 * finv(fz);
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
}

/** Build measured points while preserving the instrument's Lab values exactly. */
export function measuredTravel(readings: readonly RGB[]): TravelPoint[] | null {
  const valid = parseMeasuredReadings(readings);
  if (!valid) return null;
  return ANGLES.map((angle, i) => {
    const lab = valid[i];
    const rgb = labToLinear(lab);
    return { angle, rgb, hex: linearToHex(rgb), lab };
  });
}

export function colourTravel(mix: Mix, cal: Calibration = EMPTY_CAL): TravelPoint[] {
  const base = finalColour(mix, cal).rgb;
  const powders = ([[mix.m1, mix.m1l, 'face'], [mix.m2, mix.m2l, 'flop']] as [string, number, string][])
    .filter(([k, l]) => k !== 'none' && l > 0 && POWDERS[k] && mix.mic > 0)
    .map(([k, l, role]) => ({ p: POWDERS[k], f: midFactor(l, mix.mic), role }));

  // Metallic travel: flake (and metallic powders) make the highlight bright and the flop dark.
  let metal = mix.fl / 100;
  for (const { p, f } of powders) {
    if (p.kind === 'alu') metal += f * 0.5;
    else if (p.kind === 'diff' || p.kind === 'holo') metal += f * 0.6;
    else if (p.kind === 'spark') metal += f * 0.3;
    else if (p.kind === 'col') metal += f * 0.15;
  }
  metal = Math.min(1, metal);

  return ANGLES.map((angle, i) => {
    const hl = HL[i];
    let rgb = base.map((c) => c * (1 + metal * (hl > 0 ? 0.9 * hl : 0.6 * hl))) as RGB;
    // Pearl in the base: coloured highlight.
    if (mix.p !== 'none' && mix.pa > 0 && PEARL_COLOUR[mix.p]) {
      const c = hexToLinear(PEARL_COLOUR[mix.p]), w = (mix.pa / 100) * 0.6 * FACE_W[i];
      rgb = rgb.map((v, j) => v + c[j] * w) as RGB;
    }
    // Mid-coat powders: face powder near the highlight, flop powder towards the flop.
    for (const { p, f, role } of powders) {
      if (p.kind !== 'int' && p.kind !== 'col') continue;
      const c = hexToLinear(p.colour), w = f * (role === 'face' ? FACE_W[i] * 0.6 : FLOP_W[i] * 0.5);
      rgb = rgb.map((v, j) => v + c[j] * w) as RGB;
    }
    // Candy: longer light path at the flop deepens the colour.
    if (mix.cc > 0 && hl < 0) rgb = rgb.map((v) => v ** (1 + 0.3 * -hl)) as RGB;
    rgb = rgb.map(clamp) as RGB;
    return { angle, rgb, hex: linearToHex(rgb), lab: toLab(rgb) };
  });
}

/** CIELAB hue-angle bands (h° = atan2(b*, a*)), upper limits. */
const HUE_NAMES: [number, string][] = [[12, 'magenta-red'], [48, 'red'], [70, 'orange'], [100, 'yellow'], [135, 'yellow-green'], [175, 'green'], [230, 'teal'], [285, 'blue'], [320, 'violet'], [350, 'magenta'], [360, 'magenta-red']];

/** Plain colour description from Lab, e.g. "dark violet", "light grey". */
export function describe([L, a, b]: readonly number[]): string {
  const C = Math.hypot(a, b);
  if (C < 6) return L < 18 ? 'black' : L < 40 ? 'dark grey' : L < 65 ? 'grey' : L < 88 ? 'light grey' : 'white';
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  const hue = HUE_NAMES.find(([lim]) => h < lim)![1];
  return `${L < 30 ? 'dark ' : L > 72 ? 'light ' : ''}${C < 15 ? 'muted ' : ''}${hue}`;
}

/** One-line summary of the shift, for the recipe card, print sheet and licensing notes. */
export function travelSummary(points: TravelPoint[]): { text: string; de: number; effect: boolean } {
  const hi = points[0], face = points[2], flop = points[points.length - 1];
  const de = deltaE2000(hi.lab, flop.lab);
  const effect = de >= 5;
  const text = effect
    ? `Shifts from ${hi.hex.toUpperCase()} (${describe(hi.lab)}, highlight 15°) through ${face.hex.toUpperCase()} (${describe(face.lab)}, face 45°) to ${flop.hex.toUpperCase()} (${describe(flop.lab)}, flop 110°). Travel ΔE ${de.toFixed(1)}.`
    : `Solid colour ${face.hex.toUpperCase()} (${describe(face.lab)}): little change with angle (ΔE ${de.toFixed(1)} from 15° to 110°).`;
  return { text, de, effect };
}
