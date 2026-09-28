/**
 * A byte-transport field. The picture is a grid of cells, and a cell only gains
 * a level when a byte physically arrives: from a neighbor holding too much, or
 * up out of the terminal. Nothing fades in; every change is a delivery.
 */

export const MAX_LEVEL = 3;

export type Ink = readonly [number, number, number];

export interface ByteInks {
  settled: Ink;
  flight: Ink;
  discard: Ink;
}

export interface ByteFieldOptions {
  width: number;
  height: number;
  cell?: number;
  capacity?: number;
  seed?: number;
  /** The slot new bytes rise out of, in pixels. */
  ingress: { y: number; left: number; right: number };
}

export interface StepOptions {
  /** Share of the outstanding deficit dispatched per second. */
  pull?: number;
  /** Share of settled levels recalled per second, so the form never quite rests. */
  churn?: number;
  /** Share of dispatched bytes that land a few cells off target. */
  error?: number;
  /** Chance per second that a surplus level is thrown away instead of reused. */
  evaporate?: number;
}

const PLACE = 0;
const DISCARD = 1;
const BLOCK = 255;
const SEARCH_RADIUS = 9;

/** 3×5 hexadecimal glyphs: one octal digit per row, left bit first. */
const GLYPH_ROWS = [
  '75557', '26227', '71747', '71717', '55711', '74717', '74757', '71222',
  '75757', '75717', '25755', '65656', '34443', '65556', '74647', '74644',
];
const GLYPHS = GLYPH_ROWS.map((rows) => [...rows].map(Number));

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Small deterministic PRNG, so a seeded field replays identically. */
export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ByteField {
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  readonly levels: Uint8Array;
  readonly target: Uint8Array;
  readonly inbound: Uint16Array;
  /** Horizontal tear per cell row, in pixels. It only moves what is drawn. */
  readonly tear: Int16Array;
  /** Bytes delivered since creation; a live counter for the HUD. */
  delivered = 0;

  private readonly capacity: number;
  private readonly ingress: ByteFieldOptions['ingress'];
  private readonly random: () => number;
  private readonly x0: Float32Array;
  private readonly y0: Float32Array;
  private readonly cx: Float32Array;
  private readonly cy: Float32Array;
  private readonly x1: Float32Array;
  private readonly y1: Float32Array;
  private readonly progress: Float32Array;
  private readonly duration: Float32Array;
  private readonly destination: Int32Array;
  private readonly kind: Uint8Array;
  private readonly glyph: Uint8Array;
  private readonly deficits: Int32Array;
  private readonly offsets: Int16Array;
  private count = 0;
  private budget = 0;
  private churnBudget = 0;

  constructor(options: ByteFieldOptions) {
    this.width = options.width;
    this.height = options.height;
    this.cell = Math.max(2, Math.floor(options.cell ?? 4));
    this.columns = Math.floor(this.width / this.cell);
    this.rows = Math.floor(this.height / this.cell);
    const cells = this.columns * this.rows;
    this.levels = new Uint8Array(cells);
    this.target = new Uint8Array(cells);
    this.inbound = new Uint16Array(cells);
    this.deficits = new Int32Array(cells);
    this.tear = new Int16Array(this.rows);
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 2400));
    this.ingress = options.ingress;
    this.random = mulberry32(options.seed ?? 7);
    const floats = () => new Float32Array(this.capacity);
    this.x0 = floats();
    this.y0 = floats();
    this.cx = floats();
    this.cy = floats();
    this.x1 = floats();
    this.y1 = floats();
    this.progress = floats();
    this.duration = floats();
    this.destination = new Int32Array(this.capacity);
    this.kind = new Uint8Array(this.capacity);
    this.glyph = new Uint8Array(this.capacity);

    // Neighbor offsets nearest first, so a deficit borrows from the closest surplus.
    const pairs: [number, number][] = [];
    for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
      for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
        if ((dx || dy) && dx * dx + dy * dy <= SEARCH_RADIUS * SEARCH_RADIUS) pairs.push([dx, dy]);
      }
    }
    pairs.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
    this.offsets = Int16Array.from(pairs.flat());
  }

  /** Bytes currently in the air. */
  get flights() {
    return this.count;
  }

  setTarget(levels: ArrayLike<number>) {
    for (let index = 0; index < this.target.length; index++) {
      const value = levels[index];
      this.target[index] = Number.isFinite(value) ? clamp(Math.round(value), 0, MAX_LEVEL) : 0;
    }
  }

  /** Jump straight to the target, for still frames and reduced motion. */
  settle() {
    this.levels.set(this.target);
    this.inbound.fill(0);
    this.tear.fill(0);
    this.count = 0;
  }

  /** How closely the delivered levels match the target, from 0 to 1. */
  match(x0 = 0, y0 = 0, x1 = this.width, y1 = this.height) {
    const c0 = clamp(Math.floor(x0 / this.cell), 0, this.columns);
    const c1 = clamp(Math.ceil(x1 / this.cell), 0, this.columns);
    const r0 = clamp(Math.floor(y0 / this.cell), 0, this.rows);
    const r1 = clamp(Math.ceil(y1 / this.cell), 0, this.rows);
    let error = 0;
    let total = 0;
    for (let row = r0; row < r1; row++) {
      for (let column = c0; column < c1; column++) {
        const index = column + row * this.columns;
        const goal = this.target[index];
        total += goal;
        error += Math.abs(Math.min(this.levels[index], MAX_LEVEL) - goal);
      }
    }
    return total ? clamp(1 - error / total) : 0;
  }

  /** Knock levels off every cell in a pixel rectangle; they fall away and must be re-placed. */
  shed(x0: number, y0: number, x1: number, y1: number, amount = 1) {
    const c0 = clamp(Math.floor(x0 / this.cell), 0, this.columns);
    const c1 = clamp(Math.ceil(x1 / this.cell), 0, this.columns);
    const r0 = clamp(Math.floor(y0 / this.cell), 0, this.rows);
    const r1 = clamp(Math.ceil(y1 / this.cell), 0, this.rows);
    for (let row = r0; row < r1; row++) {
      for (let column = c0; column < c1; column++) {
        const index = column + row * this.columns;
        const lost = Math.min(this.levels[index], Math.max(0, Math.floor(amount)));
        for (let i = 0; i < lost; i++) this.discard(index);
      }
    }
  }

  step(seconds: number, options: StepOptions = {}) {
    const dt = Number.isFinite(seconds) ? clamp(seconds, 0, 0.1) : 0;
    if (!dt) return;
    const pull = options.pull ?? 1.6;
    const churn = options.churn ?? 0.03;
    const error = options.error ?? 0.06;
    const evaporate = options.evaporate ?? 1.4;

    // 1. Deliver toward whatever is still missing, borrowing locally first.
    let deficitCount = 0;
    let outstanding = 0;
    let settledTotal = 0;
    for (let index = 0; index < this.target.length; index++) {
      const need = this.target[index] - this.levels[index] - this.inbound[index];
      settledTotal += this.levels[index];
      if (need > 0) {
        this.deficits[deficitCount++] = index;
        outstanding += need;
      }
    }
    this.budget = Math.min(outstanding, this.budget + (outstanding * pull + 24) * dt);
    const dispatch = Math.min(Math.floor(this.budget), deficitCount, this.capacity - this.count);
    this.budget -= Math.max(0, dispatch);
    for (let k = 0; k < dispatch; k++) {
      const pick = k + Math.floor(this.random() * (deficitCount - k));
      const cell = this.deficits[pick];
      this.deficits[pick] = this.deficits[k];
      this.deficits[k] = cell;
      const destination = this.random() < error ? this.nearMiss(cell) : cell;
      const source = this.nearestSurplus(cell);
      if (source >= 0) {
        this.levels[source] -= 1;
        this.launchFromCell(source, destination);
      } else {
        this.launchFromIngress(destination);
      }
    }

    // 2. Whatever is left over drifts off rather than lingering.
    const loss = 1 - Math.exp(-evaporate * dt);
    for (let index = 0; index < this.target.length && this.count < this.capacity; index++) {
      if (this.levels[index] > this.target[index] && this.random() < loss) this.discard(index);
    }

    // 3. A trickle of settled bytes is recalled, so the form keeps being re-made.
    this.churnBudget += settledTotal * churn * dt;
    let recalls = Math.floor(this.churnBudget);
    this.churnBudget -= recalls;
    while (recalls-- > 0 && this.count < this.capacity) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const index = Math.floor(this.random() * this.levels.length);
        if (this.levels[index]) {
          this.discard(index);
          break;
        }
      }
    }

    // 4. Advance everything in the air and land what has arrived.
    for (let i = 0; i < this.count; i++) {
      this.progress[i] += dt / this.duration[i];
      if (this.progress[i] < 1) continue;
      if (this.kind[i] === PLACE) {
        const cell = this.destination[i];
        this.inbound[cell] = Math.max(0, this.inbound[cell] - 1);
        this.levels[cell] = Math.min(255, this.levels[cell] + 1);
        this.delivered += 1;
      }
      this.remove(i);
      i -= 1;
    }
  }

  /** Paint settled cells as pixel blocks and bytes in flight as tiny hex glyphs. */
  render(out: Uint8ClampedArray, inks: ByteInks) {
    out.fill(0);
    const { width, height, cell } = this;
    const put = (x: number, y: number, ink: Ink) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const offset = (x + y * width) * 4;
      out[offset] = ink[0];
      out[offset + 1] = ink[1];
      out[offset + 2] = ink[2];
      out[offset + 3] = 255;
    };
    const block = (x: number, y: number, size: number, ink: Ink) => {
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) put(x + dx, y + dy, ink);
    };
    const full = cell - 1;
    const half = Math.max(1, Math.ceil(full * 0.67));
    const dot = Math.floor(full / 2);

    for (let row = 0; row < this.rows; row++) {
      const shift = this.tear[row];
      for (let column = 0; column < this.columns; column++) {
        const level = Math.min(this.levels[column + row * this.columns], MAX_LEVEL);
        if (!level) continue;
        const x = column * cell + shift;
        const y = row * cell;
        if (level === 3) block(x, y, full, inks.settled);
        else if (level === 2) block(x, y, half, inks.settled);
        else put(x + dot, y + dot, inks.settled);
      }
    }

    for (let i = 0; i < this.count; i++) {
      const t = this.progress[i];
      if (this.kind[i] === DISCARD) {
        if (t > 0.72) continue;
        const [x, y] = this.position(i, t);
        put(Math.round(x), Math.round(y), inks.discard);
        continue;
      }
      const [x, y] = this.position(i, t);
      const px = Math.round(x);
      const py = Math.round(y);
      const glyph = this.glyph[i];
      if (glyph !== BLOCK && t < 0.86) {
        const rows = GLYPHS[glyph];
        for (let gy = 0; gy < 5; gy++) {
          for (let gx = 0; gx < 3; gx++) {
            if (rows[gy] & (4 >> gx)) put(px - 1 + gx, py - 2 + gy, inks.flight);
          }
        }
      } else {
        block(px, py, 2, inks.flight);
        const [tx, ty] = this.position(i, Math.max(0, t - 0.1));
        put(Math.round(tx), Math.round(ty), inks.flight);
      }
    }
  }

  private position(i: number, t: number) {
    const e = t * t * (3 - 2 * t);
    const u = 1 - e;
    return [
      u * u * this.x0[i] + 2 * u * e * this.cx[i] + e * e * this.x1[i],
      u * u * this.y0[i] + 2 * u * e * this.cy[i] + e * e * this.y1[i],
    ] as const;
  }

  private center(cell: number) {
    const column = cell % this.columns;
    const row = (cell - column) / this.columns;
    return [column * this.cell + this.cell * 0.4, row * this.cell + this.cell * 0.4] as const;
  }

  private nearestSurplus(cell: number) {
    const column = cell % this.columns;
    const row = (cell - column) / this.columns;
    for (let i = 0; i < this.offsets.length; i += 2) {
      const c = column + this.offsets[i];
      const r = row + this.offsets[i + 1];
      if (c < 0 || r < 0 || c >= this.columns || r >= this.rows) continue;
      const index = c + r * this.columns;
      if (this.levels[index] > this.target[index]) return index;
    }
    return -1;
  }

  private nearMiss(cell: number) {
    const column = cell % this.columns;
    const row = (cell - column) / this.columns;
    const c = clamp(column + Math.round((this.random() - 0.5) * 6), 0, this.columns - 1);
    const r = clamp(row + Math.round((this.random() - 0.5) * 6), 0, this.rows - 1);
    return c + r * this.columns;
  }

  private launch(x0: number, y0: number, x1: number, y1: number, duration: number, kind: number, destination: number, glyph: number) {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const bend = (this.random() - 0.5) * 0.5;
    this.x0[i] = x0;
    this.y0[i] = y0;
    this.x1[i] = x1;
    this.y1[i] = y1;
    this.cx[i] = (x0 + x1) / 2 - dy * bend;
    this.cy[i] = (y0 + y1) / 2 + dx * bend;
    this.progress[i] = 0;
    this.duration[i] = duration;
    this.kind[i] = kind;
    this.destination[i] = destination;
    this.glyph[i] = glyph;
    return true;
  }

  private launchFromCell(source: number, destination: number) {
    const [x0, y0] = this.center(source);
    const [x1, y1] = this.center(destination);
    const distance = Math.hypot(x1 - x0, y1 - y0);
    if (this.launch(x0, y0, x1, y1, 0.16 + distance / 210 + this.random() * 0.08, PLACE, destination, BLOCK)) {
      this.inbound[destination] += 1;
    }
  }

  private launchFromIngress(destination: number) {
    const [x1, y1] = this.center(destination);
    const { y, left, right } = this.ingress;
    const x0 = clamp(x1 + (this.random() - 0.5) * 70, left, right);
    const y0 = y + this.random() * 3;
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const glyph = this.random() < 0.5 ? Math.floor(this.random() * 16) : BLOCK;
    if (this.launch(x0, y0, x1, y1, 0.3 + distance / 240 + this.random() * 0.25, PLACE, destination, glyph)) {
      this.inbound[destination] += 1;
    }
  }

  private discard(cell: number) {
    if (this.count >= this.capacity || !this.levels[cell]) return;
    this.levels[cell] -= 1;
    const [x0, y0] = this.center(cell);
    const x1 = x0 + (this.random() - 0.5) * 30;
    const y1 = y0 + 8 + this.random() * 30;
    this.launch(x0, y0, x1, y1, 0.35 + this.random() * 0.4, DISCARD, -1, BLOCK);
  }

  private remove(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.x0[i] = this.x0[last];
    this.y0[i] = this.y0[last];
    this.cx[i] = this.cx[last];
    this.cy[i] = this.cy[last];
    this.x1[i] = this.x1[last];
    this.y1[i] = this.y1[last];
    this.progress[i] = this.progress[last];
    this.duration[i] = this.duration[last];
    this.kind[i] = this.kind[last];
    this.destination[i] = this.destination[last];
    this.glyph[i] = this.glyph[last];
  }
}
