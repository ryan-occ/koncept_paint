import { GROUNDS } from './data/toners.ts';
import { PEARLS } from './data/toners.ts';
import { POWDERS } from './data/powders.ts';
import type { BoothTemp, Mix } from './types.ts';
import type { MixResult } from './color/mixing.ts';
import { linearToHex } from './color/space.ts';

export type Step = [title: string, text: string];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The layer stack as shown on the recipe card. */
export function layers(mix: Mix, cov: number): Step[] {
  const pw = (k: string, l: number, role: string) =>
    k === 'none' || !l ? '' : `${role}: ${POWDERS[k].label} ${l} g/L (${+(l * mix.mv).toFixed(1)} g)`;
  const powders = [pw(mix.m1, mix.m1l, 'face'), pw(mix.m2, mix.m2l, 'flop')].filter(Boolean);
  return [
    ['Ground', GROUNDS[mix.g][0]],
    ['Base coat', `${plural(mix.bc, 'coat')} · ${Math.round(cov * 100)}% hiding`],
    ['Flake', mix.fl ? `${mix.fl}% · ${mix.fs}` : 'None (solid)'],
    ['Pearl', mix.p === 'none' || !mix.pa ? 'None' : `${PEARLS[mix.p][0]} · ${mix.pa}%`],
    ['Mid-coat', mix.mic && powders.length ? `${plural(mix.mic, 'coat')} in ${mix.mv} L binder · ${powders.join(' · ')}` : 'None'],
    ['Candy', mix.cc ? `${mix.cd.toUpperCase()} · ${plural(mix.cc, 'coat')}` : 'None'],
    ['Clear', mix.clr ? `${plural(mix.clr, 'coat')} · ${mix.fin}${mix.fin === 'gloss' ? ` · peel ${mix.peel}%` : ''}` : 'None (base only)'],
  ];
}

/** Step-by-step spray plan for the current mix. Typical ranges only; the paint system's TDS wins. */
export function applicationGuide(mix: Mix, cov: number, m: MixResult, temp: BoothTemp): Step[] {
  const g: Step[] = [];
  const used = ([[mix.m1, mix.m1l], [mix.m2, mix.m2l]] as [string, number][]).filter(([k, l]) => k !== 'none' && l > 0);
  const kinds = used.map(([k]) => POWDERS[k].kind);
  const mixLum = m.rgb.reduce((a, c) => a + c, 0) / 3;
  const big = mix.m1 === 'holo_std' || mix.m2 === 'holo_std';
  const flakey = kinds.some((k) => k === 'holo' || k === 'glass');
  const T = {
    cool: 'Cool booth: allow longer flash times and use the standard or fast reducer the TDS lists for your temperature.',
    warm: 'Use the standard reducer for your temperature range and follow TDS flash times.',
    hot: 'Hot booth: use slow reducer and hardener, expect paint to flash faster and watch for dry spray and solvent pop on heavy coats. Spray early in the day or with booth cooling running.',
  }[temp];

  g.push(['Prep and safety', 'Sand to the grade the sealer TDS asks for, blow off, degrease and tack. Wear a respirator rated for isocyanates (supplied air is best) with 2K clears and hardeners. Spray a test card alongside the job at every stage. ' + T]);
  g.push(['Ground coat', `${GROUNDS[mix.g][0]}: one even wet coat. Lay the base within the sealer's recoat window so you don't need to sand it.`]);
  g.push(['Base coat', `${plural(mix.bc, 'medium-wet coat')}, 50–75% overlap, gun about 15–20 cm from the panel. Let each coat flash until it goes dull before the next.` +
    (mix.fl ? " Metallic: finish with a lighter orientation (drop) coat from slightly further away so the flake lies even and doesn't mottle." : '') +
    (m.tot && cov < 0.95 ? ' Hiding is low for this ground, so plan an extra coat or a closer sealer colour.' : '')]);

  if (mix.mic && used.length) {
    const pw = used.map(([k, l]) => `${+(l * mix.mv).toFixed(1)} g ${POWDERS[k].label}`).join(' + ');
    g.push(['Mid-coat (powder in binder)', `Mix ${pw} into ${mix.mv} L of intercoat clear and stir until no clumps are left. Powders settle, so shake the cup between passes. ` +
      (flakey ? 'Use a coarse strainer or none, because fine strainers catch flake. ' : 'Strain before filling the gun. ') +
      `Use a ${big ? '1.8 mm or larger' : '1.4–1.5 mm'} tip. Spray ${plural(mix.mic, 'coat')} with the same distance, speed and overlap every pass, crossing direction each coat. Any change shows as stripes or patches. The effect builds coat by coat, so check the test card each time.` +
      (kinds.includes('int') && (mix.g !== 'black' || mixLum > 0.08) ? ' Ghost pearls show weakly over this lighter base. Go darker for a stronger flip.' : '')]);
  }
  if (mix.cc) g.push(['Candy', `${plural(mix.cc, 'even coat')}. Candy gets darker with every coat, so keep passes identical, finish whole panels in one session and count coats per panel. Compare with the test card after each coat.`]);
  if (mix.clr) {
    g.push(['Clear coat', `${plural(mix.clr, 'wet coat')}, flashing between coats per TDS. ` + (mix.fin === 'gloss'
      ? (mix.peel > 40 ? 'Orange peel is set high, so check reduction and air pressure, or plan to wet-sand and polish. ' : '') +
        (flakey || big ? 'Flake needs extra clear to bury it before you sand flat. ' : '') +
        'An extra coat gives you room to wet-sand and polish for a show finish.'
      : 'Satin and matte clears set the sheen themselves: spray evenly, never sand or polish, and expect touch-ups to show.')]);
  } else g.push(['No clear', 'Base coat alone is not durable and stays dull. Only use this for test cards.']);
  g.push(['Cure and finish', 'Bake or air-dry per TDS before handling, sanding or polishing. Check the final test card in sunlight and booth light against the preview.']);
  return g;
}

/** Plain-text recipe for copying. */
export function recipeText(mix: Mix, rgb: readonly number[], toners: { n: string; parts: number }[], total: number, batch: number, steps: Step[], guide: Step[]): string {
  return `${mix.n} — paint system\nFlat base colour ${linearToHex(rgb).toUpperCase()}\n\nBase toners (batch ${batch} g):\n` +
    toners.map((x) => `  ${x.n}: ${+x.parts.toFixed(2)} parts, ${((x.parts / total) * 100).toFixed(1)}%, ${Math.round((x.parts / total) * batch)} g`).join('\n') +
    '\n\n' + steps.map(([a, b]) => `${a}: ${b}`).join('\n') +
    '\n\nToner weights only — add binder/reducer/hardener per TDS. Spray-out card first.\n\nAPPLICATION GUIDE\n' +
    guide.map(([a, b], i) => `${i + 1}. ${a}: ${b}`).join('\n');
}
