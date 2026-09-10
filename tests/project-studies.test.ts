import { describe, expect, test } from 'bun:test';
import { PixelField, STUDY_IDS, STUDY_WIDTH, STUDY_HEIGHT, drawStudy } from '../src/scripts/project-studies/scenes';
import { BAYER_4, writeDither } from '../src/scripts/project-studies/dither';

const render = (id: typeof STUDY_IDS[number], time: number) => {
  const field = new PixelField();
  drawStudy(field, id, time);
  const output = new Uint8ClampedArray(STUDY_WIDTH * STUDY_HEIGHT * 4);
  writeDither(field.values, output, [32, 38, 33]);
  return output;
};

describe('project pixel studies', () => {
  test('uses every threshold exactly once in the hero’s Bayer order', () => {
    expect([...BAYER_4].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(BAYER_4.slice(0, 4)).toEqual([0, 8, 2, 10]);
  });

  test('outputs only palette ink or transparency, with no grayscale fringes', () => {
    for (const id of STUDY_IDS) {
      const pixels = render(id, 8);
      let painted = 0;
      let invalid = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== 32 || pixels[i + 1] !== 38 || pixels[i + 2] !== 33) invalid++;
        if (pixels[i + 3] !== 0 && pixels[i + 3] !== 255) invalid++;
        if (pixels[i + 3]) painted++;
      }
      expect(invalid).toBe(0);
      expect(painted).toBeGreaterThan(300);
      expect(painted).toBeLessThan(STUDY_WIDTH * STUDY_HEIGHT / 3);
    }
  });

  test('posters are reproducible and each scene actually changes with time', () => {
    for (const id of STUDY_IDS) {
      const first = render(id, 8);
      expect(render(id, 8)).toEqual(first);
      const next = render(id, 9);
      let changed = 0;
      for (let i = 3; i < first.length; i += 4) if (first[i] !== next[i]) changed++;
      expect(changed).toBeGreaterThan(30);
    }
  });

  test('all scenes stay finite and bounded with pointer input and long playback', () => {
    const field = new PixelField();
    for (const id of STUDY_IDS) for (const time of [0, 8, 49, 1200, NaN]) {
      drawStudy(field, id, time, [10, NaN]);
      expect(field.values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }
  });
});
