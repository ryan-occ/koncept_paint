import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchColour, matchColourAcrossAngles } from '../src/color/solve.ts';
import { colourAtViewAngle } from '../src/color/mixing.ts';
import { linearToHex } from '../src/color/space.ts';
import { COLOURS, searchColours } from '../src/data/colors.ts';

test('search finds black cherry by name and by partial words', () => {
  assert.equal(searchColours('Black Cherry')[0].name, 'Black cherry');
  assert.equal(searchColours('cherry')[0].name, 'Black cherry');
  assert.ok(searchColours('gray').some((c) => c.name === 'Cement grey'));
  assert.equal(searchColours('zzzz').length, 0);
});

test('solid grey is matched closely with few toners', () => {
  const r = matchColour('#8c8d8a', 'solid', 'Cement grey');
  assert.ok(r.de < 2, `ΔE ${r.de.toFixed(2)}`);
  assert.ok(Object.keys(r.mix.t).length <= 3);
});

test('black cherry gets a dark ground, a red pearl mid-coat and a close match', () => {
  const r = matchColour('#3a0b16', 'pearl', 'Black cherry');
  assert.equal(r.mix.g, 'black');
  assert.equal(r.mix.m1, 'int_red');
  assert.ok(r.de < 4, `ΔE ${r.de.toFixed(2)}`);
});

test('candy solves the tint over a silver base', () => {
  const r = matchColour('#a3000f', 'candy', 'Candy apple red');
  assert.equal(r.mix.cc, 3);
  assert.ok(r.mix.fl > 0);
  assert.ok(r.de < 2, `ΔE ${r.de.toFixed(2)}`);
});

test('parts are percentages that add up to 100', () => {
  const r = matchColour('#1c6f78', 'metallic', 'Teal');
  const sum = Object.values(r.mix.t).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.3, `sum ${sum}`);
});

test('multi-angle solver retains each observation and compares its predicted swatches', () => {
  const views = [
    { label: 'Front', angle: 'face' as const, hex: '#3a0b16' },
    { label: 'Side', angle: 'mid' as const, hex: '#481326' },
    { label: 'Grazing', angle: 'grazing' as const, hex: '#6a2940' },
  ];
  const result = matchColourAcrossAngles('#481326', 'pearl', 'Photo estimate', views);
  const analysis = result.angleAnalysis!;

  assert.deepEqual(analysis.views.map((view) => view.label), ['Front', 'Side', 'Grazing']);
  assert.deepEqual(analysis.views.map((view) => view.target), views.map((view) => view.hex));
  assert.ok(analysis.views.every((view) => Number.isFinite(view.de)));
  assert.ok(Math.abs(result.de - analysis.meanDe) < 1e-9);
  assert.ok(analysis.observedShift > 0);
  assert.ok(analysis.predictedShift > 0);
});

test('solid finish reports a large angle shift it cannot explain', () => {
  const views = [
    { label: 'Face', angle: 'face' as const, hex: '#18202a' },
    { label: 'Mid', angle: 'mid' as const, hex: '#74808c' },
    { label: 'Grazing', angle: 'grazing' as const, hex: '#e2e5e8' },
  ];
  const result = matchColourAcrossAngles('#74808c', 'solid', 'Photo estimate', views);
  assert.equal(result.angleAnalysis?.predictedShift, 0);
  assert.equal(result.angleAnalysis?.effectFit, 'unexplained');
});

test('effect model predicts more viewing-angle change for pearl than for solid', () => {
  const solid = matchColour('#3a0b16', 'solid', 'Solid test').mix;
  const pearl = matchColour('#3a0b16', 'pearl', 'Pearl test').mix;
  const solidShift = colourAtViewAngle(solid, 'face').map((c, i) =>
    Math.abs(c - colourAtViewAngle(solid, 'grazing')[i]),
  ).reduce((sum, value) => sum + value, 0);
  const pearlShift = colourAtViewAngle(pearl, 'face').map((c, i) =>
    Math.abs(c - colourAtViewAngle(pearl, 'grazing')[i]),
  ).reduce((sum, value) => sum + value, 0);
  assert.ok(pearlShift > solidShift);
  assert.notEqual(linearToHex(colourAtViewAngle(pearl, 'face')), linearToHex(colourAtViewAngle(pearl, 'grazing')));
});

test('every library colour produces a valid mix and reports gamut honestly', () => {
  let outside = 0;
  for (const col of COLOURS) {
    const r = matchColour(col.hex, col.finish, col.name);
    assert.ok(Number.isFinite(r.de), col.name);
    assert.equal(r.outOfGamut, r.de > 4);
    if (r.outOfGamut) outside++;
  }
  assert.ok(outside < COLOURS.length / 4, `${outside} of ${COLOURS.length} out of gamut`);
});
