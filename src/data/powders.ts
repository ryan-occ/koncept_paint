import type { Powder } from '../types.ts';

/**
 * Dry effect pigments for mid-coats (powder in intercoat clear).
 * Brand names are examples of each product family, not exact reproductions.
 * Chameleon / colour-shift pigments are deliberately excluded.
 */
const G1 = 'Interference / ghost pearl (e.g. Merck Iriodin, CQV Dazzling)';
const G2 = 'Coloured mica pearl';
const G3 = 'Crystal sparkle';
const G4 = 'Diffractive and holographic';
const G5 = 'Metal and glass';

const p = (label: string, film: number, colour: string, kind: Powder['kind'], group: string): Powder => ({ label, film, colour, kind, group });

export const POWDERS: Record<string, Powder> = {
  none: p('None', 0, '#000000', '', ''),
  int_gold: p('Ghost gold', 330, '#f3c64a', 'int', G1),
  int_copper: p('Ghost copper', 360, '#f08a3c', 'int', G1),
  int_red: p('Ghost red', 380, '#e8455a', 'int', G1),
  int_violet: p('Ghost violet', 400, '#8a5cf0', 'int', G1),
  int_blue: p('Ghost blue (e.g. CQV Dazzling Blue A-781S)', 440, '#3d7bf5', 'int', G1),
  int_green: p('Ghost green (e.g. CQV Dazzling Green A-791S)', 500, '#3fd08a', 'int', G1),
  col_white: p('Silver-white pearl', 0, '#e8e8ea', 'col', G2),
  col_gold: p('Brilliant gold (e.g. CQV Brilliant Gold A-601S)', 0, '#d9a43a', 'col', G2),
  col_turq: p('Turquoise (e.g. HOK Kosmatic Turquoise Fx)', 0, '#2ab5b0', 'col', G2),
  col_red: p('Red mica pearl', 0, '#b8202e', 'col', G2),
  spk_silver: p('Crystal silver (Merck Xirallic type)', 0, '#e6e9ee', 'spark', G3),
  spk_gold: p('Crystal gold (Merck Xirallic type)', 0, '#e9c46a', 'spark', G3),
  diff: p('SpectraFlair (VIAVI), usually sold pre-mixed', 700, '#d0d4da', 'diff', G4),
  holo_micro: p('Holographic flake .004" micro', 650, '#cfd3d8', 'holo', G4),
  holo_std: p('Holographic flake .015" standard', 650, '#cfd3d8', 'holo', G4),
  alu: p('Aluminium dust', 0, '#c9ccd0', 'alu', G5),
  glass: p('Glass flake sparkle', 0, '#ffffff', 'glass', G5),
};

export const POWDER_GROUPS = [...new Set(Object.values(POWDERS).map((x) => x.group).filter(Boolean))];
