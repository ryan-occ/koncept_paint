export type LightId = 'booth' | 'sun' | 'cloud' | 'sunset' | 'night';

export const LIGHTS: Record<LightId, { label: string; bg: string; floor: number; exposure: number }> = {
  booth: { label: 'Booth', bg: '#c9ccd0', floor: 0x4f5358, exposure: 0.95 },
  sun: { label: 'Noon sun', bg: '#9cc3e6', floor: 0xb49d7a, exposure: 0.75 },
  cloud: { label: 'Overcast', bg: '#b7bcc2', floor: 0x676b70, exposure: 1.05 },
  sunset: { label: 'Sunset', bg: '#3a2240', floor: 0x3a2c2a, exposure: 1 },
  night: { label: 'Street lamps', bg: '#0b0d12', floor: 0x1b1d21, exposure: 1.5 },
};
