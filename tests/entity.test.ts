import { describe, expect, test } from 'bun:test';
import { ByteField, MAX_LEVEL } from '../src/scripts/entity/bytes';
import {
  attemptAt,
  contourLevels,
  review,
  ENTITY_CELL,
  ENTITY_COLUMNS,
  ENTITY_HEIGHT,
  ENTITY_RIM,
  ENTITY_ROWS,
  ENTITY_WIDTH,
  FormBuilder,
} from '../src/scripts/entity/forms';
import { hashFor, resolveHash, step } from '../src/scripts/console/routes';

const field = (seed = 3) => new ByteField({
  width: ENTITY_WIDTH,
  height: ENTITY_HEIGHT,
  cell: ENTITY_CELL,
  seed,
  ingress: { y: ENTITY_RIM + 2, left: ENTITY_WIDTH * 0.07, right: ENTITY_WIDTH * 0.93 },
});
const builder = new FormBuilder();
const anatomy = () => Uint8Array.from(builder.build({ form: 'anatomy', time: 8, attention: 0, pointer: [0, -0.16] }));
const sum = (values: ArrayLike<number>) => Array.from(values).reduce((total, value) => total + value, 0);
const run = (bytes: ByteField, seconds: number, options = {}) => {
  for (let t = 0; t < seconds; t += 1 / 30) bytes.step(1 / 30, options);
};

describe('byte entity: transport', () => {
  test('starts empty and assembles the body only by delivering bytes', () => {
    const bytes = field();
    bytes.setTarget(anatomy());
    expect(bytes.match()).toBe(0);
    let before = sum(bytes.levels);
    let delivered = bytes.delivered;
    for (let frame = 0; frame < 150; frame++) {
      bytes.step(1 / 30, { churn: 0, error: 0, evaporate: 0 });
      // Every level gained is a byte that landed this frame; nothing fades in.
      const after = sum(bytes.levels);
      expect(after - before).toBeLessThanOrEqual(bytes.delivered - delivered);
      before = after;
      delivered = bytes.delivered;
    }
    expect(bytes.match()).toBeGreaterThan(0.9);
  });

  test('reshapes by moving bytes between forms, then settles close to the target', () => {
    const bytes = field(11);
    bytes.setTarget(builder.build({ form: 'symbol', time: 8, attention: 0, pointer: [0, -0.16] }));
    bytes.settle();
    expect(bytes.match()).toBe(1);
    bytes.setTarget(anatomy());
    const start = bytes.match();
    run(bytes, 5);
    expect(bytes.match()).toBeGreaterThan(Math.max(0.88, start));
  });

  test('stays alive: churn recalls bytes without letting the form collapse', () => {
    const bytes = field(5);
    bytes.setTarget(anatomy());
    bytes.settle();
    run(bytes, 4, { churn: 0.03, error: 0.07 });
    expect(bytes.flights).toBeGreaterThan(0);
    expect(bytes.match()).toBeGreaterThan(0.8);
    expect(bytes.match()).toBeLessThan(1);
  });

  test('shed regions fall away and are rebuilt', () => {
    const bytes = field(9);
    bytes.setTarget(anatomy());
    bytes.settle();
    bytes.shed(0, 0, ENTITY_WIDTH, ENTITY_HEIGHT * 0.4, 2);
    const broken = bytes.match();
    expect(broken).toBeLessThan(0.85);
    run(bytes, 4, { churn: 0, error: 0 });
    expect(bytes.match()).toBeGreaterThan(broken + 0.1);
  });

  test('draws only the given inks at full or zero coverage', () => {
    const bytes = field();
    bytes.setTarget(anatomy());
    run(bytes, 0.6);
    const out = new Uint8ClampedArray(ENTITY_WIDTH * ENTITY_HEIGHT * 4);
    const inks = { settled: [250, 230, 190], flight: [30, 200, 255], discard: [240, 120, 60] } as const;
    bytes.render(out, inks);
    const allowed = new Set(Object.values(inks).map((ink) => ink.join(',')));
    let painted = 0;
    for (let i = 0; i < out.length; i += 4) {
      if (!out[i + 3]) continue;
      expect(out[i + 3]).toBe(255);
      expect(allowed.has(`${out[i]},${out[i + 1]},${out[i + 2]}`)).toBe(true);
      painted += 1;
    }
    expect(painted).toBeGreaterThan(500);
  });

  test('is deterministic for a seed and bounded under hostile input', () => {
    const a = field(42);
    const b = field(42);
    for (const bytes of [a, b]) {
      bytes.setTarget(anatomy());
      run(bytes, 1);
    }
    expect(Array.from(a.levels)).toEqual(Array.from(b.levels));
    const hostile = field(1);
    hostile.setTarget(Array.from({ length: ENTITY_COLUMNS * ENTITY_ROWS }, (_, i) => (i % 3 ? NaN : 99)));
    expect(Math.max(...hostile.target)).toBe(MAX_LEVEL);
    hostile.step(NaN);
    hostile.step(Infinity);
    run(hostile, 2);
    expect(hostile.flights).toBeLessThanOrEqual(2400);
    expect(Number.isFinite(hostile.match())).toBe(true);
  });
});

describe('byte entity: forms and review', () => {
  test('opens with a sign, then an outline, then a body, and keeps second-guessing it', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => attemptAt(index).form)).toEqual([
      'symbol', 'contour', 'anatomy', 'contour', 'anatomy', 'symbol', 'anatomy',
    ]);
    expect(attemptAt(2).duration).toBeGreaterThan(attemptAt(3).duration);
    expect(attemptAt(NaN).form).toBe('symbol');
  });

  test('only the hands cross the terminal rim, in every form', () => {
    const rimRow = Math.ceil(ENTITY_RIM / ENTITY_CELL) + 1;
    for (const form of ['symbol', 'contour', 'anatomy'] as const) {
      const levels = builder.build({ form, time: 8, attention: 0, pointer: [0, -0.16] });
      for (let row = rimRow; row < ENTITY_ROWS; row++) {
        for (let column = 0; column < ENTITY_COLUMNS; column++) {
          if (!levels[column + row * ENTITY_COLUMNS]) continue;
          // Anything below the rim belongs to a hand, near the left or right edge of the figure.
          const x = column * ENTITY_CELL;
          expect(Math.abs(x - ENTITY_WIDTH / 2)).toBeGreaterThan(ENTITY_WIDTH * 0.18);
        }
      }
    }
  });

  test('the outline is traced from the body it outlines', () => {
    const body = anatomy();
    const outline = contourLevels(body, ENTITY_COLUMNS, ENTITY_ROWS, new Uint8Array(body.length));
    let traced = 0;
    for (let i = 0; i < body.length; i++) {
      if (outline[i]) {
        expect(body[i]).toBeGreaterThan(0);
        traced += 1;
      }
    }
    expect(traced).toBeGreaterThan(200);
    expect(traced).toBeLessThan(body.filter(Boolean).length * 0.6);
  });

  test('the review waits for the bytes, then checks shape, face and life', () => {
    expect(review('anatomy', 0.5, 0).verdict).toBe('REVIEWING');
    expect(review('anatomy', 0.7, 0).votes).toEqual(['pass', 'pending', 'pending']);
    expect(review('symbol', 0.95, 0)).toMatchObject({ verdict: 'NO', passes: 1 });
    expect(review('contour', 0.95, 0)).toMatchObject({ verdict: 'NO', passes: 1 });
    expect(review('anatomy', 0.95, 0)).toMatchObject({ verdict: 'ALMOST', passes: 2 });
    const noticed = review('anatomy', 0.95, 0.8);
    expect(noticed).toMatchObject({ verdict: 'YES', passes: 3 });
    expect(noticed.reasons[2]).toBe('it noticed you');
    expect(review('anatomy', NaN, NaN).verdict).toBe('REVIEWING');
  });
});

describe('deck routing', () => {
  const channels = ['home', 'work', 'tools', 'contact'];
  const units = ['ares', 'rust-edge-compute', 'physics-engine', 'inference-proxy'];

  test('hashes name a channel or a project inside Work', () => {
    expect(resolveHash('', channels, units)).toEqual({ channel: 'home', unit: null });
    expect(resolveHash('#tools', channels, units)).toEqual({ channel: 'tools', unit: null });
    expect(resolveHash('#physics-engine', channels, units)).toEqual({ channel: 'work', unit: 'physics-engine' });
    expect(resolveHash('#project-ares', channels, units)).toEqual({ channel: 'work', unit: 'ares' });
    expect(resolveHash('#capabilities', channels, units)).toEqual({ channel: 'tools', unit: null });
    expect(resolveHash('#%57ORK', channels, units)).toEqual({ channel: 'work', unit: null });
    expect(resolveHash('#%E0%A4%A', channels, units)).toEqual({ channel: 'home', unit: null });
    expect(resolveHash('#nowhere', channels, units)).toEqual({ channel: 'home', unit: null });
  });

  test('canonical hashes and wraparound stepping', () => {
    expect(hashFor({ channel: 'work', unit: 'ares' })).toBe('#ares');
    expect(hashFor({ channel: 'contact', unit: null })).toBe('#contact');
    expect(step(channels, 'home', -1)).toBe('contact');
    expect(step(channels, 'contact', 1)).toBe('home');
    expect(step(units, 'ares', 2)).toBe('physics-engine');
    expect(step(channels, 'missing', 1)).toBe('work');
  });
});
