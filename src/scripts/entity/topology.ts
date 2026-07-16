import { ENTITY_CONFIG } from './config';
import { clamp, fractalNoise2, integerHash, mix, SeededRandom } from './random';
import { BODY_REGION } from './types';
import type { BodyRegion, EntityTopology } from './types';

export const ENTITY_GLYPHS = [
  'A', 'E', 'I', 'N', 'R', 'S', 'T', 'V', 'X', 'a', 'e', 'i', 'n', 'r', 's', 't',
  '0', '1', '2', '3', '5', '7', '8', '9', '.', ':', ',', ';', '+', '-', '*', '/', '\\',
  '[', ']', '{', '}', '(', ')', '<', '>', '_', '=', '#', '@', '%', '&', '?', '!', '×', '·',
  '□', '⌁', '⌬', '⌗', '⟐', '⟡', '⋮', '∴', '∵', '¬', '¦', '┊', '┈', '╳', '⸬',
] as const;

type Point3 = [number, number, number];

const TAU = Math.PI * 2;
const REGION_COUNT = Object.keys(BODY_REGION).length;

function centered(random: SeededRandom): number {
  return (random.next() + random.next() + random.next() - 1.5) / 1.5;
}

function neutralOrientation(point: Point3, headInfluence = 1): Point3 {
  const orientation = ENTITY_CONFIG.body.neutralOrientation;
  const yaw = orientation.yaw * headInfluence;
  const pitch = orientation.pitch * headInfluence;
  const roll = orientation.roll * headInfluence;
  const yawCos = Math.cos(yaw);
  const yawSin = Math.sin(yaw);
  const yawX = point[0] * yawCos + point[2] * yawSin;
  const yawZ = -point[0] * yawSin + point[2] * yawCos;
  const pitchCos = Math.cos(pitch);
  const pitchSin = Math.sin(pitch);
  const pitchY = point[1] * pitchCos - yawZ * pitchSin;
  const pitchZ = point[1] * pitchSin + yawZ * pitchCos;
  const pivotY = -0.12;
  const localY = pitchY - pivotY;
  return [
    yawX * Math.cos(roll) - localY * Math.sin(roll),
    pivotY + yawX * Math.sin(roll) + localY * Math.cos(roll),
    pitchZ,
  ];
}

function cranialWidth(y: number): number {
  const { headTop, headBottom, headHalfWidth } = ENTITY_CONFIG.body.proportions;
  const center = (headTop + headBottom) * 0.5;
  const radiusY = (headBottom - headTop) * 0.5;
  const normalized = clamp(Math.abs((y - center) / radiusY));
  const rounded = Math.pow(Math.max(0, 1 - Math.pow(normalized, 2.35)), 0.43);
  const templeNarrowing = 1 - Math.exp(-Math.pow((y + 0.27) / 0.085, 2)) * 0.055;
  return headHalfWidth * rounded * templeNarrowing;
}

function cranialCore(random: SeededRandom): Point3 {
  const { headTop } = ENTITY_CONFIG.body.proportions;
  const y = random.range(headTop + 0.015, -0.27);
  const width = Math.max(0.035, cranialWidth(y));
  const x = random.range(-width, width);
  const radial = clamp(Math.abs(x) / width);
  const depth = 0.2 * Math.sqrt(Math.max(0.03, 1 - radial * radial));
  return neutralOrientation([x, y, centered(random) * depth]);
}

function cranialEdge(random: SeededRandom): Point3 {
  const { headTop, headBottom } = ENTITY_CONFIG.body.proportions;
  const center = (headTop + headBottom) * 0.5;
  const radiusY = (headBottom - headTop) * 0.5;
  const crown = random.chance(0.38);
  const angle = crown ? random.range(Math.PI, TAU) : 0;
  const y = crown
    ? center + Math.sin(angle) * radiusY * random.range(0.96, 1.015)
    : random.range(-0.62, -0.265);
  const side = crown ? (Math.cos(angle) < 0 ? -1 : 1) : (random.chance(0.5) ? -1 : 1);
  const x = side * Math.max(0.028, cranialWidth(y)) * random.range(0.94, 1.025);
  const z = centered(random) * 0.12 + (crown ? Math.cos(angle) : side) * 0.025;
  return neutralOrientation([x, y, z]);
}

function lowerHead(random: SeededRandom): Point3 {
  const t = random.next();
  const y = mix(-0.35, ENTITY_CONFIG.body.proportions.headBottom + 0.018, t);
  const halfWidth = mix(0.27, 0.135, Math.pow(t, 0.82));
  const edgeBias = random.chance(0.22);
  const x = edgeBias
    ? (random.chance(0.5) ? -1 : 1) * halfWidth * random.range(0.82, 1.01)
    : random.range(-halfWidth, halfWidth);
  const z = centered(random) * mix(0.17, 0.105, t);
  return neutralOrientation([x, y, z]);
}

function neckBridge(random: SeededRandom): Point3 {
  const { neckTop, neckBottom, neckHalfWidth } = ENTITY_CONFIG.body.proportions;
  const t = random.next();
  const y = mix(neckTop, neckBottom, t);
  const halfWidth = mix(neckHalfWidth * 0.92, neckHalfWidth * 1.2, t);
  const x = random.range(-halfWidth, halfWidth);
  const z = centered(random) * mix(0.12, 0.15, t);
  return neutralOrientation([x, y, z], 0.62);
}

function trapezius(side: -1 | 1, random: SeededRandom): Point3 {
  const t = Math.pow(random.next(), 0.9);
  const centerX = side * mix(0.11, 0.63, t);
  const centerY = mix(-0.105, 0.145, t);
  const thickness = mix(0.1, 0.145, t);
  const x = centerX + centered(random) * mix(0.085, 0.14, t);
  const y = centerY + centered(random) * thickness;
  return [x, y, centered(random) * mix(0.13, 0.19, t)];
}

function shoulder(side: -1 | 1, random: SeededRandom): Point3 {
  const { shoulderHalfWidth, shoulderTop } = ENTITY_CONFIG.body.proportions;
  const inner = 0.24;
  const t = Math.pow(random.next(), 0.82);
  const x = side * mix(inner, shoulderHalfWidth, t) + centered(random) * 0.055;
  const upper = shoulderTop + t * 0.1;
  const lower = 0.31 + t * 0.085;
  const vertical = random.next();
  const y = mix(upper, lower, 0.1 + vertical * 0.9) + centered(random) * 0.025;
  const edgeTaper = Math.sin(t * Math.PI) * 0.045;
  return [x, y - edgeTaper, centered(random) * mix(0.19, 0.14, t)];
}

function upperTorso(random: SeededRandom): Point3 {
  const t = random.next();
  const y = mix(-0.025, 0.62, t);
  const halfWidth = mix(0.64, 0.49, Math.pow(t, 0.78));
  const x = random.range(-halfWidth, halfWidth);
  const radial = clamp(Math.abs(x) / halfWidth);
  return [x, y, centered(random) * 0.2 * Math.sqrt(Math.max(0.08, 1 - radial * radial))];
}

function lowerTorso(random: SeededRandom): Point3 {
  const t = random.next();
  const y = mix(0.48, ENTITY_CONFIG.body.proportions.torsoBottom, t);
  const halfWidth = mix(0.52, 0.26, Math.pow(t, 0.82));
  const x = random.range(-halfWidth, halfWidth) + centered(random) * t * 0.045;
  return [x, y, centered(random) * mix(0.17, 0.1, t)];
}

function plume(random: SeededRandom): Point3 {
  const angle = random.range(0, TAU);
  const radius = Math.sqrt(random.next()) * ENTITY_CONFIG.body.plumeRadius;
  const bodyBias = random.chance(0.62);
  if (bodyBias) {
    const side = random.chance(0.5) ? -1 : 1;
    return [
      side * random.range(0.3, 0.98) + centered(random) * 0.1,
      random.range(-0.68, 0.72),
      random.range(-0.3, 0.24),
    ];
  }
  return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.86 - 0.06, random.range(-0.34, 0.26)];
}

function freeField(random: SeededRandom): Point3 {
  const angle = random.range(0, TAU);
  const radius = Math.sqrt(random.next()) * ENTITY_CONFIG.body.freeFieldRadius;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius * random.range(0.72, 1.05), random.range(-0.46, 0.34)];
}

function sampleRegion(region: BodyRegion, random: SeededRandom): Point3 {
  switch (region) {
    case BODY_REGION.CRANIAL_CORE: return cranialCore(random);
    case BODY_REGION.CRANIAL_EDGE: return cranialEdge(random);
    case BODY_REGION.LOWER_HEAD: return lowerHead(random);
    case BODY_REGION.NECK_BRIDGE: return neckBridge(random);
    case BODY_REGION.LEFT_TRAPEZIUS: return trapezius(-1, random);
    case BODY_REGION.RIGHT_TRAPEZIUS: return trapezius(1, random);
    case BODY_REGION.LEFT_SHOULDER: return shoulder(-1, random);
    case BODY_REGION.RIGHT_SHOULDER: return shoulder(1, random);
    case BODY_REGION.UPPER_TORSO: return upperTorso(random);
    case BODY_REGION.LOWER_TORSO: return lowerTorso(random);
    case BODY_REGION.PLUME: return plume(random);
    default: return freeField(random);
  }
}

function listeningTarget(coherent: Point3, region: BodyRegion, random: SeededRandom): Point3 {
  let scatter = ENTITY_CONFIG.body.listeningScatter;
  let horizontal = 1;
  let vertical = 0.55;
  if (region === BODY_REGION.NECK_BRIDGE) {
    scatter *= 0.22;
    vertical = 0.18;
  } else if (region === BODY_REGION.LEFT_TRAPEZIUS || region === BODY_REGION.RIGHT_TRAPEZIUS) {
    scatter *= 0.45;
    vertical = 0.34;
  } else if (region === BODY_REGION.LEFT_SHOULDER || region === BODY_REGION.RIGHT_SHOULDER) {
    scatter *= 0.7;
    vertical = 0.42;
  } else if (region === BODY_REGION.UPPER_TORSO) {
    scatter *= 0.62;
    vertical = 0.36;
  } else if (region === BODY_REGION.LOWER_TORSO) {
    scatter *= 0.9;
    vertical = 0.65;
  } else if (region === BODY_REGION.PLUME || region === BODY_REGION.FREE_FIELD) {
    scatter *= 1.8;
    horizontal = 1.2;
    vertical = 1.1;
  }
  return [
    coherent[0] + centered(random) * scatter * horizontal,
    coherent[1] + centered(random) * scatter * vertical,
    coherent[2] + centered(random) * scatter * 0.65,
  ];
}

function appearanceFor(region: BodyRegion, random: SeededRandom, target: Point3): [number, number, number, number] {
  let alpha: [number, number];
  let scale: [number, number];
  switch (region) {
    case BODY_REGION.CRANIAL_CORE:
      alpha = [0.21, 0.34]; scale = [0.44, 0.82]; break;
    case BODY_REGION.CRANIAL_EDGE:
      alpha = [0.21, 0.35]; scale = [0.48, 0.9]; break;
    case BODY_REGION.LOWER_HEAD:
      alpha = [0.17, 0.31]; scale = [0.43, 0.82]; break;
    case BODY_REGION.NECK_BRIDGE:
      alpha = [0.09, 0.18]; scale = [0.38, 0.74]; break;
    case BODY_REGION.LEFT_TRAPEZIUS:
    case BODY_REGION.RIGHT_TRAPEZIUS:
      alpha = [0.22, 0.39]; scale = [0.43, 0.86]; break;
    case BODY_REGION.LEFT_SHOULDER:
    case BODY_REGION.RIGHT_SHOULDER:
      alpha = [0.2, 0.37]; scale = [0.42, 0.86]; break;
    case BODY_REGION.UPPER_TORSO:
      alpha = [0.18, 0.34]; scale = [0.4, 0.84]; break;
    case BODY_REGION.LOWER_TORSO:
      alpha = [0.09, 0.23]; scale = [0.36, 0.76]; break;
    case BODY_REGION.PLUME:
      alpha = [0.04, 0.13]; scale = [0.32, 0.7]; break;
    default:
      alpha = [0.018, 0.075]; scale = [0.28, 0.62];
  }
  const lowerDissolve = target[1] > 0.6 ? mix(1, 0.5, clamp((target[1] - 0.6) / 0.34)) : 1;
  return [
    random.next(),
    random.range(alpha[0], alpha[1]) * lowerDissolve,
    random.range(0.035, 0.17),
    random.range(scale[0], scale[1]),
  ];
}

function copyParticle(source: number, target: number, from: Float32Array, to: Float32Array): void {
  const sourceOffset = source * 4;
  const targetOffset = target * 4;
  to[targetOffset] = from[sourceOffset];
  to[targetOffset + 1] = from[sourceOffset + 1];
  to[targetOffset + 2] = from[sourceOffset + 2];
  to[targetOffset + 3] = from[sourceOffset + 3];
}

function spatiallyReorder(
  targets: Float32Array,
  listeningTargets: Float32Array,
  properties: Float32Array,
  appearance: Float32Array,
  count: number,
): [Float32Array, Float32Array, Float32Array, Float32Array] {
  const order = Array.from({ length: count }, (_, index) => index);
  order.sort((left, right) => {
    const leftOffset = left * 4;
    const rightOffset = right * 4;
    const leftCellX = Math.floor((targets[leftOffset] + 1.5) * 22);
    const leftCellY = Math.floor((targets[leftOffset + 1] + 1.1) * 22);
    const rightCellX = Math.floor((targets[rightOffset] + 1.5) * 22);
    const rightCellY = Math.floor((targets[rightOffset + 1] + 1.1) * 22);
    const leftKey = leftCellY * 96 + (leftCellY % 2 === 0 ? leftCellX : 95 - leftCellX);
    const rightKey = rightCellY * 96 + (rightCellY % 2 === 0 ? rightCellX : 95 - rightCellX);
    return leftKey - rightKey || left - right;
  });
  const orderedTargets = new Float32Array(targets.length);
  const orderedListening = new Float32Array(listeningTargets.length);
  const orderedProperties = new Float32Array(properties.length);
  const orderedAppearance = new Float32Array(appearance.length);
  for (let index = 0; index < count; index += 1) {
    const source = order[index];
    copyParticle(source, index, targets, orderedTargets);
    copyParticle(source, index, listeningTargets, orderedListening);
    copyParticle(source, index, properties, orderedProperties);
    copyParticle(source, index, appearance, orderedAppearance);
  }
  return [orderedTargets, orderedListening, orderedProperties, orderedAppearance];
}

export function createFacelessHumanoidTopology(count: number, sessionSeed: number): EntityTopology {
  const particleCount = Math.max(1, Math.floor(count));
  const random = new SeededRandom(sessionSeed ^ 0x07e1717);
  const targets = new Float32Array(particleCount * 4);
  const listeningTargets = new Float32Array(particleCount * 4);
  const properties = new Float32Array(particleCount * 4);
  const appearance = new Float32Array(particleCount * 4);
  const regionCounts = new Uint32Array(REGION_COUNT);
  const distribution = ENTITY_CONFIG.body.regionDistribution;
  let distributionIndex = 0;
  let cumulative = distribution[0].ratio;

  for (let index = 0; index < particleCount; index += 1) {
    const normalized = (index + 0.5) / particleCount;
    while (normalized > cumulative && distributionIndex < distribution.length - 1) {
      distributionIndex += 1;
      cumulative += distribution[distributionIndex].ratio;
    }
    const definition = distribution[distributionIndex];
    const region = definition.region;
    const pointRandom = random.fork(integerHash(index, sessionSeed) * 0xffffffff);
    const coherent = sampleRegion(region, pointRandom);
    const structure = region <= BODY_REGION.LOWER_TORSO;
    if (structure) {
      const erosion = fractalNoise2(coherent[0] * 2.6, coherent[1] * 2.2, sessionSeed + 307);
      coherent[0] += erosion * ENTITY_CONFIG.body.asymmetry;
      coherent[1] += fractalNoise2(coherent[1] * 3.1, region * 0.43, sessionSeed + 409) * 0.008;
    }
    const unresolved = listeningTarget(coherent, region, pointRandom);
    const offset = index * 4;
    targets[offset] = coherent[0];
    targets[offset + 1] = coherent[1];
    targets[offset + 2] = coherent[2];
    targets[offset + 3] = region;
    listeningTargets[offset] = unresolved[0];
    listeningTargets[offset + 1] = unresolved[1];
    listeningTargets[offset + 2] = unresolved[2];
    listeningTargets[offset + 3] = region;
    properties[offset] = pointRandom.range(definition.binding[0], definition.binding[1]);
    properties[offset + 1] = pointRandom.range(0.6, 0.96);
    properties[offset + 2] = pointRandom.range(0.04, 0.98);
    properties[offset + 3] = pointRandom.next();
    const particleAppearance = appearanceFor(region, pointRandom, coherent);
    appearance[offset] = particleAppearance[0];
    appearance[offset + 1] = particleAppearance[1];
    appearance[offset + 2] = particleAppearance[2];
    appearance[offset + 3] = particleAppearance[3];
    regionCounts[region] += 1;
  }

  const ordered = spatiallyReorder(targets, listeningTargets, properties, appearance, particleCount);
  return {
    count: particleCount,
    targets: ordered[0],
    listeningTargets: ordered[1],
    properties: ordered[2],
    appearance: ordered[3],
    regionCounts,
    source: 'compact-faceless-humanoid-field',
  };
}
