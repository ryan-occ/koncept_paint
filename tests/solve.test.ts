import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchColour } from '../src/color/solve.ts';
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
