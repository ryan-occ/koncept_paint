import { GROUNDS, PEARLS, TONERS } from '../data/toners.ts';
import { POWDER_GROUPS, POWDERS } from '../data/powders.ts';
import { PRESETS } from '../data/presets.ts';
import { finalColour, tonerHex } from '../color/mixing.ts';
import { linearToHex } from '../color/space.ts';
import { applicationGuide, layers, recipeText } from '../guide.ts';
import { buildSheet, renderSheet } from '../sheet.ts';
import { LIGHTS } from '../render/lighting.ts';
import type { Booth } from '../render/booth.ts';
import type { Mix } from '../types.ts';
import { $, cal, changed, esc, loadMix, mix, onChange, storage, view } from './store.ts';

type Opt = [value: string, label: string];

/** Segmented control bound to a key on a state object. */
function seg<T extends object>(id: string, opts: Opt[], obj: T, key: keyof T, after?: () => void) {
  const el = $(id);
  el.innerHTML = opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(obj[key]) === v}">${l}</button>`).join('');
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    (obj as Record<keyof T, unknown>)[key] = b.dataset.v;
    el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    after?.();
    changed();
  };
}

let booth: Booth | null = null;
let copyText = '';

export function syncUI() {
  seg('shapeSeg', [['panel', 'Test panel'], ['sphere', 'Sphere'], ['car', 'Car']], view, 'shape', () => booth?.setShape(view.shape));
  seg('lightSeg', Object.entries(LIGHTS).map(([k, v]) => [k, v.label]), view, 'light', () => booth?.setLight(view.light));
  seg('spinSeg', [['on', 'Auto-rotate'], ['off', 'Hold']], view, 'spin', () => booth && (booth.autoRotate = view.spin === 'on'));
  seg('groundSeg', Object.entries(GROUNDS).map(([k, v]) => [k, v[0]]), mix, 'g');
  seg('fsSeg', [['fine', 'Fine'], ['medium', 'Medium'], ['coarse', 'Coarse']], mix, 'fs');
  seg('pearlSeg', Object.entries(PEARLS).map(([k, v]) => [k, v[0]]), mix, 'p');
  seg('finSeg', [['gloss', 'Gloss'], ['satin', 'Satin'], ['matte', 'Matte']], mix, 'fin');
  seg('tempSeg', [['cool', 'Under 25 °C'], ['warm', '25–32 °C'], ['hot', 'Over 32 °C']], view, 'temp');

  $('toners').innerHTML = TONERS.map((x) => `<div class="row"><i style="background:${tonerHex(x, cal)}"${cal.t[x.id] ? ' title="Calibrated from your test card"' : ''}></i><span>${x.n}</span>
    <div class="num"><button type="button" data-d="-1" data-id="${x.id}" aria-label="Less ${x.n}">−</button><input type="number" min="0" step="0.1" inputmode="decimal" data-id="${x.id}" value="${+(mix.t[x.id] || 0).toFixed(2)}" aria-label="${x.n} parts"><button type="button" data-d="1" data-id="${x.id}" aria-label="More ${x.n}">+</button></div><em id="pc_${x.id}"></em></div>`).join('');
  document.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => (i.value = String(mix[i.dataset.k as keyof Mix])));
  $<HTMLInputElement>('candy').value = mix.cd;
  for (const k of ['m1', 'm2'] as const) {
    const sel = $<HTMLSelectElement>(k);
    sel.innerHTML = '<option value="none">None</option>' + POWDER_GROUPS.map((g) => `<optgroup label="${g}">` +
      Object.entries(POWDERS).filter(([, p]) => p.group === g).map(([v, p]) => `<option value="${v}">${p.label}</option>`).join('') + '</optgroup>').join('');
    sel.value = mix[k];
  }
}

function update() {
  const { m, cov, rgb } = finalColour(mix, cal);
  const hex = linearToHex(rgb);
  $('sw').style.background = hex;
  $('swHex').textContent = hex.toUpperCase();
  const used = TONERS.filter((x) => mix.t[x.id] > 0);
  const nk = used.filter((x) => cal.t[x.id]?.hex).length, recent = cal.checks.slice(-5);
  $('swSub').textContent = (used.length && nk === used.length ? 'colour calibrated' : nk ? `${nk} of ${used.length} toners calibrated` : 'generic toners, uncalibrated') +
    (recent.length ? ` · recent ΔE ${(recent.reduce((a, c) => a + c.de, 0) / recent.length).toFixed(1)}` : '');

  for (const k of ['bc', 'fl', 'pa', 'cc', 'clr', 'peel'] as const) $('o_' + k).textContent = ['fl', 'pa', 'peel'].includes(k) ? mix[k] + '%' : String(mix[k]);
  $('o_m1l').textContent = mix.m1l + ' g/L';
  $('o_m2l').textContent = mix.m2l + ' g/L';
  $('o_mic').textContent = String(mix.mic);
  $('o_mv').textContent = mix.mv + ' L';

  const c = $('cover');
  c.textContent = m.tot ? `Hiding over ${GROUNDS[mix.g][0].toLowerCase()}: ${Math.round(cov * 100)}%${cov < 0.95 ? ' — ground will show through, add a coat or use a closer sealer' : ''}` : 'Add toner parts to build the base colour.';
  c.className = 'cover' + (m.tot && cov < 0.95 ? ' warn' : '');
  for (const x of TONERS) { const e = $('pc_' + x.id); if (e) e.textContent = mix.t[x.id] > 0 && m.tot ? Math.round((mix.t[x.id] / m.tot) * 100) + '%' : ''; }

  mix.n = $<HTMLInputElement>('mixName').value || 'Untitled mix';
  const batch = Math.max(0, +$<HTMLInputElement>('batch').value || 0);
  $('rTitle').textContent = mix.n;
  $('rBody').innerHTML = used.length ? used.map((x) => {
    const sh = mix.t[x.id] / m.tot;
    return `<tr><td>${x.n}</td><td class="n">${+mix.t[x.id].toFixed(2)}</td><td class="n">${(sh * 100).toFixed(1)}%</td><td class="n">${Math.round(sh * batch)} g</td></tr>`;
  }).join('') : '<tr><td colspan="4" style="color:var(--mute)">No toners yet — add parts on the mixing bench.</td></tr>';
  const L = layers(mix, cov), G = applicationGuide(mix, cov, m, view.temp);
  $('layers').innerHTML = L.map(([a, b]) => `<div class="layer"><b>${a}</b>${b}</div>`).join('');
  $('guide').innerHTML = G.map(([a, b]) => `<li><b>${a}</b>${b}</li>`).join('');
  copyText = recipeText(mix, rgb, used.map((x) => ({ n: x.n, parts: mix.t[x.id] })), m.tot, batch, L, G);
  booth?.apply(mix, rgb);
}

const SAVE_KEY = 'pbs-mixes';
let saved: Mix[] = storage.get(SAVE_KEY, []);
function drawSaved() {
  $('saved').innerHTML = saved.length ? saved.map((p, i) => `<button class="chip" type="button" data-i="${i}"><i style="width:12px;height:12px;border-radius:3px;background:${p.hex}"></i>${esc(p.n)}<span class="x" data-del="${i}" aria-label="Delete">×</span></button>`).join('')
    : '<span style="font-size:13px;color:var(--mute)">Nothing saved yet.</span>';
}

export function loadPreset(p: Mix) { load(p); }

function load(p: Mix) {
  loadMix(p);
  $<HTMLInputElement>('mixName').value = p.n;
  syncUI();
  changed();
}

export function initBench(b: Booth | null) {
  booth = b;
  onChange(update);

  $('toners').addEventListener('input', (e) => {
    const i = (e.target as HTMLElement).closest('input');
    if (i) { mix.t[i.dataset.id!] = Math.max(0, parseFloat(i.value) || 0); changed(); }
  });
  $('toners').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const id = b.dataset.id!, cur = mix.t[id] || 0, d = +b.dataset.d!;
    const step = cur < 1 && (d < 0 || cur > 0) ? 0.1 : 1;
    mix.t[id] = Math.max(0, Math.round((cur + d * step) * 10) / 10);
    b.parentElement!.querySelector('input')!.value = String(mix.t[id]);
    changed();
  });
  document.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => i.addEventListener('input', () => {
    (mix as unknown as Record<string, number>)[i.dataset.k!] = +i.value;
    changed();
  }));
  $<HTMLInputElement>('candy').addEventListener('input', (e) => {
    mix.cd = (e.target as HTMLInputElement).value;
    if (!mix.cc) { mix.cc = 2; $<HTMLInputElement>('candy').closest('section')!.querySelector<HTMLInputElement>('[data-k=cc]')!.value = '2'; }
    changed();
  });
  for (const k of ['m1', 'm2'] as const) {
    $(k).addEventListener('change', (e) => {
      mix[k] = (e.target as HTMLSelectElement).value;
      const lk = `${k}l` as 'm1l' | 'm2l';
      if (mix[k] !== 'none' && !mix[lk]) { mix[lk] = 20; document.querySelector<HTMLInputElement>(`[data-k=${lk}]`)!.value = '20'; }
      if (mix[k] !== 'none' && !mix.mic) { mix.mic = 2; document.querySelector<HTMLInputElement>('[data-k=mic]')!.value = '2'; }
      changed();
    });
  }
  $('batch').addEventListener('input', changed);
  $('mixName').addEventListener('input', changed);
  $('copyBtn').addEventListener('click', async () => {
    const b = $('copyBtn');
    try { await navigator.clipboard.writeText(copyText); b.textContent = 'Copied'; } catch { b.textContent = 'Copy blocked'; }
    setTimeout(() => (b.textContent = 'Copy recipe'), 1600);
  });

  $('printBtn').addEventListener('click', () => {
    const batch = Math.max(0, +$<HTMLInputElement>('batch').value || 0) || 1000;
    $('printSheet').innerHTML = renderSheet(buildSheet(mix, cal, view.temp, batch));
    try { window.print(); } catch { $('printBtn').textContent = 'Printing blocked here: open the app in its own tab'; }
  });

  $('presets').innerHTML = PRESETS.map((p, i) => `<button class="chip" type="button" data-i="${i}">${p.n}</button>`).join('');
  $('presets').onclick = (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) load(PRESETS[+b.dataset.i!]); };
  $('saved').onclick = (e) => {
    const t = e.target as HTMLElement, d = t.closest<HTMLElement>('[data-del]');
    if (d) { saved.splice(+d.dataset.del!, 1); storage.set(SAVE_KEY, saved); drawSaved(); return; }
    const b = t.closest('button');
    if (b) load(saved[+b.dataset.i!]);
  };
  $('saveBtn').onclick = () => {
    const n = $<HTMLInputElement>('mixName').value.trim() || 'Untitled mix';
    const p: Mix = { ...structuredClone(mix), n, hex: linearToHex(finalColour(mix, cal).rgb) };
    const i = saved.findIndex((x) => x.n === n);
    if (i >= 0) saved[i] = p; else saved.unshift(p);
    storage.set(SAVE_KEY, saved);
    drawSaved();
  };

  drawSaved();
  load(PRESETS[0]);
}
