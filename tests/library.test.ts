import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRESETS } from '../src/data/presets.ts';
import { finishText, toLibraryPaint } from '../src/library.ts';
import { isMix } from '../src/ui/mix-backup.ts';
// @ts-expect-error plain JavaScript module shared with the server
import { LIBRARY_LIMITS, validateLibraryBatch, validateLibraryPaint } from '../library-store.mjs';

const preset = (name: string) => {
  const found = PRESETS.find((p) => p.n === name);
  assert.ok(found, `preset ${name} exists`);
  return structuredClone(found);
};

describe('library paints from mixes', () => {
  it('turns every starting point into a paint the server accepts', () => {
    const paints = PRESETS.map((p) => toLibraryPaint(p, undefined, 'preset'));
    const stored = validateLibraryBatch({ paints });
    assert.equal(stored.length, PRESETS.length);
    for (const paint of paints) {
      assert.match(paint.hex, /^#[\da-f]{6}$/i);
      assert.ok(paint.finish.length > 0 && paint.finish.length <= LIBRARY_LIMITS.finish);
      assert.ok(isMix(paint.recipe), `${paint.name} recipe reopens on the bench`);
      assert.equal(paint.recipe.hex, paint.hex);
    }
  });

  it('marks interference flips as colour-shift with a second colour', () => {
    const paint = toLibraryPaint(preset('DIY flip: violet to green'));
    assert.match(paint.hex2 ?? '', /^#[\da-f]{6}$/i);
    assert.notEqual(paint.hex2, paint.hex);
    assert.equal(paint.shiftLabel, 'ghost violet / ghost green');
  });

  it('keeps solid and metallic paints single-colour', () => {
    for (const name of ['Cement grey solid', 'Teal metallic', 'Candy apple red', 'Matte gunmetal']) {
      const paint = toLibraryPaint(preset(name));
      assert.equal(paint.hex2, undefined, name);
      assert.equal(paint.shiftLabel, undefined, name);
    }
  });

  it('describes the finish in plain words', () => {
    assert.equal(finishText(preset('Satin black')), 'satin clear, solid colour, no metallic flake over black sealer');
    const candy = finishText(preset('Candy apple red'));
    assert.match(candy, /^gloss clear, fine metallic flake \(85%\), candy #B3071B \(3 coats\)/);
    assert.match(finishText(preset('Pearl white tri-coat')), /white pearl \(70%\)/);
    assert.match(finishText(preset('Copper comet')), /ghost copper and crystal gold effect mid-coat/);
  });
});

describe('library paint validation', () => {
  const good = () => toLibraryPaint(preset('Teal metallic'));

  it('normalises names and colours', () => {
    const stored = validateLibraryPaint({ ...good(), name: '  Teal   metallic ', hex: '#ABCDEF' });
    assert.equal(stored.name, 'Teal metallic');
    assert.equal(stored.hex, '#abcdef');
    assert.equal(stored.hex2, null);
    assert.equal(stored.source, 'custom');
  });

  it('rejects bad input', () => {
    assert.throws(() => validateLibraryPaint({ ...good(), name: '' }), /names must be/);
    assert.throws(() => validateLibraryPaint({ ...good(), hex: 'red' }), /main colour/);
    assert.throws(() => validateLibraryPaint({ ...good(), hex2: '#12' }), /second colour/);
    assert.throws(() => validateLibraryPaint({ ...good(), shiftLabel: 'flip' }), /needs a second colour/);
    assert.throws(() => validateLibraryPaint({ ...good(), finish: 'x'.repeat(301) }), /finish/);
    assert.throws(() => validateLibraryPaint({ ...good(), recipe: { pad: 'x'.repeat(5000) } }), /recipe/);
    assert.throws(() => validateLibraryPaint({ ...good(), source: 'other' }), /source/);
    assert.throws(() => validateLibraryBatch({ paints: [] }), /at least one/);
    assert.throws(() => validateLibraryBatch({ paints: [good(), { ...good(), name: 'TEAL METALLIC' }] }), /same name/);
  });
});
