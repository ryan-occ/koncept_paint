import { CARS } from '../data/cars.ts';
import { DEFAULT_SPECS, LAYER_NAMES, SCOPES, VEHICLES, estimateUsage, type JobSettings, type LayerKey, type Usage } from '../usage.ts';
import { ANGLES, colourTravel, describe, measuredTravel, parseMeasuredReadings, travelSummary, type TravelPoint, type TravelSpecification } from '../color/travel.ts';
import type { Calibration, Mix, RGB } from '../types.ts';
import { $, changed, esc, mix, storage, view } from './store.ts';
import { renderTravelSection } from '../sheet.ts';

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
  profiles: PaintProfile[];
  activeProfile: string | null;
}
interface PaintProfile {
  id: string;
  name: string;
  te: number;
  density: number;
  specs: Record<LayerKey, { dft: number; vs: number; ratio: [number, number, number] }>;
}
const KEY = 'pbs-job';
const stored = storage.get<Partial<JobPrefs>>(KEY, {});
const LAYER_KEYS = Object.keys(LAYER_NAMES) as LayerKey[];
function validProfiles(value: unknown): PaintProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((raw): raw is PaintProfile => {
    if (!raw || typeof raw !== 'object') return false;
    const p = raw as Partial<PaintProfile>;
    if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim() ||
      typeof p.te !== 'number' || !Number.isFinite(p.te) || p.te < 10 || p.te > 100 ||
      typeof p.density !== 'number' || !Number.isFinite(p.density) || p.density < 0.5 || p.density > 10 ||
      !p.specs || typeof p.specs !== 'object') return false;
    return LAYER_KEYS.every((key) => {
      const spec = p.specs![key];
      return !!spec && Number.isFinite(spec.dft) && spec.dft > 0 &&
        Number.isFinite(spec.vs) && spec.vs > 0 && spec.vs <= 100 &&
        Array.isArray(spec.ratio) && spec.ratio.length === 3 &&
        spec.ratio.every((part) => Number.isFinite(part) && part >= 0) &&
        spec.ratio.some((part) => part > 0);
    });
  }).map((p) => ({ ...p, specs: structuredClone(p.specs) }));
}
const loadedProfiles = validProfiles(stored.profiles);
const prefs: JobPrefs = {
  vehicle: 'auto', custom: 15, scope: 'ext', buffer: 10, te: 60, density: 1.1, autoBatch: true,
  ...stored,
  specs: { ...structuredClone(DEFAULT_SPECS), ...(stored.specs ?? {}) },
  profiles: loadedProfiles,
  activeProfile: loadedProfiles.some((p) => p.id === stored.activeProfile) ? stored.activeProfile! : null,
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

interface SavedTravel { readings: RGB[]; savedAt: string }
const TRAVEL_KEY = 'pbs-travel-readings';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function readSavedTravel(): Record<string, SavedTravel> {
  const raw = storage.get<unknown>(TRAVEL_KEY, {});
  if (!isRecord(raw)) return {};
  const valid: Record<string, SavedTravel> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) continue;
    const readings = parseMeasuredReadings(value.readings);
    if (readings) valid[key] = { readings, savedAt: value.savedAt };
  }
  return valid;
}

const savedTravel = readSavedTravel();
const formulaKey = (mix: Mix) => {
  const formula = structuredClone(mix);
  formula.n = '';
  delete formula.hex;
  formula.mv = 0;
  return JSON.stringify(formula);
};
let travelInputKey = '';
let travelDirty = false;

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
  <p class="ps-small"><strong>Paint-system profile:</strong> ${esc(activeProfile()?.name ?? 'Custom estimate settings (no saved profile)')}</p>
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
export function travelSpecification(mix: Mix, cal: Calibration): TravelSpecification {
  const saved = savedTravel[formulaKey(mix)];
  const measured = saved ? measuredTravel(saved.readings) : null;
  const points = measured ?? colourTravel(mix, cal);
  return {
    source: measured ? 'measured' : 'simulated',
    ...(measured && saved ? { savedAt: saved.savedAt } : {}),
    points,
    summary: travelSummary(points),
  };
}

function syncTravelInputs(mix: Mix) {
  const key = formulaKey(mix);
  const saved = savedTravel[key];
  if (travelInputKey !== key) {
    travelInputKey = key;
    travelDirty = false;
    for (const [index, angle] of ANGLES.entries()) {
      const reading = saved?.readings[index];
      for (const [axisIndex, axis] of ['L', 'a', 'b'].entries()) {
        $<HTMLInputElement>(`travel${angle}${axis}`).value = reading ? reading[axisIndex].toFixed(1) : '';
      }
    }
  }
  $('travelClear').toggleAttribute('disabled', !saved);
  $('travelMeasureStatus').textContent = travelDirty
    ? 'Unsaved edits. Save all five angle readings to use them in the spec.'
    : saved
      ? `Measured readings saved ${saved.savedAt.slice(0, 10)} and used for this formula.`
      : 'No measured readings saved for this formula; the strip uses a simulated estimate.';
}

export function renderTravel(mix: Mix, cal: Calibration) {
  syncTravelInputs(mix);
  const spec = travelSpecification(mix, cal);
  const source = spec.source === 'measured' ? 'Measured spray-out readings' : 'Simulated estimate';
  $('travel').innerHTML = `${travelStrip(spec.points, 'travel-strip')}<p class="cover">${esc(spec.summary.text)}</p>`;
  $('travelSource').textContent = `Source: ${source}${spec.source === 'measured' ? ' · D65 CIELAB' : ''}${spec.savedAt ? ` · saved ${spec.savedAt.slice(0, 10)}` : ''}`;
  travelText = `${mix.n} — colour travel (${source})\n` +
    (spec.savedAt ? `Measured spray-out saved ${spec.savedAt.slice(0, 10)}. D65 CIELAB readings; sRGB swatches are display approximations.\n` : 'Simulated from this paint system, not measured. Confirm a sprayed panel before licensing.\n') +
    spec.points.map((p) => `${p.angle}°: ${p.hex.toUpperCase()}  L*${p.lab[0].toFixed(1)} a*${p.lab[1].toFixed(1)} b*${p.lab[2].toFixed(1)}  ${describe(p.lab)}`).join('\n') + `\n${spec.summary.text}`;
}

export function travelHtml(mix: Mix, cal: Calibration): string {
  return renderTravelSection(travelSpecification(mix, cal));
}

function specRows() {
  $('specBody').innerHTML = (Object.keys(LAYER_NAMES) as LayerKey[]).map((k) => {
    const s = prefs.specs[k];
    return `<tr><td>${LAYER_NAMES[k]}</td><td><input type="number" min="1" step="1" data-spec="${k}" data-f="dft" value="${s.dft}" aria-label="${LAYER_NAMES[k]} film per coat"></td>
    <td><input type="number" min="1" max="100" step="1" data-spec="${k}" data-f="vs" value="${s.vs}" aria-label="${LAYER_NAMES[k]} volume solids"></td>
    <td><input type="text" data-spec="${k}" data-f="ratio" value="${s.ratio.join(':')}" aria-label="${LAYER_NAMES[k]} mix ratio paint:hardener:reducer"></td></tr>`;
  }).join('');
}

function activeProfile() {
  return prefs.profiles.find((profile) => profile.id === prefs.activeProfile);
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
    const profileSelect = $<HTMLSelectElement>('jobProfile');
    profileSelect.innerHTML = '<option value="">Current settings (not a saved profile)</option>' +
      prefs.profiles.map((profile) => `<option value="${esc(profile.id)}">${esc(profile.name)}</option>`).join('');
    profileSelect.value = prefs.activeProfile ?? '';
    $('deleteJobProfile').toggleAttribute('disabled', !activeProfile());
  };
  $<HTMLInputElement>('jobProfileName').value = activeProfile()?.name ?? '';
  sync();
  specRows();
  $('travelInputs').innerHTML = `<table class="travel-entry"><thead><tr><th>Angle</th><th>L*</th><th>a*</th><th>b*</th></tr></thead><tbody>${ANGLES.map((angle) =>
    `<tr><th scope="row">${angle}°</th>${['L', 'a', 'b'].map((axis) => `<td><input id="travel${angle}${axis}" type="number" step="0.1" ${axis === 'L' ? 'min="0" max="100"' : 'min="-128" max="127"'} inputmode="decimal" aria-label="${angle} degrees ${axis} star"></td>`).join('')}</tr>`,
  ).join('')}</tbody></table>`;
  const set = (fn: () => void) => { fn(); save(); sync(); changed(); };
  $('jobVehicle').addEventListener('change', (e) => set(() => { prefs.vehicle = (e.target as HTMLSelectElement).value; }));
  $('jobScope').addEventListener('change', (e) => set(() => { prefs.scope = (e.target as HTMLSelectElement).value; }));
  $('jobCustom').addEventListener('input', (e) => set(() => { prefs.custom = Math.max(0, +(e.target as HTMLInputElement).value || 0); }));
  $('jobBuffer').addEventListener('input', (e) => set(() => { prefs.buffer = Math.min(100, Math.max(0, +(e.target as HTMLInputElement).value || 0)); }));
  const editProfileValues = (fn: () => void) => set(() => { fn(); prefs.activeProfile = null; });
  $('jobTe').addEventListener('input', (e) => editProfileValues(() => { prefs.te = Math.min(100, Math.max(10, +(e.target as HTMLInputElement).value || 60)); }));
  $('jobDensity').addEventListener('input', (e) => editProfileValues(() => { prefs.density = Math.max(0.5, +(e.target as HTMLInputElement).value || 1.1); }));
  $('jobProfile').addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    const profile = prefs.profiles.find((item) => item.id === id);
    if (!profile) { prefs.activeProfile = null; save(); sync(); changed(); return; }
    prefs.te = profile.te;
    prefs.density = profile.density;
    prefs.specs = structuredClone(profile.specs);
    prefs.activeProfile = profile.id;
    save();
    specRows();
    sync();
    $<HTMLInputElement>('jobProfileName').value = profile.name;
    changed();
  });
  $('saveJobProfile').addEventListener('click', () => {
    const name = $<HTMLInputElement>('jobProfileName').value.trim();
    if (!name) {
      $('jobProfileStatus').textContent = 'Enter a paint-system profile name first.';
      return;
    }
    const existing = prefs.profiles.find((profile) => profile.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const profile: PaintProfile = {
      id: existing?.id ?? `profile-${Date.now().toString(36)}`,
      name,
      te: prefs.te,
      density: prefs.density,
      specs: structuredClone(prefs.specs),
    };
    if (existing) prefs.profiles[prefs.profiles.indexOf(existing)] = profile;
    else prefs.profiles.unshift(profile);
    prefs.activeProfile = profile.id;
    save();
    $('jobProfileStatus').textContent = `Saved ${name}.`;
    sync();
    changed();
  });
  $('deleteJobProfile').addEventListener('click', () => {
    const profile = activeProfile();
    if (!profile) return;
    prefs.profiles = prefs.profiles.filter((item) => item.id !== profile.id);
    prefs.activeProfile = null;
    save();
    $('jobProfileStatus').textContent = `Removed ${profile.name}. Current values were kept.`;
    sync();
    changed();
  });
  $('specBody').addEventListener('change', (e) => {
    const i = e.target as HTMLInputElement, k = i.dataset.spec as LayerKey, f = i.dataset.f!;
    if (!k) return;
    if (f === 'ratio') {
      const parts = i.value.split(':').map((x) => Math.max(0, +x || 0));
      if (parts.length === 3 && parts[0] > 0) prefs.specs[k].ratio = parts as [number, number, number];
      else i.value = prefs.specs[k].ratio.join(':');
    } else (prefs.specs[k] as unknown as Record<string, number>)[f] = Math.max(1, +i.value || (DEFAULT_SPECS[k] as unknown as Record<string, number>)[f]);
    prefs.activeProfile = null;
    save();
    sync();
    changed();
  });
  $('specReset').addEventListener('click', () => { prefs.specs = structuredClone(DEFAULT_SPECS); prefs.activeProfile = null; save(); specRows(); sync(); changed(); });
  // Batch: Auto sizes it from the job; typing a weight switches Auto off.
  $('batchAuto').addEventListener('click', () => { prefs.autoBatch = !prefs.autoBatch; save(); changed(); });
  $('batch').addEventListener('input', () => { if (prefs.autoBatch) { prefs.autoBatch = false; save(); $('batchAuto').setAttribute('aria-pressed', 'false'); } });
  $('travelInputs').addEventListener('input', () => {
    travelDirty = true;
    $('travelMeasureStatus').textContent = 'Unsaved edits. Save all five angle readings to use them in the spec.';
  });
  $('travelSave').addEventListener('click', () => {
    const raw = ANGLES.map((angle) => ['L', 'a', 'b'].map((axis) => {
      const value = $<HTMLInputElement>(`travel${angle}${axis}`).value.trim();
      return value ? Number(value) : Number.NaN;
    }));
    const readings = parseMeasuredReadings(raw);
    if (!readings) {
      $('travelMeasureStatus').textContent = 'Enter all 15 values: L* from 0 to 100, a* and b* from −128 to 127.';
      return;
    }
    const key = formulaKey(mix);
    savedTravel[key] = { readings, savedAt: new Date().toISOString() };
    const latest = Object.entries(savedTravel)
      .sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))
      .slice(0, 100);
    for (const keyToRemove of Object.keys(savedTravel)) delete savedTravel[keyToRemove];
    Object.assign(savedTravel, Object.fromEntries(latest));
    storage.set(TRAVEL_KEY, savedTravel);
    travelDirty = false;
    travelInputKey = key;
    changed();
  });
  $('travelClear').addEventListener('click', () => {
    const key = formulaKey(mix);
    delete savedTravel[key];
    storage.set(TRAVEL_KEY, savedTravel);
    travelDirty = false;
    travelInputKey = '';
    changed();
  });
  $('travelCopy').addEventListener('click', async () => {
    const b = $('travelCopy');
    try { await navigator.clipboard.writeText(travelText); b.textContent = 'Copied'; } catch { b.textContent = 'Copy blocked'; }
    setTimeout(() => (b.textContent = 'Copy colour spec'), 1600);
  });
}
