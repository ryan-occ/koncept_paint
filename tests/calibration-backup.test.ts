import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalibrationBackup } from '../src/ui/store.ts';

test('calibration backup parser accepts valid toner readings and checks', () => {
  const backup = {
    t: { red: { hex: '#123456', str: [1.4, 1.5, 1.6] }, blue: { str: [0.5, 1, 2] } },
    checks: [{ n: 'Test card', p: '#000000', m: '#111111', de: 5.1 }],
  };
  assert.deepEqual(parseCalibrationBackup(backup), backup);
});

test('calibration backup parser rejects malformed fields and entries', () => {
  const valid = {
    t: { red: { hex: '#123456', str: [1, 1, 1] } },
    checks: [{ n: 'Test card', p: '#000000', m: '#111111', de: 5.1 }],
  };
  const invalidBackups: unknown[] = [
    null,
    { t: [], checks: [] },
    { t: { unknown: { hex: '#123456' } }, checks: [] },
    { t: { red: { hex: 'red' } }, checks: [] },
    { t: { red: { str: 1.4 } }, checks: [] },
    { t: { red: { str: [1, Number.NaN, 1] } }, checks: [] },
    { t: {}, checks: [{ n: 'Test card', p: '#000000', m: '#111111', de: Number.POSITIVE_INFINITY }] },
    { t: {}, checks: [{ n: '', p: '#000000', m: '#111111', de: 1 }] },
    { ...valid, checks: [null] },
  ];
  for (const backup of invalidBackups) {
    assert.equal(parseCalibrationBackup(backup), null, `expected rejection for ${String(backup)}`);
  }
});
