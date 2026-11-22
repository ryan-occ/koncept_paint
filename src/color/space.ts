import type { RGB } from '../types.ts';

/** sRGB transfer functions, per channel, 0..1. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export const hexToLinear = (h: string): RGB =>
  [1, 3, 5].map((i) => srgbToLinear(parseInt(h.substr(i, 2), 16) / 255)) as RGB;

export const linearToHex = (a: readonly number[]): string =>
  '#' + a.map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255).toString(16).padStart(2, '0')).join('');

/** Linear sRGB (D65) to CIE L*a*b*. */
export function toLab([r, g, b]: readonly number[]): RGB {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** CIEDE2000 colour difference between two L*a*b* colours. */
export function deltaE2000([L1, a1, b1]: readonly number[], [L2, a2, b2]: readonly number[]): number {
  const rd = Math.PI / 180;
  const p7 = (c: number) => Math.sqrt(c ** 7 / (c ** 7 + 25 ** 7));
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - p7(Cb));
  const A1 = a1 * (1 + G), A2 = a2 * (1 + G);
  const C1 = Math.hypot(A1, b1), C2 = Math.hypot(A2, b2);
  const hue = (b: number, a: number) => {
    if (!a && !b) return 0;
    const x = Math.atan2(b, a) / rd;
    return x < 0 ? x + 360 : x;
  };
  const h1 = hue(b1, A1), h2 = hue(b2, A2);
  let dh = 0;
  if (C1 * C2) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = L2 - L1, dC = C2 - C1;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh * rd) / 2);
  const Lb = (L1 + L2) / 2, Cp = (C1 + C2) / 2;
  let hb = h1 + h2;
  if (C1 * C2) {
    if (Math.abs(h1 - h2) > 180) hb += hb < 360 ? 360 : -360;
    hb /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rd) + 0.24 * Math.cos(2 * hb * rd) + 0.32 * Math.cos((3 * hb + 6) * rd) - 0.2 * Math.cos((4 * hb - 63) * rd);
  const dT = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cp, SH = 1 + 0.015 * Cp * T;
  const RT = -Math.sin(2 * dT * rd) * 2 * p7(Cp);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

export const deltaE = (a: readonly number[], b: readonly number[]): number => deltaE2000(toLab(a), toLab(b));
