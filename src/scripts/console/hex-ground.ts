import { hash01 } from './format';

type Rgb = readonly [number, number, number];

interface Ripple {
  x: number;
  y: number;
  start: number;
  strength: number;
}

const SQRT3 = Math.sqrt(3);
const RADIUS = 26;
const STEP_X = SQRT3 * RADIUS;
const STEP_Y = 1.5 * RADIUS;
const PERIOD_Y = STEP_Y * 2;
const PARALLAX = 0.14;
const FRAME_MS = 1000 / 30;
const MAX_DPR = 1.5;
const RIPPLE_SPEED = 1.15;
const RIPPLE_MS = 1500;

const parseRgb = (value: string): Rgb | null => {
  const numbers = value.match(/[\d.]+/g)?.map(Number);
  if (!numbers || numbers.length < 3) return null;
  return value.trim().startsWith('color(')
    ? [numbers[0] * 255, numbers[1] * 255, numbers[2] * 255]
    : [numbers[0], numbers[1], numbers[2]];
};

class HexGround {
  private readonly context: CanvasRenderingContext2D;
  private readonly tile = document.createElement('canvas');
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private columns = 0;
  private rows = 0;
  private energy = new Float32Array(0);
  private color: Rgb = [241, 125, 60];
  private lineAlpha = 0.09;
  private offset = 0;
  private ripples: Ripple[] = [];
  private pointer: { x: number; y: number; at: number } | null = null;
  private frame = 0;
  private last = 0;
  private dirty = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('2D canvas unavailable');
    this.context = context;

    window.addEventListener('resize', this.resize, { passive: true });
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    window.addEventListener('console:scene', this.onScene as EventListener);
    window.addEventListener('console:booted', this.onBooted);
    window.addEventListener('console:overdrive', this.onOverdrive);
    document.addEventListener('visibilitychange', this.request);
    this.motion.addEventListener('change', this.resize);
    this.connection?.addEventListener('change', this.resize);
    new ResizeObserver(this.resize).observe(document.body);
    new MutationObserver(this.onPalette).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-palette', 'data-overdrive'],
    });
    window.setInterval(this.spark, 170);

    this.readPalette();
    this.resize();
  }

  private get still() {
    return this.motion.matches || this.connection?.saveData === true;
  }

  private index(row: number, column: number) {
    if (row < -1 || row > this.rows || column < -1 || column > this.columns) return -1;
    return (row + 1) * (this.columns + 2) + (column + 1);
  }

  private center(row: number, column: number): [number, number] {
    const shift = ((row % 2) + 2) % 2 ? STEP_X / 2 : 0;
    return [column * STEP_X + shift, row * STEP_Y - this.offset];
  }

  private hexagon(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
    context.moveTo(x + radius * Math.cos(Math.PI / 6), y + radius * Math.sin(Math.PI / 6));
    for (let side = 1; side < 6; side++) {
      const angle = Math.PI / 6 + (side * Math.PI) / 3;
      context.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
    }
    context.closePath();
  }

  private readPalette() {
    this.color = parseRgb(getComputedStyle(this.canvas).color) ?? this.color;
    const light = getComputedStyle(document.documentElement).colorScheme.includes('light');
    this.lineAlpha = light ? 0.11 : 0.085;
  }

  private buildTile() {
    const width = this.width + STEP_X * 2;
    this.tile.width = Math.ceil(width * this.dpr);
    this.tile.height = Math.ceil(PERIOD_Y * this.dpr);
    const context = this.tile.getContext('2d');
    if (!context) return;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, width, PERIOD_Y);
    context.beginPath();
    for (let row = -1; row <= 2; row++) {
      const shift = ((row % 2) + 2) % 2 ? STEP_X / 2 : 0;
      for (let column = -1; column <= this.columns + 1; column++) {
        this.hexagon(context, column * STEP_X + shift + STEP_X, row * STEP_Y, RADIUS);
      }
    }
    const [r, g, b] = this.color;
    context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${this.lineAlpha})`;
    context.lineWidth = 1;
    context.stroke();
  }

  private resize = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.ceil(this.width * this.dpr);
    this.canvas.height = Math.ceil(this.height * this.dpr);
    const travel = Math.max(0, document.documentElement.scrollHeight - this.height) * PARALLAX;
    const columns = Math.ceil(this.width / STEP_X) + 1;
    const rows = Math.ceil((this.height + travel) / STEP_Y) + 2;
    if (columns !== this.columns || rows !== this.rows) {
      this.columns = columns;
      this.rows = rows;
      this.energy = new Float32Array((rows + 2) * (columns + 2));
    }
    this.onScroll();
    this.buildTile();
    this.dirty = true;
    this.request();
  };

  private onScroll = () => {
    const next = this.still ? 0 : window.scrollY * PARALLAX;
    if (Math.abs(next - this.offset) < 0.25) return;
    this.offset = next;
    this.dirty = true;
    this.request();
  };

  private onPalette = () => {
    this.readPalette();
    this.buildTile();
    this.dirty = true;
    this.request();
  };

  private onPointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || this.still) return;
    this.pointer = { x: event.clientX, y: event.clientY, at: performance.now() };
    this.request();
  };

  private ripple(x: number, y: number, strength = 0.8) {
    if (this.still) return;
    this.ripples.push({ x, y, start: performance.now(), strength });
    this.request();
  }

  private onScene = (event: CustomEvent<{ x: number; y: number }>) => {
    this.ripple(event.detail?.x ?? 0, event.detail?.y ?? 0, 0.7);
  };

  private onBooted = () => {
    this.ripple(this.width * 0.72, this.height * 0.5, 0.9);
  };

  private onOverdrive = () => {
    if (this.still) return;
    for (let i = 0; i < this.energy.length; i++) {
      this.energy[i] = Math.max(this.energy[i], 0.2 + Math.random() * 0.8);
    }
    this.ripple(this.width / 2, this.height / 2, 1);
    window.setTimeout(() => this.ripple(this.width / 2, this.height / 2, 1), 450);
  };

  /** Occasional cells light up on their own, so the ground reads as live. */
  private spark = () => {
    if (this.still || document.hidden || Math.random() > 0.6) return;
    const row = Math.floor((this.offset + Math.random() * this.height) / STEP_Y);
    const column = Math.floor(Math.random() * this.columns);
    const index = this.index(row, column);
    if (index < 0) return;
    this.energy[index] = Math.max(this.energy[index], 0.35 + Math.random() * 0.55);
    this.request();
  };

  private nearest(x: number, y: number) {
    const worldY = y + this.offset;
    const baseRow = Math.round(worldY / STEP_Y);
    let best = { row: 0, column: 0, distance: Infinity };
    for (let row = baseRow - 1; row <= baseRow + 1; row++) {
      const shift = ((row % 2) + 2) % 2 ? STEP_X / 2 : 0;
      const column = Math.round((x - shift) / STEP_X);
      const distance = Math.hypot(column * STEP_X + shift - x, row * STEP_Y - worldY);
      if (distance < best.distance) best = { row, column, distance };
    }
    return best;
  }

  request = () => {
    if (!this.frame && !document.hidden) this.frame = requestAnimationFrame(this.tick);
  };

  private tick = (now: number) => {
    this.frame = 0;
    if (document.hidden) return;
    if (!this.dirty && now - this.last < FRAME_MS) {
      this.request();
      return;
    }
    const seconds = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.dirty = false;
    const active = this.step(now, seconds);
    this.draw();
    if (active) this.request();
    else this.last = 0;
  };

  /** Advances energy; returns whether anything is still changing. */
  private step(now: number, seconds: number) {
    if (this.still) {
      this.energy.fill(0);
      for (let row = 0; row < this.rows; row++) {
        for (let column = 0; column < this.columns; column++) {
          if (hash01(row, column, 3) > 0.985) this.energy[this.index(row, column)] = 0.55;
        }
      }
      return false;
    }

    const decay = Math.exp(-seconds * 2.3);
    let live = false;
    for (let i = 0; i < this.energy.length; i++) {
      if (this.energy[i] < 0.012) {
        this.energy[i] = 0;
        continue;
      }
      this.energy[i] *= decay;
      live = true;
    }

    if (this.pointer && now - this.pointer.at < 140) {
      const cell = this.nearest(this.pointer.x, this.pointer.y);
      const index = this.index(cell.row, cell.column);
      if (index >= 0) this.energy[index] = Math.max(this.energy[index], 0.5);
      live = true;
    }

    this.ripples = this.ripples.filter((ripple) => now - ripple.start < RIPPLE_MS);
    if (this.ripples.length) {
      live = true;
      const first = Math.max(-1, Math.floor(this.offset / STEP_Y) - 1);
      const last = Math.min(this.rows, Math.ceil((this.offset + this.height) / STEP_Y) + 1);
      for (const ripple of this.ripples) {
        const age = now - ripple.start;
        const radius = age * RIPPLE_SPEED;
        const fade = 1 - age / RIPPLE_MS;
        for (let row = first; row <= last; row++) {
          for (let column = -1; column <= this.columns; column++) {
            const [x, y] = this.center(row, column);
            const band = Math.abs(Math.hypot(x - ripple.x, y - ripple.y) - radius);
            if (band > RADIUS * 1.4) continue;
            const index = this.index(row, column);
            const value = ripple.strength * fade * (1 - band / (RADIUS * 1.4));
            if (index >= 0 && value > this.energy[index]) this.energy[index] = value;
          }
        }
      }
    }
    return live;
  }

  private draw() {
    const context = this.context;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);

    const phase = this.offset % PERIOD_Y;
    for (let y = -phase; y < this.height + PERIOD_Y; y += PERIOD_Y) {
      context.drawImage(this.tile, -STEP_X, y, this.tile.width / this.dpr, PERIOD_Y);
    }

    const [r, g, b] = this.color;
    const first = Math.max(-1, Math.floor(this.offset / STEP_Y) - 1);
    const last = Math.min(this.rows, Math.ceil((this.offset + this.height) / STEP_Y) + 1);
    context.lineWidth = 1.25;
    for (let row = first; row <= last; row++) {
      for (let column = -1; column <= this.columns; column++) {
        const index = this.index(row, column);
        const value = index >= 0 ? this.energy[index] : 0;
        if (value < 0.012) continue;
        const [x, y] = this.center(row, column);
        context.beginPath();
        this.hexagon(context, x, y, RADIUS - 2.5);
        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${(value * 0.16).toFixed(3)})`;
        context.fill();
        context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(value * 0.55).toFixed(3)})`;
        context.stroke();
      }
    }
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-hex-ground]');
if (canvas && !canvas.dataset.initialized) {
  canvas.dataset.initialized = 'true';
  try {
    new HexGround(canvas);
  } catch {
    canvas.hidden = true;
  }
}
