import type { Calibration, RGB, Toner } from '../types.ts';
import { reflToKS, tonerHex, tonerStrength } from './mixing.ts';
import { deltaE, hexToLinear, srgbToLinear } from './space.ts';

/** ColorChecker Classic reference patches (manufacturer sRGB values). */
export const REF_PATCHES: [id: string, label: string, hex: string][] = [
  ['white', 'White 9.5', '#f3f3f2'],
  ['grey', 'Neutral 5', '#7a7a79'],
  ['black', 'Black 2', '#343434'],
  ['red', 'Red', '#af363c'],
  ['green', 'Green', '#469449'],
  ['blue', 'Blue', '#383d96'],
];

/** Gaussian elimination with partial pivoting. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    [M[i], M[p]] = [M[p], M[i]];
    for (let j = i + 1; j < n; j++) {
      const f = M[j][i] / (M[i][i] || 1e-12);
      for (let k = i; k <= n; k++) M[j][k] -= f * M[i][k];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / (M[i][i] || 1e-12);
  }
  return x;
}

export interface Correction {
  /** number of chart patches used */
  n: number;
  /** maps camera linear RGB to corrected linear RGB */
  apply: (m: readonly number[]) => RGB;
  /** mean ΔE2000 of corrected chart patches against reference */
  fitError: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Fit a camera correction from picked chart patches (sRGB 0..255 averages).
 * All six patches → affine 3×4 least squares; two or three neutrals → per-channel gain/offset.
 */
export function fitCorrection(picks: Record<string, readonly number[]>): Correction | null {
  const pts = REF_PATCHES.filter(([k]) => picks[k]).map(([k, , h]) => [picks[k].map((v) => srgbToLinear(v / 255)), hexToLinear(h)] as const);
  let apply: Correction['apply'];
  let n: number;
  if (pts.length === 6) {
    const C = [0, 1, 2].map((c) => {
      const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
      const y = [0, 0, 0, 0];
      for (const [m, r] of pts) {
        const f = [...m, 1];
        for (let i = 0; i < 4; i++) {
          y[i] += f[i] * r[c];
          for (let j = 0; j < 4; j++) A[i][j] += f[i] * f[j];
        }
      }
      for (let i = 0; i < 4; i++) A[i][i] += 1e-6;
      return solveLinear(A, y);
    });
    apply = (m) => C.map((k) => clamp01(k[0] * m[0] + k[1] * m[1] + k[2] * m[2] + k[3])) as RGB;
    n = 6;
  } else {
    const neutrals = REF_PATCHES.slice(0, 3)
      .filter(([k]) => picks[k])
      .map(([k, , h]) => [picks[k].map((v) => srgbToLinear(v / 255)), hexToLinear(h)] as const);
    if (neutrals.length < 2) return null;
    const C = [0, 1, 2].map((c) => {
      const A = [[0, 0], [0, 0]], y = [0, 0];
      for (const [m, r] of neutrals) {
        A[0][0] += m[c] * m[c]; A[0][1] += m[c]; A[1][0] += m[c]; A[1][1]++;
        y[0] += m[c] * r[c]; y[1] += r[c];
      }
      return solveLinear(A, y);
    });
    apply = (m) => m.map((v, c) => clamp01(C[c][0] * v + C[c][1])) as RGB;
    n = neutrals.length;
  }
  const errs = pts.map(([m, r]) => deltaE(apply(m), r));
  return { n, apply, fitError: errs.reduce((a, b) => a + b, 0) / errs.length };
}

/**
 * Per-channel tint strength of a toner from a measured letdown (toner + white at `ratio` parts
 * white per part toner), so that the two-constant mix reproduces the measurement.
 */
export function tintStrength(toner: Toner, white: Toner, measured: readonly number[], ratio: number, cal: Calibration): number[] {
  const tl = hexToLinear(tonerHex(toner, cal)), wl = hexToLinear(tonerHex(white, cal)), ws = tonerStrength(white, cal);
  return measured.map((m, i) => {
    const kt = reflToKS(tl[i]), kw = reflToKS(wl[i]), km = reflToKS(m);
    const s = Math.abs(kt - km) < 1e-6 ? 1 : (ratio * ws[i] * white.s * (km - kw)) / (toner.s * (kt - km));
    return Math.min(20, Math.max(0.05, s));
  });
}

export const verdict = (d: number): string =>
  d < 1 ? 'Match, not visible' : d < 2 ? 'Close, visible side by side' : d < 4 ? 'Noticeable difference' : 'Off, recalibrate';
