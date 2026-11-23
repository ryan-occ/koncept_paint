import type { RGB } from '../types.ts';

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

export function srgbHex([red, green, blue]: RGB): string {
  return `#${[red, green, blue].map((channel) =>
    Math.min(255, Math.max(0, Math.round(channel))).toString(16).padStart(2, '0'),
  ).join('')}`;
}
