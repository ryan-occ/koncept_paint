import { GROUNDS, PEARLS, TONERS } from '../data/toners.ts';
import { POWDERS } from '../data/powders.ts';
import { $, mix, onChange, storage } from './store.ts';

/** Workstation chrome: tabs, collapsible layer summaries and keyboard shortcuts. */

const TAB_KEY = 'pbs-tabs';
const tabState: Record<string, string> = storage.get(TAB_KEY, {});

export function showTab(group: string, tab: string) {
  const bar = document.querySelector<HTMLElement>(`.tabs[data-group="${group}"]`);
  if (!bar) return;
  const pane = bar.parentElement!;
  bar.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  pane.querySelectorAll<HTMLElement>(':scope > [role=tabpanel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  tabState[group] = tab;
  storage.set(TAB_KEY, tabState);
}

function initTabs() {
  document.querySelectorAll<HTMLElement>('.tabs[data-group]').forEach((bar) => {
    const group = bar.dataset.group!;
    const tabs = [...bar.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[role=tab]');
      if (b) showTab(group, b.dataset.tab!);
    });
    bar.addEventListener('keydown', (e) => {
      const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      showTab(group, next.dataset.tab!);
      next.focus();
    });
    const saved = tabState[group];
    showTab(group, tabs.some((t) => t.dataset.tab === saved) ? saved : tabs[0].dataset.tab!);
  });
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const short = (label: string) => label.replace(/\s*\(.*\)$/, '');

/** One-line summaries on each collapsed layer, so the whole system reads at a glance. */
function summaries() {
  const used = TONERS.filter((x) => mix.t[x.id] > 0);
  const total = used.reduce((a, x) => a + mix.t[x.id], 0);
  const top = used.sort((a, b) => mix.t[b.id] - mix.t[a.id]).slice(0, 2).map((x) => `${x.n.split(' ').slice(-1)[0].toLowerCase()} ${Math.round((mix.t[x.id] / total) * 100)}%`);
  const powders = [mix.m1, mix.m2].filter((k) => k !== 'none' && POWDERS[k]).map((k) => short(POWDERS[k].label));
  const set: Record<string, string> = {
    sum1: GROUNDS[mix.g][0],
    sum2: used.length ? `${top.join(', ')}${used.length > 2 ? ` +${used.length - 2}` : ''} · ${plural(mix.bc, 'coat')}` : 'No toners',
    sum3: [mix.fl ? `${mix.fl}% ${mix.fs} flake` : 'No flake', mix.p !== 'none' && mix.pa ? `${PEARLS[mix.p][0].toLowerCase()} pearl` : ''].filter(Boolean).join(' · '),
    sum4: mix.mic && powders.length ? `${powders.join(' + ')} · ${plural(mix.mic, 'coat')}` : 'None',
    sum5: mix.cc ? `${mix.cd.toUpperCase()} · ${plural(mix.cc, 'coat')}` : 'None',
    sum6: mix.clr ? `${plural(mix.clr, 'coat')} · ${mix.fin}` : 'None',
  };
  for (const [id, text] of Object.entries(set)) { const el = document.getElementById(id); if (el) el.textContent = text; }
}

function initLayers() {
  const all = () => [...document.querySelectorAll<HTMLDetailsElement>('.layer-sec details')];
  $('expandAll').onclick = () => all().forEach((d) => (d.open = true));
  $('collapseAll').onclick = () => all().forEach((d) => (d.open = false));
  onChange(summaries);
  summaries();
}

const typing = (el: Element | null) => !!el && (el.matches('input, textarea, select') || (el as HTMLElement).isContentEditable);

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('saveBtn').click(); return; }
    // Ctrl+P prints the mixing sheet rather than the app screen.
    if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); $('printBtn').click(); return; }
    if (e.key === '/' && !mod && !typing(document.activeElement)) {
      e.preventDefault();
      showTab('lib', 'find');
      $<HTMLInputElement>('colorQ').focus();
    }
  });
  // Loading a matched colour or a library mix jumps to the layer view.
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#loadMatch, #presets .chip, #saved .chip')) showTab('work', 'layers');
  });
}

export function initLayout() {
  initTabs();
  initLayers();
  initShortcuts();
}
