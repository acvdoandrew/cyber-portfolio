/** Low-resolution, palette-independent drawings shared by animation and posters. */
export const STUDY_WIDTH = 288;
export const STUDY_HEIGHT = 192;
export const STUDY_IDS = ['ares', 'rust-edge-compute', 'physics-engine', 'inference-proxy'] as const;
export type StudyId = typeof STUDY_IDS[number];
export type Point = readonly [number, number];

const TAU = Math.PI * 2;
const fract = (value: number) => value - Math.floor(value);
const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export class PixelField {
  readonly values: Float32Array;

  constructor(readonly width = STUDY_WIDTH, readonly height = STUDY_HEIGHT) {
    this.values = new Float32Array(width * height);
  }

  clear() { this.values.fill(0); }

  dot(x: number, y: number, radius: number, intensity: number) {
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(y + radius));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const distance = Math.hypot(px - x, py - y) / radius;
        if (distance > 1) continue;
        const index = px + py * this.width;
        this.values[index] = Math.max(this.values[index], intensity * (1 - distance * distance));
      }
    }
  }

  line(a: Point, b: Point, intensity: number, radius = 0.9) {
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.5));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      this.dot(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, radius, intensity);
    }
  }

  polygon(points: Point[], intensity: number) {
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
    for (let y = minY; y <= maxY; y++) {
      const crossings: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          crossings.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i < crossings.length - 1; i += 2) {
        for (let x = Math.max(0, Math.ceil(crossings[i])); x <= Math.min(this.width - 1, crossings[i + 1]); x++) {
          this.values[x + y * this.width] = intensity;
        }
      }
    }
  }

  sphere(cx: number, cy: number, radius: number, intensity = 0.9) {
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(this.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(this.width - 1, cx + radius); x++) {
        const nx = (x - cx) / radius;
        const ny = (y - cy) / radius;
        const length = nx * nx + ny * ny;
        if (length >= 1) continue;
        const light = clamp(0.18 + Math.sqrt(1 - length) * 0.72 - nx * 0.3 - ny * 0.35);
        this.values[x + y * this.width] = light * intensity;
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, intensity: number, phase = 0) {
    for (let i = 0; i < 160; i++) {
      const angle = i / 160 * TAU;
      this.dot(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry,
        0.85, intensity * (0.65 + 0.35 * Math.sin(angle * 3 + phase)));
    }
  }
}

function ares(field: PixelField, time: number, pointer: Point) {
  const cx = 144 + pointer[0] * 4;
  const cy = 104 + pointer[1] * 3;
  const cells: { x: number; y: number; distance: number }[] = [];
  for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) {
    const distance = Math.hypot(x, y);
    if (distance < 10.5) cells.push({ x, y, distance });
  }
  cells.sort((a, b) => a.x + a.y - b.x - b.y);
  field.ellipse(cx, cy + 7, 89, 41, 0.23, time * 0.2);
  field.ellipse(cx, cy + 9, 89, 41, 0.17, time * 0.2);
  for (const { x, y, distance } of cells) {
    const seed = hash(x + 14, y + 14);
    const height = Math.max(1, 4 + Math.sin(x * 0.4) * 3 + Math.cos(y * 0.43) * 3);
    const activity = 0.5 + 0.5 * Math.sin(time * 0.8 - distance * 0.7);
    const occupied = seed > 0.87 && distance < 8;
    const tower = occupied ? 5 + Math.floor(seed * 8) + Math.floor(activity * 3) * 2 : 0;
    const px = cx + (x - y) * 4.05;
    const ground = cy + (x + y) * 1.9 - height;
    const top = ground - tower;
    const light = clamp(0.16 + height * 0.043 + activity * 0.08);
    if (tower) {
      field.polygon([[px - 3.6, top], [px, top + 1.8], [px, ground + 1.8], [px - 3.6, ground]], 0.23);
      field.polygon([[px, top + 1.8], [px + 3.6, top], [px + 3.6, ground], [px, ground + 1.8]], 0.6);
    }
    field.polygon([[px, top - 1.8], [px + 3.6, top], [px, top + 1.8], [px - 3.6, top]], occupied ? 0.85 : light);
    if (seed > 0.94 && activity > 0.65) field.dot(px, top - 2, 1.7, 1);
  }
  // Bounded agents make discrete steps around the settlement.
  for (let i = 0; i < 8; i++) {
    const angle = time * 0.18 + i * TAU / 8;
    const x = Math.round(Math.cos(angle) * 9);
    const y = Math.round(Math.sin(angle) * 9);
    field.dot(cx + (x - y) * 4.05, cy + (x + y) * 1.9 - 4, 1.5, 0.98);
  }
}

function curve(a: Point, control: Point, b: Point, t: number): Point {
  const inverse = 1 - t;
  return [inverse * inverse * a[0] + 2 * inverse * t * control[0] + t * t * b[0],
    inverse * inverse * a[1] + 2 * inverse * t * control[1] + t * t * b[1]];
}

function edge(field: PixelField, time: number, pointer: Point) {
  const center: Point = [144 + pointer[0] * 5, 94 + pointer[1] * 4];
  const failed = Math.floor(time / 7) % 6;
  const recovery = fract(time / 7);
  const nodes = Array.from({ length: 6 }, (_, i): Point => {
    const angle = i * TAU / 6 - 0.35 + Math.sin(time * 0.12) * 0.06;
    return [center[0] + Math.cos(angle) * 88, center[1] + Math.sin(angle) * 51];
  });
  field.ellipse(center[0], center[1], 101, 61, 0.17, time * 0.4);
  nodes.forEach((node, i) => {
    const down = i === failed && recovery > 0.35 && recovery < 0.8;
    const control: Point = [(node[0] + center[0]) / 2 + (i % 2 ? 9 : -9), (node[1] + center[1]) / 2 - 18];
    let previous = center;
    for (let n = 1; n <= 32; n++) {
      const next = curve(center, control, node, n / 32);
      field.line(previous, next, down ? 0.1 : 0.3);
      previous = next;
    }
    if (!down) for (let packet = 0; packet < 3; packet++) {
      const point = curve(center, control, node, fract(time * 0.26 + i * 0.13 + packet / 3));
      field.dot(point[0], point[1], 2.1, 1);
    }
    field.ellipse(node[0], node[1], 13, 8, down ? 0.12 : 0.32, time + i);
    field.sphere(node[0], node[1], down ? 4.5 : 7.5, down ? 0.3 : 0.95);
    if (down) {
      const next = nodes[(i + 1) % nodes.length];
      const point = curve(node, [center[0] + 12, center[1] - 62], next, fract(time * 0.4));
      field.dot(point[0], point[1], 2.2, 1);
      field.line(node, next, 0.16);
    }
  });
  field.ellipse(center[0], center[1], 25, 16, 0.35, time * 0.65);
  field.sphere(center[0], center[1], 13 + Math.sin(time * 1.7) * 0.6);
}

const reflect = (value: number) => 1 - Math.abs(fract(value / 2) * 2 - 1);

function particlePosition(i: number, time: number, pointer: Point): Point {
  const x = (reflect(time * (0.09 + hash(i, 2) * 0.13) + hash(i, 8) * 2) - 0.5) * 150;
  const y = (reflect(time * (0.12 + hash(i, 6) * 0.16) + hash(i, 1) * 2) - 0.5) * 91;
  const angle = -0.22 + pointer[0] * 0.04;
  return [144 + x * Math.cos(angle) - y * Math.sin(angle), 95 + x * Math.sin(angle) + y * Math.cos(angle) + pointer[1] * 3];
}

function physics(field: PixelField, time: number, pointer: Point) {
  field.ellipse(144, 95, 104, 66, 0.16, time * 0.13);
  const points = Array.from({ length: 22 }, (_, i) => particlePosition(i, time, pointer));
  points.forEach((point, i) => {
    for (let trail = 10; trail > 0; trail--) {
      const previous = particlePosition(i, time - trail * 0.09, pointer);
      field.dot(previous[0], previous[1], 1.2, 0.42 * (1 - trail / 12));
    }
    points.slice(i + 1).forEach((other) => {
      const distance = Math.hypot(point[0] - other[0], point[1] - other[1]);
      if (distance < 24) field.line(point, other, 0.24 * (1 - distance / 28), 1.1);
      if (distance < 10) field.ellipse(point[0], point[1], 10, 10, 0.35, time);
    });
    field.sphere(point[0], point[1], 2.8 + hash(i, 11) * 4.2, 0.96);
  });
}

function inference(field: PixelField, time: number, pointer: Point) {
  const cx = 159 + pointer[0] * 5;
  const cy = 95 + pointer[1] * 4;
  const stream = (t: number, lane: number): Point => {
    const before = clamp((cx - (30 + t * 228)) / 115);
    return [30 + t * 228, cy + Math.sin(t * 14 - time * 0.75 + lane * Math.PI) * (3 + before * 28)];
  };
  for (let lane = 0; lane < 2; lane++) {
    let previous = stream(0, lane);
    for (let i = 1; i <= 130; i++) {
      const next = stream(i / 130, lane);
      field.line(previous, next, 0.25, 0.9);
      previous = next;
    }
    for (let i = 0; i < 17; i++) {
      const t = fract(i / 17 + time * 0.105);
      const point = stream(t, lane);
      field.dot(point[0], point[1], t > 0.6 ? 1.7 : 2.3, 0.96);
      if (t > 0.32 && t < 0.48 && i % 5 === 0) {
        const rejection = (t - 0.32) / 0.16;
        field.dot(point[0], point[1] + rejection * 31, 1.2, 0.65 * (1 - rejection));
      }
    }
  }
  for (let i = 0; i < 7; i++) {
    field.ellipse(cx + i * 1.4 - 5, cy, 16 + i * 0.25, 43 - i * 0.3,
      0.24 + Math.sin(i / 7 * Math.PI) * 0.52, time * 0.25);
  }
  field.ellipse(cx, cy, 28, 53, 0.14, time * 0.4);
}

const scenes: Record<StudyId, (field: PixelField, time: number, pointer: Point) => void> = {
  ares,
  'rust-edge-compute': edge,
  'physics-engine': physics,
  'inference-proxy': inference,
};

export function drawStudy(field: PixelField, id: StudyId, time: number, pointer: Point = [0, 0]) {
  field.clear();
  const safeTime = Number.isFinite(time) ? Math.max(0, time) : 8;
  const safePointer: Point = pointer.map((value) => Number.isFinite(value) ? clamp(value, -1, 1) : 0) as unknown as Point;
  scenes[id](field, safeTime, safePointer);
}
