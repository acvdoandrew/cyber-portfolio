import { describe, expect, test } from 'bun:test';
import { contactLinks } from '../src/data/portfolio';
import { typingTimeline, typingFrame } from '../src/scripts/terminal-timeline';

describe('contact terminal typing', () => {
  const lengths = [15, 18, ...contactLinks.map((link) => link.value.length + 6), 31];
  const timeline = typingTimeline(lengths);

  test('completes the contact information in under seven seconds', () => {
    expect(timeline.at(-1)!.end).toBeLessThan(7000);
    expect(typingFrame(timeline, 0).counts.every((count) => count === 0)).toBe(true);
    expect(typingFrame(timeline, 10000)).toMatchObject({ counts: lengths, complete: true });
  });

  test('reveals characters in order without exceeding a line', () => {
    let previous = lengths.map(() => 0);
    for (let elapsed = 0; elapsed < 7000; elapsed += 17) {
      const current = typingFrame(timeline, elapsed);
      for (let i = 0; i < lengths.length; i++) {
        expect(current.counts[i]).toBeGreaterThanOrEqual(previous[i]);
        expect(current.counts[i]).toBeLessThanOrEqual(lengths[i]);
        if (current.counts[i] > 0 && i > 0) expect(current.counts[i - 1]).toBe(lengths[i - 1]);
      }
      previous = current.counts;
    }
  });

  test('empty or invalid timing input remains finite and safe', () => {
    expect(typingFrame([], 0)).toMatchObject({ counts: [], complete: true });
    const invalid = typingTimeline([-4, NaN, Infinity]);
    expect(typingFrame(invalid, NaN).counts).toEqual([0, 0, 0]);
    expect(typingFrame(timeline, -1).counts).toEqual(lengths.map(() => 0));
  });
});
