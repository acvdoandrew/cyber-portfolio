import { PixelField } from './project-studies/scenes';
import { manifestationAt } from './intelligence-state';

export const INTELLIGENCE_WIDTH = 256;
export const INTELLIGENCE_HEIGHT = 384;
export const TERMINAL_ENTITY_WIDTH = 384;
export const TERMINAL_ENTITY_HEIGHT = 256;
export type IntelligencePose = 'portrait' | 'terminal';
type Vec3 = readonly [number, number, number];
type Region = 'head' | 'eye' | 'body' | 'hand' | 'drift';
interface Particle {
  x: number;
  y: number;
  z: number;
  light: number;
  seed: number;
  region: Region;
}

const TAU = Math.PI * 2;
const fract = (value: number) => value - Math.floor(value);
const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const gaussian = (x: number, y: number, rx: number, ry: number) => Math.exp(-((x / rx) ** 2 + (y / ry) ** 2) * 2);
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
// Key light from the upper left, shared by every lit surface so the figure reads as one body.
const KEY: Vec3 = [-0.5, 0.45, 0.74];
const KEY_LENGTH = Math.hypot(...KEY);
const shade = (nx: number, ny: number, nz: number) => {
  const length = Math.hypot(nx, ny, nz) || 1;
  return clamp(0.16 + Math.max(0, (nx * KEY[0] + ny * KEY[1] + nz * KEY[2]) / (length * KEY_LENGTH)) * 0.88);
};
/** The terminal pose's head sits at the model's portrait offset until the final shift. */
const TERMINAL_OFFSET = -0.20;
const EYE_X = 0.104;
const EYE_Y = 0.054;
const HEAD_YAW = -0.36;

function facialRelief(x: number, y: number) {
  const eyes = gaussian(x - 0.104, y - 0.054, 0.059, 0.032)
    + gaussian(x + 0.104, y - 0.054, 0.059, 0.032);
  return gaussian(x, y + 0.004, 0.035, 0.12) * 0.068
    + gaussian(x, y + 0.078, 0.055, 0.04) * 0.086
    + (gaussian(x - 0.135, y + 0.05, 0.085, 0.075) + gaussian(x + 0.135, y + 0.05, 0.085, 0.075)) * 0.029
    + (gaussian(x - 0.11, y - 0.101, 0.084, 0.025) + gaussian(x + 0.11, y - 0.101, 0.084, 0.025)) * 0.014
    + gaussian(x, y + 0.16, 0.10, 0.018) * 0.018
    + gaussian(x, y + 0.197, 0.083, 0.023) * 0.019
    - eyes * 0.027 - gaussian(x, y + 0.174, 0.096, 0.008) * 0.012;
}

/**
 * Anatomical surfaces and filaments, generated from coordinates, never a texture.
 * `whole` keeps the cranium closed and drops the loose filaments: the byte entity
 * uses it as the finished form its bytes are trying to reach.
 */
export function createIntelligenceGeometry(pose: IntelligencePose = 'portrait', whole = false): readonly Particle[] {
  const particles: Particle[] = [];
  const add = (x: number, y: number, z: number, light: number, region: Region, seed?: number) => {
    particles.push({ x, y, z, light: clamp(light), region, seed: seed ?? hash(particles.length, 8) });
  };

  // An open cranial shell. The front is displaced into brow, cheek, nose and lip contours.
  for (let latitude = 1; latitude < 89; latitude++) {
    const theta = latitude / 90 * Math.PI;
    const dy = Math.cos(theta) * 0.345;
    const taper = 0.75 + 0.25 * clamp((dy + 0.24) / 0.31);
    for (let longitude = 0; longitude < 170; longitude++) {
      const phi = longitude / 170 * TAU;
      let x = Math.sin(theta) * Math.cos(phi) * 0.265 * taper;
      let z = Math.sin(theta) * Math.sin(phi) * 0.245;
      const front = clamp(Math.sin(phi) * 4);
      if (z < -0.045) continue;
      const eyes = gaussian(x - 0.104, dy - 0.054, 0.059, 0.032)
        + gaussian(x + 0.104, dy - 0.054, 0.059, 0.032);
      const mouth = gaussian(x, dy + 0.174, 0.096, 0.008);
      const baseZ = Math.max(0.02, z);
      const dzdx = -x * 0.245 ** 2 / ((0.265 * taper) ** 2 * baseZ)
        + (facialRelief(x + 0.002, dy) - facialRelief(x - 0.002, dy)) / 0.004 * front;
      const dzdy = -dy * 0.245 ** 2 / (0.345 ** 2 * baseZ)
        + (facialRelief(x, dy + 0.002) - facialRelief(x, dy - 0.002)) / 0.004 * front;
      z += facialRelief(x, dy) * front;
      const seed = hash(latitude + 10, longitude + 5);
      const openSide = clamp((x - 0.015) / 0.22);
      if (!whole && seed < openSide * 0.4) continue;
      const normalLight = clamp(0.16 + Math.max(0, (dzdx * 0.5 - dzdy * 0.45 + 0.74)
        / Math.hypot(dzdx, dzdy, 1)) * 0.88);
      const light = normalLight * (1 - eyes * front * 0.86) * (1 - mouth * front * 0.85);
      // A three-quarter turn makes the projection read as a face rather than a mask.
      const yaw = -0.36;
      const rotatedX = x * Math.cos(yaw) + z * Math.sin(yaw);
      z = z * Math.cos(yaw) - x * Math.sin(yaw);
      x = rotatedX;
      add(x - 0.20, dy + 0.67, z, light, 'head', seed);
    }
  }

  // Ears and lit pupils share the cranium's three-quarter turn.
  const headPoint = (x: number, y: number, z: number, light: number, region: Region, seed?: number) => {
    add(x * Math.cos(HEAD_YAW) + z * Math.sin(HEAD_YAW) - 0.20, y + 0.67,
      z * Math.cos(HEAD_YAW) - x * Math.sin(HEAD_YAW), light, region, seed);
  };
  for (const side of [-1, 1]) {
    for (let lat = 1; lat < 16; lat++) for (let lon = 0; lon < 22; lon++) {
      const theta = lat / 16 * Math.PI;
      const phi = lon / 22 * TAU;
      const seed = hash(lat + side * 40, lon + 90);
      if (!whole && side > 0 && seed < 0.25) continue;
      const ny = Math.cos(theta);
      const nx = Math.sin(theta) * Math.cos(phi);
      const nz = Math.sin(theta) * Math.sin(phi);
      // The rim of the ear catches light; its hollow falls into shadow.
      headPoint(side * (0.252 + 0.018 + nx * 0.022), 0.01 + ny * 0.068, -0.03 + nz * 0.045,
        shade(side * nx, ny, nz) * (0.7 + Math.abs(nx) * 0.3), 'head', seed);
    }
    // A lit pupil inside a dark iris ring, so the gaze reads even at one pixel per point.
    for (let ring = 0; ring < 9; ring++) for (let i = 0; i < 24; i++) {
      const angle = i / 24 * TAU;
      const radius = ring / 8 * 0.032;
      headPoint(side * EYE_X + Math.cos(angle) * radius, EYE_Y - 0.004 + Math.sin(angle) * radius * 0.75, 0.214,
        ring < 5 ? 1 : 0.02, 'eye', hash(ring + side * 3, i) * 0.5);
    }
  }

  /** A true 3D tube: lit from its surface normal, with the hidden back half omitted. */
  const limb = (path: Vec3[], radii: number[], rings: number, steps: number, region: Region, strength: number) => {
    for (let step = 0; step <= steps; step++) {
      const t = step / steps * (path.length - 1);
      const index = Math.min(path.length - 2, Math.floor(t));
      const f = smooth(t - index) * 0.35 + (t - index) * 0.65;
      const a = path[index];
      const b = path[index + 1];
      const radius = radii[index] + (radii[index + 1] - radii[index]) * f;
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      // Normal frame: the tangent crossed with the view axis, or with up when the tube points at the viewer.
      let nx = -ty / tl;
      let ny = tx / tl;
      let nz = 0;
      if (Math.hypot(nx, ny) < 0.3) {
        nx = 0; ny = -tz / tl; nz = ty / tl;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const bx = (ty * nz - tz * ny) / tl;
      const by = (tz * nx - tx * nz) / tl;
      const bz = (tx * ny - ty * nx) / tl;
      for (let ring = 0; ring < rings; ring++) {
        const phase = ring / rings * TAU;
        const ox = nx * Math.cos(phase) + bx * Math.sin(phase);
        const oy = ny * Math.cos(phase) + by * Math.sin(phase);
        const oz = nz * Math.cos(phase) + bz * Math.sin(phase);
        if (oz < -0.25) continue;
        add(a[0] + tx * f + ox * radius, a[1] + ty * f + oy * radius, a[2] + tz * f + oz * radius,
          shade(ox, oy, oz) * strength, region);
      }
    }
  };

  const tube = (path: Vec3[], radii: number[], strands: number, steps: number, region: Region, strength: number) => {
    for (let strand = 0; strand < strands; strand++) {
      const phase = strand / strands * TAU;
      for (let step = 0; step <= steps; step++) {
        const t = step / steps * (path.length - 1);
        const index = Math.min(path.length - 2, Math.floor(t));
        const f = t - index;
        const a = path[index];
        const b = path[index + 1];
        const radius = radii[index] + (radii[index + 1] - radii[index]) * f;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length = Math.max(0.001, Math.hypot(dx, dy));
        const x = a[0] + dx * f - dy / length * Math.cos(phase) * radius;
        const y = a[1] + dy * f + dx / length * Math.cos(phase) * radius;
        const z = a[2] + (b[2] - a[2]) * f + Math.sin(phase) * radius * 0.8;
        add(x, y, z, strength * (0.42 + Math.sin(phase) * 0.2 + Math.cos(phase) * 0.2), region);
      }
    }
  };

  if (pose === 'terminal') {
    const o = TERMINAL_OFFSET;
    // Neck: narrow under the jaw, flaring into the trapezius.
    // Kept dim: it sits in the jaw's shadow.
    limb([[o, 0.43, -0.04], [o, 0.30, -0.035], [o, 0.17, 0]], [0.088, 0.084, 0.125], 36, 60, 'body', 0.66);

    // Shoulders and upper chest as a lit relief: trapezius slope, clavicles, pectorals.
    const top = (ax: number) => ax < 0.40
      ? 0.21 - 0.095 * smooth((ax - 0.07) / 0.33)
      : 0.115 - 0.09 * (1 - Math.sqrt(Math.max(0, 1 - ((ax - 0.40) / 0.075) ** 2)));
    const surface = (x: number, y: number) => {
      const ax = Math.abs(x);
      return 0.13 * Math.sqrt(Math.max(0, 1 - (x / 0.5) ** 2))
        + gaussian(ax - 0.17, y + 0.03, 0.2, 0.13) * 0.035
        + gaussian(ax - 0.2, y - (0.135 - ax * 0.12), 0.34, 0.025) * 0.012
        - gaussian(x, y + 0.02, 0.07, 0.26) * 0.008
        + gaussian(ax - 0.42, y - 0.06, 0.12, 0.14) * 0.03;
    };
    for (let gy = 0; gy < 70; gy++) {
      const y = 0.22 - gy / 69 * 0.36;
      for (let gx = 0; gx <= 150; gx++) {
        const x = (gx / 150 * 2 - 1) * 0.49;
        const ax = Math.abs(x);
        if (y > top(ax) || ax > 0.475 - Math.max(0, 0.02 - y) * 0.35) continue;
        const z = surface(x, y);
        const dzdx = (surface(x + 0.003, y) - surface(x - 0.003, y)) / 0.006;
        const dzdy = (surface(x, y + 0.003) - surface(x, y - 0.003)) / 0.006;
        // Depth falloff toward the terminal hides the chest before the rim cuts it.
        add(o + x, y, z, shade(-dzdx, -dzdy, 1) * (0.62 + clamp((y + 0.14) / 0.36) * 0.3), 'body', hash(gx + 300, gy));
      }
    }
  }

  if (pose !== 'terminal') {
  tube([[-0.20, 0.42, 0], [-0.19, 0.29, -0.018], [-0.17, 0.17, -0.035]],
    [0.092, 0.080, 0.12], 32, 55, 'body', 0.95);

  // A body that only provisionally exists: flowing meridians, not a solid torso.
  for (let strand = 0; strand < 90; strand++) {
    const angle = strand / 90 * TAU;
    for (let step = 0; step < 115; step++) {
      const t = step / 114;
      const y = 0.22 - t * 1.42;
      const width = 0.085 + Math.exp(-Math.pow((t - 0.15) / 0.20, 2)) * 0.26
        + Math.exp(-Math.pow((t - 0.42) / 0.23, 2)) * 0.105;
      const twist = angle + Math.sin(t * 9) * 0.12 + t * t * 1.8;
      const cx = -0.16 + Math.sin(t * 7.4) * t * 0.11;
      const x = cx + Math.cos(twist) * width * (1 - t * 0.33);
      const z = Math.sin(twist) * (0.11 - t * 0.07);
      const fade = Math.pow(1 - t, 0.55);
      if (hash(strand, step) > fade * 0.84) continue;
      add(x, y, z, (0.48 + Math.sin(angle) * 0.15) * fade, 'body');
    }
  }
  }

  if (pose === 'terminal') {
    // Shoulders roll into upper arms; elbows splay out and the forearms come forward to the rim.
    for (const side of [-1, 1]) {
      const o = TERMINAL_OFFSET;
      const cx = side * 0.74 + o;
      for (let lat = 1; lat < 22; lat++) for (let lon = 0; lon < 40; lon++) {
        const theta = lat / 22 * Math.PI;
        const phi = lon / 40 * TAU;
        const nx = Math.sin(theta) * Math.cos(phi);
        const ny = Math.cos(theta);
        const nz = Math.sin(theta) * Math.sin(phi);
        if (nz < -0.1) continue;
        add(o + side * 0.43 + nx * 0.08, 0.055 + ny * 0.068, 0.02 + nz * 0.07, shade(nx, ny, nz) * 0.92, 'body');
      }
      limb([[o + side * 0.42, 0.06, 0.02], [o + side * 0.58, -0.01, 0.03], [o + side * 0.66, -0.075, 0.07]],
        [0.074, 0.062, 0.055], 30, 70, 'body', 0.9);
      limb([[o + side * 0.66, -0.075, 0.07], [o + side * 0.71, -0.08, 0.15], [cx - side * 0.01, -0.075, 0.21]],
        [0.055, 0.05, 0.044], 30, 50, 'hand', 0.9);

      // The back of the hand, knuckles raised, fingers curling down over the edge.
      for (let lat = 1; lat < 30; lat++) for (let lon = 0; lon < 46; lon++) {
        const theta = lat / 30 * Math.PI;
        const phi = lon / 46 * TAU;
        const nx = Math.sin(theta) * Math.cos(phi);
        const ny = Math.cos(theta);
        const nz = Math.sin(theta) * Math.sin(phi);
        if (nz < -0.1) continue;
        add(cx + nx * 0.088, -0.078 + ny * 0.05, 0.235 + nz * 0.05, shade(nx, ny * 0.6 + 0.4, nz), 'hand');
      }
      for (let finger = 0; finger < 4; finger++) {
        const x = cx + (finger - 1.5) * 0.04 - side * 0.006;
        const length = 0.085 + Math.sin((finger + 0.5) / 4 * Math.PI) * 0.042;
        limb([[x, -0.095, 0.265], [x + side * 0.004, -0.12, 0.305], [x + side * 0.006, -0.10 - length, 0.3]],
          [0.021, 0.018, 0.013], 14, 34, 'hand', 1.05);
      }
      limb([[cx - side * 0.075, -0.07, 0.25], [cx - side * 0.125, -0.10, 0.285], [cx - side * 0.12, -0.16, 0.29]],
        [0.024, 0.02, 0.014], 14, 34, 'hand', 1);
    }
  } else {
  // A lifted forearm and open palm, assembled from the same filament geometry.
  tube([[0.10, 0.12, 0], [0.19, -0.14, 0.015], [0.20, -0.40, 0.055]],
    [0.075, 0.068, 0.062], 22, 65, 'body', 0.7);
  tube([[0.20, -0.40, 0.055], [0.34, -0.22, 0.13], [0.46, -0.015, 0.20]],
    [0.063, 0.048, 0.040], 25, 70, 'hand', 0.9);

  for (let lat = 1; lat < 40; lat++) for (let lon = 0; lon < 60; lon++) {
    const theta = lat / 40 * Math.PI;
    const phi = lon / 60 * TAU;
    const x = Math.sin(theta) * Math.cos(phi) * 0.096;
    const y = Math.cos(theta) * 0.13;
    const z = Math.sin(theta) * Math.sin(phi) * 0.04;
    if (z < 0) continue;
    add(0.48 + x, 0.085 + y, 0.20 + z, 0.48 + Math.sin(phi) * 0.18, 'hand');
  }

  const fingers: Vec3[][] = [
    [[0.414, 0.034, 0.23], [0.332, 0.091, 0.27], [0.310, 0.176, 0.28]],
    [[0.423, 0.171, 0.22], [0.394, 0.283, 0.22], [0.383, 0.386, 0.25]],
    [[0.477, 0.196, 0.22], [0.487, 0.327, 0.21], [0.503, 0.426, 0.24]],
    [[0.524, 0.170, 0.22], [0.568, 0.277, 0.22], [0.601, 0.355, 0.26]],
    [[0.555, 0.126, 0.22], [0.620, 0.195, 0.23], [0.656, 0.262, 0.27]],
  ];
  for (const finger of fingers) tube(finger, [0.022, 0.018, 0.011], 16, 44, 'hand', 1.05);
  }

  // Disconnected paths off the unfinished half of the cranium.
  for (let strand = 0; strand < (whole ? 0 : 38); strand++) {
    const startY = 0.47 + hash(strand, 18) * 0.5;
    for (let step = 0; step < 48; step++) {
      const t = step / 47;
      const x = -0.01 + t * (0.14 + hash(strand, 5) * 0.32);
      const y = startY + Math.sin(t * 5 + strand) * 0.025 + t * (hash(strand, 8) - 0.5) * 0.18;
      if (hash(strand, step + 70) > 0.65 - t * 0.4) continue;
      add(x, y, 0.06, (0.38 - t * 0.2), 'drift');
    }
  }
  return pose === 'terminal' ? particles.map((particle) => ({ ...particle, x: particle.x + 0.20 })) : particles;
}

const geometry = createIntelligenceGeometry();
const terminalGeometry = createIntelligenceGeometry('terminal');
let wholeGeometry: readonly Particle[] | null = null;
const depthBuffers = new WeakMap<PixelField, Float32Array>();

type Point2 = readonly [number, number];
export interface TerminalLandmarks {
  /** Center of the face, following the head's turn. */
  face: Point2;
  /** Center of the skull and its projected half-width, in pixels. */
  head: Point2;
  headRadius: number;
  neck: Point2;
  shoulders: readonly [Point2, Point2];
  hands: readonly [Point2, Point2];
  /** The terminal's top edge; only the hands cross it. */
  rim: number;
}

const safeInputs = (seconds: number, pointer: readonly [number, number]) => ({
  time: Number.isFinite(seconds) ? Math.max(0, seconds) : 8,
  pointerX: Number.isFinite(pointer[0]) ? clamp(pointer[0], -0.5, 0.5) : 0,
  pointerY: Number.isFinite(pointer[1]) ? clamp(pointer[1], -0.5, 0.5) : 0,
});

/** The head's look and nod in the terminal pose, shared by particles and landmarks. */
function turnHead(x: number, y: number, z: number, time: number, pointerX: number, pointerY: number): Vec3 {
  const look = Math.sin(time * 0.27) * 0.055 + pointerX * 0.5;
  const headX = x * Math.cos(look) + z * Math.sin(look);
  z = z * Math.cos(look) - x * Math.sin(look);
  const pitch = 0.20 - pointerY * 0.3 + Math.sin(time * 0.38) * 0.025;
  const headY = (y - 0.60) * Math.cos(pitch) - z * Math.sin(pitch);
  z = z * Math.cos(pitch) + (y - 0.60) * Math.sin(pitch);
  return [headX, 0.60 + headY, z];
}

function projectTerminal(x: number, y: number, z: number, width: number, height: number, time: number): Point2 & { z: number } {
  const yaw = Math.sin(time * 0.14) * 0.018;
  const rotatedX = x * Math.cos(yaw) + z * Math.sin(yaw);
  const rotatedZ = z * Math.cos(yaw) - x * Math.sin(yaw);
  const perspective = 1 / (1 - rotatedZ * 0.17);
  const scale = width * 0.3516;
  return Object.assign([width * 0.5 + rotatedX * scale * perspective, height * 0.6055 - y * scale * perspective] as const, { z: rotatedZ });
}

/** Where the terminal pose's head, shoulders and hands land in a field of this size. */
export function terminalLandmarks(
  width: number,
  height: number,
  seconds: number,
  pointer: readonly [number, number] = [0, 0],
): TerminalLandmarks {
  const { time, pointerX, pointerY } = safeInputs(seconds, pointer);
  const project = (point: Vec3, head = false) => {
    const [x, y, z] = head ? turnHead(point[0], point[1], point[2], time, pointerX, pointerY) : point;
    const [px, py] = projectTerminal(x, y, z, width, height, time);
    return [px, py] as const;
  };
  const head = project([0, 0.67, 0], true);
  const edge = project([0.265, 0.67, 0], true);
  return {
    face: project([0, 0.67, 0.24], true),
    head,
    headRadius: Math.abs(edge[0] - head[0]),
    neck: project([0, 0.27, 0]),
    shoulders: [project([-0.43, 0.09, 0.02]), project([0.43, 0.09, 0.02])],
    hands: [project([-0.74, -0.08, 0.235]), project([0.74, -0.08, 0.235])],
    rim: width * 0.443,
  };
}

/** Render directly into the low-resolution intensity field before 1-bit quantization. */
export function drawIntelligence(
  field: PixelField,
  seconds: number,
  attention = 0,
  pointer: readonly [number, number] = [0, 0],
  pose: IntelligencePose = 'portrait',
) {
  return render(field, pose === 'terminal' ? terminalGeometry : geometry, seconds, attention, pointer, pose, false);
}

/**
 * The finished terminal figure, fully coherent and with its cranium closed:
 * the shape the byte entity keeps trying to assemble.
 */
export function drawEntityTarget(
  field: PixelField,
  seconds: number,
  attention = 0,
  pointer: readonly [number, number] = [0, 0],
) {
  wholeGeometry ??= createIntelligenceGeometry('terminal', true);
  return render(field, wholeGeometry, seconds, attention, pointer, 'terminal', true);
}

function render(
  field: PixelField,
  model: readonly Particle[],
  seconds: number,
  attention: number,
  pointer: readonly [number, number],
  pose: IntelligencePose,
  whole: boolean,
) {
  field.clear();
  let depth = depthBuffers.get(field);
  if (!depth) {
    depth = new Float32Array(field.values.length);
    depthBuffers.set(field, depth);
  }
  depth.fill(-Infinity);
  const { time, pointerX, pointerY } = safeInputs(seconds, pointer);
  const focus = Number.isFinite(attention) ? clamp(attention) : 0;
  const coherence = whole ? 1 : Math.max(pose === 'terminal' ? 0.68 : 0, manifestationAt(time, focus).coherence);
  const yaw = pose === 'terminal' ? Math.sin(time * 0.14) * 0.018 : Math.sin(time * 0.16) * 0.08 + pointerX * 0.28;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const scale = pose === 'terminal' ? field.width * 0.3516 : Math.min(field.height * 0.37, field.width * 0.58);
  const uncertain = 1 - coherence;
  const scan = (time * 0.06) % 1;

  for (const particle of model) {
    const face = particle.region === 'head' || particle.region === 'eye';
    if (particle.region === 'eye' && (pose !== 'terminal' || fract(time / 5.3 + 0.35) < 0.028)) continue;
    const priority = face ? 0.21 : particle.region === 'hand' ? 0.14 : 0;
    const remaining = clamp(coherence + priority);
    if (particle.seed > remaining + 0.025) continue;
    const loose = Math.max(0, particle.seed - remaining + 0.17) / 0.17;
    const tail = clamp((-particle.y - 0.1) / 1.2);
    const phase = particle.seed * TAU;
    let x = particle.x;
    let y = particle.y;
    let z = particle.z;
    const drift = particle.region === 'eye' ? 0 : pose === 'terminal' && particle.region === 'hand' ? 0.003 : face
      ? uncertain * (0.018 + loose * 0.08)
      : pose === 'terminal'
        ? uncertain * (0.02 + loose * 0.22)
        : uncertain * (0.055 + loose * 0.38) + tail * 0.028;
    x += Math.sin(time * 0.45 + phase + y * 6) * drift;
    y += Math.cos(time * 0.34 + phase) * drift * 0.38;
    z += Math.sin(time * 0.3 + phase) * drift * 0.2;
    if (particle.region === 'hand' && pose !== 'terminal') {
      x += Math.sin(time * 0.52) * 0.015 + pointerX * focus * 0.028;
      y += Math.cos(time * 0.52) * 0.008 + pointerY * focus * 0.04;
    }
    if (particle.region === 'eye') {
      // Pupils glance toward the pointer a beat ahead of the head.
      x += pointerX * 0.016;
      y -= pointerY * 0.01;
    }
    if (pose === 'terminal' && (face || particle.region === 'drift')) {
      [x, y, z] = turnHead(x, y, z, time, pointerX, pointerY);
    }
    const rotatedX = x * cosine + z * sine;
    const rotatedZ = z * cosine - x * sine;
    const perspective = 1 / (1 - rotatedZ * 0.17);
    const px = field.width * (pose === 'terminal' ? 0.5 : 0.46) + rotatedX * scale * perspective;
    const py = field.height * (pose === 'terminal' ? 0.6055 : 0.43) - y * scale * perspective;
    // The opaque terminal conceals the body. Only the resting hands cross the rim.
    if (pose === 'terminal' && particle.region !== 'hand' && py > field.width * 0.443 - 1.5) continue;
    // A finished target must hold still; the scan band belongs to the old dissolving render.
    const scanLight = whole ? 0 : Math.exp(-Math.pow((py / field.height - scan) / 0.032, 2)) * 0.11;
    const intensity = clamp(particle.light * (0.87 + coherence * 0.24) + scanLight);
    const radius = 0.8 + particle.seed * 0.45;
    if (face) {
      // Lit pupils sit deep in the sockets but must survive the brow when the head tips down.
      const z = particle.region === 'eye' ? rotatedZ + 0.06 : rotatedZ;
      for (let iy = Math.max(0, Math.floor(py - radius)); iy <= Math.min(field.height - 1, py + radius); iy++) {
        for (let ix = Math.max(0, Math.floor(px - radius)); ix <= Math.min(field.width - 1, px + radius); ix++) {
          const distance = Math.hypot(ix - px, iy - py) / radius;
          const index = ix + iy * field.width;
          if (distance < 1 && z > depth[index]) {
            depth[index] = z;
            field.values[index] = intensity * (1 - distance * distance * 0.65);
          }
        }
      }
    } else {
      field.dot(px, py, radius, intensity);
    }
  }
  return coherence;
}
