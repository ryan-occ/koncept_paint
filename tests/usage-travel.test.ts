import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SPECS, estimateUsage, rtsLitres, type JobSettings } from '../src/usage.ts';
import { colourTravel, describe, labToLinear, measuredTravel, parseMeasuredReadings, travelSummary } from '../src/color/travel.ts';
import { PRESETS } from '../src/data/presets.ts';
import { hexToLinear, toLab } from '../src/color/space.ts';

const job = (o: Partial<JobSettings> = {}): JobSettings => ({ area: 15, scope: 'ext', buffer: 10, te: 60, density: 1.1, specs: DEFAULT_SPECS, ...o });
const preset = (n: string) => PRESETS.find((p) => p.n === n)!;

test('coverage formula: litres = area × coats × DFT / (10 × VS% × TE)', () => {
  // 50 % solids at 25 µm covers 20 m²/L in theory; at 50 % transfer efficiency 10 m²/L.
  assert.ok(Math.abs(rtsLitres(10, 1, { dft: 25, vs: 50, ratio: [1, 0, 0] }, 50) - 1) < 1e-9);
  assert.equal(rtsLitres(0, 2, DEFAULT_SPECS.base, 60), 0);
});

test('quantities scale with area, coats and buffer, and split by mix ratio', () => {
  const m = preset('Cement grey solid');
  const a = estimateUsage(m, job({ buffer: 0 })), b = estimateUsage(m, job({ buffer: 0, area: 30 }));
  const clearA = a.layers.find((l) => l.key === 'clear')!, clearB = b.layers.find((l) => l.key === 'clear')!;
  assert.ok(Math.abs(clearB.rtsL - 2 * clearA.rtsL) < 1e-9);
  const buffered = estimateUsage(m, job({ buffer: 10 })).layers.find((l) => l.key === 'clear')!;
  assert.ok(Math.abs(buffered.rtsL - 1.1 * clearA.rtsL) < 1e-9);
  // clear 2 : 1 : 0.2
  assert.ok(Math.abs(clearA.paintL / clearA.hardenerL - 2) < 1e-9);
  assert.ok(Math.abs(clearA.paintL + clearA.hardenerL + clearA.reducerL - clearA.rtsL) < 1e-9);
});

test('only layers in the paint system are listed; batch grams come from the base layer', () => {
  const solid = estimateUsage(preset('Cement grey solid'), job());
  assert.deepEqual(solid.layers.map((l) => l.key), ['sealer', 'base', 'clear']);
  const base = solid.layers.find((l) => l.key === 'base')!;
  assert.equal(solid.baseGrams, Math.ceil((base.paintL * 1.1 * 1000) / 10) * 10);
  assert.equal(solid.midBinderL, 0);
  const flip = estimateUsage(preset('DIY flip: violet to green'), job());
  assert.ok(flip.layers.some((l) => l.key === 'mid') && flip.midBinderL > 0);
  assert.ok(estimateUsage(preset('Candy apple red'), job()).layers.some((l) => l.key === 'candy'));
});

test('a mid-size full respray lands in a realistic range', () => {
  const u = estimateUsage(preset('Cement grey solid'), job({ buffer: 0 }));
  const base = u.layers.find((l) => l.key === 'base')!, clear = u.layers.find((l) => l.key === 'clear')!;
  assert.ok(base.rtsL > 1.5 && base.rtsL < 5, `base ${base.rtsL.toFixed(2)} L`);
  assert.ok(clear.rtsL > 1.5 && clear.rtsL < 5, `clear ${clear.rtsL.toFixed(2)} L`);
});

test('solid colours barely travel; flip and metallic finishes travel clearly', () => {
  const solid = travelSummary(colourTravel(preset('Cement grey solid')));
  assert.equal(solid.effect, false);
  const flip = travelSummary(colourTravel(preset('DIY flip: violet to green')));
  assert.equal(flip.effect, true);
  assert.match(flip.text, /highlight 15°.*face 45°.*flop 110°/);
  const metallic = colourTravel(preset('Teal metallic'));
  assert.ok(metallic[0].lab[0] > metallic[4].lab[0] + 10, 'metallic highlight is lighter than flop');
});

test('measured travel keeps five validated CIELAB readings and creates preview swatches', () => {
  const readings = [
    [46.2, 38.1, 22.4],
    [48.8, 25.2, 14.5],
    [52.1, 5.5, 3.2],
    [44.6, -13.4, -8.1],
    [36.7, -28.2, -16.9],
  ];
  const parsed = parseMeasuredReadings(readings);
  assert.deepEqual(parsed, readings);
  const points = measuredTravel(parsed!);
  assert.deepEqual(points?.map((point) => point.angle), [15, 25, 45, 75, 110]);
  assert.deepEqual(points?.map((point) => point.lab), readings);
  assert.ok(points?.every((point) => /^#[\da-f]{6}$/i.test(point.hex)));
  assert.ok(travelSummary(points!).de > 5);

  const neutral = labToLinear([50, 0, 0]);
  assert.ok(neutral.every((channel) => channel > 0.15 && channel < 0.25));
});

test('measured travel rejects missing, non-finite, and out-of-range readings', () => {
  assert.equal(parseMeasuredReadings([[50, 0, 0]]), null);
  assert.equal(parseMeasuredReadings(Array.from({ length: 5 }, () => [50, 0, Number.NaN])), null);
  assert.equal(parseMeasuredReadings(Array.from({ length: 5 }, () => [101, 0, 0])), null);
  assert.equal(parseMeasuredReadings(Array.from({ length: 5 }, () => [50, 128, 0])), null);
});

test('colour descriptions', () => {
  assert.equal(describe([10, 0, 0]), 'black');
  assert.equal(describe([95, 1, 1]), 'white');
  assert.match(describe([25, 30, -40]), /dark (violet|blue)/);
  // named against real hex values
  const lab = (hex: string) => toLab(hexToLinear(hex));
  assert.match(describe(lab('#a3000f')), /red/);
  assert.match(describe(lab('#1c6f78')), /teal/);
  assert.match(describe(lab('#1b2a4a')), /blue/);
  assert.match(describe(lab('#2a1640')), /violet/);
  assert.match(describe(lab('#0f3b25')), /green/);
  assert.match(describe(lab('#f2c014')), /yellow|orange/);
});
