const UINT32_SCALE = 1 / 4294967296;

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}
export function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function smoothstep(value: number): number {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
}

export function smootherstep(value: number): number {
  const x = clamp(value);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function integerHash(value: number, seed: number): number {
  let result = Math.imul((value | 0) + 0x9e3779b9 + (seed | 0), 0x85ebca6b);
  result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35);
  return ((result ^ (result >>> 16)) >>> 0) * UINT32_SCALE;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state * UINT32_SCALE;
  }

  range(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }

  integer(minimum: number, maximumExclusive: number): number {
    return Math.floor(this.range(minimum, maximumExclusive));
  }

  chance(probability: number): boolean {
    return this.next() < clamp(probability);
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.min(values.length - 1, this.integer(0, values.length))];
  }

  fork(salt: number | string): SeededRandom {
    const saltValue = typeof salt === 'string' ? hashString(salt) : salt;
    return new SeededRandom((this.state ^ saltValue ^ 0x9e3779b9) >>> 0);
  }

  snapshot(): number {
    return this.state;
  }
}

function gradient(ix: number, iy: number, x: number, y: number, seed: number): number {
  const angle = integerHash(Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663), seed) * Math.PI * 2;
  return (x - ix) * Math.cos(angle) + (y - iy) * Math.sin(angle);
}

export function valueNoise2(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = smootherstep(x - x0);
  const sy = smootherstep(y - y0);
  const n00 = gradient(x0, y0, x, y, seed);
  const n10 = gradient(x0 + 1, y0, x, y, seed);
  const n01 = gradient(x0, y0 + 1, x, y, seed);
  const n11 = gradient(x0 + 1, y0 + 1, x, y, seed);
  return clamp(mix(mix(n00, n10, sx), mix(n01, n11, sx), sy) * 1.42, -1, 1);
}

export function fractalNoise2(x: number, y: number, seed = 0): number {
  return valueNoise2(x, y, seed) * 0.58 +
    valueNoise2(x * 2.03 + 17.1, y * 2.03 - 9.7, seed + 71) * 0.28 +
    valueNoise2(x * 4.11 - 31.4, y * 4.11 + 22.9, seed + 193) * 0.14;
}

export function springStep(
  current: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  delta: number,
): [number, number] {
  const acceleration = stiffness * (target - current) - damping * velocity;
  const nextVelocity = velocity + acceleration * delta;
  return [current + nextVelocity * delta, nextVelocity];
}
