import { describe, expect, test } from 'bun:test';
import { PixelField } from '../src/scripts/project-studies/scenes';
import { writeDither } from '../src/scripts/project-studies/dither';
import { createIntelligenceGeometry, drawIntelligence, INTELLIGENCE_WIDTH, INTELLIGENCE_HEIGHT, TERMINAL_ENTITY_WIDTH, TERMINAL_ENTITY_HEIGHT } from '../src/scripts/intelligence-geometry';

function render(time: number, attention = 0, pointer: readonly [number, number] = [0, 0]) {
  const field = new PixelField(INTELLIGENCE_WIDTH, INTELLIGENCE_HEIGHT);
  drawIntelligence(field, time, attention, pointer);
  const output = new Uint8ClampedArray(field.values.length * 4);
  writeDither(field.values, output, [240, 238, 226], field.width, field.height);
  return { field, output };
}

describe('procedural pixel intelligence', () => {
  test('the terminal pose rests two hands at the rim and keeps the text area clear', () => {
    const hands = createIntelligenceGeometry('terminal').filter((point) => point.region === 'hand');
    expect(hands.filter((point) => point.x < -0.4).length).toBeGreaterThan(300);
    expect(hands.filter((point) => point.x > 0.4).length).toBeGreaterThan(300);
    const field = new PixelField(TERMINAL_ENTITY_WIDTH, TERMINAL_ENTITY_HEIGHT);
    drawIntelligence(field, 8, 0.7, [0.2, -0.2], 'terminal');
    expect(field.values.slice(field.width * 204).every((value) => value === 0)).toBe(true);
  });
  test('generates a bounded, reproducible point model without an image input', () => {
    const model = createIntelligenceGeometry();
    expect(model.length).toBeGreaterThan(10000);
    expect(model.length).toBeLessThan(40000);
    expect(model.every((p) => [p.x, p.y, p.z, p.light, p.seed].every(Number.isFinite))).toBe(true);
    expect(model.every((p) => Math.abs(p.x) < 1.5 && Math.abs(p.y) < 1.5 && Math.abs(p.z) < 1.5)).toBe(true);
    expect(createIntelligenceGeometry()).toEqual(model);
  });

  test('uses strictly binary coverage, without translucent photographic tones', () => {
    for (const time of [0, 8, 18]) {
      const { field, output } = render(time);
      let invalid = 0;
      let painted = 0;
      for (let i = 0; i < output.length; i += 4) {
        if (output[i] !== 240 || output[i + 1] !== 238 || output[i + 2] !== 226) invalid++;
        if (output[i + 3] !== 0 && output[i + 3] !== 255) invalid++;
        if (output[i + 3]) painted++;
      }
      expect(invalid).toBe(0);
      expect(painted).toBeGreaterThan(700);
      expect(painted).toBeLessThan(field.values.length / 3);
      expect(field.values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }
  });

  test('time and attention change the drawing while fixed inputs remain deterministic', () => {
    const first = render(8).output;
    expect(render(8).output).toEqual(first);
    for (const next of [render(18).output, render(8, 1, [0.5, 0.3]).output]) {
      let changed = 0;
      for (let i = 3; i < first.length; i += 4) if (next[i] !== first[i]) changed++;
      expect(changed).toBeGreaterThan(100);
    }
    expect(render(NaN, Infinity, [NaN, Infinity]).field.values.every(Number.isFinite)).toBe(true);
  });
});
