import { GROUNDS, PEARLS } from './data/toners.ts';
import { POWDERS } from './data/powders.ts';
import { colourAtViewAngle, EMPTY_CAL, finalColour } from './color/mixing.ts';
import { deltaE, linearToHex } from './color/space.ts';
import type { Calibration, Mix } from './types.ts';

/** A paint in the shared library that Koncept Kits renders cars with. */
export interface LibraryPaint {
  id?: number;
  name: string;
  /** flat colour seen face-on */
  hex: string;
  /** colour at a grazing angle, only for colour-shift (interference) paints */
  hex2?: string;
  shiftLabel?: string;
  /** plain-English finish for the render prompt */
  finish: string;
  recipe: Mix;
  source: 'preset' | 'custom';
  updatedAt?: string;
}

/** Below this ΔE2000 between face and grazing colour the flip is too weak to call colour-shift. */
export const SHIFT_MIN_DELTA_E = 4;

const LIMITS = { name: 80, shiftLabel: 40, finish: 300 };

/** "Ghost blue (e.g. CQV Dazzling Blue A-781S)" → "ghost blue". */
const powderName = (id: string) => POWDERS[id].label.replace(/\s*\(.*\)\s*$/, '').toLowerCase();

const activePowders = (mix: Mix) =>
  ([[mix.m1, mix.m1l], [mix.m2, mix.m2l]] as [string, number][])
    .filter(([id, load]) => id !== 'none' && POWDERS[id] && load > 0 && mix.mic > 0)
    .map(([id]) => id);

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** One line describing the finish, e.g. "gloss clear, fine metallic flake (85%), candy #B3071B (3 coats) over mid grey sealer". */
export function finishText(mix: Mix): string {
  const parts: string[] = [];
  const pearl = mix.p !== 'none' && mix.pa > 0;
  const powders = activePowders(mix).map(powderName);
  parts.push(mix.clr > 0 ? `${mix.fin} clear` : 'no clear coat (dull base only)');
  parts.push(mix.fl > 0 ? `${mix.fs} metallic flake (${mix.fl}%)` : pearl || powders.length ? 'no metallic flake' : 'solid colour, no metallic flake');
  if (pearl) parts.push(`${PEARLS[mix.p][0].toLowerCase()} pearl (${mix.pa}%)`);
  if (powders.length) parts.push(`${powders.join(' and ')} effect mid-coat`);
  if (mix.cc > 0) parts.push(`candy ${mix.cd.toUpperCase()} (${mix.cc} coat${mix.cc === 1 ? '' : 's'})`);
  return clip(`${parts.join(', ')} over ${GROUNDS[mix.g][0].toLowerCase()}`, LIMITS.finish);
}

/** Turn a mix into a library paint, using the same colour maths and calibration the bench shows. */
export function toLibraryPaint(mix: Mix, cal: Calibration = EMPTY_CAL, source: LibraryPaint['source'] = 'custom'): LibraryPaint {
  const name = clip(mix.n.trim().replace(/\s+/g, ' ') || 'Untitled mix', LIMITS.name);
  const face = finalColour(mix, cal).rgb;
  const hex = linearToHex(face);
  const paint: LibraryPaint = {
    name,
    hex,
    finish: finishText(mix),
    recipe: { ...structuredClone(mix), n: name, hex },
    source,
  };

  const interference = activePowders(mix).filter((id) => POWDERS[id].kind === 'int');
  if (interference.length) {
    const grazing = colourAtViewAngle(mix, 'grazing', cal);
    if (deltaE(face, grazing) >= SHIFT_MIN_DELTA_E) {
      paint.hex2 = linearToHex(grazing);
      paint.shiftLabel = clip(interference.map(powderName).join(' / '), LIMITS.shiftLabel);
    }
  }
  return paint;
}
