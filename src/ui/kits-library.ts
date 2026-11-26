import { PRESETS } from '../data/presets.ts';
import { toLibraryPaint, type LibraryPaint } from '../library.ts';
import { loadPreset } from './bench.ts';
import { isMix } from './mix-backup.ts';
import { $, cal, esc, mix } from './store.ts';

let paints: LibraryPaint[] = [];
let busy = false;

class LibraryError extends Error {}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new LibraryError('Could not reach the app. Check your connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new LibraryError(data?.error ?? `The library request failed (${response.status}).`);
  return data as T;
}

const message = (text: string) => { $('kitsLibMsg').textContent = text; };

function swatch(p: LibraryPaint) {
  const background = p.hex2 ? `linear-gradient(135deg,${p.hex},${p.hex2})` : p.hex;
  return `<i style="width:12px;height:12px;border-radius:3px;background:${background}"></i>`;
}

function draw() {
  $('kitsLibrary').innerHTML = paints.length
    ? paints.map((p, i) => `<button class="chip" type="button" data-i="${i}" title="${esc(p.finish)}">${swatch(p)}${esc(p.name)}<span class="x" data-del="${i}" aria-label="Remove ${esc(p.name)} from the library">×</span></button>`).join('')
    : '<span style="font-size:13px;color:var(--mute)">Nothing in the library yet.</span>';
}

function setBusy(next: boolean) {
  busy = next;
  for (const id of ['kitsLibSaveBtn', 'kitsLibPresetsBtn']) $<HTMLButtonElement>(id).disabled = next;
}

async function refresh() {
  try {
    paints = (await call<{ paints: LibraryPaint[] }>('GET', '/api/library')).paints;
    draw();
  } catch (error) {
    $('kitsLibrary').innerHTML = '';
    message(error instanceof Error ? error.message : 'Could not load the library.');
  }
}

async function save(batch: LibraryPaint[], done: (added: number, updated: number) => string) {
  if (busy) return;
  setBusy(true);
  const before = new Set(paints.map((p) => p.name.toLowerCase()));
  try {
    paints = (await call<{ paints: LibraryPaint[] }>('PUT', '/api/library', { paints: batch })).paints;
    draw();
    const updated = batch.filter((p) => before.has(p.name.toLowerCase())).length;
    message(done(batch.length - updated, updated));
  } catch (error) {
    message(error instanceof Error ? error.message : 'Could not save to the library.');
  } finally {
    setBusy(false);
  }
}

export function initKitsLibrary() {
  $('kitsLibSaveBtn').onclick = () => {
    const name = $<HTMLInputElement>('mixName').value.trim();
    if (!name || name === 'Untitled mix') {
      message('Name the mix first: Koncept Kits shows it by name.');
      $('mixName').focus();
      return;
    }
    const paint = toLibraryPaint({ ...mix, n: name }, cal, 'custom');
    void save([paint], (added) => `${added ? 'Added' : 'Updated'} “${paint.name}” in the Koncept Kits library.`);
  };

  $('kitsLibPresetsBtn').onclick = () => {
    void save(PRESETS.map((p) => toLibraryPaint(p, cal, 'preset')),
      (added, updated) => `Added ${added} and updated ${updated} starting point${added + updated === 1 ? '' : 's'} in the Koncept Kits library.`);
  };

  $('kitsLibrary').onclick = async (event) => {
    const target = event.target as HTMLElement;
    const del = target.closest<HTMLElement>('[data-del]');
    if (del) {
      const paint = paints[+del.dataset.del!];
      if (!paint?.id || busy) return;
      if (!confirm(`Remove “${paint.name}” from the Koncept Kits library? Builds that already use it keep their colour.`)) return;
      setBusy(true);
      try {
        await call<void>('DELETE', `/api/library/${paint.id}`);
        paints = paints.filter((p) => p.id !== paint.id);
        draw();
        message(`Removed “${paint.name}” from the Koncept Kits library.`);
      } catch (error) {
        message(error instanceof Error ? error.message : 'Could not remove that paint.');
      } finally {
        setBusy(false);
      }
      return;
    }
    const chip = target.closest<HTMLElement>('button[data-i]');
    const paint = chip ? paints[+chip.dataset.i!] : undefined;
    if (!paint) return;
    if (!isMix(paint.recipe)) {
      message(`“${paint.name}” has a recipe this version can't open.`);
      return;
    }
    loadPreset(paint.recipe);
    message(`Opened “${paint.name}” on the mixing bench.`);
  };

  draw();
  void refresh();
}
