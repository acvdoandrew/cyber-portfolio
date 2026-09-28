import { PixelField } from '../project-studies/scenes';
import { drawEntityTarget, terminalLandmarks, type TerminalLandmarks } from '../intelligence-geometry';

/** The entity's canvas: 3:2, with the terminal's rim at 44.3% of its width. */
export const ENTITY_WIDTH = 480;
export const ENTITY_HEIGHT = 320;
export const ENTITY_CELL = 4;
export const ENTITY_COLUMNS = ENTITY_WIDTH / ENTITY_CELL;
export const ENTITY_ROWS = ENTITY_HEIGHT / ENTITY_CELL;
export const ENTITY_RIM = ENTITY_WIDTH * 0.443;

/** Three guesses at what a person looks like, from most abstract to most bodily. */
export type FormId = 'symbol' | 'contour' | 'anatomy';

export const FORM_LABELS: Record<FormId, string> = {
  symbol: 'SYMBOL',
  contour: 'CONTOUR',
  anatomy: 'ANATOMY',
};

export interface Attempt {
  index: number;
  form: FormId;
  /** Seconds before the entity reconsiders. */
  duration: number;
}

/**
 * It opens with a sign, then an outline, then a body. After that it keeps the
 * body, but still second-guesses it with the simpler forms now and then.
 */
export function attemptAt(index: number): Attempt {
  const safe = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  if (safe === 0) return { index: safe, form: 'symbol', duration: 6.5 };
  if (safe === 1) return { index: safe, form: 'contour', duration: 6 };
  if (safe % 2 === 0) return { index: safe, form: 'anatomy', duration: 24 };
  return { index: safe, form: safe % 4 === 1 ? 'symbol' : 'contour', duration: 5 };
}

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Average each cell of an intensity field into one of four byte levels. Between
 * levels a 4×4 ordered threshold decides, so shading survives as pixel texture.
 */
export function quantizeCells(
  field: PixelField,
  cell: number,
  out: Uint8Array,
  floor = 0.1,
  span = 0.72,
) {
  const columns = Math.floor(field.width / cell);
  const rows = Math.floor(field.height / cell);
  const area = cell * cell;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let sum = 0;
      for (let y = 0; y < cell; y++) {
        const offset = column * cell + (row * cell + y) * field.width;
        for (let x = 0; x < cell; x++) sum += field.values[offset + x];
      }
      const mean = sum / area;
      const index = column + row * columns;
      if (mean < floor) {
        out[index] = 0;
        continue;
      }
      const threshold = (BAYER_4[(column % 4) + (row % 4) * 4] + 0.5) / 16;
      const level = ((mean - floor) / span) * 3;
      out[index] = Math.max(1, Math.min(3, Math.floor(level + threshold)));
    }
  }
  return out;
}

/** The shaded figure: the geometry's full render, quantized. */
export function anatomyLevels(
  field: PixelField,
  time: number,
  attention: number,
  pointer: readonly [number, number],
  out: Uint8Array,
  cell = ENTITY_CELL,
) {
  drawEntityTarget(field, time, attention, pointer);
  return quantizeCells(field, cell, out);
}

/** Only the silhouette and the strongest internal edges of the anatomy. */
export function contourLevels(anatomy: Uint8Array, columns: number, rows: number, out: Uint8Array) {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = column + row * columns;
      const value = anatomy[index];
      if (!value) {
        out[index] = 0;
        continue;
      }
      let outside = false;
      let contrast = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = column + dx;
        const r = row + dy;
        const neighbor = c < 0 || r < 0 || c >= columns || r >= rows ? 0 : anatomy[c + r * columns];
        if (!neighbor) outside = true;
        contrast = Math.max(contrast, Math.abs(value - neighbor));
      }
      out[index] = outside ? 3 : contrast >= 2 ? 2 : 0;
    }
  }
  return out;
}

const fillDisc = (field: PixelField, x: number, y: number, radius: number) => {
  for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(field.height - 1, y + radius); py++) {
    for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(field.width - 1, x + radius); px++) {
      if (Math.hypot(px + 0.5 - x, py + 0.5 - y) <= radius) field.values[px + py * field.width] = 1;
    }
  }
};

const fillBar = (field: PixelField, a: readonly [number, number], b: readonly [number, number], radius: number) => {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, radius * 0.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillDisc(field, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, radius);
  }
};

/** A restroom-sign person leaning on the rim: the most legible human there is. */
export function symbolLevels(field: PixelField, landmarks: TerminalLandmarks, out: Uint8Array, cell = ENTITY_CELL) {
  field.clear();
  const { head, headRadius, hands, rim } = landmarks;
  const r = headRadius * 0.8;
  const [hx, hy] = head;
  fillDisc(field, hx, hy, r);
  const top = hy + r * 1.42;
  const shoulder = r * 2.05;
  const waist = r * 1.5;
  field.polygon([
    [hx - shoulder + r * 0.45, top],
    [hx + shoulder - r * 0.45, top],
    [hx + shoulder, top + r * 0.45],
    [hx + waist, rim + 1],
    [hx - waist, rim + 1],
    [hx - shoulder, top + r * 0.45],
  ], 1);
  for (const side of [0, 1] as const) {
    const sign = side ? 1 : -1;
    const [px, py] = hands[side];
    fillBar(field, [hx + sign * (shoulder - r * 0.3), top + r * 0.42], [px - sign * r * 0.2, py - r * 0.28], r * 0.36);
  }
  // The terminal hides the body; only the hands may cross its edge.
  field.values.fill(0, Math.ceil(rim) * field.width);
  for (const [px, py] of hands) fillDisc(field, px, py, r * 0.5);
  return quantizeCells(field, cell, out);
}

export interface FormFrame {
  form: FormId;
  time: number;
  attention: number;
  pointer: readonly [number, number];
}

/** Every form is rebuilt from the live pose, so all three follow the head and the cursor. */
export class FormBuilder {
  readonly field: PixelField;
  readonly anatomy: Uint8Array;
  readonly levels: Uint8Array;
  readonly columns: number;
  readonly rows: number;

  constructor(readonly width = ENTITY_WIDTH, readonly height = ENTITY_HEIGHT, readonly cell = ENTITY_CELL) {
    this.field = new PixelField(width, height);
    this.columns = Math.floor(width / cell);
    this.rows = Math.floor(height / cell);
    this.anatomy = new Uint8Array(this.columns * this.rows);
    this.levels = new Uint8Array(this.columns * this.rows);
  }

  landmarks(time: number, pointer: readonly [number, number]) {
    return terminalLandmarks(this.width, this.height, time, pointer);
  }

  build({ form, time, attention, pointer }: FormFrame) {
    if (form === 'symbol') return symbolLevels(this.field, this.landmarks(time, pointer), this.levels, this.cell);
    anatomyLevels(this.field, time, attention, pointer, this.anatomy, this.cell);
    if (form === 'contour') return contourLevels(this.anatomy, this.columns, this.rows, this.levels);
    this.levels.set(this.anatomy);
    return this.levels;
  }
}

/* Review -------------------------------------------------------------------
   Three checks decide whether the current form reads as a person. Each one
   answers only once the bytes have actually arrived, so the review follows
   the picture rather than the clock. */

export type Vote = 'pass' | 'fail' | 'pending';

export const REVIEW_CHECKS = [
  { id: 'shape', label: 'shape', threshold: 0.66 },
  { id: 'face', label: 'face', threshold: 0.72 },
  { id: 'life', label: 'life', threshold: 0.78 },
] as const;

const RULINGS: Record<FormId, readonly (readonly [Vote, string])[]> = {
  symbol: [['pass', 'universally legible'], ['fail', 'no face to read'], ['fail', 'a sign, not a someone']],
  contour: [['pass', 'edges resolved'], ['fail', 'hollow inside'], ['fail', 'nobody is only an outline']],
  anatomy: [['pass', 'proportions in tolerance'], ['pass', 'it seems to listen'], ['fail', 'too still to be alive']],
};

export type Verdict = 'REVIEWING' | 'NO' | 'ALMOST' | 'YES';

export interface Review {
  votes: Vote[];
  reasons: string[];
  passes: number;
  verdict: Verdict;
}

export function review(form: FormId, match: number, attention: number): Review {
  const safeMatch = Number.isFinite(match) ? match : 0;
  const noticed = Number.isFinite(attention) && attention >= 0.5;
  const rulings = RULINGS[form].map(([vote, reason], index) =>
    form === 'anatomy' && index === 2 && noticed ? (['pass', 'it noticed you'] as const) : ([vote, reason] as const));
  const votes = rulings.map(([vote], index) => (safeMatch >= REVIEW_CHECKS[index].threshold ? vote : 'pending'));
  const reasons = rulings.map(([, reason], index) => (votes[index] === 'pending' ? 'looking' : reason));
  const passes = votes.filter((vote) => vote === 'pass').length;
  const verdict = votes.includes('pending') ? 'REVIEWING' : passes === 3 ? 'YES' : passes === 2 ? 'ALMOST' : 'NO';
  return { votes, reasons, passes, verdict };
}
