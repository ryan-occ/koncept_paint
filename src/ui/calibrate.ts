import { TONERS } from '../data/toners.ts';
import { finalColour, tonerHex } from '../color/mixing.ts';
import { fitCorrection, REF_PATCHES, tintStrength, verdict, type Correction } from '../color/calibration.ts';
import { linearToHex, srgbToLinear, toLab, deltaE } from '../color/space.ts';
import type { Calibration, RGB } from '../types.ts';
import { $, cal, changed, esc, mix, saveCal } from './store.ts';
import { syncUI } from './bench.ts';

const PICKS: [string, string][] = [...REF_PATCHES.map(([k, l]) => [k, l] as [string, string]), ['paint', 'Paint sample']];
const picked: Record<string, number[]> = {};
let pick = 'white';
let src: HTMLCanvasElement | null = null;
let marks: [string, number, number][] = [];
let measured: RGB | null = null;

function drawPicks() {
  $('picks').innerHTML = PICKS.map(([k, l]) => `<button class="chip" type="button" data-k="${k}" aria-pressed="${pick === k}">${picked[k] ? `<i style="background:rgb(${picked[k].map(Math.round)})"></i>` : ''}${l}${picked[k] ? ' ✓' : ''}</button>`).join('');
}

function drawPhoto() {
  if (!src) return;
  const c = $<HTMLCanvasElement>('pc');
  c.width = src.width;
  c.height = src.height;
  const x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  const r = Math.max(6, src.width / 90);
  x.lineWidth = r / 3;
  for (const [k, mx, my] of marks) {
    x.strokeStyle = k === 'paint' ? '#f2b705' : '#fff';
    x.beginPath(); x.arc(mx, my, r, 0, 7); x.stroke();
    x.strokeStyle = '#000';
    x.beginPath(); x.arc(mx, my, r + r / 3, 0, 7); x.stroke();
  }
}

function calc() {
  const corr: Correction | null = fitCorrection(picked);
  measured = null;
  const o = $('calOut');
  if (!corr) { o.textContent = 'Pick at least White, Neutral 5 and Black (all six chart patches is more accurate).'; return; }
  const fe = corr.fitError;
  const q = corr.n === 6 ? (fe < 1.5 ? 'good' : fe < 3 ? 'fair, check light and glare' : 'poor, reshoot in even light') : 'neutral-only correction, colour casts may remain';
  if (!picked.paint) { o.textContent = `Chart fitted (${corr.n} patches, error ΔE ${fe.toFixed(1)}: ${q}). Now pick the paint sample.`; return; }
  measured = corr.apply(picked.paint.map((v) => srgbToLinear(v / 255)));
  const h = linearToHex(measured);
  o.innerHTML = `<div style="display:flex;gap:12px;align-items:center"><i style="width:56px;height:56px;border-radius:8px;background:${h};border:1px solid var(--line)"></i><div><b style="font-size:18px">${h.toUpperCase()}</b><br>Lab ${toLab(measured).map((v) => v.toFixed(1)).join(' / ')}</div></div><p class="caveat">Chart fit: ${corr.n} patches, ΔE ${fe.toFixed(1)} (${q}).</p>`;
}

function targets() {
  $('calTarget').innerHTML = '<option value="mix">Check the current mix (sprayed card of this recipe)</option><optgroup label="Toner masstone (toner alone, full hide)">' +
    TONERS.map((x) => `<option value="m:${x.id}">${x.n} masstone</option>`).join('') +
    '</optgroup><optgroup label="Toner tint (toner + white, ratio below)">' +
    TONERS.filter((x) => x.id !== 'white').map((x) => `<option value="l:${x.id}">${x.n} + white</option>`).join('') + '</optgroup>';
  syncRatio();
}
const syncRatio = () => { $('letRow').style.display = $<HTMLSelectElement>('calTarget').value.startsWith('l:') ? 'grid' : 'none'; };

function render() {
  $('checks').innerHTML = cal.checks.length ? cal.checks.slice().reverse().map((c) => `<tr><td>${esc(c.n)}</td><td><i class="sw2" style="background:${c.p}"></i>${c.p}</td><td><i class="sw2" style="background:${c.m}"></i>${c.m}</td><td class="n">${c.de.toFixed(1)}</td><td>${verdict(c.de)}</td></tr>`).join('')
    : '<tr><td colspan="5" style="color:var(--mute)">No checks yet. Spray a recipe, photograph it, and log it as "Check the current mix".</td></tr>';
  $('calStatus').innerHTML = TONERS.map((x) => {
    const c = cal.t[x.id] || {};
    return `<tr><td><i class="sw2" style="background:${tonerHex(x, cal)}"></i>${x.n}</td><td>${c.hex ? 'Measured ' + c.hex : 'Generic'}</td><td>${c.str ? 'Measured' : x.id === 'white' ? 'Reference' : 'Generic'}</td><td>${c.hex || c.str ? `<button class="chip" type="button" data-reset="${x.id}">Reset</button>` : ''}</td></tr>`;
  }).join('');
  $<HTMLTextAreaElement>('calJson').value = JSON.stringify(cal);
}

const refresh = () => { saveCal(); syncUI(); changed(); render(); };

export function initCalibration() {
  $('picks').onclick = (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) { pick = b.dataset.k!; drawPicks(); } };

  $('photo').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 2000 / Math.max(img.width, img.height));
      src = document.createElement('canvas');
      src.width = (img.width * s) | 0;
      src.height = (img.height * s) | 0;
      src.getContext('2d')!.drawImage(img, 0, 0, src.width, src.height);
      marks = [];
      for (const [k] of PICKS) delete picked[k];
      pick = 'white';
      drawPicks(); drawPhoto();
      $('photoHint').textContent = 'Click the White 9.5 patch.';
      calc();
    };
    img.src = URL.createObjectURL(f);
  });

  $('pc').addEventListener('click', (e) => {
    if (!src) return;
    const c = $<HTMLCanvasElement>('pc'), r = c.getBoundingClientRect();
    const mx = ((e.clientX - r.left) * c.width) / r.width, my = ((e.clientY - r.top) * c.height) / r.height;
    const h = Math.max(3, (src.width / 200) | 0);
    const d = src.getContext('2d')!.getImageData(Math.max(0, (mx - h) | 0), Math.max(0, (my - h) | 0), 2 * h, 2 * h).data;
    const a = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { a[0] += d[i]; a[1] += d[i + 1]; a[2] += d[i + 2]; n++; }
    picked[pick] = a.map((v) => v / n);
    marks = marks.filter((m) => m[0] !== pick);
    marks.push([pick, mx, my]);
    const i = PICKS.findIndex(([k]) => k === pick), next = PICKS.slice(i + 1).find(([k]) => !picked[k]);
    if (next) pick = next[0];
    $('photoHint').textContent = next ? `Now click ${next[1]}.` : 'All points picked. Click any point again to re-pick it.';
    drawPicks(); drawPhoto(); calc();
  });

  $('calTarget').addEventListener('change', syncRatio);
  $('calApply').onclick = () => {
    const v = $<HTMLSelectElement>('calTarget').value, msg = $('calMsg');
    if (!measured) { msg.textContent = 'Pick the chart patches and the paint sample first.'; return; }
    if (v === 'mix') {
      const p = finalColour(mix, cal).rgb, de = deltaE(p, measured);
      cal.checks.push({ n: mix.n, p: linearToHex(p), m: linearToHex(measured), de });
      cal.checks = cal.checks.slice(-30);
      msg.textContent = `Logged: ΔE ${de.toFixed(1)}.`;
    } else {
      const [kind, id] = v.split(':'), x = TONERS.find((z) => z.id === id)!;
      cal.t[id] ??= {};
      if (kind === 'm') {
        cal.t[id].hex = linearToHex(measured);
        msg.textContent = `${x.n} masstone saved.`;
      } else {
        const ratio = Math.max(0.1, +$<HTMLInputElement>('letRatio').value || 4);
        cal.t[id].str = tintStrength(x, TONERS[0], measured, ratio, cal);
        msg.textContent = `${x.n} tint strength saved` + (cal.t[id].hex ? '.' : '. Calibrate its masstone too for best results.');
      }
    }
    refresh();
  };

  $('calStatus').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-reset]');
    if (b) { delete cal.t[b.dataset.reset!]; refresh(); }
  };
  $('calCopy').onclick = async () => {
    const b = $('calCopy');
    try { await navigator.clipboard.writeText($<HTMLTextAreaElement>('calJson').value); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy the text'; }
    setTimeout(() => (b.textContent = 'Copy'), 1600);
  };
  $('calLoad').onclick = () => {
    try {
      const d = JSON.parse($<HTMLTextAreaElement>('calJson').value) as Calibration;
      if (!d || typeof d.t !== 'object' || !Array.isArray(d.checks)) throw new Error('invalid');
      cal.t = d.t;
      cal.checks = d.checks;
      refresh();
      $('calMsg').textContent = 'Calibration restored.';
    } catch {
      $('calMsg').textContent = 'That text is not a valid calibration backup.';
    }
  };

  drawPicks();
  targets();
  render();
}
