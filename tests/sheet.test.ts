import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheet, formula, renderSheet } from '../src/sheet.ts';
import { PRESETS } from '../src/data/presets.ts';
import { EMPTY_CAL } from '../src/color/mixing.ts';

const preset = (n: string) => PRESETS.find((p) => p.n === n)!;

test('formula running totals end at the batch weight', () => {
  const rows = formula(preset('Teal metallic'), EMPTY_CAL, 1000);
  assert.equal(rows.length, 3);
  assert.ok(Math.abs(rows.at(-1)!.cumulative - 1000) <= 0.2, `ends at ${rows.at(-1)!.cumulative}`);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].cumulative > rows[i - 1].cumulative);
});

test('stages follow the paint system: mid-coat and candy only when used', () => {
  const keys = (n: string) => buildSheet(preset(n), EMPTY_CAL, 'hot', 1000).stages.map((s) => s.key).join(',');
  assert.equal(keys('Cement grey solid'), 'ground,base,clear');
  assert.equal(keys('Candy apple red'), 'ground,base,candy,clear');
  assert.equal(keys('DIY flip: violet to green'), 'ground,base,mid,clear');
});

test('matte finish recommends a matte clear, gloss a 2K urethane clear', () => {
  const clear = (n: string) => buildSheet(preset(n), EMPTY_CAL, 'warm', 500).stages.at(-1)!.product;
  assert.match(clear('Matte gunmetal'), /matte clear/);
  assert.match(clear('Cement grey solid'), /2K high-solids/);
});

test('mid-coat stage lists powder grams for the binder volume', () => {
  const mid = buildSheet({ ...preset('DIY flip: violet to green'), mv: 2 }, EMPTY_CAL, 'warm', 1000).stages.find((s) => s.key === 'mid')!;
  assert.ok(mid.notes.some((n) => n.includes('50 g in 2 L')), mid.notes.join(' | '));
});

test('rendered sheet escapes the mix name and includes every stage', () => {
  const s = buildSheet({ ...preset('Candy apple red'), n: 'Job <42> & "test"' }, EMPTY_CAL, 'warm', 1000);
  const html = renderSheet(s);
  assert.ok(html.includes('Job &lt;42&gt; &amp; &quot;test&quot;'));
  assert.ok(!html.includes('<42>'));
  for (const st of s.stages) assert.ok(html.includes(st.title));
});
