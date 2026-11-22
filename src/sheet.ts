import { GROUNDS, PEARLS, TONERS } from './data/toners.ts';
import { POWDERS } from './data/powders.ts';
import { finalColour, midFactor, tonerHex } from './color/mixing.ts';
import { hexToLinear, linearToHex } from './color/space.ts';
import { applicationGuide, type Step } from './guide.ts';
import type { BoothTemp, Calibration, Mix, RGB } from './types.ts';

/** Printable mixing sheet: everything the mixing room needs, from ground coat to clear. */

export interface FormulaRow { name: string; swatch: string; parts: number; pct: number; grams: number; cumulative: number }
export interface Stage {
  key: 'ground' | 'base' | 'mid' | 'candy' | 'clear';
  title: string;
  product: string;
  why: string;
  notes: string[];
  mix: string;
  coats: string;
  /** colour patch after this layer: a flat colour or a CSS gradient for effect layers */
  patch: string;
  patchLabel: string;
}
export interface Sheet {
  name: string;
  date: string;
  finalHex: string;
  calibration: string;
  batch: number;
  details: Required<SheetDetails>;
  formula: FormulaRow[];
  stages: Stage[];
  guide: Step[];
  general: string[];
}

export interface SheetDetails {
  jobNumber?: string;
  vehiclePanels?: string;
  paintSystem?: string;
  technician?: string;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const lerp = (a: RGB, b: RGB, t: number) => a.map((v, i) => v + (b[i] - v) * t) as RGB;

/** Formula rows with weights for the batch and running totals for adding toners on the scale. */
export function formula(mix: Mix, cal: Calibration, batch: number): FormulaRow[] {
  const used = TONERS.filter((x) => mix.t[x.id] > 0);
  const total = used.reduce((a, x) => a + mix.t[x.id], 0);
  let run = 0;
  return used.map((x) => {
    const pct = mix.t[x.id] / total, grams = Math.round(pct * batch * 10) / 10;
    run = Math.round((run + grams) * 10) / 10;
    return { name: x.n, swatch: tonerHex(x, cal), parts: mix.t[x.id], pct: pct * 100, grams, cumulative: run };
  });
}

export function buildSheet(
  mix: Mix,
  cal: Calibration,
  temp: BoothTemp,
  batch: number,
  date = new Date(),
  details: SheetDetails = {},
): Sheet {
  const full = finalColour(mix, cal);
  const noMid: Mix = { ...mix, mic: 0, m1: 'none', m2: 'none', cc: 0 };
  const afterBase = finalColour(noMid, cal);
  const afterMid = finalColour({ ...mix, cc: 0 }, cal);
  const hex = linearToHex;
  const used = TONERS.filter((x) => mix.t[x.id] > 0);
  const nk = used.filter((x) => cal.t[x.id]?.hex).length;
  const stages: Stage[] = [];
  const [groundName, groundHex] = GROUNDS[mix.g];

  stages.push({
    key: 'ground', title: 'Ground coat / primer',
    product: `2K wet-on-wet sealer in ${groundName.toLowerCase().replace(' sealer', '').replace(' primer', '')} shade, or a tintable sealer mixed to that shade.`,
    why: 'The ground shade changes how the base and any pearl look. A sealer close to the base colour also saves base coats.',
    notes: [
      'Bare metal: 2K epoxy primer first for adhesion and corrosion protection.',
      'Filler or deep sanding marks: 2K urethane primer-surfacer, block-sanded, then the sealer.',
      'Lay the base inside the sealer\'s recoat window so it needs no sanding.',
    ],
    mix: 'Sealer, hardener and reducer per the sealer TDS.', coats: '1 even wet coat',
    patch: groundHex, patchLabel: groundName,
  });

  const fl = mix.fl > 0;
  stages.push({
    key: 'base', title: 'Base coat',
    product: "The paint system's basecoat, solvent-borne or waterborne, with the toners below mixed into its mixing binder (balancer) at the TDS ratio." + (fl ? " For metallics, use the system's effect / metallic binder if it has one: it controls how the flake lies." : ''),
    why: 'Toners only carry colour. The binder carries adhesion, flake control and drying, and has to match the toner range.',
    notes: [
      'Never mix toners from different brands, or waterborne with solvent-borne.',
      `Hiding over ${groundName.toLowerCase()}: ${Math.round(afterBase.cov * 100)}%${afterBase.cov < 0.95 ? ' (low: add a coat or use a closer sealer shade)' : ''}.`,
      ...(mix.p !== 'none' && mix.pa ? [`${PEARLS[mix.p][0]} pearl in the base at ${mix.pa}% strength.`] : []),
      ...(fl ? [`Metallic flake ${mix.fl}%, ${mix.fs}. Finish with a lighter orientation (drop) coat.`] : []),
    ],
    mix: used.length ? `${plural(used.length, 'toner')}, ${batch} g batch (see formula)` : 'No toners set',
    coats: plural(mix.bc, 'medium-wet coat'),
    patch: hex(afterBase.rgb), patchLabel: 'After base',
  });

  const powders = ([[mix.m1, mix.m1l, 'Face'], [mix.m2, mix.m2l, 'Flop']] as [string, number, string][])
    .filter(([k, l]) => k !== 'none' && l > 0 && POWDERS[k]);
  if (mix.mic && powders.length) {
    const kinds = powders.map(([k]) => POWDERS[k].kind);
    const flake = kinds.some((k) => k === 'holo' || k === 'glass') || mix.m1 === 'holo_std' || mix.m2 === 'holo_std';
    const mid = afterMid.rgb;
    const face = powders.find(([, , r]) => r === 'Face'), flop = powders.find(([, , r]) => r === 'Flop');
    const tint = (p: [string, number, string] | undefined, k: number) => p ? lerp(mid, hexToLinear(POWDERS[p[0]].colour), midFactor(p[1], mix.mic) * k) : mid;
    stages.push({
      key: 'mid', title: 'Mid-coat (powder in binder)',
      product: 'Intercoat clear / pearl and flake carrier: a basecoat-type clear made to carry dry pearls, flakes and candy concentrates (for example House of Kolor SG100, or SG150 for flake).' +
        (flake ? ' Large flake needs a dedicated flake carrier that keeps it suspended.' : ''),
      why: 'An intercoat stays recoatable and can be scuffed for artwork. It is not a build or topcoat clear, so it goes under the 2K clear, never as the final layer.',
      notes: [
        ...powders.map(([k, l, r]) => `${r} powder: ${POWDERS[k].label}, ${l} g/L = ${+(l * mix.mv).toFixed(1)} g in ${mix.mv} L.`),
        'Mix powder into ready-to-spray intercoat and stir until no clumps remain. Shake the cup between passes.',
        'Intercoat clears limit how many coats you can apply. Check the TDS (SG100: no more than 4 when carrying candy).',
        ...(kinds.includes('int') && mix.g !== 'black' ? ['Ghost pearls are strongest over a black ground; this lighter ground weakens the flip.'] : []),
      ],
      mix: `${mix.mv} L intercoat + ${powders.map(([k, l]) => `${+(l * mix.mv).toFixed(1)} g`).join(' + ')} powder`,
      coats: plural(mix.mic, 'even coat'),
      patch: `linear-gradient(135deg, ${hex(tint(face, 0.35))} 0%, ${hex(mid)} 55%, ${hex(tint(flop, 0.5))} 100%)`,
      patchLabel: 'After mid-coat (face → flop, approx.)',
    });
  }

  if (mix.cc > 0) {
    stages.push({
      key: 'candy', title: 'Candy coat',
      product: "Candy concentrate in the system's candy binder or intercoat clear, or a ready-mixed urethane candy, at the candy maker's ratio.",
      why: 'Candy is a transparent dye layer: every coat darkens it, so control comes from identical coats, not from the mix.',
      notes: [
        `Target tint ${mix.cd.toUpperCase()}.`,
        'Mix the whole job in one batch. Candy shade shifts between batches.',
        'Count coats per panel and finish whole panels in one session.',
      ],
      mix: "Concentrate in binder per candy TDS", coats: plural(mix.cc, 'even coat'),
      patch: hex(full.rgb), patchLabel: `After ${plural(mix.cc, 'candy coat')}`,
    });
  }

  const flakeClear = mix.m1 === 'holo_std' || mix.m2 === 'holo_std' || powders.some(([k]) => ['holo', 'glass'].includes(POWDERS[k].kind));
  stages.push(mix.clr > 0 ? {
    key: 'clear', title: 'Clear coat',
    product: mix.fin === 'gloss'
      ? '2K high-solids (HS or UHS) urethane clear from the same paint system.'
      : `Factory ${mix.fin} clear, or the system's matting additive at its stated ratio.`,
    why: mix.fin === 'gloss' ? 'The 2K clear gives the gloss, UV protection and durability. The layers under it have none of their own.' : 'Satin and matte clears set the sheen themselves, so the clear decides the finish.',
    notes: mix.fin === 'gloss' ? [
      'Add an extra coat if the job will be wet-sanded and polished.',
      ...(flakeClear ? ['Flake: 2–3 coats, let cure, sand flat, then 2 more coats to bury it.'] : []),
      ...(mix.peel > 40 ? ['Orange peel set high: check reduction and air pressure.'] : []),
    ] : ["Don't add flattener to a gloss clear unless the system allows it.", 'Never sand or polish; touch-ups show.'],
    mix: 'Clear, hardener and reducer per TDS', coats: plural(mix.clr, 'wet coat'),
    patch: hex(full.rgb), patchLabel: `Finished, ${mix.fin}`,
  } : {
    key: 'clear', title: 'Clear coat', product: 'None set.', why: 'Base coat without clear is not durable and stays dull. Only acceptable for test cards.',
    notes: [], mix: '—', coats: '—', patch: hex(full.rgb), patchLabel: 'No clear',
  });

  return {
    name: mix.n,
    date: date.toISOString().slice(0, 10),
    finalHex: hex(full.rgb),
    calibration: used.length && nk === used.length ? 'Toner colours calibrated from test cards' : nk ? `${nk} of ${used.length} toners calibrated` : 'Generic toner colours (not calibrated)',
    batch,
    details: {
      jobNumber: details.jobNumber?.trim() || '',
      vehiclePanels: details.vehiclePanels?.trim() || '',
      paintSystem: details.paintSystem?.trim() || '',
      technician: details.technician?.trim() || '',
    },
    formula: formula(mix, cal, batch),
    stages,
    guide: applicationGuide(mix, full.cov, full.m, temp),
    general: [
      'Stay in one paint system from sealer to clear. Mixing brands risks lifting, poor adhesion and losing the manufacturer warranty.',
      'Weights are colour toners only. Binder, reducer and hardener follow the technical data sheet (TDS).',
      'Spray a test card with every stage and attach it below before the job is painted.',
      'Wear a respirator rated for isocyanates (supplied air is best) with 2K products.',
    ],
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderSheet(s: Sheet): string {
  const patch = (bg: string, cls = 'ps-patch') => `<span class="${cls}" style="background:${bg}"></span>`;
  return `<article class="ps">
  <header class="ps-head">
    <div><h1>Paint mixing sheet</h1><p class="ps-name">${esc(s.name)}</p></div>
    <div class="ps-final">${patch(s.finalHex, 'ps-big')}<div><b>${s.finalHex.toUpperCase()}</b><br>${esc(s.calibration)}<br>Printed ${s.date}</div></div>
  </header>
  <table class="ps-job"><tr><td>Job no.</td><td>${esc(s.details.jobNumber)}</td><td>Vehicle / panels</td><td>${esc(s.details.vehiclePanels)}</td></tr><tr><td>Paint system</td><td>${esc(s.details.paintSystem)}</td><td>Technician / mixed by</td><td>${esc(s.details.technician)}</td></tr></table>

  <h2>Layer build-up</h2>
  <div class="ps-strip">${s.stages.map((st) => `<div>${patch(st.patch)}<span>${esc(st.patchLabel)}</span></div>`).join('<i>→</i>')}</div>

  ${s.stages.map((st, i) => `<section class="ps-stage">
    <div class="ps-stage-patch">${patch(st.patch)}<small>${esc(st.patchLabel)}</small></div>
    <div>
      <h3>${i + 1}. ${esc(st.title)} <em>${esc(st.coats)}</em></h3>
      <p><b>Use:</b> ${esc(st.product)}</p>
      <p><b>Why:</b> ${esc(st.why)}</p>
      <p><b>Mix:</b> ${esc(st.mix)}</p>
      ${st.notes.length ? `<ul>${st.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>
  </section>`).join('')}

  <h2>Base coat formula · ${s.batch} g batch</h2>
  ${s.formula.length ? `<table class="ps-formula"><thead><tr><th></th><th>Toner</th><th class="n">Parts</th><th class="n">Share</th><th class="n">Add (g)</th><th class="n">Scale reads (g)</th><th>✓</th></tr></thead><tbody>
    ${s.formula.map((r) => `<tr><td>${patch(r.swatch, 'ps-sw')}</td><td>${esc(r.name)}</td><td class="n">${+r.parts.toFixed(2)}</td><td class="n">${r.pct.toFixed(1)}%</td><td class="n">${r.grams.toFixed(1)}</td><td class="n">${r.cumulative.toFixed(1)}</td><td class="ps-box"></td></tr>`).join('')}
  </tbody></table><p class="ps-small">Add toners in this order and tick each one. "Scale reads" is the running total on a tared scale. Toners only: add binder, reducer and hardener per TDS.</p>` : '<p>No toners set.</p>'}

  <h2>Application guide</h2>
  <ol class="ps-guide">${s.guide.map(([a, b]) => `<li><b>${esc(a)}.</b> ${esc(b)}</li>`).join('')}</ol>

  <h2>General rules</h2>
  <ul class="ps-rules">${s.general.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>

  <div class="ps-sign">
    <div class="ps-card">Attach spray-out card here</div>
    <table><tr><td>Mixed by</td><td></td></tr><tr><td>Checked against card by</td><td></td></tr><tr><td>Painter</td><td></td></tr><tr><td>Date</td><td></td></tr></table>
  </div>
  <p class="ps-small">Printed colour patches are approximate: printers and paper shift colour, and pearl, flake and candy effects change with angle. Match the job to the physical spray-out card, not to this print.</p>
</article>`;
}
