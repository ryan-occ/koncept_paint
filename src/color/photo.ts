import type { RGB } from '../types.ts';
import { hexToLinear, linearToSrgb, srgbToLinear } from './space.ts';

/** Median of sRGB samples, reducing the effect of glare and isolated highlights. */
export function medianRgb(samples: readonly RGB[]): RGB {
  if (!samples.length) throw new RangeError('At least one colour sample is required.');
  return [0, 1, 2].map((channel) => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return Math.round(values.length % 2
      ? values[middle]
      : (values[middle - 1] + values[middle]) / 2);
  }) as RGB;
}

/**
 * Correct a sampled sRGB colour using a patch whose true colour is known.
 * The per-channel gains are fitted in linear light, then applied to the paint sample.
 */
export function correctPhotoSample(sample: RGB, measuredReference: RGB, referenceHex: string): RGB {
  const target = hexToLinear(referenceHex);
  return sample.map((channel, index) => {
    const seenReference = srgbToLinear(Math.min(255, Math.max(0, measuredReference[index])) / 255);
    const seenPaint = srgbToLinear(Math.min(255, Math.max(0, channel)) / 255);
    // A channel at or near black cannot provide a stable gain estimate.
    const gain = target[index] > 1e-4 && seenReference > 1e-4
      ? target[index] / seenReference
      : 1;
    return Math.round(Math.min(1, Math.max(0, linearToSrgb(seenPaint * gain))) * 255);
  }) as RGB;
}

export function srgbHex([red, green, blue]: RGB): string {
  return `#${[red, green, blue].map((channel) =>
    Math.min(255, Math.max(0, Math.round(channel))).toString(16).padStart(2, '0'),
  ).join('')}`;
}
