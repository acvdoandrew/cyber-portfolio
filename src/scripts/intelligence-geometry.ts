import { PixelField } from './project-studies/scenes';
import { manifestationAt } from './intelligence-state';

export const INTELLIGENCE_WIDTH = 256;
export const INTELLIGENCE_HEIGHT = 384;
export const TERMINAL_ENTITY_WIDTH = 384;
export const TERMINAL_ENTITY_HEIGHT = 256;
export type IntelligencePose = 'portrait' | 'terminal';
type Vec3 = readonly [number, number, number];
type Region = 'head' | 'body' | 'hand' | 'drift';
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

/** Anatomical surfaces and filaments, generated from coordinates, never a texture. */
export function createIntelligenceGeometry(pose: IntelligencePose = 'portrait'): readonly Particle[] {
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
      if (seed < openSide * 0.4) continue;
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

  if (pose === 'terminal') {
    // Both forearms reach over the rim; curled fingers rest on its front edge.
    for (const side of [-1, 1]) {
      const cx = side * 0.74 - 0.20;
      tube([[side * 0.30 - 0.20, 0.15, 0], [side * 0.64 - 0.20, 0.095, 0.05], [cx, -0.055, 0.21]],
        [0.078, 0.062, 0.044], 30, 75, 'body', 0.88);
      for (let lat = 1; lat < 34; lat++) for (let lon = 0; lon < 50; lon++) {
        const theta = lat / 34 * Math.PI;
        const phi = lon / 50 * TAU;
        const x = Math.sin(theta) * Math.cos(phi) * 0.103;
        const y = Math.cos(theta) * 0.058;
        const z = Math.sin(theta) * Math.sin(phi) * 0.065;
        if (z < -0.012) continue;
        add(cx + x, -0.078 + y, 0.235 + z, 0.51 + Math.sin(phi) * 0.19, 'hand');
      }
      for (let finger = 0; finger < 4; finger++) {
        const x = cx + (finger - 1.5) * 0.041;
        const length = 0.10 + Math.sin((finger + 0.5) / 4 * Math.PI) * 0.044;
        tube([[x, -0.10, 0.27], [x + side * 0.006, -0.145, 0.30], [x + side * 0.004, -0.10 - length, 0.285]],
          [0.023, 0.020, 0.013], 15, 34, 'hand', 1.03);
      }
      tube([[cx - side * 0.080, -0.066, 0.25], [cx - side * 0.132, -0.10, 0.29], [cx - side * 0.123, -0.165, 0.295]],
        [0.025, 0.021, 0.014], 16, 34, 'hand', 0.98);
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
  for (let strand = 0; strand < 38; strand++) {
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
const depthBuffers = new WeakMap<PixelField, Float32Array>();

/** Render directly into the low-resolution intensity field before 1-bit quantization. */
export function drawIntelligence(
  field: PixelField,
  seconds: number,
  attention = 0,
  pointer: readonly [number, number] = [0, 0],
  pose: IntelligencePose = 'portrait',
) {
  field.clear();
  let depth = depthBuffers.get(field);
  if (!depth) {
    depth = new Float32Array(field.values.length);
    depthBuffers.set(field, depth);
  }
  depth.fill(-Infinity);
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 8;
  const focus = Number.isFinite(attention) ? clamp(attention) : 0;
  const pointerX = Number.isFinite(pointer[0]) ? clamp(pointer[0], -0.5, 0.5) : 0;
  const pointerY = Number.isFinite(pointer[1]) ? clamp(pointer[1], -0.5, 0.5) : 0;
  const coherence = Math.max(pose === 'terminal' ? 0.68 : 0, manifestationAt(time, focus).coherence);
  const yaw = pose === 'terminal' ? Math.sin(time * 0.14) * 0.018 : Math.sin(time * 0.16) * 0.08 + pointerX * 0.28;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const scale = pose === 'terminal' ? field.width * 0.3516 : Math.min(field.height * 0.37, field.width * 0.58);
  const uncertain = 1 - coherence;
  const scan = (time * 0.06) % 1;

  for (const particle of pose === 'terminal' ? terminalGeometry : geometry) {
    const priority = particle.region === 'head' ? 0.21 : particle.region === 'hand' ? 0.14 : 0;
    const remaining = clamp(coherence + priority);
    if (particle.seed > remaining + 0.025) continue;
    const loose = Math.max(0, particle.seed - remaining + 0.17) / 0.17;
    const tail = clamp((-particle.y - 0.1) / 1.2);
    const phase = particle.seed * TAU;
    let x = particle.x;
    let y = particle.y;
    let z = particle.z;
    const drift = pose === 'terminal' && particle.region === 'hand' ? 0.003 : particle.region === 'head'
      ? uncertain * (0.018 + loose * 0.08)
      : uncertain * (0.055 + loose * 0.38) + tail * 0.028;
    x += Math.sin(time * 0.45 + phase + y * 6) * drift;
    y += Math.cos(time * 0.34 + phase) * drift * 0.38;
    z += Math.sin(time * 0.3 + phase) * drift * 0.2;
    if (particle.region === 'hand' && pose !== 'terminal') {
      x += Math.sin(time * 0.52) * 0.015 + pointerX * focus * 0.028;
      y += Math.cos(time * 0.52) * 0.008 + pointerY * focus * 0.04;
    }
    if (pose === 'terminal' && (particle.region === 'head' || particle.region === 'drift')) {
      const look = Math.sin(time * 0.27) * 0.055 + pointerX * 0.5;
      const headX = x * Math.cos(look) + z * Math.sin(look);
      z = z * Math.cos(look) - x * Math.sin(look);
      x = headX;
      const pitch = 0.20 - pointerY * 0.3 + Math.sin(time * 0.38) * 0.025;
      const headY = (y - 0.60) * Math.cos(pitch) - z * Math.sin(pitch);
      z = z * Math.cos(pitch) + (y - 0.60) * Math.sin(pitch);
      y = 0.60 + headY;
    }
    const rotatedX = x * cosine + z * sine;
    const rotatedZ = z * cosine - x * sine;
    const perspective = 1 / (1 - rotatedZ * 0.17);
    const px = field.width * (pose === 'terminal' ? 0.5 : 0.46) + rotatedX * scale * perspective;
    const py = field.height * (pose === 'terminal' ? 0.6055 : 0.43) - y * scale * perspective;
    // The opaque terminal conceals the body. Only the resting hands cross the rim.
    if (pose === 'terminal' && particle.region !== 'hand' && py > field.width * 0.443 - 1.5) continue;
    const scanLight = Math.exp(-Math.pow((py / field.height - scan) / 0.032, 2)) * 0.11;
    const intensity = clamp(particle.light * (0.87 + coherence * 0.24) + scanLight);
    const radius = 0.8 + particle.seed * 0.45;
    if (particle.region === 'head') {
      for (let iy = Math.max(0, Math.floor(py - radius)); iy <= Math.min(field.height - 1, py + radius); iy++) {
        for (let ix = Math.max(0, Math.floor(px - radius)); ix <= Math.min(field.width - 1, px + radius); ix++) {
          const distance = Math.hypot(ix - px, iy - py) / radius;
          const index = ix + iy * field.width;
          if (distance < 1 && rotatedZ > depth[index]) {
            depth[index] = rotatedZ;
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
