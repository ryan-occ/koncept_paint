import type { GroundId, PearlId, Toner } from '../types.ts';

/** Relative scattering: white scatters strongly, black and transparent organics weakly. */
const SCATTER: Record<string, number> = { white: 1, black: 0.12, oxide: 0.45, yellow: 0.25, orange: 0.25 };

const RAW: Omit<Toner, 's'>[] = [
  { id: 'white', n: 'Titanium white', hex: '#f3f3ef', h: 0.92 },
  { id: 'black', n: 'Jet black', hex: '#111214', h: 0.95 },
  { id: 'blue', n: 'Phthalo blue', hex: '#12307e', h: 0.55 },
  { id: 'green', n: 'Phthalo green', hex: '#0b5c48', h: 0.55 },
  { id: 'red', n: 'Bright red', hex: '#c8161f', h: 0.5 },
  { id: 'oxide', n: 'Oxide red', hex: '#8b2b1d', h: 0.85 },
  { id: 'magenta', n: 'Quinacridone magenta', hex: '#a3164c', h: 0.4 },
  { id: 'violet', n: 'Carbazole violet', hex: '#4b1f7a', h: 0.45 },
  { id: 'yellow', n: 'Organic yellow', hex: '#f1c40a', h: 0.45 },
  { id: 'orange', n: 'Orange', hex: '#e8600e', h: 0.5 },
];

export const TONERS: Toner[] = RAW.map((t) => ({ ...t, s: SCATTER[t.id] ?? 0.12 }));

export const GROUNDS: Record<GroundId, [label: string, hex: string]> = {
  white: ['White sealer', '#e9eaea'],
  grey: ['Mid grey sealer', '#8d9093'],
  black: ['Black sealer', '#1e1f21'],
  oxide: ['Red oxide primer', '#7a3326'],
};

/** Pearl mixed into the base coat: [label, film thickness nm, IOR]. */
export const PEARLS: Record<PearlId, [label: string, film: number, ior: number]> = {
  none: ['None', 0, 1.5],
  white: ['White', 200, 1.5],
  gold: ['Gold', 330, 1.8],
  blue: ['Blue', 440, 1.8],
};
