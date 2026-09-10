import { STUDY_WIDTH, STUDY_HEIGHT } from './scenes';

// The hero's ordered 4×4 threshold, applied at the animation's native pixel size.
export const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export function writeDither(
  values: Float32Array,
  output: Uint8ClampedArray,
  ink: readonly number[],
  width = STUDY_WIDTH,
  height = STUDY_HEIGHT,
) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = x + y * width;
      const threshold = ((BAYER_4[(x % 4) + (y % 4) * 4] + 0.5) / 16) * 0.86 + 0.07;
      const offset = index * 4;
      output[offset] = ink[0];
      output[offset + 1] = ink[1];
      output[offset + 2] = ink[2];
      output[offset + 3] = values[index] >= threshold ? 255 : 0;
    }
  }
}
