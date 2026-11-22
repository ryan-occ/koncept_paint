import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalColour, mixToners } from '../src/color/mixing.ts';
import { toLab } from '../src/color/space.ts';
import { PRESETS } from '../src/data/presets.ts';

const lightness = (parts: Record<string, number>) => toLab(mixToners(parts).rgb)[0];

test('cement grey preset is a neutral mid grey (regression: it once mixed near-black)', () => {
  const p = PRESETS.find((x) => x.n === 'Cement grey solid')!;
  const [L, a, b] = toLab(mixToners(p.t).rgb);
  assert.ok(L > 40 && L < 65, `L* ${L.toFixed(1)} should be mid grey`);
  assert.ok(Math.hypot(a, b) < 4, `chroma ${Math.hypot(a, b).toFixed(1)} should be near neutral`);
});

test('adding black to white darkens gradually and monotonically', () => {
  let prev = 101;
  for (const black of [0, 0.1, 0.25, 0.5, 1, 2, 4]) {
    const L = lightness({ white: 6, black });
    assert.ok(L < prev, `L* should fall as black rises (black ${black}: ${L.toFixed(1)})`);
    prev = L;
  }
  assert.ok(lightness({ white: 6, black: 0.25 }) > 70, 'a small amount of black should leave a light grey');
});

test('only the ratio of parts matters, not the batch size', () => {
  const a = mixToners({ white: 3, blue: 1 }).rgb, b = mixToners({ white: 30, blue: 10 }).rgb;
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
});

test('a single toner reproduces its own masstone', () => {
  const [L] = toLab(mixToners({ white: 5 }).rgb);
  assert.ok(L > 94);
});

test('low hiding lets the ground show; more coats hide it', () => {
  const p = { ...PRESETS.find((x) => x.n === 'Cement grey solid')!, g: 'black' as const };
  const one = finalColour({ ...p, bc: 1 }).cov, three = finalColour({ ...p, bc: 3 }).cov;
  assert.ok(three > one && three > 0.95);
});

test('candy coats darken the colour', () => {
  const p = PRESETS[0];
  const L1 = toLab(finalColour({ ...p, cc: 1 }).rgb)[0], L4 = toLab(finalColour({ ...p, cc: 4 }).rgb)[0];
  assert.ok(L4 < L1);
});

test('every preset produces a valid colour', () => {
  const creative = ['Oil-slick petrol', 'Copper comet', 'Ultraviolet static', 'Arctic tide', 'Solar flare', 'Ghost orchid'];
  for (const name of creative) assert.ok(PRESETS.some((p) => p.n === name), `missing starting point: ${name}`);
  for (const p of PRESETS) for (const v of finalColour(p).rgb) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), p.n);
});
