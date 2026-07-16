import { ENTITY_CONFIG } from './config';
import { clamp, fractalNoise2, mix, smoothstep } from './random';
import { entityRuntime } from './runtime';
import { createFacelessHumanoidTopology, ENTITY_GLYPHS } from './topology';
import type { EntityRuntimeFrame, EntityTopology } from './types';

declare global {
  interface Window {
    __ENTITY_07_CANVAS_DISPOSE__?: () => void;
  }
}

const root = document.documentElement;
const canvas = document.getElementById('braille-entity') as HTMLCanvasElement | null;
const abortController = new AbortController();
const maximumCount = matchMedia('(pointer: coarse)').matches ? 4200 : 6800;

class CanvasEntityRenderer {
  private context: CanvasRenderingContext2D;
  private topology: EntityTopology | null = null;
  private position: Float32Array | null = null;
  private velocity: Float32Array | null = null;
  private running = false;
  private disposed = false;
  private frameRequest = 0;
  private lastTime = 0;
  private lastRenderedAt = 0;
  private dpr = 1;
  private width = 1;
  private height = 1;
  private resizeObserver: ResizeObserver;
  private anchorScratch = { x: 0, y: 0 };

  constructor(private stage: HTMLCanvasElement) {
    const context = stage.getContext('2d', { alpha: true });
    if (!context) throw new Error('ENTITY_07 Canvas fallback is unavailable');
    this.context = context;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(document.documentElement);
    this.resize();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.ensurePool();
    this.running = true;
    this.lastTime = 0;
    root.dataset.entityPool = entityRuntime.particlePoolId;
    root.dataset.entityParticles = String(maximumCount);
    entityRuntime.setActiveParticleCount(maximumCount);
    this.frameRequest = requestAnimationFrame(this.tick);
  }

  private ensurePool(): void {
    if (this.topology && this.position && this.velocity) return;
    this.topology = createFacelessHumanoidTopology(maximumCount, entityRuntime.frame.sessionSeed);
    this.position = new Float32Array(maximumCount * 2);
    this.velocity = new Float32Array(maximumCount * 2);
    const initialBlend = ENTITY_CONFIG.body.stateFormBlend.DORMANT;
    for (let index = 0; index < maximumCount; index += 1) {
      const source = index * 4;
      const target = index * 2;
      this.position[target] = mix(this.topology.listeningTargets[source], this.topology.targets[source], initialBlend);
      this.position[target + 1] = mix(this.topology.listeningTargets[source + 1], this.topology.targets[source + 1], initialBlend);
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.context.clearRect(0, 0, this.width, this.height);
  }

  private resize(): void {
    this.width = Math.max(1, innerWidth);
    this.height = Math.max(1, visualViewport?.height || innerHeight);
    this.dpr = Math.min(devicePixelRatio || 1, 1.25);
    this.stage.width = Math.round(this.width * this.dpr);
    this.stage.height = Math.round(this.height * this.dpr);
    this.stage.style.width = `${this.width}px`;
    this.stage.style.height = `${this.height}px`;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private transitionAnchor(frame: EntityRuntimeFrame, index: number): { x: number; y: number } {
    if (!['RELEASING', 'RELOCATING', 'RETURNING'].includes(frame.spatialMode)) return frame.anchor;
    const topology = this.topology!;
    const source = index * 4;
    const binding = topology.properties[source];
    const delay = topology.properties[source + 2];
    const seed = topology.properties[source + 3];
    const region = Math.round(topology.targets[source + 3]);
    const broadSilhouette = region >= 3 && region <= 9 ? (region === 9 ? 0.5 : 1) : 0;
    const cranialCore = region === 0 ? 1 : 0;
    const start = mix(-0.14, 0.16, binding) + delay * 0.08;
    const finish = Math.max(start + 0.2, mix(0.98, 0.82, binding) - broadSilhouette * 0.08 + cranialCore * 0.055);
    let particleProgress = clamp((frame.transitionProgress - start) / Math.max(0.01, finish - start));
    if (seed < ENTITY_CONFIG.relocation.residualRatio) {
      particleProgress *= smoothstep(clamp((frame.transitionProgress - 0.76) / 0.24));
    }
    const eased = particleProgress * particleProgress * (3 - 2 * particleProgress);
    const inverse = 1 - eased;
    const dx = frame.anchorTarget.x - frame.anchorFrom.x;
    const dy = frame.anchorTarget.y - frame.anchorFrom.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    const curve = (seed - 0.5) * frame.relocationCurve * Math.min(this.width, this.height) * 1.4;
    const controlX = mix(frame.anchorFrom.x, frame.anchorTarget.x, 0.46) + normalX * curve;
    const controlY = mix(frame.anchorFrom.y, frame.anchorTarget.y, 0.46) + normalY * curve;
    this.anchorScratch.x = inverse * inverse * frame.anchorFrom.x + 2 * inverse * eased * controlX + eased * eased * frame.anchorTarget.x;
    this.anchorScratch.y = inverse * inverse * frame.anchorFrom.y + 2 * inverse * eased * controlY + eased * eased * frame.anchorTarget.y;
    return this.anchorScratch;
  }

  private simulate(frame: EntityRuntimeFrame, delta: number): void {
    if (frame.simulationPaused || delta <= 0) return;
    const topology = this.topology!;
    const position = this.position!;
    const velocity = this.velocity!;
    const count = maximumCount;
    const entropy = frame.internal.entropy;
    const coherence = frame.formCoherence;
    const time = frame.timestamp * 0.001;
    const reduced = frame.reducedMotion ? ENTITY_CONFIG.reducedMotion.particleDriftScale : 1;
    const cognitiveBlend = ENTITY_CONFIG.body.stateFormBlend[frame.cognitiveState] * (1 - entropy * 0.14);
    const formBlend = frame.reducedMotion ? Math.max(0.55, cognitiveBlend) : clamp(cognitiveBlend);
    const pointerLocalX = (frame.pointerPosition.x - frame.anchor.x) / Math.max(1, frame.entityWidth * 0.5);
    const pointerLocalY = (frame.pointerPosition.y - frame.anchor.y) / Math.max(1, frame.entityHeight * 0.5);
    const pointerMotionX = clamp(frame.pointerVelocity.x / 1200, -1, 1);
    const pointerMotionY = clamp(frame.pointerVelocity.y / 1200, -1, 1);
    const pointerSpeed = clamp(Math.hypot(frame.pointerVelocity.x, frame.pointerVelocity.y) / 1500);
    const pointerMotionLength = Math.max(0.0001, Math.hypot(pointerMotionX, pointerMotionY));
    const specimenStrength = frame.specimen.strength;
    const specimenClock = frame.reducedMotion ? frame.specimen.phase * Math.PI * 2 : time;
    const specimenDirectionLength = Math.hypot(frame.specimen.direction.x, frame.specimen.direction.y);
    const specimenDirectionX = specimenDirectionLength > 0.001
      ? frame.specimen.direction.x / specimenDirectionLength
      : frame.directionalBias || 1;
    const specimenDirectionY = specimenDirectionLength > 0.001
      ? frame.specimen.direction.y / specimenDirectionLength
      : 0;
    const specimenNormalX = -specimenDirectionY;
    const specimenNormalY = specimenDirectionX;
    for (let index = 0; index < count; index += 1) {
      const source = index * 4;
      const offset = index * 2;
      let targetX = mix(topology.listeningTargets[source], topology.targets[source], formBlend);
      let targetY = mix(topology.listeningTargets[source + 1], topology.targets[source + 1], formBlend);
      const targetZ = mix(topology.listeningTargets[source + 2], topology.targets[source + 2], formBlend);
      const region = Math.round(topology.targets[source + 3]);
      const binding = topology.properties[source] * coherence;
      const inertia = topology.properties[source + 1];
      const delay = topology.properties[source + 2];
      const curiosity = topology.properties[source + 3];
      const head = region <= 2;
      const neck = region === 3;
      const trap = region === 4 || region === 5;
      const shoulder = region === 6 || region === 7;
      const upperTorso = region === 8;
      const lowerTorso = region === 9;
      const plume = region === 10;
      const freeField = region === 11;
      const cranialCore = region === 0;
      if (head) {
        const pivotY = -0.08;
        const localY = targetY - pivotY;
        const angle = frame.posture.headTilt * 0.095;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const rotatedX = targetX * cosine - localY * sine;
        targetY = pivotY + targetX * sine + localY * cosine;
        targetX = rotatedX + frame.headOrientation.x * (0.31 + targetZ * 0.28)
          + frame.gazeOrientation.x * (0.052 + frame.attentionStrength * 0.034 + (1 - delay) * 0.012);
        targetY += frame.headOrientation.y * 0.19
          + frame.gazeOrientation.y * (0.036 + frame.attentionStrength * 0.024 + (1 - delay) * 0.008);
        const facingSide = smoothstep(clamp(targetX * frame.directionalBias / 0.72 + 0.5));
        targetX += frame.attentionStrength * frame.directionalBias * (0.018 + (1 - delay) * 0.026) * mix(0.52, 1, facingSide);
        targetY -= frame.attentionStrength * frame.inspectionStrength * facingSide * 0.012;
      } else if (neck || trap || shoulder || upperTorso) {
        const horizontalSupport = neck ? 0.72 : trap ? 0.48 : shoulder ? 0.18 : 0.18;
        const verticalSupport = neck ? 0.64 : trap ? 0.38 : shoulder ? 0.14 : 0.14;
        targetX += frame.headOrientation.x * 0.105 * horizontalSupport;
        targetY += frame.headOrientation.y * 0.082 * verticalSupport;
      }
      if (head || neck || trap || upperTorso) targetX += frame.posture.lean * (head ? 0.064 : 0.028);
      if (trap || shoulder) {
        const side = region === 4 || region === 6 ? 1 : -1;
        targetX += side * frame.posture.shoulderCounter * 0.022;
        targetY += side * frame.posture.shoulderCounter * 0.018;
      }
      if (trap || shoulder || upperTorso) {
        targetX *= 1 + (frame.posture.breath - 0.5) * 0.028;
        targetY += (frame.posture.shoulderSettle - 0.18) * 0.018;
      }
      if (specimenStrength > 0.001 && frame.specimen.kind) {
        const looseStructure = clamp((region === 1 ? 0.45 : 0) + (shoulder ? 0.72 : 0) + (plume || freeField ? 1 : 0));
        const projection = targetX * specimenDirectionX + targetY * specimenDirectionY;
        const nearSide = smoothstep(clamp((projection + 0.34) / 0.86));
        if (frame.specimen.kind === 'black-hole' && curiosity >= 0.66 && looseStructure > 0) {
          const member = looseStructure * nearSide;
          const arc = Math.sin(curiosity * 31 + specimenClock * 1.55 +
            (targetX * specimenNormalX + targetY * specimenNormalY) * 8);
          targetX += specimenDirectionX * specimenStrength * member * (0.08 + curiosity * 0.13)
            + specimenNormalX * specimenStrength * member * arc * 0.075;
          targetY += specimenDirectionY * specimenStrength * member * (0.08 + curiosity * 0.13)
            + specimenNormalY * specimenStrength * member * arc * 0.075;
          targetX -= specimenDirectionX * projection * specimenStrength * (1 - nearSide) * 0.12;
          targetY -= specimenDirectionY * projection * specimenStrength * (1 - nearSide) * 0.12;
        } else if (frame.specimen.kind === 'galaxy' && curiosity >= 0.7 && looseStructure > 0) {
          const spin = curiosity > 0.85 ? -1 : 1;
          const angle = curiosity * Math.PI * 6 + specimenClock * spin * mix(0.24, 0.48, curiosity);
          const fractional = curiosity * 7.31 - Math.floor(curiosity * 7.31);
          const radius = mix(0.34, 0.78, fractional);
          const orbitX = Math.cos(angle) * radius + specimenDirectionX * Math.sin(angle * 0.5) * 0.07;
          const orbitY = Math.sin(angle) * radius * 0.43 - 0.2 + specimenDirectionY * Math.sin(angle * 0.5) * 0.07;
          const amount = specimenStrength * looseStructure * 0.68;
          targetX = mix(targetX, orbitX, amount);
          targetY = mix(targetY, orbitY, amount);
        } else if (frame.specimen.kind === 'relay' && curiosity >= 0.38 && (head || neck || trap || shoulder || upperTorso || lowerTorso || plume)) {
          const column = Math.floor((targetX + 0.9) * 8 + 0.5) / 8 - 0.9;
          const signal = Math.sin((targetY + specimenClock * 0.28) * 25 + Math.floor(curiosity * 8));
          targetX = mix(targetX, column, specimenStrength * 0.46);
          targetY -= specimenStrength * Math.max(0, signal) * (plume ? 0.098 : 0.018);
        } else if (frame.specimen.kind === 'graph' && curiosity >= 0.3 && (head || neck || trap || shoulder || upperTorso)) {
          const level = Math.floor((targetY + 0.86) * 8 + 0.5) / 8 - 0.86;
          const branchSeed = curiosity * 9.73 - Math.floor(curiosity * 9.73);
          const branchBand = Math.floor((curiosity * 5.17 - Math.floor(curiosity * 5.17)) * 3);
          const branch = (branchSeed > 0.5 ? 1 : -1) * (0.11 + branchBand * 0.11);
          const propagation = 0.55 + 0.45 * Math.sin(specimenClock * 1.7 - level * 12 + curiosity * 4);
          const amount = specimenStrength * (0.34 + propagation * 0.2);
          targetX = mix(targetX, branch * smoothstep(clamp((level + 0.7) / 1.42)), amount);
          targetY = mix(targetY, level, amount);
        } else if (frame.specimen.kind === 'orbit' && curiosity >= 0.82 && looseStructure > 0) {
          const band = curiosity >= 0.91 ? 1 : 0;
          const angle = curiosity * Math.PI * 4 + specimenClock * mix(0.18, -0.24, band);
          const radius = mix(0.4, 0.66, band);
          const amount = specimenStrength * looseStructure * 0.76;
          targetX = mix(targetX, Math.cos(angle) * radius, amount);
          targetY = mix(targetY, Math.sin(angle) * mix(0.15, 0.25, band) + mix(-0.31, 0.06, band), amount);
        }
      }
      let x = position[offset];
      let y = position[offset + 1];
      let velocityX = velocity[offset];
      let velocityY = velocity[offset + 1];
      const attraction = (0.75 + binding * 6.2) * (0.45 + (1 - delay) * 0.55);
      const detach = (1 - binding) * (0.02 + entropy * 0.11);
      const noiseX = fractalNoise2(x * 0.8 + index * 0.0007, time * 0.13, frame.sessionSeed + 1409);
      const noiseY = fractalNoise2(y * 0.8 - index * 0.0009, time * 0.11, frame.sessionSeed + 1511);
      velocityX += ((targetX - x) * attraction + noiseX * detach) * delta * reduced;
      velocityY += ((targetY - y) * attraction + noiseY * detach - (1 - binding) * entropy * 0.015) * delta * reduced;
      if (!frame.reducedMotion && frame.scrollEnergy > 0.002) {
        const scrollVelocity = clamp(frame.scrollVelocity / 1200, -1, 1);
        const scrollAcceleration = clamp(Math.abs(frame.scrollAcceleration) / 5200);
        const originDelay = Math.abs(targetY * 0.5 + 0.5 - frame.scrollOrigin) * 2.2;
        const regionalDelay = delay * 4.8 + originDelay + (region === 9 ? 0.8 : shoulder ? 0.34 : 0);
        const wave = Math.sin(targetY * 7.2 - time * 4 + regionalDelay) * frame.scrollEnergy;
        const coreResistance = cranialCore ? 0.16 : neck ? 0.66 : 1;
        velocityX += wave * delta * (1 - binding * 0.65) * 0.12 * coreResistance;
        velocityY -= wave * scrollVelocity * delta * 0.036 * (0.42 + coreResistance * 0.58);
        if (plume) velocityY += scrollAcceleration * frame.scrollEnergy * (0.08 - y * 0.08) * delta;
      }
      if (!frame.reducedMotion && frame.pointerIntrusion > 0.001) {
        const pointerDeltaX = x - pointerLocalX;
        const pointerDeltaY = y - pointerLocalY;
        const pointerDistance = Math.hypot(pointerDeltaX / 0.92, pointerDeltaY / 1.04);
        const pointerContact = frame.pointerIntrusion * (1 - smoothstep(clamp((pointerDistance - 0.05) / 0.73)));
        if (pointerContact > 0.001) {
          const pointerLength = Math.max(0.0001, Math.hypot(pointerDeltaX, pointerDeltaY));
          const awayX = pointerDeltaX / pointerLength;
          const awayY = pointerDeltaY / pointerLength;
          const directionX = pointerSpeed > 0.01 ? pointerMotionX / pointerMotionLength : -awayY;
          const directionY = pointerSpeed > 0.01 ? pointerMotionY / pointerMotionLength : awayX;
          const compliance = mix(0.38, 1, 1 - binding) * (cranialCore ? 0.58 : 1);
          const striation = Math.sin((y - pointerLocalY) * 43 + curiosity * 8 + time * 7.2);
          const wake = pointerContact * compliance;
          velocityX += (awayX * (3.4 + pointerSpeed * 2.5) + directionX * (0.8 + pointerSpeed * 1.9) +
            striation * (0.72 + pointerSpeed * 1.15)) * wake * delta;
          velocityY += (awayY * (3.4 + pointerSpeed * 2.5) + directionY * (0.8 + pointerSpeed * 1.9) +
            Math.sin((x - pointerLocalX) * 21 - time * 4) * 0.26) * wake * delta;
        }
      }
      const reachThreshold = mix(0.94, 0.91, frame.inspectionStrength);
      const reachX = (frame.reachPosition.x - frame.anchor.x) / Math.max(1, frame.entityWidth * 0.5);
      const reachDirection = reachX < 0 ? -1 : 1;
      const reachSide = targetX * reachDirection > 0.025;
      if (!frame.reducedMotion && frame.reachStrength > 0 && curiosity > reachThreshold && reachSide && (shoulder || upperTorso)) {
        const reachY = (frame.reachPosition.y - frame.anchor.y) / Math.max(1, frame.entityHeight * 0.5);
        const amount = clamp((curiosity - reachThreshold) / Math.max(0.01, 1 - reachThreshold)) * frame.reachStrength;
        velocityX += (reachX - x) * amount * delta * 1.8;
        velocityY += (reachY - y) * amount * delta * 1.8;
      }
      const retention = Math.pow(mix(0.84, 0.986, inertia), delta * 60);
      velocityX *= retention;
      velocityY *= retention;
      x += velocityX * delta;
      y += velocityY * delta;
      position[offset] = clamp(x, -5, 5);
      position[offset + 1] = clamp(y, -5, 5);
      velocity[offset] = velocityX;
      velocity[offset + 1] = velocityY;
    }
  }

  private render(frame: EntityRuntimeFrame): void {
    const context = this.context;
    const topology = this.topology!;
    const position = this.position!;
    context.clearRect(0, 0, this.width, this.height);
    if (!frame.visible) return;
    const theme = ENTITY_CONFIG.theme[frame.theme];
    const light = frame.theme === 'light';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 5px "Doto", monospace';
    const rect = frame.containmentRect;
    const releaseAmount = 1 - frame.containmentStrength;
    const occupancy = entityRuntime.getOccupancy();
    const cognitiveBlend = ENTITY_CONFIG.body.stateFormBlend[frame.cognitiveState] * (1 - frame.internal.entropy * 0.14);
    const formBlend = frame.reducedMotion ? Math.max(0.55, cognitiveBlend) : clamp(cognitiveBlend);
    for (let index = 0; index < maximumCount; index += 1) {
      const source = index * 4;
      const offset = index * 2;
      const region = topology.targets[source + 3];
      const anchor = this.transitionAnchor(frame, index);
      const x = anchor.x + position[offset] * frame.entityWidth * 0.5;
      const y = anchor.y + position[offset + 1] * frame.entityHeight * 0.5;
      if (x < -8 || x > this.width + 8 || y < -8 || y > this.height + 8) continue;
      if (frame.containmentStrength > 0.001) {
        const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        const seed = topology.properties[source + 3];
        if (!inside && seed > releaseAmount) continue;
      }
      const column = clamp(Math.floor(x / this.width * occupancy.columns), 0, occupancy.columns - 1);
      const row = clamp(Math.floor(y / this.height * occupancy.rows), 0, occupancy.rows - 1);
      const occupied = occupancy.grid[row * occupancy.columns + column] / 255;
      if (occupied > 0.72 && region >= 9) continue;
      const appearance = topology.appearance[source + 1];
      const seed = topology.properties[source + 3];
      const cranialEdge = region === 1;
      const lowerHead = region === 2;
      const neck = region === 3;
      const trap = region === 4 || region === 5;
      const shoulder = region === 6 || region === 7;
      const upperTorso = region === 8;
      const lowerTorso = region === 9;
      const distributedHighlight = seed > 0.34
        ? (cranialEdge ? 0.38 + seed * 0.24 : lowerHead ? 0.18 : trap ? 0.24 + seed * 0.2 : shoulder ? 0.2 + seed * 0.18 : upperTorso ? 0.12 : 0)
        : 0;
      const structure = cranialEdge ? 1 : lowerHead ? 0.4 : neck ? 0.35 : trap ? 0.75 : shoulder ? 0.62 : upperTorso ? 0.25 : 0;
      const hierarchy = 1 + (cranialEdge ? ENTITY_CONFIG.body.edgeHighlightGain : 0)
        + (neck || trap ? ENTITY_CONFIG.body.supportHighlightGain : 0);
      const presenceGain = 1.12 + (region === 0 ? 0.18 : 0) + (cranialEdge ? 0.14 : 0)
        + (neck || trap ? 0.08 : 0) + (upperTorso ? 0.04 : 0);
      const lowerDepth = clamp((topology.targets[source + 1] - 0.36) / 0.5);
      const torsoFade = lowerTorso ? mix(1, ENTITY_CONFIG.body.torsoDissolve, lowerDepth) : 1;
      const unresolvedFade = region <= 9 ? mix(0.74, 1, formBlend * formBlend) : 1;
      const directionalSurface = region <= 2
        ? clamp(0.5 + position[offset] * frame.directionalBias * 1.7)
        : 0;
      const specimenPresence = frame.specimen.strength * (region >= 10 ? 0.82 : 0.18);
      const episodeGain = 1 + frame.attentionStrength * 0.1 + frame.inspectionStrength * 0.22 + specimenPresence +
        directionalSurface * frame.attentionStrength * 0.16 + (cranialEdge ? frame.inspectionStrength * 0.1 : 0);
      const hiddenFade = frame.spatialMode === 'HIDDEN'
        ? 1 - smoothstep(clamp((frame.transitionProgress - 0.08) / 0.92))
        : 1;
      const relocationFade = frame.spatialMode === 'RELOCATING'
        ? mix(1, region >= 10 ? 0.68 : 0.48, Math.sin(frame.transitionProgress * Math.PI))
        : 1;
      const alpha = clamp(
        mix(theme.alpha, theme.structureAlpha, structure * 0.28)
        * appearance
        * (region >= 10 ? 0.32 : 1.08)
        * hierarchy
        * presenceGain
        * torsoFade
        * unresolvedFade
        * episodeGain
        * hiddenFade
        * relocationFade
        * ENTITY_CONFIG.particles.densityAlpha[frame.quality],
      );
      if (alpha < 0.025) continue;
      const glyphIndex = Math.round(topology.appearance[source] * (ENTITY_GLYPHS.length - 1));
      context.globalAlpha = alpha;
      context.fillStyle = light
        ? (distributedHighlight > 0.3 ? '#222124' : '#302e31')
        : (distributedHighlight > 0.3 ? '#c4c7c4' : '#a0a4a1');
      context.fillText(ENTITY_GLYPHS[glyphIndex], x, y);
    }
    context.globalAlpha = 1;
  }

  private tick = (time: number): void => {
    if (!this.running || this.disposed) return;
    this.frameRequest = requestAnimationFrame(this.tick);
    const interval = entityRuntime.frame.reducedMotion ? 1000 / 8 : 1000 / 24;
    if (time - this.lastRenderedAt < interval - 1) return;
    const delta = this.lastTime ? Math.min(0.05, (time - this.lastTime) / 1000) : 1 / 24;
    this.lastTime = time;
    this.lastRenderedAt = time;
    const frame = entityRuntime.update(time, delta);
    this.simulate(frame, delta);
    this.render(frame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    this.topology = null;
    this.position = null;
    this.velocity = null;
  }
}

window.__ENTITY_07_CANVAS_DISPOSE__?.();
delete window.__ENTITY_07_CANVAS_DISPOSE__;

let renderer: CanvasEntityRenderer | null = null;
if (canvas) {
  renderer = new CanvasEntityRenderer(canvas);
  const selectRenderer = () => {
    if (root.dataset.renderer === 'canvas') renderer?.start();
    else renderer?.stop();
  };
  addEventListener('andrew:renderer-change', selectRenderer, { signal: abortController.signal });
  queueMicrotask(() => {
    if (root.dataset.fxReason !== 'boot') selectRenderer();
  });
}

const disposeCanvasEntity = () => {
  abortController.abort();
  renderer?.dispose();
  renderer = null;
};

window.__ENTITY_07_CANVAS_DISPOSE__ = disposeCanvasEntity;
import.meta.hot?.dispose(() => {
  if (window.__ENTITY_07_CANVAS_DISPOSE__ !== disposeCanvasEntity) return;
  disposeCanvasEntity();
  delete window.__ENTITY_07_CANVAS_DISPOSE__;
});
