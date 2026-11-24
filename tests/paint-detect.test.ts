import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessPaintParts, type PartInfo } from '../src/render/paint-detect.ts';

const part = (name: string, material: string, size = 1, transparent = false): PartInfo => ({ name, material, size, transparent });

test('named body and paint parts are picked, glass, tyres and chrome are not', () => {
  const parts = [
    part('Body', 'CarPaint', 5),
    part('Door_L', 'CarPaint', 1.5),
    part('Windshield', 'Glass', 1.4, true),
    part('Wheel_FL', 'Tyre_Rubber', 0.8),
    part('Bumper_F', 'Chrome', 1),
    part('Hood', 'Paint_Red', 1.6),
  ];
  assert.deepEqual(guessPaintParts(parts), [0, 1, 5]);
});

test('unnamed models fall back to the material covering the most of the car', () => {
  const parts = [
    part('Object_2', 'Material.001', 4),
    part('Object_3', 'Material.001', 2),
    part('Object_4', 'Material.002', 1.2),
    part('Object_5', 'Material.003', 0.5, true),
  ];
  assert.deepEqual(guessPaintParts(parts), [0, 1]);
});

test('transparent parts are never painted, even when named body', () => {
  assert.deepEqual(guessPaintParts([part('body_glass', 'body', 3, true), part('shell', 'x', 1)]), [1]);
});

test('a model with nothing paintable returns no parts', () => {
  assert.deepEqual(guessPaintParts([part('tyre', 'rubber'), part('window', 'glass', 1, true)]), []);
});
