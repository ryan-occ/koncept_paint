import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctPhotoSample, medianRgb, srgbHex } from '../src/color/photo.ts';
import { hexToLinear, linearToSrgb } from '../src/color/space.ts';

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

test('reference correction removes a known channel cast from multiple photo angles', () => {
  const reference = hexToLinear('#808080');
  const originalPaint = hexToLinear('#788ca0');
  const casts = [[0.75, 1.1, 1.2], [1.15, 0.8, 0.9]];
  const corrected = casts.map((cast) => {
    const cameraRgb = (linear: readonly number[]) =>
      linear.map((channel, index) => Math.round(linearToSrgb(channel * cast[index]) * 255)) as [number, number, number];
    const photoPaint = cameraRgb(originalPaint);
    const photoReference = cameraRgb(reference);
    return correctPhotoSample(photoPaint, photoReference, '#808080');
  });

  assert.deepEqual(corrected[0], [120, 140, 160]);
  assert.deepEqual(corrected[1], [120, 140, 160]);
  assert.deepEqual(medianRgb(corrected), [120, 140, 160]);
});
