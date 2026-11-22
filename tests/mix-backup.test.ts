import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRESETS } from '../src/data/presets.ts';
import { mergeMixes, parseMixBackup, serializeMixBackup } from '../src/ui/mix-backup.ts';

describe('saved mix backups', () => {
  it('round-trips a saved mix through the versioned JSON format', () => {
    const mix = structuredClone(PRESETS[0]);
    const decoded = parseMixBackup(serializeMixBackup([mix]));
    assert.deepEqual(decoded, [mix]);
  });

  it('rejects malformed, unsupported, or invalid mix data', () => {
    assert.throws(() => parseMixBackup('{broken json'), /not valid JSON/);
    assert.throws(() => parseMixBackup(JSON.stringify({ format: 'other', version: 1, mixes: [] })), /not a supported/);

    const text = serializeMixBackup([PRESETS[0]]).replace('"fl": 85', '"fl": 101');
    assert.throws(() => parseMixBackup(text), /invalid mix/);
  });

  it('updates matching names and adds new mixes without mutating saved data', () => {
    const current = [structuredClone(PRESETS[0])];
    const incoming = [
      { ...structuredClone(PRESETS[0]), fl: 40 },
      { ...structuredClone(PRESETS[1]), n: 'Imported pearl' },
    ];
    const merged = mergeMixes(current, incoming);

    assert.equal(merged.length, 2);
    assert.equal(merged[0].fl, 40);
    assert.equal(merged[1].n, 'Imported pearl');
    assert.equal(current[0].fl, PRESETS[0].fl);
  });
});
