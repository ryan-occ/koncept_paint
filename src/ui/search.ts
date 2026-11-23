import { COLOURS, searchColours, type NamedColour } from '../data/colors.ts';
import { matchColour, type Finish, type MatchResult } from '../color/solve.ts';
import { verdict } from '../color/calibration.ts';
import { GROUNDS, TONERS } from '../data/toners.ts';
import { POWDERS } from '../data/powders.ts';
import { $, cal, esc } from './store.ts';
import { loadPreset } from './bench.ts';

const FINISHES: [Finish, string][] = [['solid', 'Solid'], ['metallic', 'Metallic'], ['pearl', 'Pearl'], ['candy', 'Candy'], ['satin', 'Satin'], ['matte', 'Matte']];
let picked: NamedColour | null = null;
let last: MatchResult | null = null;
let job = 0;

function results(list: NamedColour[]) {
  $('colorResults').innerHTML = list.map((c, i) =>
    `<button class="chip" type="button" data-i="${i}"><i style="width:14px;height:14px;border-radius:3px;background:${c.hex}"></i>${esc(c.name)}<span class="tag">${c.finish}</span></button>`).join('');
  $('colorResults').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b) choose(list[+b.dataset.i!]);
  };
}

function choose(c: NamedColour) {
  picked = c;
  $<HTMLSelectElement>('finishSel').value = c.finish;
  $<HTMLInputElement>('colorPick').value = c.hex;
  solve();
}

function solve() {
  if (!picked) return;
  const mine = ++job, c = picked, finish = $<HTMLSelectElement>('finishSel').value as Finish;
  $('matchOut').innerHTML = `<p class="cover">Working out a mix for ${esc(c.name)}…</p>`;
  // Let the message paint before the solver runs.
  setTimeout(() => {
    if (mine !== job) return;
    last = matchColour(c.hex, finish, c.name, cal);
    render(last, c, finish);
  }, 30);
}

function render(r: MatchResult, c: NamedColour, finish: Finish) {
  const toners = Object.entries(r.mix.t).sort((a, b) => b[1] - a[1]).map(([id, p]) => `${TONERS.find((x) => x.id === id)!.n} ${p}%`).join(', ');
  const extras = [
    `${GROUNDS[r.mix.g][0]}`,
    `${r.mix.bc} base coats`,
    r.mix.fl ? `${r.mix.fl}% flake` : '',
    r.mix.p !== 'none' ? `${r.mix.p} pearl in base` : '',
    r.mix.mic && r.mix.m1 !== 'none' ? `mid-coat: ${POWDERS[r.mix.m1].label}` : '',
    r.mix.cc ? `${r.mix.cc} candy coats, tint ${r.mix.cd.toUpperCase()}` : '',
    r.mix.fin !== 'gloss' ? `${r.mix.fin} clear` : '',
  ].filter(Boolean).join(' · ');
  $('matchOut').innerHTML = `<div class="match">
    <div class="pair"><div><i style="background:${r.target}"></i><small>Target</small></div><div><i style="background:${r.predicted}"></i><small>Predicted</small></div></div>
    <div>
      <b>${esc(c.name)}</b> · ${finish}<br>
      <span class="${r.outOfGamut ? 'warn' : ''}">ΔE ${r.de.toFixed(1)}: ${r.outOfGamut ? 'out of reach with these toners — closest possible shown' : verdict(r.de)}</span>
      <p class="cover">${esc(toners)}<br>${esc(extras)}</p>
      <button class="btn" type="button" id="loadMatch">Load into bench</button>
    </div></div>`;
  $('loadMatch').onclick = () => { if (last) loadPreset(last.mix); $('mixName').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
}

export function initSearch() {
  $('finishSel').innerHTML = FINISHES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const q = $<HTMLInputElement>('colorQ');
  q.addEventListener('input', () => {
    const v = q.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) {
      const hex = '#' + v.replace('#', '').toLowerCase();
      results([{ name: `Custom ${hex.toUpperCase()}`, hex, finish: 'solid', tags: '' }]);
      return;
    }
    const found = searchColours(v);
    results(found);
    if (v && !found.length) $('colorResults').innerHTML = '<span class="cover">No reference colour by that name. Pick the colour with the swatch, or type a hex code like #3A0B16.</span>';
  });
  $<HTMLInputElement>('colorPick').addEventListener('change', (e) => {
    const hex = (e.target as HTMLInputElement).value;
    choose({ name: `Custom ${hex.toUpperCase()}`, hex, finish: $<HTMLSelectElement>('finishSel').value as Finish, tags: '' });
  });
  $('finishSel').addEventListener('change', solve);
  results(COLOURS.filter((c) => ['Black cherry', 'Candy apple red', 'British racing green', 'Midnight blue', 'Cement grey', 'Pearl white'].includes(c.name)));
}
