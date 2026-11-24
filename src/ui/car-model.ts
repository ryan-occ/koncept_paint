import type { Booth } from '../render/booth.ts';
import { CARS, type BuiltInCar } from '../data/cars.ts';
import { $, changed, storage, view } from './store.ts';
import { refreshShapes } from './bench.ts';

/**
 * Real-car models for the preview: built-in cars served with the app, or the user's own .glb
 * kept in this browser (IndexedDB). Credits for CC BY models show on the preview.
 */
interface StoredModel { name: string; credit: string; data: ArrayBuffer; painted: number[] }
interface CarPrefs { sel: string; painted: Record<string, number[]> }

const MAX_BYTES = 80 * 1024 * 1024;
const PREF_KEY = 'pbs-car';
let booth: Booth | null = null;
let upload: StoredModel | null = null;
let active: { id: string; credit: string } | null = null;
const prefs: CarPrefs = { sel: '', painted: {}, ...storage.get<Partial<CarPrefs>>(PREF_KEY, {}) };
const savePrefs = () => storage.set(PREF_KEY, prefs);

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pbs-models', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('models');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(op: 'get' | 'put' | 'delete', value?: StoredModel): Promise<StoredModel | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('models', op === 'get' ? 'readonly' : 'readwrite');
    const os = tx.objectStore('models');
    const req = op === 'get' ? os.get('car') : op === 'put' ? os.put(value, 'car') : os.delete('car');
    req.onsuccess = () => resolve(op === 'get' ? (req.result as StoredModel | undefined) : undefined);
    req.onerror = () => reject(req.error);
  });
}

const msg = (t: string) => { $('modelMsg').textContent = t; };

function showCredit() {
  const el = $('modelCreditShow');
  el.textContent = active && view.shape === 'custom' ? active.credit.trim() : '';
  el.hidden = !el.textContent;
}

function setPicking(on: boolean) {
  if (booth) booth.pickMode = on;
  $('modelPick').setAttribute('aria-pressed', String(on));
  $('view').classList.toggle('picking', on);
  if (on) msg('Click a part of the car to paint it or un-paint it. Drag still rotates. Click "Choose paint parts" again when done.');
}

function renderSelect() {
  const sel = $<HTMLSelectElement>('carSel');
  sel.innerHTML = '<option value="">No real car</option>' +
    `<optgroup label="Built-in cars">${CARS.map((c) => `<option value="${c.id}">${c.name} (${c.sizeMb} MB)</option>`).join('')}</optgroup>` +
    (upload ? `<optgroup label="Your upload"><option value="upload">${upload.name.replace(/</g, '&lt;')}</option></optgroup>` : '');
  sel.value = active?.id ?? '';
}

function sync() {
  const has = !!active && !!booth?.hasCarModel;
  view.hasCar = has;
  view.carId = has ? active!.id : undefined;
  $('modelPick').hidden = !has;
  $('modelRemove').hidden = !upload;
  $('creditRow').hidden = active?.id !== 'upload';
  $<HTMLInputElement>('modelCredit').value = upload?.credit ?? '';
  $('modelName').textContent = has ? (active!.id === 'upload' ? upload!.name : CARS.find((c) => c.id === active!.id)!.name) : 'None';
  if (!has && view.shape === 'custom') { view.shape = 'car'; booth?.setShape('car'); }
  renderSelect();
  refreshShapes();
  showCredit();
  changed();
}

async function loadInto(id: string, data: ArrayBuffer, credit: string, paint?: string[], select = true) {
  if (!booth) return;
  setPicking(false);
  msg('Loading model…');
  try {
    const saved = prefs.painted[id];
    const painted = await booth.loadCarModel(data, saved?.length ? saved : null, paint);
    active = { id, credit };
    prefs.sel = id;
    savePrefs();
    if (id === 'upload' && upload) { upload.painted = painted; void idb('put', upload).catch(() => {}); }
    if (select) { view.shape = 'custom'; booth.setShape('custom'); }
    sync();
    msg(painted.length
      ? `${painted.length} part${painted.length === 1 ? '' : 's'} painted. If the paint is on the wrong parts, use "Choose paint parts".`
      : 'Could not tell which parts are the body. Use "Choose paint parts" and click the body panels.');
  } catch (err) {
    console.error(err);
    const text = String((err as Error)?.message ?? err);
    msg(/draco|meshopt/i.test(text)
      ? 'This model uses a compressed format the app cannot read yet. Export it again as a plain .glb (no Draco or Meshopt compression).'
      : 'Could not read this model. Use a .glb (binary glTF) file.');
  }
}

async function loadBuiltIn(car: BuiltInCar, select = true) {
  msg(`Downloading ${car.name} (${car.sizeMb} MB)…`);
  try {
    const res = await fetch(car.file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadInto(car.id, await res.arrayBuffer(), car.credit, car.paint, select);
  } catch (err) {
    console.error(err);
    msg(`Could not download ${car.name}. Check the connection and try again.`);
  }
}

function clearActive() {
  setPicking(false);
  booth?.clearCarModel();
  active = null;
  prefs.sel = '';
  savePrefs();
  sync();
}

export function initCarModel() {
  renderSelect();
  $('carSel').addEventListener('change', () => {
    const v = $<HTMLSelectElement>('carSel').value;
    if (!v) { clearActive(); msg('Real car turned off.'); return; }
    if (v === 'upload' && upload) { void loadInto('upload', upload.data.slice(0), upload.credit); return; }
    const car = CARS.find((c) => c.id === v);
    if (car) void loadBuiltIn(car);
  });
  $('modelFile').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (!/\.glb$/i.test(f.name)) { msg('Choose a .glb file. Sketchfab: Download 3D Model → GLB.'); return; }
    if (f.size > MAX_BYTES) { msg(`That file is ${(f.size / 1048576).toFixed(0)} MB. Use one under 80 MB so it loads on phones.`); return; }
    upload = { name: f.name.replace(/\.glb$/i, ''), credit: '', data: await f.arrayBuffer(), painted: [] };
    delete prefs.painted.upload;
    await loadInto('upload', upload.data.slice(0), '');
    void idb('put', upload).catch(() => msg('Loaded for this session only: the browser would not store the model.'));
  });
  $('modelCredit').addEventListener('input', () => {
    if (!upload) return;
    upload.credit = $<HTMLInputElement>('modelCredit').value;
    if (active?.id === 'upload') active.credit = upload.credit;
    showCredit();
    void idb('put', upload).catch(() => {});
  });
  $('modelPick').addEventListener('click', () => {
    const on = $('modelPick').getAttribute('aria-pressed') !== 'true';
    if (on && view.shape !== 'custom') { view.shape = 'custom'; booth?.setShape('custom'); refreshShapes(); }
    setPicking(on);
    if (!on) msg('Paint parts saved.');
  });
  $('modelRemove').addEventListener('click', () => {
    if (active?.id === 'upload') clearActive();
    upload = null;
    delete prefs.painted.upload;
    savePrefs();
    void idb('delete').catch(() => {});
    sync();
    msg('Your uploaded model was removed from this browser.');
  });
  $('shapeSeg').addEventListener('click', () => setTimeout(showCredit));
}

/** Called once the 3D preview is ready: wire part picking and restore the last real car. */
export async function attachCarModel(b: Booth) {
  booth = b;
  b.onPaintPartsChange = (painted) => {
    if (!active) return;
    prefs.painted[active.id] = painted;
    savePrefs();
    if (active.id === 'upload' && upload) { upload.painted = painted; void idb('put', upload).catch(() => {}); }
  };
  try { upload = (await idb('get')) ?? null; } catch { upload = null; }
  if (upload && !prefs.painted.upload && upload.painted.length) prefs.painted.upload = upload.painted;
  sync();
  const car = CARS.find((c) => c.id === prefs.sel);
  if (car) await loadBuiltIn(car, false);
  else if (prefs.sel === 'upload' && upload) await loadInto('upload', upload.data.slice(0), upload.credit, undefined, false);
}
