import { CARS } from '../data/cars.ts';
import { DEFAULT_SPECS, LAYER_NAMES, SCOPES, VEHICLES, estimateUsage, type JobSettings, type LayerKey, type Usage } from '../usage.ts';
import { colourTravel, describe, travelSummary, type TravelPoint } from '../color/travel.ts';
import type { Calibration, Mix } from '../types.ts';
import { $, changed, esc, storage, view } from './store.ts';

/**
 * Job size and paint quantities (Recipe tab), automatic batch weight, and colour travel.
 */
interface JobPrefs {
  vehicle: string; // 'auto' | VEHICLES id | 'custom'
  custom: number;
  scope: JobSettings['scope'];
  buffer: number;
  te: number;
  density: number;
  autoBatch: boolean;
  specs: Record<LayerKey, { dft: number; vs: number; ratio: [number, number, number] }>;
}
const KEY = 'pbs-job';
const stored = storage.get<Partial<JobPrefs>>(KEY, {});
const prefs: JobPrefs = {
  vehicle: 'auto', custom: 15, scope: 'ext', buffer: 10, te: 60, density: 1.1, autoBatch: true,
  ...stored,
  specs: { ...structuredClone(DEFAULT_SPECS), ...(stored.specs ?? {}) },
};
const save = () => storage.set(KEY, prefs);

/** Area and its source label for the current preview. */
export function jobArea(): { area: number; label: string } {
  if (prefs.vehicle === 'custom') return { area: Math.max(0, prefs.custom), label: 'Custom area' };
  if (prefs.vehicle !== 'auto') {
    const v = VEHICLES.find((x) => x.id === prefs.vehicle) ?? VEHICLES[1];
    return { area: v.area, label: v.label };
  }
  const car = view.shape === 'custom' ? CARS.find((c) => c.id === view.carId) : undefined;
  if (car) return { area: car.areaM2, label: car.name };
  return { area: VEHICLES[1].area, label: `${VEHICLES[1].label} (default)` };
}

export function jobSettings(): JobSettings {
  return { area: jobArea().area, scope: prefs.scope, buffer: prefs.buffer, te: prefs.te, density: prefs.density, specs: prefs.specs };
}

const f2 = (n: number) => (n < 0.005 ? '—' : n.toFixed(2));

/**
 * Called at the start of every recipe update: sizes the batch and mid-coat binder to the job
 * when auto batch is on, and returns the usage for display and printing.
 */
export function applyJob(mix: Mix): Usage {
  const usage = estimateUsage(mix, jobSettings());
  if (prefs.autoBatch && usage.baseGrams > 0) $<HTMLInputElement>('batch').value = String(usage.baseGrams);
  if (prefs.autoBatch && usage.midBinderL > 0 && Math.abs(mix.mv - usage.midBinderL) > 1e-6) {
    mix.mv = usage.midBinderL;
    const slider = document.querySelector<HTMLInputElement>('[data-k=mv]');
    if (slider) slider.value = String(Math.min(+slider.max, mix.mv));
  }
  renderUsage(usage);
  return usage;
}

function renderUsage(u: Usage) {
  const { label } = jobArea();
  $('jobArea').textContent = `${label} · ${u.area.toFixed(1)} m² painted (${SCOPES[prefs.scope].label.toLowerCase()})`;
  $('usageBody').innerHTML = u.layers.map((l) => `<tr><td>${l.name}</td><td class="n">${l.coats}</td><td class="n">${f2(l.rtsL)}</td><td class="n">${f2(l.paintL)}${l.key === 'base' ? `<br><small>${u.baseGrams} g</small>` : ''}</td><td class="n">${f2(l.hardenerL)}</td><td class="n">${f2(l.reducerL)}</td></tr>`).join('');
  $('batchAuto').setAttribute('aria-pressed', String(prefs.autoBatch));
}

export function usageHtml(u: Usage): string {
  return `<h2>Materials for this job</h2>
  <p class="ps-small">${esc(jobArea().label)} · ${u.area.toFixed(1)} m² painted (${SCOPES[prefs.scope].label.toLowerCase()}) · includes ${prefs.buffer}% buffer · transfer efficiency ${prefs.te}%.</p>
  <table class="ps-formula"><thead><tr><th>Layer</th><th class="n">Coats</th><th class="n">Ready to spray (L)</th><th class="n">Paint (L)</th><th class="n">Hardener (L)</th><th class="n">Reducer (L)</th></tr></thead><tbody>
  ${u.layers.map((l) => `<tr><td>${l.name}</td><td class="n">${l.coats}</td><td class="n">${f2(l.rtsL)}</td><td class="n">${f2(l.paintL)}${l.key === 'base' ? ` (${u.baseGrams} g)` : ''}</td><td class="n">${f2(l.hardenerL)}</td><td class="n">${f2(l.reducerL)}</td></tr>`).join('')}
  </tbody></table>
  <p class="ps-small">Estimate from film build and volume solids; confirm ratios and film build with the paint system's TDS.</p>`;
}

function travelStrip(points: TravelPoint[], cls: string) {
  return `<div class="${cls}">${points.map((p) => `<div><i style="background:${p.hex}"></i><b>${p.angle}°</b><span>${p.hex.toUpperCase()}</span><small title="CIELAB L* / a* / b*">${p.lab.map((v) => v.toFixed(1)).join(' / ')}</small><small>${describe(p.lab)}</small></div>`).join('')}</div>`;
}

let travelText = '';
export function renderTravel(mix: Mix, cal: Calibration) {
  const pts = colourTravel(mix, cal), s = travelSummary(pts);
  $('travel').innerHTML = `${travelStrip(pts, 'travel-strip')}<p class="cover">${esc(s.text)}</p>`;
  travelText = `${mix.n} — colour travel (simulated, confirm by measuring a sprayed panel)\n` +
    pts.map((p) => `${p.angle}°: ${p.hex.toUpperCase()}  L*${p.lab[0].toFixed(1)} a*${p.lab[1].toFixed(1)} b*${p.lab[2].toFixed(1)}  ${describe(p.lab)}`).join('\n') + `\n${s.text}`;
}

export function travelHtml(mix: Mix, cal: Calibration): string {
  const pts = colourTravel(mix, cal);
  return `<h2>Colour travel by viewing angle</h2>${travelStrip(pts, 'ps-travel')}<p>${esc(travelSummary(pts).text)}</p>
  <p class="ps-small">Angles are degrees from the specular reflection (15° highlight, 45° face, 110° flop), as used by multi-angle spectrophotometers. Values are simulated from this paint system; for a licensing or specification document, measure a sprayed panel and record those readings.</p>`;
}

function specRows() {
  $('specBody').innerHTML = (Object.keys(LAYER_NAMES) as LayerKey[]).map((k) => {
    const s = prefs.specs[k];
    return `<tr><td>${LAYER_NAMES[k]}</td><td><input type="number" min="1" step="1" data-spec="${k}" data-f="dft" value="${s.dft}" aria-label="${LAYER_NAMES[k]} film per coat"></td>
    <td><input type="number" min="1" max="100" step="1" data-spec="${k}" data-f="vs" value="${s.vs}" aria-label="${LAYER_NAMES[k]} volume solids"></td>
    <td><input type="text" data-spec="${k}" data-f="ratio" value="${s.ratio.join(':')}" aria-label="${LAYER_NAMES[k]} mix ratio paint:hardener:reducer"></td></tr>`;
  }).join('');
}

export function initJob() {
  $('jobVehicle').innerHTML = '<option value="auto">Match the preview car</option>' +
    VEHICLES.map((v) => `<option value="${v.id}">${v.label} (${v.area} m²)</option>`).join('') + '<option value="custom">Custom area…</option>';
  $('jobScope').innerHTML = Object.entries(SCOPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const sync = () => {
    $<HTMLSelectElement>('jobVehicle').value = prefs.vehicle;
    $<HTMLSelectElement>('jobScope').value = prefs.scope;
    $<HTMLInputElement>('jobCustom').value = String(prefs.custom);
    $('jobCustomRow').hidden = prefs.vehicle !== 'custom';
    $<HTMLInputElement>('jobBuffer').value = String(prefs.buffer);
    $<HTMLInputElement>('jobTe').value = String(prefs.te);
    $<HTMLInputElement>('jobDensity').value = String(prefs.density);
  };
  sync();
  specRows();
  const set = (fn: () => void) => { fn(); save(); sync(); changed(); };
  $('jobVehicle').addEventListener('change', (e) => set(() => { prefs.vehicle = (e.target as HTMLSelectElement).value; }));
  $('jobScope').addEventListener('change', (e) => set(() => { prefs.scope = (e.target as HTMLSelectElement).value; }));
  $('jobCustom').addEventListener('input', (e) => set(() => { prefs.custom = Math.max(0, +(e.target as HTMLInputElement).value || 0); }));
  $('jobBuffer').addEventListener('input', (e) => set(() => { prefs.buffer = Math.min(100, Math.max(0, +(e.target as HTMLInputElement).value || 0)); }));
  $('jobTe').addEventListener('input', (e) => set(() => { prefs.te = Math.min(100, Math.max(10, +(e.target as HTMLInputElement).value || 60)); }));
  $('jobDensity').addEventListener('input', (e) => set(() => { prefs.density = Math.max(0.5, +(e.target as HTMLInputElement).value || 1.1); }));
  $('specBody').addEventListener('change', (e) => {
    const i = e.target as HTMLInputElement, k = i.dataset.spec as LayerKey, f = i.dataset.f!;
    if (!k) return;
    if (f === 'ratio') {
      const parts = i.value.split(':').map((x) => Math.max(0, +x || 0));
      if (parts.length === 3 && parts[0] > 0) prefs.specs[k].ratio = parts as [number, number, number];
      else i.value = prefs.specs[k].ratio.join(':');
    } else (prefs.specs[k] as unknown as Record<string, number>)[f] = Math.max(1, +i.value || (DEFAULT_SPECS[k] as unknown as Record<string, number>)[f]);
    save();
    changed();
  });
  $('specReset').addEventListener('click', () => { prefs.specs = structuredClone(DEFAULT_SPECS); save(); specRows(); changed(); });
  // Batch: Auto sizes it from the job; typing a weight switches Auto off.
  $('batchAuto').addEventListener('click', () => { prefs.autoBatch = !prefs.autoBatch; save(); changed(); });
  $('batch').addEventListener('input', () => { if (prefs.autoBatch) { prefs.autoBatch = false; save(); $('batchAuto').setAttribute('aria-pressed', 'false'); } });
  $('travelCopy').addEventListener('click', async () => {
    const b = $('travelCopy');
    try { await navigator.clipboard.writeText(travelText); b.textContent = 'Copied'; } catch { b.textContent = 'Copy blocked'; }
    setTimeout(() => (b.textContent = 'Copy colour spec'), 1600);
  });
}
