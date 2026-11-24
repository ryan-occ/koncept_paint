import type { Booth } from '../render/booth.ts';
import { $, view } from './store.ts';
import { refreshShapes } from './bench.ts';

/**
 * Imported car model: upload a .glb, keep it in this browser (IndexedDB), credit line for
 * CC BY models, and a mode to fix which parts get the paint.
 */
interface StoredModel { name: string; credit: string; data: ArrayBuffer; painted: number[] }

const MAX_BYTES = 80 * 1024 * 1024;
let booth: Booth | null = null;
let current: StoredModel | null = null;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pbs-models', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('models');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function store(op: 'get' | 'put' | 'delete', value?: StoredModel): Promise<StoredModel | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('models', op === 'get' ? 'readonly' : 'readwrite');
    const os = tx.objectStore('models');
    const req = op === 'get' ? os.get('car') : op === 'put' ? os.put(value, 'car') : os.delete('car');
    req.onsuccess = () => resolve(op === 'get' ? (req.result as StoredModel | undefined) : undefined);
    req.onerror = () => reject(req.error);
  });
}
const save = () => { if (current) store('put', current).catch(() => msg('Saved for this session only: the browser would not store the model.')); };

const msg = (t: string) => { $('modelMsg').textContent = t; };
function showCredit() {
  const c = current?.credit.trim() ?? '';
  const el = $('modelCreditShow');
  el.textContent = c && view.shape === 'custom' ? c : '';
  el.hidden = !el.textContent;
}
function setPicking(on: boolean) {
  if (booth) booth.pickMode = on;
  $('modelPick').setAttribute('aria-pressed', String(on));
  $('view').classList.toggle('picking', on);
  if (on) msg('Click a part of the car to paint it or un-paint it. Drag still rotates. Click "Choose paint parts" again when done.');
}
function sync() {
  const has = !!current && !!booth?.hasCarModel;
  view.hasCar = has;
  $('modelPick').hidden = !has;
  $('modelRemove').hidden = !has;
  $<HTMLInputElement>('modelCredit').value = current?.credit ?? '';
  $('modelName').textContent = has ? current!.name : 'None loaded';
  if (!has && view.shape === 'custom') { view.shape = 'car'; booth?.setShape('car'); }
  refreshShapes();
  showCredit();
}

async function show(model: StoredModel, select: boolean) {
  if (!booth) return;
  msg('Loading model…');
  try {
    const painted = await booth.loadCarModel(model.data.slice(0), model.painted.length ? model.painted : null);
    model.painted = painted;
    current = model;
    if (select) { view.shape = 'custom'; booth.setShape('custom'); }
    sync();
    msg(painted.length
      ? `${painted.length} part${painted.length === 1 ? '' : 's'} painted. If the paint landed on the wrong parts, use "Choose paint parts".`
      : 'Could not tell which parts are the body. Use "Choose paint parts" and click the body panels.');
  } catch (err) {
    console.error(err);
    const text = String((err as Error)?.message ?? err);
    msg(/draco|meshopt|KHR_|EXT_/i.test(text)
      ? 'This model uses a compressed format the app cannot read yet. Export it again as a plain .glb (no Draco or Meshopt compression).'
      : 'Could not read this file. Use a .glb (binary glTF) model.');
  }
}

export function initCarModel() {
  $('modelFile').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (!/\.glb$/i.test(f.name)) { msg('Choose a .glb file. Sketchfab: Download 3D Model → glTF → .glb.'); return; }
    if (f.size > MAX_BYTES) { msg(`That file is ${(f.size / 1048576).toFixed(0)} MB. Use one under 80 MB so it loads on phones.`); return; }
    setPicking(false);
    await show({ name: f.name.replace(/\.glb$/i, ''), credit: $<HTMLInputElement>('modelCredit').value, data: await f.arrayBuffer(), painted: [] }, true);
    save();
  });
  $('modelCredit').addEventListener('input', () => {
    if (!current) return;
    current.credit = $<HTMLInputElement>('modelCredit').value;
    showCredit();
    save();
  });
  $('modelPick').addEventListener('click', () => {
    const on = $('modelPick').getAttribute('aria-pressed') !== 'true';
    if (on && view.shape !== 'custom') { view.shape = 'custom'; booth?.setShape('custom'); refreshShapes(); }
    setPicking(on);
    if (!on) msg('Paint parts saved.');
  });
  $('modelRemove').addEventListener('click', () => {
    setPicking(false);
    booth?.clearCarModel();
    current = null;
    store('delete').catch(() => {});
    sync();
    msg('Model removed from this browser.');
  });
  $('shapeSeg').addEventListener('click', () => setTimeout(showCredit));
}

/** Called once the 3D preview is ready: wire part picking and restore the saved model. */
export async function attachCarModel(b: Booth) {
  booth = b;
  b.onPaintPartsChange = (painted) => { if (current) { current.painted = painted; save(); } };
  try {
    const saved = await store('get');
    if (saved?.data) await show(saved, false);
  } catch { /* storage unavailable: start without a model */ }
}
