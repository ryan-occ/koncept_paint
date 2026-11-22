import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCorrection, REF_PATCHES, solveLinear, tintStrength } from '../src/color/calibration.ts';
import { mixToners, EMPTY_CAL } from '../src/color/mixing.ts';
import { deltaE, hexToLinear, linearToSrgb } from '../src/color/space.ts';
import { TONERS } from '../src/data/toners.ts';

const toCamera = (lin: number[]) => lin.map((v) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255);

test('solveLinear solves a small system', () => {
  const x = solveLinear([[2, 1], [1, 3]], [5, 10]);
  assert.ok(Math.abs(x[0] - 1) < 1e-9 && Math.abs(x[1] - 3) < 1e-9);
});

test('six-patch fit undoes a camera colour cast', () => {
  // Simulated camera: warm cast plus slight under-exposure, applied in linear light.
  const cast = (c: number[]) => [c[0] * 0.95 + 0.01, c[1] * 0.85 + 0.005, c[2] * 0.7];
  const picks = Object.fromEntries(REF_PATCHES.map(([k, , h]) => [k, toCamera(cast(hexToLinear(h)))]));
  const corr = fitCorrection(picks)!;
  assert.equal(corr.n, 6);
  assert.ok(corr.fitError < 0.5, `fit error ${corr.fitError}`);
  const truth = hexToLinear('#797a79');
  const seen = toCamera(cast(truth)).map((v) => ((v / 255 + 0.055) / 1.055) ** 2.4);
  assert.ok(deltaE(corr.apply(seen), truth) < 1);
});

test('neutral-only fit needs at least two neutral patches', () => {
  assert.equal(fitCorrection({ white: [240, 240, 240] }), null);
  assert.equal(fitCorrection({ white: [240, 240, 240], grey: [120, 120, 120] })?.n, 2);
});

test('tint strength from a letdown makes the mix reproduce the measurement', () => {
  const blue = TONERS.find((x) => x.id === 'blue')!, white = TONERS[0];
  // Pretend the real blue tints 2.5x stronger than the generic model.
  const truthCal = { t: { blue: { str: [2.5, 2.5, 2.5] } }, checks: [] };
  const measured = mixToners({ blue: 1, white: 4 }, truthCal).rgb;
  const str = tintStrength(blue, white, measured, 4, EMPTY_CAL);
  str.forEach((s) => assert.ok(Math.abs(s - 2.5) < 0.05, `strength ${s}`));
  const predicted = mixToners({ blue: 1, white: 8 }, { t: { blue: { str } }, checks: [] }).rgb;
  assert.ok(deltaE(predicted, mixToners({ blue: 1, white: 8 }, truthCal).rgb) < 0.5);
});
