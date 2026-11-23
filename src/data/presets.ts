import type { Mix } from '../types.ts';

const BASE: Omit<Mix, 'n' | 't'> = {
  g: 'grey', bc: 2, fl: 0, fs: 'fine', p: 'none', pa: 0, cd: '#ffffff', cc: 0,
  clr: 2, fin: 'gloss', peel: 20, m1: 'none', m1l: 0, m2: 'none', m2l: 0, mic: 0, mv: 1,
};

const mix = (n: string, t: Record<string, number>, o: Partial<Mix> = {}): Mix => ({ ...BASE, n, t, ...o });

/** Starting points: sample mixes, not manufacturer formulas. */
export const PRESETS: Mix[] = [
  mix('Candy apple red', { white: 10, black: 0.2 }, { fl: 85, cd: '#b3071b', cc: 3, clr: 3, peel: 15 }),
  mix('Pearl white tri-coat', { white: 20, yellow: 0.02 }, { g: 'white', p: 'white', pa: 70 }),
  mix('DIY flip: violet to green', { black: 10 }, { g: 'black', clr: 3, peel: 15, m1: 'int_violet', m1l: 25, m2: 'int_green', m2l: 20, mic: 3 }),
  mix('DIY flip: blue to gold', { black: 8, blue: 1 }, { g: 'black', fl: 20, clr: 3, peel: 15, m1: 'int_blue', m1l: 30, m2: 'int_gold', m2l: 20, mic: 3 }),
  mix('Holographic silver over black', { black: 10 }, { g: 'black', fs: 'medium', clr: 3, peel: 15, m1: 'holo_micro', m1l: 20, mic: 2 }),
  mix('Turquoise pearl with ghost blue edge', { white: 4, green: 1, blue: 0.5 }, { m1: 'col_turq', m1l: 20, m2: 'int_blue', m2l: 15, mic: 2 }),
  mix('Ghost sparkle over red', { red: 6, oxide: 1 }, { fs: 'medium', m1: 'glass', m1l: 30, m2: 'int_gold', m2l: 12, mic: 2 }),
  mix('Teal metallic', { green: 3, blue: 1, white: 1 }, { fl: 65, fs: 'medium', peel: 25 }),
  mix('Cement grey solid', { white: 6, black: 1, oxide: 0.05, yellow: 0.03 }, { peel: 25 }),
  mix('Satin black', { black: 10 }, { g: 'black', fin: 'satin', peel: 10 }),
  mix('Matte gunmetal', { black: 3, white: 1.2 }, { fl: 80, fs: 'coarse', fin: 'matte', peel: 0 }),
  mix('Oil-slick petrol', { black: 8, blue: 1, green: 0.35 }, { g: 'black', fl: 18, fs: 'fine', m1: 'int_blue', m1l: 24, m2: 'int_green', m2l: 18, mic: 3, clr: 3, peel: 12 }),
  mix('Copper comet', { oxide: 3, orange: 1, red: 0.35 }, { g: 'black', fl: 38, fs: 'medium', m1: 'int_copper', m1l: 24, m2: 'spk_gold', m2l: 9, mic: 2, clr: 3, peel: 12 }),
  mix('Ultraviolet static', { black: 7, magenta: 0.8, violet: 0.7 }, { g: 'black', fl: 42, fs: 'coarse', m1: 'int_violet', m1l: 28, m2: 'holo_micro', m2l: 8, mic: 2, clr: 3, peel: 10 }),
  mix('Arctic tide', { white: 12, blue: 0.12, green: 0.08 }, { g: 'white', p: 'blue', pa: 52, m1: 'col_turq', m1l: 16, m2: 'spk_silver', m2l: 8, mic: 2, clr: 3, peel: 10 }),
  mix('Solar flare', { red: 4, orange: 1, yellow: 0.45 }, { g: 'oxide', fl: 35, fs: 'medium', m1: 'int_gold', m1l: 14, mic: 1, cd: '#ff552c', cc: 2, clr: 3, peel: 12 }),
  mix('Ghost orchid', { black: 6, magenta: 1.2, violet: 0.7 }, { g: 'black', p: 'blue', pa: 14, m1: 'int_red', m1l: 16, m2: 'int_violet', m2l: 22, mic: 3, clr: 3, peel: 10 }),
];

export const DEFAULT_MIX = BASE;
