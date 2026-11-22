export type RGB = [number, number, number];
export type GroundId = 'white' | 'grey' | 'black' | 'oxide';
export type PearlId = 'none' | 'white' | 'gold' | 'blue';
export type FlakeSize = 'fine' | 'medium' | 'coarse';
export type Finish = 'gloss' | 'satin' | 'matte';
export type BoothTemp = 'cool' | 'warm' | 'hot';
export type PowderKind = '' | 'int' | 'col' | 'spark' | 'diff' | 'holo' | 'alu' | 'glass';

export interface Toner {
  id: string;
  n: string;
  /** masstone colour, sRGB hex */
  hex: string;
  /** hiding power per coat, 0..1 */
  h: number;
  /** relative scattering (two-constant Kubelka-Munk); white = 1 */
  s: number;
}

export interface Powder {
  label: string;
  /** thin-film thickness used for the iridescence shader (nm), 0 if not interference */
  film: number;
  colour: string;
  kind: PowderKind;
  group: string;
}

/** A complete paint system, from ground coat to clear. */
export interface Mix {
  n: string;
  g: GroundId;
  t: Record<string, number>;
  bc: number;
  fl: number;
  fs: FlakeSize;
  p: PearlId;
  pa: number;
  cd: string;
  cc: number;
  clr: number;
  fin: Finish;
  peel: number;
  m1: string;
  m1l: number;
  m2: string;
  m2l: number;
  mic: number;
  mv: number;
  hex?: string;
}

export interface TonerCalibration {
  hex?: string;
  str?: number[];
}

export interface MixCheck {
  n: string;
  p: string;
  m: string;
  de: number;
}

export interface Calibration {
  t: Record<string, TonerCalibration>;
  checks: MixCheck[];
}
