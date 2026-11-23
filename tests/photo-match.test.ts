import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medianRgb, srgbHex } from '../src/color/photo.ts';

test('photo match combines angle samples with a channel-wise median', () => {
  assert.deepEqual(medianRgb([
    [40, 60, 80],
    [44, 58, 79],
    [255, 250, 245],
  ]), [44, 60, 80]);
});

test('photo match averages the middle pair and formats the target as hex', () => {
  assert.deepEqual(medianRgb([[10, 20, 30], [15, 24, 35]]), [13, 22, 33]);
  assert.equal(srgbHex([12, 128, 255]), '#0c80ff');
  assert.equal(srgbHex([-1, 300, 12.4]), '#00ff0c');
});

test('photo match rejects an empty set of samples', () => {
  assert.throws(() => medianRgb([]), /At least one colour sample/);
});
