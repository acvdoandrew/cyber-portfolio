import { describe, expect, test } from 'bun:test';
import { manifestationAt } from '../src/scripts/intelligence-state';

describe('uploaded intelligence formation', () => {
  test('arrives fragmented, then resolves into a readable presence', () => {
    expect(manifestationAt(0, 0).coherence).toBeLessThan(0.4);
    expect(manifestationAt(6, 0).coherence).toBeGreaterThan(0.8);
  });

  test('stays visible and bounded throughout extended playback', () => {
    for (let time = 0; time <= 3600; time += 0.5) {
      for (const attention of [0, 0.5, 1]) {
        const { coherence } = manifestationAt(time, attention);
        expect(coherence).toBeGreaterThanOrEqual(0.25);
        expect(coherence).toBeLessThanOrEqual(1);
      }
    }
  });

  test('attention stabilizes the image and time changes remain continuous', () => {
    for (let time = 0; time < 90; time += 0.1) {
      const unattended = manifestationAt(time, 0).coherence;
      expect(manifestationAt(time, 1).coherence).toBeGreaterThanOrEqual(unattended);
      expect(Math.abs(manifestationAt(time + 1 / 30, 0).coherence - unattended)).toBeLessThan(0.01);
    }
  });

  test('invalid inputs cannot introduce NaN into the shader uniforms', () => {
    for (const time of [-10, NaN, Infinity]) {
      for (const attention of [-1, 2, NaN, Infinity]) {
        const state = manifestationAt(time, attention);
        expect(Number.isFinite(state.coherence)).toBe(true);
        expect(state.coherence).toBeGreaterThanOrEqual(0);
        expect(state.coherence).toBeLessThanOrEqual(1);
      }
    }
  });
});
