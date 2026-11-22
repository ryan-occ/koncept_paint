import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE2000, hexToLinear, linearToHex, toLab } from '../src/color/space.ts';

test('CIEDE2000 matches Sharma, Wu & Dalal (2005) reference pairs', () => {
  const pairs: [number[], number[], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, -1, 2], [50, 0, 0], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [a, b, want] of pairs) assert.ok(Math.abs(deltaE2000(a, b) - want) < 1e-3, `${a} vs ${b}: ${deltaE2000(a, b)} != ${want}`);
});

test('ΔE2000 is symmetric and zero for identical colours', () => {
  const a = [62, 14, -30], b = [58, 20, -22];
  assert.equal(deltaE2000(a, a), 0);
  assert.ok(Math.abs(deltaE2000(a, b) - deltaE2000(b, a)) < 1e-9);
});

test('white maps to L*=100, a*=b*=0', () => {
  const [L, a, b] = toLab([1, 1, 1]);
  assert.ok(Math.abs(L - 100) < 0.01 && Math.abs(a) < 0.05 && Math.abs(b) < 0.05);
});

test('hex round-trips through linear RGB', () => {
  for (const h of ['#000000', '#ffffff', '#797a79', '#b3071b', '#3d7bf5']) assert.equal(linearToHex(hexToLinear(h)), h);
});
