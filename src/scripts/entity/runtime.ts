import { EntityBrain } from './brain';
import { selectAttentionTarget } from './attention';
import { ENTITY_CONFIG } from './config';
import {
  EntityOccupancyMap,
  intersectionArea,
  oppositeSideNoveltyWeight,
  preferredAnchorPosition,
  relocationPathIsClear,
  scoreAnchorCandidate,
} from './occupancy';
import { EntityPerceptionStream } from './perception';
import { clamp, fractalNoise2, hashString, mix, SeededRandom, smoothstep, springStep } from './random';
import { containmentStrengthFor, expensiveSimulationShouldPause, spatialModeIsReleased } from './policy';
import type {
  AnchorCandidate,
  BehaviorEpisodeKind,
  BehaviorPhase,
  CognitiveState,
  EntityPostureState,
  EntityRuntimeApi,
  EntityRuntimeDebugSnapshot,
  EntityRuntimeFrame,
  InteractionMemory,
  MotorIntent,
  PerceptionEvent,
  PerceptionSource,
  QualityTier,
  RectLike,
  SpecimenKind,
  SpatialMode,
  Vec2,
} from './types';
import type { AttentionCandidate, AttentionSelection } from './attention';

interface BehaviorEpisode {
  kind: BehaviorEpisodeKind;
  phase: BehaviorPhase;
  targetId: string | null;
  startedAt: number;
  phaseStartedAt: number;
  phaseDuration: number;
  commitment: number;
  hostId: string | null;
  destination: Vec2 | null;
  holdUntil: number;
  specimenKind: SpecimenKind | null;
}

interface ProjectEngagement {
  targetId: string;
  element: HTMLElement;
  hover: boolean;
  focus: boolean;
  startedAt: number;
  lastSignalAt: number;
  acknowledgeAfter: number;
  commitAfter: number;
  responded: boolean;
}

const MEMORY_KEY = 'entity-07-memory-v1';
const SEED_KEY = 'entity-07-seed-v1';
const GLYPH_CORRUPTION = ['·', ':', '░', '_', ' '];
const COGNITIVE_STATES: CognitiveState[] = [
  'DORMANT', 'OBSERVING', 'CURIOUS', 'INSPECTING', 'THINKING', 'FRAGMENTING', 'REFORMING',
];
const SPECIMEN_KINDS: SpecimenKind[] = ['black-hole', 'galaxy', 'relay', 'graph', 'orbit'];

function isSpecimenKind(value: string | undefined | null): value is SpecimenKind {
  return Boolean(value && SPECIMEN_KINDS.includes(value as SpecimenKind));
}

const MESSAGE_POOLS: Record<CognitiveState, string[]> = {
  DORMANT: ['listening...', 'signal incomplete', 'low coherence'],
  OBSERVING: ['observing...', 'external motion detected', 'attention vector unstable'],
  CURIOUS: ['pattern recognized', 'hypothesis pending', 'trajectory inferred'],
  INSPECTING: ['target familiarity increased', 'memory trace retained', 'boundary model updated'],
  THINKING: ['self-check in progress', 'learning...', 'symbol order unresolved'],
  FRAGMENTING: ['coherence declining', 'signal dispersing', 'structure not required'],
  REFORMING: ['reconstructing...', 'topology reacquired', 'memory trace retained'],
};
const SPECIMEN_MESSAGES: Record<SpecimenKind, string> = {
  'black-hole': 'mass gradient resisting // core retained',
  galaxy: 'orbital hypothesis // counterfield stable',
  relay: 'carrier signal received // reply forming',
  graph: 'branch topology synchronized',
  orbit: 'phase lock acquired // drift pending',
};

function emptyPosture(): EntityPostureState {
  return {
    headTilt: 0,
    lean: 0,
    breath: 0.5,
    shoulderSettle: 0,
    shoulderCounter: 0,
    surfaceFlow: 0,
  };
}

function rectCenter(rect: RectLike): Vec2 {
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
}

function copyRect(rect: RectLike): RectLike {
  return { ...rect };
}

function readSessionSeed(): number {
  const params = new URLSearchParams(location.search);
  const requested = Number.parseInt(params.get('entitySeed') || '', 10);
  if (Number.isFinite(requested)) return requested >>> 0;
  try {
    const stored = Number.parseInt(sessionStorage.getItem(SEED_KEY) || '', 10);
    if (Number.isFinite(stored)) return stored >>> 0;
  } catch { /* storage can be unavailable */ }
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const seed = values[0] || hashString(`${performance.timeOrigin}:${navigator.userAgent}`);
  try { sessionStorage.setItem(SEED_KEY, String(seed)); } catch { /* storage can be unavailable */ }
  return seed >>> 0;
}

function readMemory(): InteractionMemory[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(MEMORY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function particleCountForTier(quality: QualityTier): number {
  const size = ENTITY_CONFIG.particles.textureSize[quality];
  return size * size;
}

function elementTargetId(element: HTMLElement): string {
  const existing = element.dataset.entityId || element.dataset.entityProject || element.dataset.case || element.id;
  if (existing) return existing;
  const generated = `interest-${hashString(`${element.tagName}:${element.textContent?.slice(0, 80) || ''}`).toString(36)}`;
  element.dataset.entityId = generated;
  return generated;
}

function interestElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-entity-interest],[data-entity-project],.casefile')
    : null;
}

function projectInterest(element: HTMLElement): boolean {
  return element.matches('[data-entity-project],.casefile');
}

function elementPosition(element: HTMLElement): Vec2 {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
}

class EntityRuntimeController implements EntityRuntimeApi {
  readonly particlePoolId: string;
  readonly frame: EntityRuntimeFrame;
  private brain: EntityBrain;
  private perception = new EntityPerceptionStream();
  private occupancy: EntityOccupancyMap;
  private rng: SeededRandom;
  private abortController = new AbortController();
  private sectionObserver: IntersectionObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private pointer = {
    x: innerWidth * 0.5,
    y: innerHeight * 0.5,
    lastAt: 0,
    lastSampleAt: 0,
    velocityX: 0,
    velocityY: 0,
    idleEmitted: false,
    nextIdleAt: 0,
    idleDelay: 3400,
  };
  private inputModality: PerceptionSource = 'system';
  private scroll = { y: scrollY, velocity: 0, acceleration: 0, energy: 0, lastAt: performance.now(), lastEventAt: 0, origin: 0.5 };
  private requestedEnabled = true;
  private previousSpatialMode: SpatialMode = 'SEALED';
  private spatialMode: SpatialMode = 'SEALED';
  private cognitiveState: CognitiveState = 'DORMANT';
  private motorIntent: MotorIntent = 'IDLE';
  private transitionStart = 0;
  private transitionDuration = 1;
  private transitionProgress = 0;
  private transitionFrom: Vec2;
  private transitionTarget: Vec2;
  private stableAnchor: Vec2;
  private anchorVelocity: Vec2 = { x: 0, y: 0 };
  private nextRelocationAt = 0;
  private sectionRelocationEligibleAt = 0;
  private lastRelocationAt = -Infinity;
  private lastLayoutRevision = -1;
  private lastReleaseLayoutRevision = -1;
  private lastTickAt = 0;
  private lastPublishedKey = '';
  private lastAttentionTarget: string | null = null;
  private lastBrainAttentionTarget: string | null = null;
  private activeAttention: AttentionSelection = {
    id: null,
    secondaryId: null,
    kind: null,
    position: { x: innerWidth * 0.5, y: innerHeight * 0.42 },
    score: 0,
    confidence: 0,
    abandoned: false,
  };
  private nextAttentionDecisionAt = 0;
  private gazeTargetReadyAt = 0;
  private headTargetReadyAt = 0;
  private gazeTarget: Vec2 = { x: 0, y: 0 };
  private nextPostureCheck = 0;
  private nextSurfaceGesture = 0;
  private nextPostureGesture = 0;
  private postureTargets = { headTilt: 0, lean: 0, shoulderCounter: 0, surfaceFlow: 0 };
  private reachTargetId: string | null = null;
  private reachStop = ENTITY_CONFIG.interaction.reachStopPx[1];
  private nextMessageAt = 0;
  private lastMessageAt = -Infinity;
  private recentMessages: string[] = [];
  private thoughtOutput = document.getElementById('entity-thought') as HTMLOutputElement | null;
  private debugEnabled = Boolean(import.meta.env?.DEV) && new URLSearchParams(location.search).get('entityDebug') === '1';
  private debugOverlayEnabled = new URLSearchParams(location.search).get('entityDebugOverlay') !== '0';
  private debugFreezeAnchor = this.debugEnabled && new URLSearchParams(location.search).get('entityFreeze') === '1';
  private forcedCognitiveState = (() => {
    if (!this.debugEnabled) return null;
    const requested = new URLSearchParams(location.search).get('entityState')?.toUpperCase() as CognitiveState | undefined;
    return requested && COGNITIVE_STATES.includes(requested) ? requested : null;
  })();
  private debugRoot: HTMLElement | null = null;
  private debugCanvas: HTMLCanvasElement | null = null;
  private lastDebugUpdate = 0;
  private frameTimeAverage = 16.7;
  private activeParticleCount = particleCountForTier('high');
  private pendingReleaseAfterSession = false;
  private pendingReleaseForSafeSpace = false;
  private nextReleaseAttemptAt = 0;
  private hiddenReason: 'disabled' | 'occupancy' | null = null;
  private unsafeAnchorSince = 0;
  private targetElements = new Map<string, HTMLElement>();
  private visibleSections = new Map<string, { element: HTMLElement; ratio: number; visible: boolean }>();
  private currentVisibleSection: string | null = null;
  private lastNonNullSection: string | null = null;
  private pendingSectionId: string | null = null;
  private thoughtHideTimer = 0;
  private releaseAdjustmentFrames = new Set<number>();
  private episode: BehaviorEpisode | null = null;
  private projectEngagements = new Map<string, ProjectEngagement>();
  private nextSurveyAt = 0;
  private compactObservation = false;
  private selectedAnchorCompact = false;
  private lastVisibleActionAt = 0;
  private lastEvidenceMessageAt = -Infinity;
  private lastEvidenceTarget: string | null = null;
  private evidenceMessagePending: string | null = null;
  private lastDeclineAt = -Infinity;
  private specimenNextEligible = new Map<string, number>();
  private activeSpecimenElement: HTMLElement | null = null;
  private activeSpecimenKind: SpecimenKind | null = null;

  constructor() {
    const seed = readSessionSeed();
    this.rng = new SeededRandom(seed ^ 0x7f4a7c15);
    this.brain = new EntityBrain(seed, readMemory());
    this.occupancy = new EntityOccupancyMap();
    const containment = this.occupancy.getContainmentRect();
    const center = rectCenter(containment);
    this.stableAnchor = { ...center };
    this.transitionFrom = { ...center };
    this.transitionTarget = { ...center };
    this.particlePoolId = `entity07-${seed.toString(16).padStart(8, '0')}`;
    const initialQuality = this.initialQuality();
    this.activeParticleCount = particleCountForTier(initialQuality);
    this.frame = {
      revision: 0,
      timestamp: performance.now(),
      delta: 0,
      sessionSeed: seed,
      spatialMode: 'SEALED',
      cognitiveState: 'DORMANT',
      motorIntent: 'IDLE',
      episodeKind: null,
      episodePhase: null,
      episodeTargetId: null,
      episodeCommitment: 0,
      activeHostId: null,
      attentionStrength: 0.18,
      inspectionStrength: 0,
      directionalBias: 0,
      specimen: {
        kind: null,
        strength: 0,
        phase: 0,
        direction: { x: 0, y: 0 },
        distance: 0,
      },
      lastVisibleActionAt: performance.now(),
      internal: this.brain.internal,
      activeAnchorId: 'containment',
      attentionTargetId: null,
      attentionPosition: { ...center },
      gazeOrientation: { x: 0, y: 0 },
      headOrientation: { x: 0, y: 0 },
      gazeVelocity: { x: 0, y: 0 },
      headVelocity: { x: 0, y: 0 },
      pointerPosition: { x: this.pointer.x, y: this.pointer.y },
      pointerVelocity: { x: 0, y: 0 },
      pointerProximity: 0,
      pointerIntrusion: 0,
      anchor: { ...center },
      anchorFrom: { ...center },
      anchorTarget: { ...center },
      anchorVelocity: this.anchorVelocity,
      entityWidth: 260,
      entityHeight: 344,
      containmentRect: copyRect(containment),
      containmentStrength: 1,
      transitionProgress: 0,
      relocationCurve: 0,
      reachPosition: { ...center },
      reachStrength: 0,
      scrollVelocity: 0,
      scrollAcceleration: 0,
      scrollEnergy: 0,
      scrollOrigin: 0.5,
      interactionEnergy: 0,
      formCoherence: ENTITY_CONFIG.brain.stateCoherence.DORMANT,
      boundRatio: ENTITY_CONFIG.particles.activeBindingRange[0],
      posture: emptyPosture(),
      quality: initialQuality,
      enabled: true,
      visible: true,
      released: false,
      reducedMotion: this.reducedMotion.matches,
      simulationPaused: false,
      theme: document.documentElement.dataset.themeResolved === 'light' ? 'light' : 'dark',
      status: 'SEALED / DORMANT',
      frameTimeAverage: 16.7,
      activeParticleCount: this.activeParticleCount,
    };
    if (document.documentElement.dataset.entity === 'off') {
      this.requestedEnabled = false;
      this.spatialMode = 'HIDDEN';
      this.hiddenReason = 'disabled';
      this.frame.spatialMode = 'HIDDEN';
      this.frame.enabled = false;
      this.frame.visible = false;
      this.frame.simulationPaused = true;
      this.frame.status = 'HIDDEN / DORMANT';
    }
    this.nextRelocationAt = performance.now() + this.rng.range(...ENTITY_CONFIG.anchors.relocationCooldownSeconds) * 1000;
    this.nextSurveyAt = performance.now() + this.rng.range(...ENTITY_CONFIG.interaction.firstSurveySeconds) * 1000;
    this.lastVisibleActionAt = performance.now();
    this.pointer.idleDelay = this.rng.range(...ENTITY_CONFIG.interaction.pointerIdleMs);
    this.pointer.nextIdleAt = performance.now() + this.pointer.idleDelay;
    this.schedulePostureEvents(performance.now());
    this.nextMessageAt = performance.now() + this.rng.range(...ENTITY_CONFIG.messages.intervalSeconds) * 1000;
    this.bindPerception();
    this.publish(true);
    if (this.debugEnabled && this.debugOverlayEnabled) this.createDebugOverlay();
    const debugMode = new URLSearchParams(location.search).get('entityMode');
    if (this.debugEnabled && debugMode === 'free') this.requestRelease('system');
    else if (this.debugEnabled && debugMode === 'disabled') this.setEnabled(false, 'system');
  }

  update(time: number, delta: number): EntityRuntimeFrame {
    if (time <= this.lastTickAt + 0.1) return this.frame;
    const seconds = clamp(delta || (time - this.lastTickAt) / 1000 || 1 / 60, 0, 0.05);
    this.lastTickAt = time;
    this.emitTemporalPerception(time);
    this.perception.drain((event) => this.brain.enqueue(event));
    this.frameTimeAverage = mix(this.frameTimeAverage, seconds * 1000, ENTITY_CONFIG.particles.frameTimeEmaAlpha);
    const containment = this.occupancy.getContainmentRect();
    this.frame.containmentRect = copyRect(containment);
    this.updateSpatialMode(time, seconds, containment);
    this.maybeRecoverFromOccupancyHide(time);
    if (this.pendingReleaseForSafeSpace && this.spatialMode === 'SEALED' && time >= this.nextReleaseAttemptAt) {
      this.tryBeginRelease(time);
    }

    const pointerDistance = Math.hypot(this.pointer.x - this.frame.anchor.x, this.pointer.y - this.frame.anchor.y);
    const brainOutput = this.brain.update({
      now: time,
      delta: seconds,
      spatialMode: this.spatialMode,
      released: this.spatialMode === 'FREE' || this.spatialMode === 'RELOCATING',
      reducedMotion: this.reducedMotion.matches,
      pointerDistanceToEntity: pointerDistance,
      activeSectionId: this.currentVisibleSection || document.documentElement.dataset.activeSection || null,
      transitionProgress: this.transitionProgress,
    });
    this.cognitiveState = this.forcedCognitiveState || brainOutput.cognitiveState;
    this.motorIntent = brainOutput.motorIntent;
    this.activeAttention = this.resolveAttention(time, brainOutput.attentionTargetId, brainOutput.attentionPosition);
    this.updateBehaviorEpisode(time, seconds);
    this.updateGaze(time, seconds, this.activeAttention.id, this.activeAttention.position);
    this.updatePosture(time, seconds);
    this.updateReach(seconds, this.activeAttention.id, this.activeAttention.position);
    this.updateScroll(seconds);
    this.updateFrame(time, seconds, brainOutput.interactionEnergy);
    this.maybeRelocate(time, pointerDistance);
    this.maybeShowMessage(time, brainOutput.stateChanged);
    this.publish(brainOutput.stateChanged);
    if (this.debugEnabled && time - this.lastDebugUpdate > 180) this.updateDebugOverlay(time);
    return this.frame;
  }

  enqueue(event: PerceptionEvent): void {
    this.perception.push(event);
  }

  requestRelease(source: PerceptionSource = 'system'): void {
    const now = performance.now();
    this.enqueue({ type: 'RELEASE_REQUESTED', timestamp: now, salience: 1, source });
    this.pendingReleaseForSafeSpace = true;
    document.documentElement.dataset.entityReleaseIntent = 'on';
    if (document.documentElement.classList.contains('session-pending')) {
      this.pendingReleaseAfterSession = true;
      return;
    }
    if (this.spatialMode === 'HIDDEN' && this.hiddenReason === 'disabled') this.setEnabled(true, source);
    this.tryBeginRelease(now);
    if (this.pendingReleaseForSafeSpace) this.publish(true);
  }

  private tryBeginRelease(now: number): void {
    if (!this.requestedEnabled || (this.spatialMode !== 'SEALED' && this.spatialMode !== 'RETURNING')) return;
    const engagement = this.activeProjectEngagement();
    const selected = this.chooseFreeAnchor(false, engagement?.targetId || this.activeAttention.id, true);
    if (selected.hardRejected) {
      this.pendingReleaseForSafeSpace = true;
      this.nextReleaseAttemptAt = now + this.rng.range(420, 1100);
      this.occupancy.scheduleRefresh('release-awaiting-safe-space');
      return;
    }
    this.compactObservation = this.selectedAnchorCompact;
    this.pendingReleaseForSafeSpace = false;
    delete document.documentElement.dataset.entityReleaseIntent;
    const containment = this.occupancy.getContainmentRect();
    const from = this.spatialMode === 'RETURNING' ? this.visualAnchor() : rectCenter(containment);
    const cohesion = this.brain.internal.cohesion;
    const arousal = this.brain.internal.arousal;
    const duration = mix(
      ENTITY_CONFIG.containment.releaseDurationMs[0],
      ENTITY_CONFIG.containment.releaseDurationMs[1],
      clamp(cohesion * 0.72 - arousal * 0.28 + 0.24),
    );
    this.beginSpatialTransition('RELEASING', from, selected.position, this.reducedMotion.matches ? 1 : duration, now);
    this.lastReleaseLayoutRevision = this.occupancy.getSnapshot().revision;
    this.frame.activeAnchorId = selected.id;
    this.frame.released = true;
    this.frame.spatialMode = 'RELEASING';
    this.publish(true);
    const firstFrame = requestAnimationFrame(() => {
      this.releaseAdjustmentFrames.delete(firstFrame);
      const secondFrame = requestAnimationFrame(() => {
        this.releaseAdjustmentFrames.delete(secondFrame);
        if (this.spatialMode !== 'RELEASING') return;
        this.occupancy.refresh();
        const adjusted = this.chooseFreeAnchor(false, this.activeAttention.id, true);
        if (adjusted.hardRejected) return;
        this.compactObservation = this.selectedAnchorCompact;
        this.transitionTarget = { ...adjusted.position };
        this.frame.activeAnchorId = adjusted.id;
      });
      this.releaseAdjustmentFrames.add(secondFrame);
    });
    this.releaseAdjustmentFrames.add(firstFrame);
  }

  requestReturn(source: PerceptionSource = 'system'): void {
    const now = performance.now();
    this.enqueue({ type: 'RETURN_REQUESTED', timestamp: now, salience: 0.9, source });
    const cancelledPendingRelease = this.pendingReleaseForSafeSpace;
    this.pendingReleaseForSafeSpace = false;
    delete document.documentElement.dataset.entityReleaseIntent;
    if (this.spatialMode === 'SEALED' || this.spatialMode === 'RETURNING') {
      if (cancelledPendingRelease) this.publish(true);
      return;
    }
    if (this.episode?.targetId) {
      const engagement = this.projectEngagements.get(this.episode.targetId);
      if (engagement) engagement.responded = true;
    }
    this.episode = null;
    const target = rectCenter(this.occupancy.getContainmentRect());
    const duration = this.reducedMotion.matches ? 1 : this.rng.range(...ENTITY_CONFIG.containment.returnDurationMs);
    this.beginSpatialTransition('RETURNING', this.visualAnchor(), target, duration, now);
    this.frame.activeAnchorId = 'containment';
  }

  toggleRelease(source: PerceptionSource = 'system'): void {
    if (this.pendingReleaseForSafeSpace) this.requestReturn(source);
    else if (this.spatialMode === 'SEALED' || this.spatialMode === 'RETURNING') this.requestRelease(source);
    else this.requestReturn(source);
  }

  setEnabled(enabled: boolean, source: PerceptionSource = 'system'): void {
    if (enabled === this.requestedEnabled && this.spatialMode !== 'HIDDEN') return;
    const now = performance.now();
    this.requestedEnabled = enabled;
    this.enqueue({ type: enabled ? 'ENTITY_ENABLED' : 'ENTITY_DISABLED', timestamp: now, salience: 1, source });
    if (!enabled) {
      this.episode = null;
      this.pendingReleaseForSafeSpace = false;
      delete document.documentElement.dataset.entityReleaseIntent;
      if (this.spatialMode !== 'HIDDEN') this.previousSpatialMode = this.spatialMode === 'SEALED' ? 'SEALED' : 'FREE';
      this.hiddenReason = 'disabled';
      const anchor = this.visualAnchor();
      this.beginSpatialTransition('HIDDEN', anchor, anchor, this.reducedMotion.matches ? 1 : 850, now);
    } else {
      this.hiddenReason = null;
      const containment = rectCenter(this.occupancy.getContainmentRect());
      const restore = this.previousSpatialMode === 'SEALED' ? containment : this.stableAnchor;
      this.spatialMode = this.previousSpatialMode;
      this.transitionStart = now;
      this.transitionDuration = this.reducedMotion.matches ? 1 : 720;
      this.transitionProgress = 0;
      this.transitionFrom = { ...restore };
      this.transitionTarget = { ...restore };
      this.frame.visible = true;
      this.frame.simulationPaused = false;
      this.frame.enabled = true;
    }
    try { localStorage.setItem('andrew-entity', enabled ? 'on' : 'off'); } catch { /* storage can be unavailable */ }
  }

  setQuality(quality: QualityTier): void {
    this.frame.quality = quality;
    this.frame.activeParticleCount = Math.min(this.activeParticleCount, particleCountForTier(quality));
  }

  setActiveParticleCount(count: number): void {
    this.activeParticleCount = Math.max(1, Math.floor(count));
    this.frame.activeParticleCount = this.activeParticleCount;
  }

  getOccupancy() {
    return this.occupancy.getSnapshot();
  }

  getDebugSnapshot(): EntityRuntimeDebugSnapshot {
    return {
      frame: this.frame,
      occupancy: this.occupancy.getSnapshot(),
      memory: this.brain.getMemory(),
      recentEvents: this.perception.getRecent(),
      candidateUtilities: this.brain.getUtilities(),
      eventQueueDepth: this.perception.depth + this.brain.getQueueDepth(),
      particlePoolId: this.particlePoolId,
      currentVisibleSection: this.currentVisibleSection,
      debugState: {
        enabled: this.debugEnabled,
        anchorFrozen: this.debugFreezeAnchor,
        forcedCognitiveState: this.forcedCognitiveState,
      },
    };
  }

  requestLayoutRefresh(reason = 'manual'): void {
    this.enqueue({
      type: 'LAYOUT_CHANGED',
      timestamp: performance.now(),
      targetId: reason,
      salience: 0.34,
      source: 'system',
    });
    this.occupancy.scheduleRefresh(reason);
  }

  dispose(): void {
    this.persistMemory();
    this.syncSpecimenContact(null);
    this.abortController.abort();
    this.sectionObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.occupancy.dispose();
    this.perception.dispose();
    window.clearTimeout(this.thoughtHideTimer);
    for (const frame of this.releaseAdjustmentFrames) cancelAnimationFrame(frame);
    this.releaseAdjustmentFrames.clear();
    this.debugRoot?.remove();
    this.debugCanvas?.remove();
    if (window.__ENTITY_07_RUNTIME__ === this) delete window.__ENTITY_07_RUNTIME__;
  }

  private initialQuality(): QualityTier {
    const forced = new URLSearchParams(location.search).get('quality') as QualityTier | null;
    if (forced && forced in ENTITY_CONFIG.particles.textureSize) return forced;
    if (this.reducedMotion.matches) return 'static';
    if (matchMedia('(pointer: coarse)').matches || innerWidth < 700) return 'mobile';
    if ((navigator.hardwareConcurrency || 8) <= 4) return 'low';
    if ((navigator.hardwareConcurrency || 8) >= 12 && innerWidth >= 1600) return 'ultra';
    return 'high';
  }

  private bindPerception(): void {
    const signal = this.abortController.signal;
    addEventListener('pointermove', (event) => this.onPointerMove(event), { passive: true, signal });
    addEventListener('pointerdown', (event) => {
      const pointerEvent = event as PointerEvent;
      this.inputModality = pointerEvent.pointerType === 'touch' ? 'touch' : 'pointer';
    }, { passive: true, signal });
    addEventListener('pointerover', (event) => this.onPointerEnter(event), { passive: true, signal });
    addEventListener('pointerout', (event) => this.onPointerLeave(event), { passive: true, signal });
    addEventListener('focusin', (event) => this.onFocus(event), { signal });
    addEventListener('focusout', (event) => this.onBlur(event), { signal });
    addEventListener('click', (event) => this.onActivation(event), { signal });
    document.getElementById('entity-release')?.addEventListener('click', () => this.toggleRelease('pointer'), { signal });
    document.getElementById('entity-toggle')?.addEventListener('click', () => this.setEnabled(!this.requestedEnabled, 'pointer'), { signal });
    addEventListener('keydown', (event) => {
      const keyboardEvent = event as KeyboardEvent;
      this.inputModality = 'keyboard';
      const target = keyboardEvent.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
      if (typing || keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey || keyboardEvent.repeat) return;
      if (keyboardEvent.key.toLowerCase() === 'y') this.requestRelease('keyboard');
      else if (keyboardEvent.key.toLowerCase() === 'n') this.requestReturn('keyboard');
    }, { signal });
    addEventListener('scroll', () => this.onScroll(), { passive: true, signal });
    document.addEventListener('visibilitychange', () => {
      this.enqueue({
        type: document.hidden ? 'PAGE_HIDDEN' : 'PAGE_VISIBLE',
        timestamp: performance.now(),
        salience: 0.5,
        source: 'system',
      });
      this.frame.simulationPaused = document.hidden || !this.frame.visible;
      if (document.hidden) this.persistMemory();
    }, { signal });
    addEventListener('pagehide', () => {
      this.enqueue({ type: 'PAGE_HIDDEN', timestamp: performance.now(), salience: 0.5, source: 'system' });
      this.persistMemory();
    }, { signal });
    addEventListener('andrew:session-open', () => {
      this.occupancy.scheduleRefresh('session-open');
      const chamber = rectCenter(this.occupancy.getContainmentRect());
      this.stableAnchor = { ...chamber };
      this.transitionFrom = { ...chamber };
      this.transitionTarget = { ...chamber };
      if (this.pendingReleaseAfterSession) {
        this.pendingReleaseAfterSession = false;
        this.tryBeginRelease(performance.now());
      }
      this.publish(true);
    }, { signal });
    addEventListener('andrew:entity-command', (event) => {
      const command = (event as CustomEvent<{ command?: string; source?: PerceptionSource }>).detail?.command;
      const source = (event as CustomEvent<{ source?: PerceptionSource }>).detail?.source || 'system';
      if (command === 'release') this.requestRelease(source);
      else if (command === 'return') this.requestReturn(source);
      else if (command === 'toggle-release') this.toggleRelease(source);
      else if (command === 'toggle') this.setEnabled(!this.requestedEnabled, source);
      else if (command === 'enable') this.setEnabled(true, source);
      else if (command === 'disable') this.setEnabled(false, source);
    }, { signal });
    this.reducedMotion.addEventListener('change', () => {
      this.frame.reducedMotion = this.reducedMotion.matches;
      if (this.reducedMotion.matches && this.spatialMode === 'RELOCATING') {
        this.stableAnchor = { ...this.transitionTarget };
        this.spatialMode = 'FREE';
      }
    }, { signal });
    this.sectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const id = element.dataset.section || element.id;
        if (!id) continue;
        const previous = this.visibleSections.get(id);
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.18;
        this.visibleSections.set(id, { element, ratio: entry.intersectionRatio, visible });
        if ((!previous && visible) || (previous && previous.visible !== visible)) {
          this.enqueue({
            type: visible ? 'SECTION_ENTER' : 'SECTION_LEAVE',
            timestamp: performance.now(),
            targetId: id,
            positionViewport: elementPosition(element),
            salience: clamp(entry.intersectionRatio + 0.2),
            source: 'system',
          });
        }
      }
      const nextSection = [...this.visibleSections.entries()]
        .filter(([, section]) => section.visible)
        .sort((left, right) => right[1].ratio - left[1].ratio)[0]?.[0] || null;
      if (nextSection !== this.currentVisibleSection) {
        const previousSection = this.lastNonNullSection;
        this.currentVisibleSection = nextSection;
        if (nextSection && previousSection && nextSection !== previousSection) {
          this.pendingSectionId = nextSection;
          this.sectionRelocationEligibleAt = performance.now() + this.rng.range(...ENTITY_CONFIG.interaction.sectionSettleMs);
        } else if (!previousSection) {
          this.pendingSectionId = null;
          this.sectionRelocationEligibleAt = 0;
        }
        if (nextSection) this.lastNonNullSection = nextSection;
      }
    }, { threshold: [0.18, 0.42, 0.7] });
    document.querySelectorAll<HTMLElement>('[data-section]').forEach((element) => this.sectionObserver?.observe(element));
    this.themeObserver = new MutationObserver(() => {
      this.frame.theme = document.documentElement.dataset.themeResolved === 'light' ? 'light' : 'dark';
      this.occupancy.scheduleRefresh('theme-change');
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-resolved', 'class'] });
  }

  private emitTemporalPerception(time: number): void {
    if (!this.pointer.idleEmitted && time >= this.pointer.nextIdleAt) {
      this.pointer.idleEmitted = true;
      this.enqueue({
        type: 'POINTER_IDLE',
        timestamp: time,
        positionViewport: { x: this.pointer.x, y: this.pointer.y },
        velocityViewport: { x: 0, y: 0 },
        salience: clamp((time - this.pointer.lastAt) / 12000, 0.2, 0.72),
        source: 'pointer',
      });
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const now = performance.now();
    if (this.pointer.idleEmitted || !this.pointer.lastAt) {
      this.pointer.idleDelay = this.rng.range(...ENTITY_CONFIG.interaction.pointerIdleMs);
    }
    this.pointer.idleEmitted = false;
    this.pointer.nextIdleAt = now + this.pointer.idleDelay;
    const elapsed = Math.max(8, now - (this.pointer.lastAt || now));
    const rawVelocityX = (event.clientX - this.pointer.x) / elapsed * 1000;
    const rawVelocityY = (event.clientY - this.pointer.y) / elapsed * 1000;
    this.pointer.velocityX = mix(this.pointer.velocityX, rawVelocityX, 0.28);
    this.pointer.velocityY = mix(this.pointer.velocityY, rawVelocityY, 0.28);
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    this.pointer.lastAt = now;
    const shared = window.__ANDREW_VISUAL_STATE__;
    if (shared) Object.assign(shared.pointer, { x: event.clientX, y: event.clientY, lastAt: now });
    if (now - this.pointer.lastSampleAt < ENTITY_CONFIG.interaction.pointerSampleMs) return;
    this.pointer.lastSampleAt = now;
    this.enqueue({
      type: 'POINTER_MOVE',
      timestamp: now,
      positionViewport: { x: event.clientX, y: event.clientY },
      velocityViewport: { x: this.pointer.velocityX, y: this.pointer.velocityY },
      salience: clamp(Math.hypot(this.pointer.velocityX, this.pointer.velocityY) / 1300, 0.04, 1),
      source: event.pointerType === 'touch' ? 'touch' : 'pointer',
    });
  }

  private onPointerEnter(event: PointerEvent): void {
    const element = interestElement(event.target);
    if (!element || (event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) return;
    const id = elementTargetId(element);
    const now = performance.now();
    this.rememberTargetElement(id, element);
    if (projectInterest(element)) this.beginProjectEngagement(id, element, 'hover', now);
    this.enqueue({
      type: projectInterest(element) ? 'PROJECT_HOVER_START' : 'POINTER_ENTER_REGION',
      timestamp: now,
      targetId: id,
      positionViewport: elementPosition(element),
      salience: element.matches('[data-entity-project],.casefile') ? 0.88 : 0.58,
      source: event.pointerType === 'touch' ? 'touch' : 'pointer',
    });
  }

  private onPointerLeave(event: PointerEvent): void {
    const element = interestElement(event.target);
    if (!element || (event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) return;
    const id = elementTargetId(element);
    const now = performance.now();
    if (projectInterest(element)) this.endProjectEngagement(id, 'hover', now);
    this.enqueue({
      type: projectInterest(element) ? 'PROJECT_HOVER_END' : 'POINTER_LEAVE_REGION',
      timestamp: now,
      targetId: id,
      positionViewport: elementPosition(element),
      salience: 0.4,
      source: event.pointerType === 'touch' ? 'touch' : 'pointer',
    });
  }

  private onFocus(event: FocusEvent): void {
    const element = interestElement(event.target) || (event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('a,button,input,textarea,select') : null);
    if (!element || (event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) return;
    const id = elementTargetId(element);
    const now = performance.now();
    this.rememberTargetElement(id, element);
    if (projectInterest(element)) this.beginProjectEngagement(id, element, 'focus', now);
    this.occupancy.scheduleRefresh('focus-enter');
    this.enqueue({
      type: projectInterest(element) ? 'PROJECT_FOCUS' : 'REGION_FOCUS',
      timestamp: now,
      targetId: id,
      positionViewport: elementPosition(element),
      salience: 0.92,
      source: this.inputModality,
    });
  }

  private onBlur(event: FocusEvent): void {
    const element = interestElement(event.target) || (event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('a,button,input,textarea,select') : null);
    if (!element || (event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) return;
    const id = elementTargetId(element);
    const now = performance.now();
    if (projectInterest(element)) this.endProjectEngagement(id, 'focus', now);
    this.occupancy.scheduleRefresh('focus-leave');
    this.enqueue({
      type: projectInterest(element) ? 'PROJECT_BLUR' : 'REGION_BLUR',
      timestamp: now,
      targetId: id,
      positionViewport: elementPosition(element),
      salience: 0.52,
      source: this.inputModality,
    });
  }

  private onActivation(event: MouseEvent): void {
    const actionable = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('a,button') : null;
    if (!actionable) return;
    const element = interestElement(event.target) || actionable;
    const id = elementTargetId(element);
    const now = performance.now();
    if (projectInterest(element)) {
      this.rememberTargetElement(id, element);
      const engagement = this.projectEngagements.get(id);
      if (engagement) engagement.lastSignalAt = now;
    }
    this.enqueue({
      type: projectInterest(element) ? 'PROJECT_ACTIVATED' : 'REGION_ACTIVATED',
      timestamp: now,
      targetId: id,
      positionViewport: elementPosition(element),
      salience: 1,
      source: event.detail === 0 ? 'keyboard' : this.inputModality === 'touch' ? 'touch' : 'pointer',
    });
  }

  private rememberTargetElement(id: string, element: HTMLElement): void {
    this.targetElements.delete(id);
    this.targetElements.set(id, element);
    while (this.targetElements.size > 48) {
      const oldest = this.targetElements.keys().next().value as string | undefined;
      if (!oldest) break;
      this.targetElements.delete(oldest);
    }
  }

  private beginProjectEngagement(
    targetId: string,
    element: HTMLElement,
    channel: 'hover' | 'focus',
    now: number,
  ): void {
    let engagement = this.projectEngagements.get(targetId);
    const wasActive = Boolean(engagement?.hover || engagement?.focus);
    if (!engagement) {
      engagement = {
        targetId,
        element,
        hover: false,
        focus: false,
        startedAt: now,
        lastSignalAt: now,
        acknowledgeAfter: 0,
        commitAfter: 0,
        responded: false,
      };
      this.projectEngagements.set(targetId, engagement);
    }
    engagement.element = element;
    engagement[channel] = true;
    engagement.lastSignalAt = now;
    if (!wasActive) {
      const familiarity = this.targetFamiliarity(targetId);
      engagement.startedAt = now;
      engagement.acknowledgeAfter = this.rng.range(...ENTITY_CONFIG.interaction.acknowledgeMs);
      engagement.commitAfter = mix(
        ENTITY_CONFIG.interaction.unfamiliarCommitMs,
        ENTITY_CONFIG.interaction.familiarCommitMs,
        familiarity,
      );
      engagement.acknowledgeAfter = Math.min(engagement.acknowledgeAfter, engagement.commitAfter - 90);
      engagement.responded = false;
    }
    while (this.projectEngagements.size > 18) {
      const stale = [...this.projectEngagements.values()]
        .filter((entry) => !entry.hover && !entry.focus)
        .sort((left, right) => left.lastSignalAt - right.lastSignalAt)[0];
      if (!stale) break;
      this.projectEngagements.delete(stale.targetId);
    }
  }

  private endProjectEngagement(targetId: string, channel: 'hover' | 'focus', now: number): void {
    const engagement = this.projectEngagements.get(targetId);
    if (!engagement) return;
    engagement[channel] = false;
    engagement.lastSignalAt = now;
  }

  private targetFamiliarity(targetId: string): number {
    const memory = this.brain.getMemory().find((entry) => entry.targetId === targetId);
    if (!memory) return 0;
    const repeated = clamp((memory.hoverCount + memory.focusCount) / 6);
    const activated = memory.activationCount > 0 ? 0.2 : 0;
    return clamp(memory.affinity * 2.4 + repeated * 0.54 + activated);
  }

  private onScroll(): void {
    const now = performance.now();
    const starting = !this.scroll.lastEventAt;
    const elapsed = Math.max(12, now - this.scroll.lastAt);
    const nextY = scrollY;
    const velocity = (nextY - this.scroll.y) / elapsed * 1000;
    const acceleration = (velocity - this.scroll.velocity) / elapsed * 1000;
    this.scroll.acceleration = mix(this.scroll.acceleration, acceleration, 0.24);
    this.scroll.velocity = mix(this.scroll.velocity, velocity, 0.32);
    this.scroll.energy = clamp(this.scroll.energy + Math.abs(velocity) / 1800, 0, 1.6);
    this.scroll.origin = clamp(this.pointer.y / Math.max(1, innerHeight));
    this.scroll.y = nextY;
    this.scroll.lastAt = now;
    this.scroll.lastEventAt = now;
    if (starting) {
      this.enqueue({
        type: 'SCROLL_START',
        timestamp: now,
        positionViewport: { x: this.pointer.x, y: this.pointer.y },
        velocityViewport: { x: 0, y: this.scroll.velocity },
        salience: clamp(Math.abs(this.scroll.velocity) / 1200, 0.12, 1),
        source: 'scroll',
      });
    }
    this.enqueue({
      type: 'SCROLL_IMPULSE',
      timestamp: now,
      positionViewport: { x: this.pointer.x, y: this.pointer.y },
      velocityViewport: { x: 0, y: this.scroll.velocity },
      salience: clamp(Math.abs(velocity) / 1200, 0.08, 1),
      source: 'scroll',
    });
  }

  private updateScroll(seconds: number): void {
    this.scroll.energy *= Math.exp(-seconds * 1.8);
    this.scroll.velocity *= Math.exp(-seconds * 2.4);
    this.scroll.acceleration *= Math.exp(-seconds * 3.2);
    if (this.scroll.lastEventAt && performance.now() - this.scroll.lastEventAt > 180 && Math.abs(this.scroll.velocity) < 12) {
      this.enqueue({ type: 'SCROLL_SETTLED', timestamp: performance.now(), salience: 0.25, source: 'scroll' });
      this.scroll.lastEventAt = 0;
    }
  }

  private beginSpatialTransition(mode: SpatialMode, from: Vec2, target: Vec2, duration: number, now: number): void {
    this.spatialMode = mode;
    this.transitionStart = now;
    this.transitionDuration = Math.max(1, duration);
    this.transitionProgress = 0;
    this.transitionFrom = { ...from };
    this.transitionTarget = { ...target };
    this.anchorVelocity.x = 0;
    this.anchorVelocity.y = 0;
  }

  private updateSpatialMode(time: number, seconds: number, containment: RectLike): void {
    if (this.spatialMode === 'SEALED') {
      const target = rectCenter(containment);
      const stiffness = this.reducedMotion.matches ? 22 : 8;
      const damping = this.reducedMotion.matches ? 9 : 5.2;
      [this.stableAnchor.x, this.anchorVelocity.x] = springStep(this.stableAnchor.x, this.anchorVelocity.x, target.x, stiffness, damping, seconds);
      [this.stableAnchor.y, this.anchorVelocity.y] = springStep(this.stableAnchor.y, this.anchorVelocity.y, target.y, stiffness, damping, seconds);
      this.transitionFrom = { ...this.stableAnchor };
      this.transitionTarget = { ...this.stableAnchor };
      this.transitionProgress = 0;
      return;
    }
    if (!['RELEASING', 'RELOCATING', 'RETURNING', 'HIDDEN'].includes(this.spatialMode)) return;
    this.transitionProgress = clamp((time - this.transitionStart) / this.transitionDuration);
    if (this.spatialMode === 'RELEASING' && this.transitionProgress < 0.72) {
      const layoutRevision = this.occupancy.getSnapshot().revision;
      if (layoutRevision !== this.lastReleaseLayoutRevision) {
        this.lastReleaseLayoutRevision = layoutRevision;
        const adjusted = this.chooseFreeAnchor(false, this.activeAttention.id, true);
        if (!adjusted.hardRejected) {
          this.compactObservation = this.selectedAnchorCompact;
          this.transitionTarget = { ...adjusted.position };
          this.frame.activeAnchorId = adjusted.id;
        }
      }
    }
    if (this.transitionProgress < 1) return;
    if (this.spatialMode === 'RELEASING' || this.spatialMode === 'RELOCATING') {
      const completedMode = this.spatialMode;
      this.stableAnchor = { ...this.transitionTarget };
      this.occupancy.rememberAnchor(this.transitionFrom);
      this.spatialMode = 'FREE';
      this.lastRelocationAt = time;
      this.nextRelocationAt = time + (completedMode === 'RELEASING'
        ? this.rng.range(...ENTITY_CONFIG.interaction.firstRoamSeconds)
        : this.rng.range(...ENTITY_CONFIG.interaction.laterRoamSeconds)) * 1000;
      if (completedMode === 'RELEASING') {
        this.nextSurveyAt = time + this.rng.range(...ENTITY_CONFIG.interaction.firstSurveySeconds) * 1000;
      }
      this.primeSettledPresence(time);
    } else if (this.spatialMode === 'RETURNING') {
      this.stableAnchor = rectCenter(containment);
      this.spatialMode = 'SEALED';
    } else if (this.spatialMode === 'HIDDEN') {
      this.frame.visible = false;
      this.frame.simulationPaused = true;
      this.frame.enabled = this.requestedEnabled;
      this.transitionProgress = 1;
      return;
    }
    this.transitionProgress = 0;
    this.transitionFrom = { ...this.stableAnchor };
    this.transitionTarget = { ...this.stableAnchor };
  }

  private maybeRecoverFromOccupancyHide(time: number): void {
    if (
      this.spatialMode !== 'HIDDEN' ||
      this.hiddenReason !== 'occupancy' ||
      !this.requestedEnabled ||
      this.transitionProgress < 1 ||
      time < this.nextReleaseAttemptAt
    ) return;
    const engagement = this.activeProjectEngagement();
    const selected = this.chooseFreeAnchor(false, engagement?.targetId || this.activeAttention.id, true);
    if (selected.hardRejected) {
      this.nextReleaseAttemptAt = time + this.rng.range(700, 1500);
      return;
    }
    this.hiddenReason = null;
    this.compactObservation = this.selectedAnchorCompact;
    this.stableAnchor = { ...selected.position };
    this.frame.formCoherence = Math.min(this.frame.formCoherence, 0.1);
    this.frame.visible = true;
    this.frame.simulationPaused = false;
    this.frame.activeAnchorId = selected.id;
    this.beginSpatialTransition(
      'RELOCATING',
      selected.position,
      selected.position,
      this.rng.range(2200, 3600),
      time,
    );
  }

  private visualAnchor(): Vec2 {
    if (['RELEASING', 'RELOCATING', 'RETURNING'].includes(this.spatialMode)) {
      const progress = smoothstep(this.transitionProgress);
      return {
        x: mix(this.transitionFrom.x, this.transitionTarget.x, progress),
        y: mix(this.transitionFrom.y, this.transitionTarget.y, progress),
      };
    }
    return { ...this.stableAnchor };
  }

  private fieldSize(compact = this.compactObservation): { width: number; height: number } {
    const mobile = innerWidth < 700;
    if (mobile) {
      const width = compact ? clamp(innerWidth * 0.3, 104, 126) : clamp(innerWidth * 0.35, 112, 142);
      return { width, height: width * ENTITY_CONFIG.anchors.fieldAspect };
    }
    if (compact) {
      const width = innerWidth < 1050 ? 164 : 178;
      return { width, height: width * ENTITY_CONFIG.anchors.fieldAspect };
    }
    const preferred = innerWidth < 1050
      ? 220
      : innerWidth < 1600
        ? ENTITY_CONFIG.anchors.fieldWidth.min
        : ENTITY_CONFIG.anchors.fieldWidth.preferred;
    const width = clamp(preferred, ENTITY_CONFIG.anchors.fieldWidth.min, ENTITY_CONFIG.anchors.fieldWidth.max);
    return { width, height: width * ENTITY_CONFIG.anchors.fieldAspect };
  }

  private specimenForSection(sectionId: string): HTMLElement | null {
    const specimen = document.querySelector<HTMLElement>(
      `[data-entity-specimen="section:${CSS.escape(sectionId)}"]`,
    );
    if (!specimen) return null;
    const rect = specimen.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
      rect.right > 0 && rect.left < innerWidth
      ? specimen
      : null;
  }

  private specimenSectionFromTarget(targetId: string | null): string | null {
    return targetId?.startsWith('specimen:') ? targetId.slice('specimen:'.length) : null;
  }

  private specimenKindForSection(sectionId: string): SpecimenKind | null {
    const kind = this.specimenForSection(sectionId)?.dataset.specimen;
    return isSpecimenKind(kind) ? kind : null;
  }

  private chooseFreeAnchor(
    preferNovel = false,
    targetId: string | null = this.activeAttention.id,
    allowCompact = false,
  ): AnchorCandidate {
    this.selectedAnchorCompact = false;
    let size = this.fieldSize(false);
    const specimenSection = this.specimenSectionFromTarget(targetId);
    const interestElement = targetId
      ? this.targetElements.get(targetId) || (specimenSection ? this.specimenForSection(specimenSection) : null)
      : null;
    const interestPosition = interestElement?.isConnected ? elementPosition(interestElement) : undefined;
    const sectionId = specimenSection || this.currentVisibleSection || document.documentElement.dataset.activeSection || undefined;
    const projectTargetId = interestElement && projectInterest(interestElement) ? targetId || undefined : undefined;
    let selected = this.occupancy.chooseAnchor(
      this.visualAnchor(),
      { x: this.pointer.x, y: this.pointer.y },
      size,
      {
        interestPosition,
        cognitiveState: this.cognitiveState,
        interestTargetId: projectTargetId,
        activeSectionId: sectionId,
      },
    );
    if (selected.hardRejected && allowCompact) {
      size = this.fieldSize(true);
      const compactSelected = this.occupancy.chooseAnchor(
        this.visualAnchor(),
        { x: this.pointer.x, y: this.pointer.y },
        size,
        {
          interestPosition,
          cognitiveState: this.cognitiveState,
          interestTargetId: projectTargetId,
          activeSectionId: sectionId,
        },
      );
      if (!compactSelected.hardRejected || compactSelected.score > selected.score) {
        selected = compactSelected;
        this.selectedAnchorCompact = true;
      }
    }
    if (!preferNovel || selected.hardRejected) return selected;
    const minimumTravel = Math.max(120, size.width * 0.55);
    const pathCorridor = Math.min(size.width, size.height) * 0.18;
    const scoreWindow = mix(1.65, 2.8, this.brain.internal.curiosity);
    const diagonal = Math.max(1, Math.hypot(innerWidth, innerHeight));
    const alternativesWithRoutes = this.occupancy.getSnapshot().candidates
      .filter((candidate) => !candidate.hardRejected)
      .map((candidate) => ({
        candidate,
        distance: Math.hypot(candidate.position.x - this.stableAnchor.x, candidate.position.y - this.stableAnchor.y),
        oppositeWeight: oppositeSideNoveltyWeight(this.stableAnchor.x, candidate.position.x, innerWidth),
      }))
      .filter(({ candidate, distance, oppositeWeight }) => {
        const safeDissolvedCrossing = oppositeWeight >= 3 && distance >= size.width * 1.3;
        return distance >= minimumTravel &&
          candidate.score >= selected.score - scoreWindow * (oppositeWeight >= 3 ? 1.45 : 1) &&
          (safeDissolvedCrossing || relocationPathIsClear(
            this.stableAnchor,
            candidate.position,
            this.occupancy.getSnapshot().obstacles,
            pathCorridor,
          ));
      });
    const oppositeAlternatives = alternativesWithRoutes.filter((entry) => entry.oppositeWeight >= 3);
    const alternatives = (oppositeAlternatives.length ? oppositeAlternatives : alternativesWithRoutes).slice(0, 12);
    if (!alternatives.length) return selected;
    const weighted = alternatives.map(({ candidate, distance, oppositeWeight }) => ({
      candidate,
      weight: Math.exp((candidate.score - selected.score) * 1.35) *
        (1 + clamp(distance / diagonal) * mix(0.35, 1.1, this.brain.internal.curiosity)) * oppositeWeight,
    }));
    let ticket = this.rng.next() * weighted.reduce((total, entry) => total + entry.weight, 0);
    for (const entry of weighted) {
      ticket -= entry.weight;
      if (ticket <= 0) return entry.candidate;
    }
    return weighted[weighted.length - 1].candidate;
  }

  private chooseSpecimenAnchor(sectionId: string, allowCompact = true): AnchorCandidate | null {
    const specimen = this.specimenForSection(sectionId);
    if (!specimen) return null;
    const interestPosition = elementPosition(specimen);
    const hostPrefix = `host:section:${sectionId}:`;
    this.selectedAnchorCompact = false;
    const evaluate = (compact: boolean): { host: AnchorCandidate | null; approach: AnchorCandidate | null } => {
      const size = this.fieldSize(compact);
      this.occupancy.chooseAnchor(
        this.visualAnchor(),
        { x: this.pointer.x, y: this.pointer.y },
        size,
        {
          interestPosition,
          cognitiveState: 'CURIOUS',
          activeSectionId: sectionId,
          specimenSectionId: sectionId,
        },
      );
      const safe = this.occupancy.getSnapshot().candidates.filter((candidate) => !candidate.hardRejected);
      const host = safe
        .filter((candidate) => candidate.id.startsWith(hostPrefix) && !candidate.hardRejected)
        .sort((left, right) => right.score - left.score)[0] || null;
      return { host, approach: null };
    };
    const full = evaluate(false);
    if (full.host) return full.host;
    if (!allowCompact) return null;
    const compact = evaluate(true);
    if (compact.host) {
      this.selectedAnchorCompact = true;
      return compact.host;
    }
    return null;
  }

  private activeProjectEngagement(): ProjectEngagement | null {
    return [...this.projectEngagements.values()]
      .filter((engagement) => (engagement.hover || engagement.focus) && engagement.element.isConnected)
      .sort((left, right) => right.lastSignalAt - left.lastSignalAt)[0] || null;
  }

  private startEpisode(
    kind: BehaviorEpisodeKind,
    phase: BehaviorPhase,
    targetId: string | null,
    now: number,
    phaseDuration: number,
    options: {
      hostId?: string | null;
      destination?: Vec2 | null;
      commitment?: number;
      specimenKind?: SpecimenKind | null;
    } = {},
  ): void {
    this.episode = {
      kind,
      phase,
      targetId,
      startedAt: now,
      phaseStartedAt: now,
      phaseDuration: Math.max(1, phaseDuration),
      commitment: options.commitment ?? 0,
      hostId: options.hostId ?? null,
      destination: options.destination ? { ...options.destination } : null,
      holdUntil: 0,
      specimenKind: options.specimenKind ?? null,
    };
    this.lastVisibleActionAt = now;
  }

  private setEpisodePhase(phase: BehaviorPhase, now: number, duration: number): void {
    if (!this.episode) return;
    this.episode.phase = phase;
    this.episode.phaseStartedAt = now;
    this.episode.phaseDuration = Math.max(1, duration);
    this.lastVisibleActionAt = now;
  }

  private clearEpisode(now: number): void {
    const completed = this.episode;
    this.episode = null;
    if (completed?.kind === 'SPECIMEN') {
      const sectionId = this.specimenSectionFromTarget(completed.targetId);
      if (sectionId) {
        this.specimenNextEligible.set(
          sectionId,
          now + this.rng.range(...ENTITY_CONFIG.interaction.specimenCooldownSeconds) * 1000,
        );
      }
      this.nextSurveyAt = now + this.rng.range(10000, 19000);
    } else if (completed?.kind === 'SURVEY') {
      this.nextSurveyAt = now + this.rng.range(9000, 18000);
    } else if (completed && ['INSPECT', 'ROAM', 'DECLINE'].includes(completed.kind)) {
      this.nextSurveyAt = Math.max(this.nextSurveyAt, now + this.rng.range(5500, 11000));
    }
  }

  private directAttention(targetId: string, confidence = 0.86): void {
    let element = this.targetElements.get(targetId);
    let kind: AttentionSelection['kind'] = element && projectInterest(element) ? 'project' : 'region';
    if (!element?.isConnected && targetId.startsWith('specimen:')) {
      const sectionId = targetId.slice('specimen:'.length);
      element = this.specimenForSection(sectionId) || undefined;
      kind = 'region';
    } else if (!element?.isConnected && targetId.startsWith('section:')) {
      const sectionId = targetId.slice('section:'.length);
      const section = document.querySelector<HTMLElement>(`[data-section="${CSS.escape(sectionId)}"]`);
      element = section?.querySelector<HTMLElement>('h1,h2,h3') || section || undefined;
      kind = 'section';
    }
    if (!element?.isConnected) return;
    this.activeAttention = {
      id: targetId,
      secondaryId: this.activeAttention.id && this.activeAttention.id !== targetId ? this.activeAttention.id : null,
      kind,
      position: elementPosition(element),
      score: Math.max(this.activeAttention.score, confidence),
      confidence,
      abandoned: false,
    };
  }

  private beginInspection(engagement: ProjectEngagement, now: number): void {
    if (this.spatialMode === 'SEALED' || this.spatialMode === 'RETURNING' || this.spatialMode === 'RELEASING') {
      if (this.episode) this.episode.commitment = 0.78;
      return;
    }
    if (this.spatialMode === 'HIDDEN' && this.hiddenReason === 'disabled') {
      engagement.responded = true;
      this.beginDecline(engagement.targetId, now);
      return;
    }
    const selected = this.chooseFreeAnchor(false, engagement.targetId, true);
    if (selected.hardRejected) {
      engagement.responded = true;
      this.beginDecline(engagement.targetId, now);
      return;
    }
    // Reconstructing inside a project in the newly visible section already
    // satisfies the section-follow impulse; do not immediately roam away.
    this.sectionRelocationEligibleAt = 0;
    this.pendingSectionId = null;
    this.compactObservation = this.selectedAnchorCompact;
    const distance = Math.hypot(selected.position.x - this.visualAnchor().x, selected.position.y - this.visualAnchor().y);
    this.startEpisode('INSPECT', 'TRANSIT', engagement.targetId, now, 1, {
      hostId: selected.id.startsWith('host:') ? selected.id : null,
      destination: selected.position,
      commitment: 1,
    });
    this.frame.activeAnchorId = selected.id;
    this.hiddenReason = null;
    this.frame.visible = true;
    this.frame.simulationPaused = false;
    if (this.reducedMotion.matches || distance < 54) {
      this.stableAnchor = { ...selected.position };
      this.transitionFrom = { ...selected.position };
      this.transitionTarget = { ...selected.position };
      this.transitionProgress = 0;
      this.spatialMode = 'FREE';
      this.setEpisodePhase('SETTLE', now, this.rng.range(...ENTITY_CONFIG.interaction.inspectionSettleMs));
      return;
    }
    const from = this.spatialMode === 'HIDDEN' ? selected.position : this.visualAnchor();
    if (this.spatialMode === 'HIDDEN') this.frame.formCoherence = Math.min(this.frame.formCoherence, 0.08);
    const duration = this.rng.range(...ENTITY_CONFIG.relocation.durationMs) * mix(0.88, 0.72, this.brain.internal.confidence);
    this.beginSpatialTransition('RELOCATING', from, selected.position, duration, now);
  }

  private beginSpecimenInspection(sectionId: string, now: number): boolean {
    const specimenKind = this.specimenKindForSection(sectionId);
    if (this.spatialMode !== 'FREE' || !specimenKind) return false;
    const targetId = `specimen:${sectionId}`;
    const selected = this.chooseSpecimenAnchor(sectionId, true);
    if (!selected && !this.reducedMotion.matches) return false;
    const destination = selected?.position || this.visualAnchor();
    const distance = Math.hypot(destination.x - this.visualAnchor().x, destination.y - this.visualAnchor().y);
    this.compactObservation = selected ? this.selectedAnchorCompact : this.compactObservation;
    this.sectionRelocationEligibleAt = 0;
    this.pendingSectionId = null;
    this.startEpisode('SPECIMEN', 'ORIENT', targetId, now, this.rng.range(520, 920), {
      hostId: selected?.id || null,
      destination,
      commitment: 0,
      specimenKind,
    });
    if (selected) this.frame.activeAnchorId = selected.id;
    if (this.reducedMotion.matches || distance < 54) {
      this.setEpisodePhase('SETTLE', now, this.rng.range(520, 880));
    }
    return true;
  }

  private advanceSpecimen(now: number): void {
    const episode = this.episode;
    if (!episode || episode.kind !== 'SPECIMEN' || !episode.destination || !episode.targetId) return;
    const specimenKind = episode.specimenKind;
    this.directAttention(episode.targetId, 0.98);
    const direction = Math.sign(this.activeAttention.position.x - this.visualAnchor().x) || 1;
    const specimenTilt = specimenKind === 'galaxy'
      ? -direction * 0.48
      : specimenKind === 'black-hole'
        ? direction * 0.16
        : specimenKind === 'orbit'
          ? -direction * 0.38
          : specimenKind === 'graph'
            ? -direction * 0.14
            : -direction * 0.26;
    this.postureTargets.headTilt = mix(this.postureTargets.headTilt, specimenTilt, 0.12);
    this.postureTargets.surfaceFlow = Math.max(
      this.postureTargets.surfaceFlow,
      specimenKind === 'graph' || specimenKind === 'relay' ? 0.82 : 0.64,
    );
    if (episode.phase === 'ORIENT') {
      this.cognitiveState = this.forcedCognitiveState || 'CURIOUS';
      this.motorIntent = 'ORIENT';
      episode.commitment = smoothstep(clamp((now - episode.phaseStartedAt) / episode.phaseDuration));
      if (now - episode.phaseStartedAt < episode.phaseDuration) return;
      const duration = this.rng.range(...ENTITY_CONFIG.relocation.durationMs) * mix(0.98, 0.8, this.brain.internal.curiosity);
      this.beginSpatialTransition('RELOCATING', this.visualAnchor(), episode.destination, duration, now);
      this.frame.activeAnchorId = episode.hostId || this.frame.activeAnchorId;
      this.setEpisodePhase('TRANSIT', now, duration);
      return;
    }
    if (episode.phase === 'TRANSIT') {
      this.cognitiveState = this.forcedCognitiveState || (this.transitionProgress < 0.56 ? 'FRAGMENTING' : 'REFORMING');
      this.motorIntent = this.transitionProgress < 0.56 ? 'DISSOLVE' : 'REASSEMBLE';
      if (this.spatialMode === 'FREE') this.setEpisodePhase('SETTLE', now, this.rng.range(650, 1100));
      return;
    }
    if (episode.phase === 'SETTLE') {
      this.cognitiveState = this.forcedCognitiveState || 'REFORMING';
      this.motorIntent = 'REASSEMBLE';
      episode.commitment = 0.82;
      if (now - episode.phaseStartedAt < episode.phaseDuration) return;
      this.setEpisodePhase('ENGAGE', now, this.rng.range(...ENTITY_CONFIG.interaction.specimenHoldMs));
      episode.holdUntil = now + episode.phaseDuration;
      if (specimenKind && now - this.lastEvidenceMessageAt > 30000 && this.rng.chance(0.46)) {
        this.evidenceMessagePending = SPECIMEN_MESSAGES[specimenKind];
      }
      return;
    }
    if (episode.phase === 'ENGAGE') {
      this.cognitiveState = this.forcedCognitiveState || 'INSPECTING';
      this.motorIntent = specimenKind === 'relay'
        ? 'REACH'
        : specimenKind === 'black-hole'
          ? 'WITHDRAW'
          : specimenKind === 'graph'
            ? 'TRACK'
            : 'ORIENT';
      episode.commitment = 1;
      const specimenLean = specimenKind === 'black-hole'
        ? -direction * 0.14
        : specimenKind === 'galaxy' || specimenKind === 'orbit'
          ? direction * 0.08
          : direction * 0.2;
      this.postureTargets.lean = mix(this.postureTargets.lean, specimenLean, 0.08);
      this.postureTargets.surfaceFlow = Math.max(this.postureTargets.surfaceFlow, 0.9);
      if (now < episode.holdUntil) return;
      this.setEpisodePhase('EXIT', now, this.rng.range(680, 1100));
      return;
    }
    this.cognitiveState = this.forcedCognitiveState || 'OBSERVING';
    this.motorIntent = 'WITHDRAW';
    episode.commitment = 1 - clamp((now - episode.phaseStartedAt) / episode.phaseDuration);
    if (now - episode.phaseStartedAt >= episode.phaseDuration) this.clearEpisode(now);
  }

  private beginDecline(targetId: string | null, now: number): void {
    if (this.episode?.kind === 'DECLINE') return;
    if (now - this.lastDeclineAt < 4500) {
      this.episode = null;
      return;
    }
    this.lastDeclineAt = now;
    const engagement = targetId ? this.projectEngagements.get(targetId) : null;
    if (engagement) engagement.responded = true;
    this.startEpisode('DECLINE', 'ORIENT', targetId, now, this.rng.range(320, 620), { commitment: 0.34 });
  }

  private advanceAcknowledge(engagement: ProjectEngagement, now: number): void {
    const episode = this.episode;
    if (!episode) return;
    this.directAttention(engagement.targetId, 0.96);
    if (episode.phase === 'EXIT') {
      this.cognitiveState = this.forcedCognitiveState || 'OBSERVING';
      this.motorIntent = 'WITHDRAW';
      episode.commitment = 1 - clamp((now - episode.phaseStartedAt) / episode.phaseDuration);
      if (now - episode.phaseStartedAt >= episode.phaseDuration) this.clearEpisode(now);
      return;
    }
    this.cognitiveState = this.forcedCognitiveState || 'CURIOUS';
    this.motorIntent = 'ORIENT';
    const elapsed = now - engagement.startedAt;
    episode.commitment = clamp(elapsed / Math.max(1, engagement.commitAfter));
    const direction = Math.sign(elementPosition(engagement.element).x - this.visualAnchor().x) || 1;
    this.postureTargets.headTilt = mix(this.postureTargets.headTilt, direction * -0.48, 0.18);
    this.postureTargets.lean = mix(this.postureTargets.lean, direction * 0.17, 0.12);
    this.postureTargets.surfaceFlow = Math.max(this.postureTargets.surfaceFlow, 0.52 + episode.commitment * 0.28);
    if (episode.phase === 'ORIENT' && elapsed >= engagement.acknowledgeAfter) {
      this.setEpisodePhase('COMMIT', now, Math.max(90, engagement.commitAfter - engagement.acknowledgeAfter));
    }
    if (elapsed < engagement.commitAfter) return;
    if (this.spatialMode === 'RELOCATING' || this.spatialMode === 'RELEASING') return;
    if (this.spatialMode === 'SEALED' || this.spatialMode === 'RETURNING') {
      if (elapsed > engagement.commitAfter + 1200) {
        engagement.responded = true;
        this.setEpisodePhase('EXIT', now, 700);
      }
      return;
    }
    this.beginInspection(engagement, now);
  }

  private advanceInspection(engagementActive: boolean, now: number): void {
    const episode = this.episode;
    if (!episode || episode.kind !== 'INSPECT') return;
    if (episode.targetId) this.directAttention(episode.targetId, 0.98);
    if (episode.phase === 'TRANSIT') {
      this.cognitiveState = this.forcedCognitiveState || (this.transitionProgress < 0.56 ? 'FRAGMENTING' : 'REFORMING');
      this.motorIntent = this.transitionProgress < 0.56 ? 'DISSOLVE' : 'REASSEMBLE';
      if (this.spatialMode === 'FREE') {
        this.setEpisodePhase('SETTLE', now, this.rng.range(...ENTITY_CONFIG.interaction.inspectionSettleMs));
      }
      return;
    }
    if (episode.phase === 'SETTLE') {
      this.cognitiveState = this.forcedCognitiveState || 'REFORMING';
      this.motorIntent = 'REASSEMBLE';
      episode.commitment = 1;
      if (now - episode.phaseStartedAt < episode.phaseDuration) return;
      if (!engagementActive) {
        this.setEpisodePhase('ENGAGE', now, this.rng.range(850, 1350));
      } else {
        this.setEpisodePhase('ENGAGE', now, this.rng.range(...ENTITY_CONFIG.interaction.inspectionHoldMs));
      }
      episode.holdUntil = now + episode.phaseDuration;
      const familiarity = episode.targetId ? this.targetFamiliarity(episode.targetId) : 0;
      if (
        episode.targetId &&
        familiarity > 0.34 &&
        now - this.lastEvidenceMessageAt > 42000 &&
        (episode.targetId !== this.lastEvidenceTarget || now - this.lastEvidenceMessageAt > 90000) &&
        this.rng.chance(0.48)
      ) {
        this.evidenceMessagePending = familiarity > 0.7 ? 'pattern recognized // familiarity rising' : 'memory trace reacquired';
        this.lastEvidenceTarget = episode.targetId;
      }
      return;
    }
    if (episode.phase === 'ENGAGE') {
      this.cognitiveState = this.forcedCognitiveState || 'INSPECTING';
      this.motorIntent = 'REACH';
      episode.commitment = 1;
      this.postureTargets.lean = mix(this.postureTargets.lean, 0.24, 0.08);
      this.postureTargets.surfaceFlow = Math.max(this.postureTargets.surfaceFlow, 0.76);
      if (now < episode.holdUntil) return;
      this.setEpisodePhase('EXIT', now, this.rng.range(720, 1180));
      return;
    }
    if (episode.phase === 'EXIT') {
      this.cognitiveState = this.forcedCognitiveState || 'OBSERVING';
      this.motorIntent = 'WITHDRAW';
      episode.commitment = 1 - clamp((now - episode.phaseStartedAt) / episode.phaseDuration);
      if (now - episode.phaseStartedAt < episode.phaseDuration) return;
      const engagement = episode.targetId ? this.projectEngagements.get(episode.targetId) : null;
      if (engagement) engagement.responded = true;
      this.clearEpisode(now);
    }
  }

  private advanceRoam(now: number): void {
    const episode = this.episode;
    if (!episode || episode.kind !== 'ROAM' || !episode.destination) return;
    if (episode.targetId?.startsWith('section:')) this.directAttention(episode.targetId, 0.78);
    else {
      this.activeAttention = {
        ...this.activeAttention,
        id: episode.targetId,
        kind: 'quiet',
        position: { ...episode.destination },
        confidence: 0.7,
        abandoned: false,
      };
    }
    if (episode.phase === 'ORIENT') {
      this.cognitiveState = this.forcedCognitiveState || 'CURIOUS';
      this.motorIntent = 'ORIENT';
      episode.commitment = smoothstep(clamp((now - episode.phaseStartedAt) / episode.phaseDuration));
      if (now - episode.phaseStartedAt < episode.phaseDuration) return;
      if (this.reducedMotion.matches) {
        this.stableAnchor = { ...episode.destination };
        this.transitionFrom = { ...episode.destination };
        this.transitionTarget = { ...episode.destination };
        this.frame.activeAnchorId = episode.hostId || this.frame.activeAnchorId;
        this.setEpisodePhase('SETTLE', now, this.rng.range(650, 1050));
        return;
      }
      const duration = this.rng.range(...ENTITY_CONFIG.relocation.durationMs) * mix(1.06, 0.88, this.brain.internal.arousal);
      this.beginSpatialTransition('RELOCATING', this.visualAnchor(), episode.destination, duration, now);
      this.frame.activeAnchorId = episode.hostId || this.frame.activeAnchorId;
      this.setEpisodePhase('TRANSIT', now, duration);
      return;
    }
    if (episode.phase === 'TRANSIT') {
      this.cognitiveState = this.forcedCognitiveState || (this.transitionProgress < 0.56 ? 'FRAGMENTING' : 'REFORMING');
      this.motorIntent = this.transitionProgress < 0.56 ? 'DISSOLVE' : 'REASSEMBLE';
      if (this.spatialMode === 'FREE') this.setEpisodePhase('SETTLE', now, this.rng.range(650, 1150));
      return;
    }
    if (episode.phase === 'SETTLE') {
      this.cognitiveState = this.forcedCognitiveState || 'REFORMING';
      this.motorIntent = 'REASSEMBLE';
      if (now - episode.phaseStartedAt < episode.phaseDuration) return;
      this.setEpisodePhase('EXIT', now, this.rng.range(420, 760));
      return;
    }
    this.cognitiveState = this.forcedCognitiveState || 'OBSERVING';
    this.motorIntent = 'IDLE';
    if (now - episode.phaseStartedAt >= episode.phaseDuration) this.clearEpisode(now);
  }

  private advanceAmbientEpisode(now: number): void {
    const episode = this.episode;
    if (!episode) return;
    const elapsed = now - episode.phaseStartedAt;
    if (episode.kind === 'SURVEY') {
      if (episode.targetId) this.directAttention(episode.targetId, 0.72);
      this.cognitiveState = this.forcedCognitiveState || 'OBSERVING';
      this.motorIntent = episode.phase === 'EXIT' ? 'IDLE' : 'ORIENT';
      episode.commitment = episode.phase === 'EXIT'
        ? 1 - clamp(elapsed / episode.phaseDuration)
        : smoothstep(clamp(elapsed / episode.phaseDuration));
      this.postureTargets.headTilt = mix(this.postureTargets.headTilt, -0.24, 0.08);
      this.postureTargets.surfaceFlow = Math.max(this.postureTargets.surfaceFlow, 0.42);
      if (elapsed < episode.phaseDuration) return;
      if (episode.phase === 'ORIENT') this.setEpisodePhase('SETTLE', now, this.rng.range(900, 1800));
      else if (episode.phase === 'SETTLE') this.setEpisodePhase('EXIT', now, this.rng.range(420, 720));
      else this.clearEpisode(now);
      return;
    }
    if (episode.kind === 'DECLINE') {
      this.cognitiveState = this.forcedCognitiveState || 'OBSERVING';
      this.motorIntent = episode.phase === 'ORIENT' ? 'ORIENT' : 'WITHDRAW';
      episode.commitment = episode.phase === 'ORIENT' ? 0.34 : 1 - clamp(elapsed / episode.phaseDuration);
      if (episode.phase === 'ORIENT' && episode.targetId) this.directAttention(episode.targetId, 0.54);
      if (episode.phase === 'EXIT') {
        const anchor = this.visualAnchor();
        const away = this.activeAttention.position.x >= anchor.x ? -1 : 1;
        this.activeAttention = {
          ...this.activeAttention,
          id: 'autonomous:decline',
          kind: 'drift',
          position: { x: anchor.x + away * innerWidth * 0.2, y: anchor.y - innerHeight * 0.08 },
          confidence: 0.46,
          abandoned: true,
        };
        this.postureTargets.headTilt = mix(this.postureTargets.headTilt, away * 0.32, 0.1);
      }
      if (elapsed < episode.phaseDuration) return;
      if (episode.phase === 'ORIENT') this.setEpisodePhase('EXIT', now, this.rng.range(650, 1050));
      else this.clearEpisode(now);
      return;
    }
    if (episode.kind === 'SELF_MAINTAIN') {
      this.motorIntent = this.cognitiveState === 'REFORMING' ? 'REASSEMBLE' : 'DISSOLVE';
      episode.commitment = smoothstep(clamp(elapsed / episode.phaseDuration));
      if (elapsed >= episode.phaseDuration || !['FRAGMENTING', 'REFORMING', 'THINKING'].includes(this.cognitiveState)) {
        this.clearEpisode(now);
      }
    }
  }

  private updateBehaviorEpisode(now: number, _seconds: number): void {
    const engagement = this.activeProjectEngagement();
    const episodeTargetsEngagement = Boolean(
      engagement && this.episode?.targetId === engagement.targetId &&
      (this.episode.kind === 'ACKNOWLEDGE' || this.episode.kind === 'INSPECT'),
    );
    if (engagement && !engagement.responded && !episodeTargetsEngagement) {
      this.startEpisode(
        'ACKNOWLEDGE',
        'ORIENT',
        engagement.targetId,
        now,
        engagement.acknowledgeAfter,
        { commitment: 0 },
      );
    }
    if (engagement && this.episode?.targetId === engagement.targetId) {
      if (this.episode.kind === 'ACKNOWLEDGE') this.advanceAcknowledge(engagement, now);
      else if (this.episode.kind === 'INSPECT') this.advanceInspection(true, now);
      return;
    }
    if (this.episode?.kind === 'ACKNOWLEDGE') {
      const abandoned = this.projectEngagements.get(this.episode.targetId || '');
      if (abandoned) abandoned.responded = true;
      this.beginDecline(this.episode.targetId, now);
      this.advanceAmbientEpisode(now);
      return;
    }
    if (this.episode?.kind === 'INSPECT') {
      this.advanceInspection(false, now);
      return;
    }
    if (this.episode?.kind === 'SPECIMEN') {
      this.advanceSpecimen(now);
      return;
    }
    if (this.episode?.kind === 'ROAM') {
      this.advanceRoam(now);
      return;
    }
    if (this.episode) {
      this.advanceAmbientEpisode(now);
      return;
    }
    if (
      this.spatialMode === 'FREE' &&
      now >= this.nextSurveyAt &&
      !this.scroll.lastEventAt &&
      this.brain.internal.arousal < 0.76
    ) {
      const sectionId = this.currentVisibleSection || document.documentElement.dataset.activeSection || null;
      const specimenEligible = sectionId && now >= (this.specimenNextEligible.get(sectionId) || 0);
      const firstEncounter = Boolean(sectionId && !this.specimenNextEligible.has(sectionId));
      if (
        specimenEligible &&
        (firstEncounter || this.rng.chance(0.58 + this.brain.internal.curiosity * 0.24)) &&
        this.beginSpecimenInspection(sectionId!, now)
      ) {
        this.advanceSpecimen(now);
        return;
      }
      this.startEpisode('SURVEY', 'ORIENT', sectionId ? `section:${sectionId}` : null, now, this.rng.range(620, 1050), {
        commitment: 0.42,
      });
      this.advanceAmbientEpisode(now);
      return;
    }
    if (['FRAGMENTING', 'REFORMING', 'THINKING'].includes(this.cognitiveState) && this.spatialMode === 'FREE') {
      this.startEpisode('SELF_MAINTAIN', 'ENGAGE', null, now, this.rng.range(2200, 4800), { commitment: 0.34 });
    }
  }

  private resolveAttention(time: number, brainTargetId: string | null, brainPosition: Vec2): AttentionSelection {
    const explicitChanged = brainTargetId !== this.lastBrainAttentionTarget;
    this.lastBrainAttentionTarget = brainTargetId;
    if (!explicitChanged && time < this.nextAttentionDecisionAt) {
      if (brainTargetId && this.activeAttention.id === brainTargetId) {
        this.activeAttention.position = { ...brainPosition };
      }
      return this.activeAttention;
    }

    const memory = this.brain.getMemory();
    const memoryByTarget = new Map(memory.map((entry) => [entry.targetId, entry]));
    const candidates: AttentionCandidate[] = [];
    if (brainTargetId) {
      const entry = memoryByTarget.get(brainTargetId);
      const element = this.targetElements.get(brainTargetId);
      candidates.push({
        id: brainTargetId,
        kind: element && projectInterest(element) ? 'project' : 'region',
        position: { ...brainPosition },
        salience: 0.9 + (entry?.activationCount ? 0.08 : 0),
        familiarity: entry?.affinity ?? 0,
        novelty: entry?.novelty ?? 0.7,
        uncertainty: entry?.uncertainty ?? 0.4,
        active: true,
        lastSeenAt: entry?.lastSeenAt ?? time,
      });
    }

    const sincePointer = this.pointer.lastAt ? time - this.pointer.lastAt : Infinity;
    const pointerDecay = Math.exp(-Math.max(0, sincePointer) / 1100);
    const pointerSpeed = Math.hypot(this.pointer.velocityX, this.pointer.velocityY) * pointerDecay;
    if (sincePointer < 3600) {
      candidates.push({
        id: 'pointer',
        kind: 'pointer',
        position: { x: this.pointer.x, y: this.pointer.y },
        salience: 0.2 + clamp(pointerSpeed / 1400) * 0.34,
        familiarity: 0.12,
        novelty: 0.14,
        uncertainty: clamp(pointerSpeed / 1700),
        active: sincePointer < 420,
        lastSeenAt: this.pointer.lastAt,
      });
    }

    const sectionId = this.currentVisibleSection || document.documentElement.dataset.activeSection || null;
    const sectionState = sectionId ? this.visibleSections.get(sectionId) : null;
    const section = sectionState?.element || (sectionId
      ? document.querySelector<HTMLElement>(`[data-section="${CSS.escape(sectionId)}"]`)
      : null);
    if (sectionId && section) {
      const heading = section.querySelector<HTMLElement>('h1,h2,h3') || section;
      const entry = memoryByTarget.get(`section:${sectionId}`);
      candidates.push({
        id: `section:${sectionId}`,
        kind: 'section',
        position: elementPosition(heading),
        salience: 0.25 + (sectionState?.ratio || 0) * 0.12,
        familiarity: entry?.affinity ?? 0,
        novelty: entry?.novelty ?? 0.86,
        uncertainty: entry?.uncertainty ?? 0.34,
        active: false,
        lastSeenAt: entry?.lastSeenAt ?? time,
      });
    }

    const familiarTargets = memory
      .filter((entry) => !entry.targetId.startsWith('section:') && entry.targetId !== brainTargetId)
      .filter((entry) => entry.affinity >= 0.1 || entry.activationCount > 0 || entry.hoverCount + entry.focusCount >= 3)
      .sort((left, right) => right.affinity - left.affinity)
      .slice(0, 3);
    for (const entry of familiarTargets) {
      let element = this.targetElements.get(entry.targetId);
      if (!element?.isConnected) {
        element = document.querySelector<HTMLElement>(`[data-entity-project="${CSS.escape(entry.targetId)}"]`) || undefined;
      }
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
      this.rememberTargetElement(entry.targetId, element);
      candidates.push({
        id: entry.targetId,
        kind: 'memory',
        position: elementPosition(element),
        salience: 0.2 + entry.affinity * 0.22,
        familiarity: entry.affinity,
        novelty: entry.novelty * 0.48,
        uncertainty: entry.uncertainty,
        active: false,
        lastSeenAt: entry.lastSeenAt,
      });
    }

    if (this.spatialMode !== 'SEALED') {
      candidates.push({
        id: 'containment',
        kind: 'containment',
        position: rectCenter(this.occupancy.getContainmentRect()),
        salience: 0.13,
        familiarity: 0.72,
        novelty: 0.04,
        uncertainty: 0.08,
        active: false,
        lastSeenAt: time,
      });
    }
    const quiet = this.occupancy.getSnapshot().candidates.find((candidate) => !candidate.hardRejected);
    if (quiet) {
      candidates.push({
        id: `quiet:${quiet.id}`,
        kind: 'quiet',
        position: { ...quiet.position },
        salience: 0.15,
        familiarity: 0.1,
        novelty: 0.58,
        uncertainty: 0.12,
        active: false,
        lastSeenAt: time,
      });
    }
    const driftPosition = {
      x: innerWidth * (0.48 + fractalNoise2(time * 0.000029, 12.1, this.frame.sessionSeed + 2251) * 0.24),
      y: innerHeight * (0.42 + fractalNoise2(time * 0.000023, 33.7, this.frame.sessionSeed + 2281) * 0.2),
    };
    candidates.push({
      id: 'autonomous:drift',
      kind: 'drift',
      position: driftPosition,
      salience: 0.14,
      familiarity: 0,
      novelty: 0.34,
      uncertainty: 0.18,
      active: false,
      lastSeenAt: time,
    });

    const selected = selectAttentionTarget(candidates, {
      now: time,
      seed: this.frame.sessionSeed,
      currentTargetId: this.activeAttention.id,
      curiosity: this.brain.internal.curiosity,
      fatigue: this.brain.internal.fatigue,
      confidence: this.brain.internal.confidence,
      attentionalCertainty: this.brain.internal.attentionConfidence,
      pointerSpeed,
    }, driftPosition);
    this.nextAttentionDecisionAt = time + this.rng.range(...ENTITY_CONFIG.interaction.autonomousAttentionSeconds) * 1000;
    return selected;
  }

  private maybeRelocate(time: number, pointerDistance: number): void {
    if (this.spatialMode !== 'FREE' || this.reducedMotion.matches || this.debugFreezeAnchor || this.episode) return;
    const occupancy = this.occupancy.getSnapshot();
    const layoutChanged = occupancy.revision !== this.lastLayoutRevision;
    this.lastLayoutRevision = occupancy.revision;
    const size = this.fieldSize();
    const interestElement = this.activeAttention.id ? this.targetElements.get(this.activeAttention.id) : null;
    const interestPosition = interestElement?.isConnected ? elementPosition(interestElement) : undefined;
    const currentScore = scoreAnchorCandidate({
      id: 'current',
      position: this.stableAnchor,
      viewport: { width: occupancy.width, height: occupancy.height },
      fieldSize: size,
      obstacles: occupancy.obstacles,
      currentAnchor: this.stableAnchor,
      pointer: { x: this.pointer.x, y: this.pointer.y },
      preferred: preferredAnchorPosition({ width: occupancy.width, height: occupancy.height }),
      interestPosition,
      cognitiveState: this.cognitiveState,
    });
    if (currentScore.hardRejected) {
      if (!this.unsafeAnchorSince) this.unsafeAnchorSince = time;
    } else {
      this.unsafeAnchorSince = 0;
    }
    const forcedAvoidance = currentScore.hardRejected &&
      (layoutChanged || time - this.unsafeAnchorSince >= ENTITY_CONFIG.relocation.forcedAvoidanceDelayMs);
    const curiosityPressure = this.brain.internal.curiosity * (1 - this.brain.internal.fatigue);
    const autonomousDecision = time >= this.nextRelocationAt &&
      fractalNoise2(time * 0.000043, this.frame.sessionSeed * 0.0001, this.frame.sessionSeed + 613) > 0.08 - curiosityPressure * 0.22;
    const sectionDecision = this.sectionRelocationEligibleAt > 0 && time >= this.sectionRelocationEligibleAt &&
      !this.scroll.lastEventAt && time - this.lastRelocationAt > 2200;
    const cursorAvoidance = pointerDistance < 82 && this.brain.internal.socialDistance > 0.68 && time - this.lastRelocationAt > 5000;
    if (!forcedAvoidance && !autonomousDecision && !sectionDecision && !cursorAvoidance) return;
    const sectionTarget = sectionDecision && this.pendingSectionId ? `section:${this.pendingSectionId}` : null;
    if (
      sectionDecision &&
      this.pendingSectionId &&
      time >= (this.specimenNextEligible.get(this.pendingSectionId) || 0) &&
      this.rng.chance(0.86) &&
      this.beginSpecimenInspection(this.pendingSectionId, time)
    ) {
      this.advanceSpecimen(time);
      return;
    }
    if (sectionDecision && !forcedAvoidance && !this.rng.chance(ENTITY_CONFIG.interaction.sectionFollowChance)) {
      this.beginDecline(sectionTarget, time);
      this.nextRelocationAt = time + this.rng.range(...ENTITY_CONFIG.interaction.laterRoamSeconds) * 1000;
      this.sectionRelocationEligibleAt = 0;
      this.pendingSectionId = null;
      return;
    }
    if (!sectionDecision && !forcedAvoidance && !cursorAvoidance && this.rng.chance(0.2 + this.brain.internal.fatigue * 0.3)) {
      this.beginDecline(this.activeAttention.id, time);
      this.nextRelocationAt = time + this.rng.range(...ENTITY_CONFIG.interaction.laterRoamSeconds) * 1000;
      return;
    }
    const intentionalNovelty = !forcedAvoidance && !cursorAvoidance &&
      (autonomousDecision || sectionDecision);
    const selected = this.chooseFreeAnchor(intentionalNovelty, sectionTarget || this.activeAttention.id, true);
    const distance = Math.hypot(selected.position.x - this.stableAnchor.x, selected.position.y - this.stableAnchor.y);
    const improvement = selected.score - currentScore.score;
    if (selected.hardRejected) {
      if (forcedAvoidance && time - this.unsafeAnchorSince >= ENTITY_CONFIG.relocation.forcedAvoidanceDelayMs) {
        this.hiddenReason = 'occupancy';
        this.previousSpatialMode = 'FREE';
        this.nextReleaseAttemptAt = time + this.rng.range(700, 1500);
        this.beginSpatialTransition('HIDDEN', this.stableAnchor, this.stableAnchor, 520, time);
      }
      this.nextRelocationAt = time + this.rng.range(...ENTITY_CONFIG.interaction.laterRoamSeconds) * 1000;
      return;
    }
    if ((!forcedAvoidance && distance < 96) ||
      (!forcedAvoidance && !intentionalNovelty && improvement < 0.08 && this.rng.chance(0.64))) {
      this.beginDecline(sectionTarget || this.activeAttention.id, time);
      this.nextRelocationAt = time + this.rng.range(...ENTITY_CONFIG.interaction.laterRoamSeconds) * 1000;
      this.sectionRelocationEligibleAt = 0;
      this.pendingSectionId = null;
      return;
    }
    this.compactObservation = this.selectedAnchorCompact;
    this.startEpisode('ROAM', 'ORIENT', sectionTarget || `quiet:${selected.id}`, time, forcedAvoidance ? this.rng.range(180, 320) : this.rng.range(520, 920), {
      hostId: selected.id,
      destination: selected.position,
      commitment: forcedAvoidance ? 1 : 0,
    });
    this.sectionRelocationEligibleAt = 0;
    this.pendingSectionId = null;
  }

  private updateGaze(time: number, seconds: number, targetId: string | null, attention: Vec2): void {
    if (targetId !== this.lastAttentionTarget) {
      this.lastAttentionTarget = targetId;
      this.gazeTargetReadyAt = time + this.rng.range(...ENTITY_CONFIG.gaze.surfaceReactionDelayMs);
      this.headTargetReadyAt = time + this.rng.range(...ENTITY_CONFIG.gaze.headReactionDelayMs);
    }
    const anchor = this.visualAnchor();
    const noiseX = fractalNoise2(time * 0.000071, 17.7, this.frame.sessionSeed + 811) * ENTITY_CONFIG.gaze.autonomousNoise;
    const noiseY = fractalNoise2(time * 0.000059, 39.2, this.frame.sessionSeed + 883) * ENTITY_CONFIG.gaze.autonomousNoise;
    const ignorePointer = this.cognitiveState === 'THINKING' || this.cognitiveState === 'DORMANT' ||
      fractalNoise2(time * 0.000021, 71.4, this.frame.sessionSeed + 947) > 0.53;
    const autonomousTarget = targetId || !ignorePointer ? attention : {
      x: innerWidth * (0.5 + noiseX * 3.2),
      y: innerHeight * (0.42 + noiseY * 2.8),
    };
    const pointerAge = this.pointer.lastAt ? time - this.pointer.lastAt : Infinity;
    const pointerDistance = Math.hypot(this.pointer.x - anchor.x, this.pointer.y - anchor.y);
    const pointerFreshness = Math.exp(-Math.max(0, pointerAge) / 520);
    const pointerNearness = 1 - clamp(pointerDistance / Math.max(520, this.fieldSize().width * 2.25));
    const deliberateFocus = this.episode?.kind === 'INSPECT' || this.episode?.kind === 'SPECIMEN';
    const cognitivePermission = this.cognitiveState === 'DORMANT'
      ? 0.18
      : this.cognitiveState === 'THINKING'
        ? 0.28
        : deliberateFocus
          ? 0.42
          : 0.88;
    const pointerFollow = targetId === 'pointer'
      ? 1
      : clamp(pointerFreshness * pointerNearness * cognitivePermission);
    const targetPosition = {
      x: mix(autonomousTarget.x, this.pointer.x, pointerFollow),
      y: mix(autonomousTarget.y, this.pointer.y, pointerFollow),
    };
    const size = this.fieldSize();
    const rawX = clamp((targetPosition.x - anchor.x) / Math.max(185, size.width * 1.12), -1, 1);
    const rawY = clamp((targetPosition.y - anchor.y) / Math.max(165, size.height * 0.92), -1, 1);
    if (time >= this.gazeTargetReadyAt) {
      this.gazeTarget.x = clamp(rawX * ENTITY_CONFIG.gaze.targetGain + noiseX, -ENTITY_CONFIG.gaze.maximumYaw, ENTITY_CONFIG.gaze.maximumYaw);
      this.gazeTarget.y = clamp(rawY * ENTITY_CONFIG.gaze.targetGain + noiseY, -ENTITY_CONFIG.gaze.maximumPitch, ENTITY_CONFIG.gaze.maximumPitch);
    }
    const motionScale = this.reducedMotion.matches ? ENTITY_CONFIG.reducedMotion.gazeScale : 1;
    [this.frame.gazeOrientation.x, this.frame.gazeVelocity.x] = springStep(
      this.frame.gazeOrientation.x,
      this.frame.gazeVelocity.x,
      this.gazeTarget.x * motionScale,
      ENTITY_CONFIG.gaze.gazeStiffness,
      ENTITY_CONFIG.gaze.gazeDamping,
      seconds,
    );
    [this.frame.gazeOrientation.y, this.frame.gazeVelocity.y] = springStep(
      this.frame.gazeOrientation.y,
      this.frame.gazeVelocity.y,
      this.gazeTarget.y * motionScale,
      ENTITY_CONFIG.gaze.gazeStiffness,
      ENTITY_CONFIG.gaze.gazeDamping,
      seconds,
    );
    if (time >= this.headTargetReadyAt) {
      const overshoot = 1 + ENTITY_CONFIG.gaze.overshoot * (1 - this.brain.internal.fatigue);
      [this.frame.headOrientation.x, this.frame.headVelocity.x] = springStep(
        this.frame.headOrientation.x,
        this.frame.headVelocity.x,
        this.frame.gazeOrientation.x * ENTITY_CONFIG.gaze.headFollow.yaw * overshoot,
        ENTITY_CONFIG.gaze.headStiffness,
        ENTITY_CONFIG.gaze.headDamping,
        seconds,
      );
      [this.frame.headOrientation.y, this.frame.headVelocity.y] = springStep(
        this.frame.headOrientation.y,
        this.frame.headVelocity.y,
        this.frame.gazeOrientation.y * ENTITY_CONFIG.gaze.headFollow.pitch * overshoot,
        ENTITY_CONFIG.gaze.headStiffness,
        ENTITY_CONFIG.gaze.headDamping,
        seconds,
      );
    }
  }

  private schedulePostureEvents(now: number): void {
    const fatigueScale = mix(0.8, 1.35, this.brain.internal.fatigue);
    this.nextSurfaceGesture = now + this.rng.range(5000, 13000) * fatigueScale;
    this.nextPostureGesture = now + this.rng.range(9000, 26000);
    this.nextPostureCheck = now + 100;
  }

  private primeSettledPresence(now: number): void {
    if (this.reducedMotion.matches) {
      this.schedulePostureEvents(now);
      return;
    }
    const travelDirection = Math.sign(this.transitionTarget.x - this.transitionFrom.x) || 1;
    this.postureTargets.headTilt = this.rng.range(-0.2, 0.2);
    this.postureTargets.lean = clamp(this.rng.range(-0.08, 0.1) - travelDirection * 0.035, -0.2, 0.2);
    this.postureTargets.shoulderCounter = this.rng.range(-0.2, 0.2);
    this.postureTargets.surfaceFlow = this.rng.range(0.34, 0.58);
    this.frame.posture.shoulderSettle = this.rng.range(0.28, 0.46);
    this.frame.posture.surfaceFlow = Math.max(this.frame.posture.surfaceFlow, this.postureTargets.surfaceFlow);
    this.nextSurfaceGesture = now + this.rng.range(4200, 9000);
    this.nextPostureGesture = now + this.rng.range(6500, 15000);
    this.nextPostureCheck = now + 100;
    this.nextAttentionDecisionAt = now + this.rng.range(450, 1200);
  }

  private updatePosture(time: number, seconds: number): void {
    const posture = this.frame.posture;
    const decay = (value: number, rate: number) => value * Math.exp(-seconds * rate);
    posture.shoulderSettle = decay(posture.shoulderSettle, 0.32);
    posture.surfaceFlow = decay(posture.surfaceFlow, 0.5);
    if (this.reducedMotion.matches) {
      posture.headTilt = mix(posture.headTilt, 0, 1 - Math.exp(-seconds * 2));
      posture.lean = mix(posture.lean, 0, 1 - Math.exp(-seconds * 2));
      posture.breath = mix(posture.breath, 0.5, 1 - Math.exp(-seconds * 0.35));
      posture.shoulderCounter = mix(posture.shoulderCounter, 0, 1 - Math.exp(-seconds * 2));
      posture.surfaceFlow = 0;
      return;
    }
    if (time >= this.nextPostureCheck) {
      this.nextPostureCheck = time + this.rng.range(90, 180);
      if (time >= this.nextSurfaceGesture) {
        this.postureTargets.surfaceFlow = this.rng.range(0.18, 0.64);
        this.nextSurfaceGesture = time + this.rng.range(5000, 13000) * mix(0.86, 1.32, this.brain.internal.fatigue);
      }
      if (time >= this.nextPostureGesture) {
        const curiosityScale = this.cognitiveState === 'CURIOUS' ? 1.28 : 1;
        const stateLean = this.cognitiveState === 'INSPECTING' ? 0.18 : this.cognitiveState === 'THINKING' ? -0.16 : 0;
        this.postureTargets.headTilt = this.rng.range(-0.42, 0.42) * curiosityScale;
        this.postureTargets.lean = clamp(stateLean + this.rng.range(-0.14, 0.18), -0.28, 0.34);
        this.postureTargets.shoulderCounter = this.rng.range(-0.26, 0.26);
        posture.shoulderSettle = this.rng.range(0.12, 0.48);
        this.nextPostureGesture = time + this.rng.range(9000, 26000);
      }
    }
    const breathTarget = 0.5 + fractalNoise2(time * 0.000064, 12.7, this.frame.sessionSeed + 1213) * 0.42;
    posture.breath = mix(posture.breath, breathTarget, 1 - Math.exp(-seconds * 0.62));
    posture.headTilt = mix(posture.headTilt, this.postureTargets.headTilt, 1 - Math.exp(-seconds * 0.34));
    posture.lean = mix(posture.lean, this.postureTargets.lean, 1 - Math.exp(-seconds * 0.22));
    posture.shoulderCounter = mix(posture.shoulderCounter, this.postureTargets.shoulderCounter, 1 - Math.exp(-seconds * 0.28));
    posture.surfaceFlow = Math.max(posture.surfaceFlow, this.postureTargets.surfaceFlow);
    this.postureTargets.headTilt *= Math.exp(-seconds * 0.035);
    this.postureTargets.lean *= Math.exp(-seconds * 0.028);
    this.postureTargets.shoulderCounter *= Math.exp(-seconds * 0.04);
    this.postureTargets.surfaceFlow *= Math.exp(-seconds * 0.48);
  }

  private updateReach(seconds: number, targetId: string | null, fallbackPosition: Vec2): void {
    const intendsToReach = this.motorIntent === 'REACH' && !this.reducedMotion.matches && innerWidth >= 700;
    if (targetId !== this.reachTargetId) {
      this.reachTargetId = targetId;
      this.reachStop = this.rng.range(...ENTITY_CONFIG.interaction.reachStopPx);
    }
    let target = fallbackPosition;
    const element = targetId ? this.targetElements.get(targetId) : null;
    if (element?.isConnected) {
      const rect = element.getBoundingClientRect();
      const anchor = this.visualAnchor();
      const nearestX = clamp(anchor.x, rect.left, rect.right);
      const nearestY = clamp(anchor.y, rect.top, rect.bottom);
      const dx = anchor.x - nearestX;
      const dy = anchor.y - nearestY;
      const length = Math.max(1, Math.hypot(dx, dy));
      target = { x: nearestX + dx / length * this.reachStop, y: nearestY + dy / length * this.reachStop };
    }
    const reachDistance = Math.hypot(target.x - this.visualAnchor().x, target.y - this.visualAnchor().y);
    const specimenReachAllowed = !targetId?.startsWith('specimen:') || reachDistance <= this.fieldSize().width * 1.8;
    const shouldReach = intendsToReach && specimenReachAllowed;
    const follow = 1 - Math.exp(-seconds * 5.5);
    this.frame.reachPosition.x = mix(this.frame.reachPosition.x, target.x, follow);
    this.frame.reachPosition.y = mix(this.frame.reachPosition.y, target.y, follow);
    this.frame.reachStrength = mix(this.frame.reachStrength, shouldReach ? 1 : 0, 1 - Math.exp(-seconds * (shouldReach ? 2.1 : 1.05)));
  }

  private updateFrame(time: number, seconds: number, interactionEnergy: number): void {
    const anchor = this.visualAnchor();
    const size = this.fieldSize();
    const pointerAge = this.pointer.lastAt ? time - this.pointer.lastAt : Infinity;
    const pointerFreshness = Math.exp(-Math.max(0, pointerAge) / 360);
    const pointerDistance = Math.hypot(this.pointer.x - anchor.x, this.pointer.y - anchor.y);
    const localPointerX = (this.pointer.x - anchor.x) / Math.max(1, size.width * 0.5);
    const localPointerY = (this.pointer.y - anchor.y) / Math.max(1, size.height * 0.5);
    const ellipseDistance = Math.hypot(localPointerX / 0.92, localPointerY / 1.04);
    const proximityTarget = pointerFreshness * (1 - clamp(pointerDistance / Math.max(540, size.width * 2.2)));
    const intrusionTarget = this.reducedMotion.matches
      ? 0
      : pointerFreshness * smoothstep(1 - clamp((ellipseDistance - 0.04) / 1.08));
    this.frame.pointerPosition = { x: this.pointer.x, y: this.pointer.y };
    this.frame.pointerVelocity = { x: this.pointer.velocityX, y: this.pointer.velocityY };
    this.frame.pointerProximity = mix(
      this.frame.pointerProximity,
      proximityTarget,
      1 - Math.exp(-seconds * (proximityTarget > this.frame.pointerProximity ? 8.5 : 2.6)),
    );
    this.frame.pointerIntrusion = mix(
      this.frame.pointerIntrusion,
      intrusionTarget,
      1 - Math.exp(-seconds * (intrusionTarget > this.frame.pointerIntrusion ? 12 : 3.8)),
    );
    const containmentProgress = containmentStrengthFor(this.spatialMode, this.transitionProgress);
    let spatialCoherence = 1;
    if (['RELEASING', 'RELOCATING', 'RETURNING'].includes(this.spatialMode)) {
      const progress = this.transitionProgress;
      if (progress < 0.5) {
        spatialCoherence = mix(1, 0.24, smoothstep(progress / 0.5));
      } else {
        const reform = smoothstep((progress - 0.5) / 0.5);
        const settleOvershoot = Math.sin(reform * Math.PI) * 0.08;
        spatialCoherence = mix(0.24, 1, reform) + settleOvershoot;
      }
    } else if (this.spatialMode === 'HIDDEN') {
      spatialCoherence = 0.06;
    }
    const coherenceTarget = clamp(
      ENTITY_CONFIG.brain.stateCoherence[this.cognitiveState] *
      mix(1, 0.64, this.brain.internal.entropy) * spatialCoherence,
    );
    const boundTarget = mix(
      ENTITY_CONFIG.particles.fragmentBindingRange[0],
      ENTITY_CONFIG.particles.activeBindingRange[1],
      coherenceTarget,
    );
    const episode = this.episode;
    const attentionStrength = episode
      ? episode.kind === 'INSPECT'
        ? 0.82 + episode.commitment * 0.18
        : episode.kind === 'SPECIMEN'
          ? 0.72 + episode.commitment * 0.24
        : episode.kind === 'ACKNOWLEDGE'
          ? 0.48 + episode.commitment * 0.46
          : episode.kind === 'ROAM'
            ? 0.68 + episode.commitment * 0.2
            : episode.kind === 'SURVEY'
              ? 0.58
              : episode.kind === 'DECLINE'
                ? 0.42
                : 0.32
      : this.activeAttention.id ? 0.28 + this.activeAttention.confidence * 0.24 : 0.2;
    const inspectionStrength = episode?.kind === 'INSPECT' || episode?.kind === 'SPECIMEN'
      ? episode.phase === 'ENGAGE'
        ? 1
        : episode.phase === 'SETTLE'
          ? 0.44
          : episode.phase === 'EXIT'
            ? episode.commitment * 0.38
            : 0.2
      : 0;
    const attentionDirection = Math.sign(this.activeAttention.position.x - anchor.x) || 1;
    const directionalBias = episode?.kind === 'DECLINE' && episode.phase === 'EXIT'
      ? -attentionDirection * attentionStrength
      : attentionDirection * attentionStrength;
    const specimenSection = episode?.kind === 'SPECIMEN'
      ? this.specimenSectionFromTarget(episode.targetId)
      : null;
    const specimenElement = specimenSection ? this.specimenForSection(specimenSection) : null;
    const elementSpecimenKind = isSpecimenKind(specimenElement?.dataset.specimen)
      ? specimenElement.dataset.specimen
      : null;
    const specimenKind = episode?.kind === 'SPECIMEN'
      ? episode.specimenKind || elementSpecimenKind
      : null;
    const specimenPosition = specimenElement
      ? elementPosition(specimenElement)
      : episode?.kind === 'SPECIMEN' && this.activeAttention.id === episode.targetId
        ? this.activeAttention.position
        : anchor;
    const specimenDelta = {
      x: specimenPosition.x - anchor.x,
      y: specimenPosition.y - anchor.y,
    };
    const specimenDistancePx = Math.hypot(specimenDelta.x, specimenDelta.y);
    const specimenPhaseProgress = episode?.kind === 'SPECIMEN'
      ? clamp((time - episode.phaseStartedAt) / Math.max(1, episode.phaseDuration))
      : 0;
    const specimenPhaseBase = episode?.phase === 'ORIENT'
      ? 0
      : episode?.phase === 'TRANSIT'
        ? 0.15
        : episode?.phase === 'SETTLE'
          ? 0.55
          : episode?.phase === 'ENGAGE'
            ? 0.7
            : episode?.phase === 'EXIT'
              ? 0.92
              : 0;
    const specimenPhaseSpan = episode?.phase === 'ORIENT'
      ? 0.15
      : episode?.phase === 'TRANSIT'
        ? 0.4
        : episode?.phase === 'SETTLE'
          ? 0.15
          : episode?.phase === 'ENGAGE'
            ? 0.22
            : episode?.phase === 'EXIT'
              ? 0.08
              : 0;
    const specimenStrength = specimenKind && episode?.kind === 'SPECIMEN'
      ? episode.phase === 'ENGAGE'
        ? 1
        : episode.phase === 'SETTLE'
          ? mix(0.18, 0.46, specimenPhaseProgress)
          : episode.phase === 'EXIT'
            ? clamp(episode.commitment) * 0.72
            : episode.phase === 'ORIENT'
              ? specimenPhaseProgress * 0.08
              : 0
      : 0;
    this.frame.revision += 1;
    this.frame.timestamp = time;
    this.frame.delta = seconds;
    this.frame.spatialMode = this.spatialMode;
    this.frame.cognitiveState = this.cognitiveState;
    this.frame.motorIntent = this.motorIntent;
    this.frame.episodeKind = episode?.kind || null;
    this.frame.episodePhase = episode?.phase || null;
    this.frame.episodeTargetId = episode?.targetId || null;
    this.frame.episodeCommitment = episode?.commitment || 0;
    this.frame.attentionStrength = attentionStrength;
    this.frame.inspectionStrength = inspectionStrength;
    this.frame.directionalBias = directionalBias;
    this.frame.specimen.kind = specimenKind;
    this.frame.specimen.strength = this.reducedMotion.matches
      ? Math.min(0.68, specimenStrength)
      : specimenStrength;
    this.frame.specimen.phase = clamp(specimenPhaseBase + specimenPhaseProgress * specimenPhaseSpan);
    this.frame.specimen.direction = specimenDistancePx > 0.001
      ? { x: specimenDelta.x / specimenDistancePx, y: specimenDelta.y / specimenDistancePx }
      : { x: 0, y: 0 };
    this.frame.specimen.distance = clamp(specimenDistancePx / Math.max(1, size.width), 0, 4);
    this.frame.lastVisibleActionAt = this.lastVisibleActionAt;
    this.frame.activeAnchorId = this.spatialMode === 'SEALED' ? 'containment' : this.frame.activeAnchorId;
    this.frame.activeHostId = episode?.hostId?.startsWith('host:')
      ? episode.hostId
      : this.frame.activeAnchorId?.startsWith('host:') ? this.frame.activeAnchorId : null;
    this.frame.attentionTargetId = this.activeAttention.id;
    this.frame.attentionPosition = { ...this.activeAttention.position };
    this.frame.anchor = anchor;
    this.frame.anchorFrom = { ...this.transitionFrom };
    this.frame.anchorTarget = { ...this.transitionTarget };
    this.frame.entityWidth = size.width;
    this.frame.entityHeight = size.height;
    this.frame.containmentStrength = clamp(containmentProgress);
    this.frame.transitionProgress = this.transitionProgress;
    this.frame.relocationCurve = Math.sin(this.transitionProgress * Math.PI) * ENTITY_CONFIG.relocation.flowCurve;
    this.frame.scrollVelocity = this.reducedMotion.matches ? 0 : this.scroll.velocity;
    this.frame.scrollAcceleration = this.reducedMotion.matches ? 0 : this.scroll.acceleration;
    this.frame.scrollEnergy = this.reducedMotion.matches ? 0 : this.scroll.energy;
    this.frame.scrollOrigin = this.scroll.origin;
    this.frame.interactionEnergy = interactionEnergy;
    this.frame.formCoherence = mix(this.frame.formCoherence, coherenceTarget, 1 - Math.exp(-seconds * 0.7));
    this.frame.boundRatio = mix(this.frame.boundRatio, boundTarget, 1 - Math.exp(-seconds * 0.5));
    this.frame.enabled = this.requestedEnabled;
    this.frame.visible = this.spatialMode !== 'HIDDEN' || this.transitionProgress < 1;
    this.frame.released = this.hiddenReason === 'occupancy' || spatialModeIsReleased(this.spatialMode);
    this.frame.reducedMotion = this.reducedMotion.matches;
    this.frame.simulationPaused = expensiveSimulationShouldPause(document.hidden, this.frame.visible);
    this.frame.theme = document.documentElement.dataset.themeResolved === 'light' ? 'light' : 'dark';
    this.frame.status = `${this.spatialMode} / ${this.cognitiveState}${episode ? ` / ${episode.kind}:${episode.phase}` : ''}`;
    this.frame.frameTimeAverage = this.frameTimeAverage;
    this.frame.activeParticleCount = this.activeParticleCount;
    const coupledSpecimenSection = episode?.kind === 'SPECIMEN' && ['SETTLE', 'ENGAGE'].includes(episode.phase)
      ? specimenSection
      : null;
    this.syncSpecimenContact(coupledSpecimenSection);
  }

  private syncSpecimenContact(sectionId: string | null): void {
    const nextElement = sectionId ? this.specimenForSection(sectionId) : null;
    const nextKind = isSpecimenKind(nextElement?.dataset.specimen) ? nextElement.dataset.specimen : null;
    if (nextElement === this.activeSpecimenElement && nextKind === this.activeSpecimenKind) return;
    this.activeSpecimenElement?.classList.remove('is-active');
    this.activeSpecimenElement = nextElement;
    this.activeSpecimenKind = nextKind;
    if (nextElement && nextKind) {
      nextElement.classList.add('is-active');
      document.documentElement.dataset.specimenContact = nextKind;
    } else {
      delete document.documentElement.dataset.specimenContact;
    }
    window.dispatchEvent(new CustomEvent('andrew:specimen-change', {
      detail: { kind: nextKind, sectionId },
    }));
  }

  private maybeShowMessage(time: number, stateChanged: boolean): void {
    if (!this.thoughtOutput || document.documentElement.classList.contains('session-pending') || !this.frame.visible) return;
    const evidenceReady = Boolean(this.evidenceMessagePending) && time - this.lastMessageAt > 14000;
    const eventPressure = stateChanged && time - this.lastMessageAt > 12000 &&
      ['INSPECTING', 'FRAGMENTING', 'REFORMING'].includes(this.cognitiveState);
    if (time < this.nextMessageAt && !eventPressure && !evidenceReady) return;
    const pool = MESSAGE_POOLS[this.cognitiveState];
    const available = pool.filter((message) => !this.recentMessages.includes(message));
    const source = available.length ? available : pool;
    let message = evidenceReady ? this.evidenceMessagePending! : this.rng.pick(source);
    if (!evidenceReady && this.frame.attentionTargetId && this.cognitiveState === 'INSPECTING' && this.brain.getMemory().find((entry) => entry.targetId === this.frame.attentionTargetId)?.affinity) {
      message = 'target familiarity increased';
    }
    message = [...message].map((character) => this.rng.chance(0.045) && character !== ' ' ? this.rng.pick(GLYPH_CORRUPTION) : character).join('');
    this.recentMessages.unshift(message);
    this.recentMessages.length = Math.min(this.recentMessages.length, ENTITY_CONFIG.messages.repeatWindow);
    this.thoughtOutput.textContent = message;
    const position = this.safeMessagePosition();
    if (!position) {
      this.thoughtOutput.dataset.visible = 'false';
      this.nextMessageAt = time + this.rng.range(...ENTITY_CONFIG.messages.intervalSeconds) * 1000;
      return;
    }
    this.thoughtOutput.dataset.visible = 'true';
    this.lastMessageAt = time;
    if (evidenceReady) {
      this.lastEvidenceMessageAt = time;
      this.evidenceMessagePending = null;
    }
    this.thoughtOutput.style.setProperty('--thought-x', `${Math.round(position.x)}px`);
    this.thoughtOutput.style.setProperty('--thought-y', `${Math.round(position.y)}px`);
    const duration = this.rng.range(...ENTITY_CONFIG.messages.visibleMs);
    this.thoughtOutput.style.setProperty('--thought-duration', `${Math.round(duration)}ms`);
    window.clearTimeout(this.thoughtHideTimer);
    this.thoughtHideTimer = window.setTimeout(() => {
      if (this.thoughtOutput?.textContent === message) this.thoughtOutput.dataset.visible = 'false';
    }, duration);
    this.nextMessageAt = time + this.rng.range(...ENTITY_CONFIG.messages.intervalSeconds) * 1000;
  }

  private safeMessagePosition(): Vec2 | null {
    const anchor = this.visualAnchor();
    const attempts = [
      { x: anchor.x + this.frame.entityWidth * 0.42, y: anchor.y - this.frame.entityHeight * 0.25 },
      { x: anchor.x - this.frame.entityWidth * 0.72, y: anchor.y - this.frame.entityHeight * 0.2 },
      { x: anchor.x + this.frame.entityWidth * 0.34, y: anchor.y + this.frame.entityHeight * 0.3 },
    ];
    const obstacles = this.occupancy.getSnapshot().obstacles;
    for (const attempt of attempts) {
      const position = { x: clamp(attempt.x, 12, innerWidth - 222), y: clamp(attempt.y, 18, innerHeight - 48) };
      const rect: RectLike = { left: position.x, top: position.y, right: position.x + 210, bottom: position.y + 30, width: 210, height: 30 };
      if (!obstacles.some((obstacle) => intersectionArea(rect, obstacle.rect) > 0)) {
        return position;
      }
    }
    return null;
  }

  private publish(force = false): void {
    const shared = window.__ANDREW_VISUAL_STATE__ ||= {
      revision: 0,
      pointer: { x: this.pointer.x, y: this.pointer.y, lastAt: this.pointer.lastAt },
      entity: this.frame,
    };
    shared.entity = this.frame;
    shared.revision = this.frame.revision;
    const key = `${this.spatialMode}:${this.cognitiveState}:${this.motorIntent}:${this.episode?.kind || '-'}:${this.episode?.phase || '-'}:${this.requestedEnabled}:${this.frame.quality}`;
    if (!force && key === this.lastPublishedKey) return;
    this.lastPublishedKey = key;
    const root = document.documentElement;
    root.dataset.entitySpatial = this.spatialMode.toLowerCase();
    root.dataset.entityBehavior = this.cognitiveState.toLowerCase();
    root.dataset.entityMotor = this.motorIntent.toLowerCase();
    root.dataset.entityEpisode = this.episode?.kind.toLowerCase() || 'none';
    root.dataset.entityEpisodePhase = this.episode?.phase.toLowerCase() || 'none';
    root.dataset.entityReleased = this.frame.released ? 'on' : 'off';
    root.dataset.entity = this.requestedEnabled ? 'on' : 'off';
    this.occupancy.scheduleRefresh('entity-state-change');
    const topStatus = document.getElementById('entity-state');
    const releaseButton = document.getElementById('entity-release') as HTMLButtonElement | null;
    const releaseLabel = releaseButton?.querySelector<HTMLElement>('[data-release-label]');
    const containmentLabel = document.querySelector<HTMLElement>('[data-containment-label],[data-entity-presence-label]');
    const toggle = document.getElementById('entity-toggle');
    const toggleLabel = toggle?.querySelector<HTMLElement>('[data-entity-label]');
    if (topStatus) topStatus.textContent = this.requestedEnabled ? this.cognitiveState : 'OFFLINE';
    document.querySelectorAll<HTMLElement>('[data-entity-spatial-status]').forEach((status) => { status.textContent = this.spatialMode; });
    document.querySelectorAll<HTMLElement>('[data-entity-cognitive-status]').forEach((status) => { status.textContent = this.cognitiveState; });
    document.querySelectorAll<HTMLElement>('[data-entity-form-status]').forEach((status) => { status.textContent = 'GLYPH_INTELLIGENCE'; });
    if (containmentLabel) containmentLabel.textContent = this.spatialMode === 'SEALED'
      ? 'LOCAL_CONTAINMENT_ACTIVE'
      : this.spatialMode === 'RETURNING'
        ? 'FIELD_RECALL_IN_PROGRESS'
        : 'ENTITY_07 // PORTFOLIO_WIDE';
    if (releaseButton) {
      const sealed = this.spatialMode === 'SEALED' || this.spatialMode === 'RETURNING';
      releaseButton.disabled = !this.requestedEnabled || this.pendingReleaseForSafeSpace || ['RELEASING', 'RETURNING'].includes(this.spatialMode);
      releaseButton.setAttribute('aria-pressed', String(!sealed));
      releaseButton.setAttribute('aria-label', sealed ? 'Release ENTITY 07 from containment' : 'Return ENTITY 07 to containment');
      if (releaseLabel) releaseLabel.textContent = sealed ? 'RELEASE_ENTITY' : 'RETURN_ENTITY';
    }
    toggle?.setAttribute('aria-pressed', String(this.requestedEnabled));
    toggle?.setAttribute('aria-label', this.requestedEnabled ? 'Disable ENTITY 07' : 'Enable ENTITY 07');
    if (toggleLabel) toggleLabel.textContent = this.requestedEnabled ? 'ENT_ON' : 'ENT_OFF';
    window.dispatchEvent(new CustomEvent('andrew:entity-state', { detail: this.frame }));
  }

  private persistMemory(): void {
    const now = performance.now();
    this.perception.drain((event) => this.brain.enqueue(event));
    this.brain.flush(now);
    try { sessionStorage.setItem(MEMORY_KEY, JSON.stringify(this.brain.getMemory())); } catch { /* storage can be unavailable */ }
  }

  private createDebugOverlay(): void {
    this.debugRoot = document.createElement('aside');
    this.debugRoot.className = 'entity-debug';
    this.debugRoot.setAttribute('aria-hidden', 'true');
    this.debugRoot.innerHTML = '<strong>ENTITY_07 DEBUG</strong><pre></pre>';
    this.debugCanvas = document.createElement('canvas');
    this.debugCanvas.className = 'entity-debug__occupancy';
    this.debugCanvas.setAttribute('aria-hidden', 'true');
    document.body.append(this.debugCanvas, this.debugRoot);
  }

  private updateDebugOverlay(time: number): void {
    this.lastDebugUpdate = time;
    const snapshot = this.getDebugSnapshot();
    const pre = this.debugRoot?.querySelector('pre');
    if (pre) {
      const internal = snapshot.frame.internal;
      const utilities = Object.entries(snapshot.candidateUtilities)
        .map(([state, utility]) => `${state.slice(0, 4)}:${utility.toFixed(2)}`)
        .join(' ');
      const anchors = snapshot.occupancy.candidates.slice(0, 5)
        .map((candidate) => `${candidate.id}:${candidate.score.toFixed(1)}${candidate.hardRejected ? '!' : ''}`)
        .join(' ');
      const obstacleIds = snapshot.occupancy.obstacles.slice(0, 12).map((obstacle) => obstacle.id).join(',');
      const memory = snapshot.memory.slice(0, 5)
        .map((entry) => `${entry.targetId}[h${entry.hoverCount}/f${entry.focusCount}/a${entry.activationCount}:${entry.affinity.toFixed(2)}]`)
        .join(' ');
      const events = snapshot.recentEvents.slice(0, 6)
        .map((event) => `${event.type}${event.targetId ? `:${event.targetId}` : ''}`)
        .join(' ');
      pre.textContent = [
        `spatial  ${snapshot.frame.spatialMode}`,
        `cognitive ${snapshot.frame.cognitiveState}`,
        `motor    ${snapshot.frame.motorIntent}`,
        `episode  ${snapshot.frame.episodeKind || '-'}:${snapshot.frame.episodePhase || '-'} -> ${snapshot.frame.episodeTargetId || '-'}`,
        `response A:${snapshot.frame.attentionStrength.toFixed(2)} I:${snapshot.frame.inspectionStrength.toFixed(2)} C:${snapshot.frame.episodeCommitment.toFixed(2)}`,
        `pointer  P:${snapshot.frame.pointerProximity.toFixed(2)} X:${snapshot.frame.pointerIntrusion.toFixed(2)} V:${Math.hypot(snapshot.frame.pointerVelocity.x, snapshot.frame.pointerVelocity.y).toFixed(0)}`,
        `anchor   ${snapshot.frame.activeAnchorId || '-'} @ ${snapshot.frame.anchor.x.toFixed(0)},${snapshot.frame.anchor.y.toFixed(0)}`,
        `host     ${snapshot.frame.activeHostId || '-'}`,
        `attention ${snapshot.frame.attentionTargetId || '-'}`,
        `section  ${snapshot.currentVisibleSection || '-'}`,
        `drives   C:${internal.curiosity.toFixed(2)} A:${internal.arousal.toFixed(2)} H:${internal.cohesion.toFixed(2)} E:${internal.entropy.toFixed(2)}`,
        `         F:${internal.confidence.toFixed(2)} T:${internal.fatigue.toFixed(2)} R:${internal.trust.toFixed(2)}`,
        `particles ${snapshot.frame.activeParticleCount} / pool ${snapshot.particlePoolId}`,
        `quality  ${snapshot.frame.quality} ${snapshot.frame.frameTimeAverage.toFixed(1)}ms rm:${snapshot.frame.reducedMotion ? 'on' : 'off'} theme:${snapshot.frame.theme}`,
        `binding  ${(snapshot.frame.boundRatio * 100).toFixed(0)}% / free ${((1 - snapshot.frame.boundRatio) * 100).toFixed(0)}%`,
        `coherence ${snapshot.frame.formCoherence.toFixed(2)} mask ${snapshot.frame.containmentStrength.toFixed(2)}`,
        `anchors  ${anchors || '-'}`,
        `obstacles ${snapshot.occupancy.obstacles.length} ${obstacleIds}`,
        `memory   ${memory || '-'}`,
        `events   ${events || '-'}`,
        `utility  ${utilities}`,
      ].join('\n');
    }
    const canvas = this.debugCanvas;
    if (!canvas) return;
    canvas.width = Math.max(1, innerWidth);
    canvas.height = Math.max(1, innerHeight);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 1;
    for (const obstacle of snapshot.occupancy.obstacles) {
      context.strokeStyle = obstacle.kind === 'interactive' || obstacle.kind === 'modal' ? 'rgba(255,95,130,.75)' : 'rgba(100,220,220,.32)';
      context.strokeRect(obstacle.rect.left, obstacle.rect.top, obstacle.rect.width, obstacle.rect.height);
    }
    context.strokeStyle = 'rgba(255,210,90,.9)';
    const mask = snapshot.frame.containmentRect;
    context.strokeRect(mask.left, mask.top, mask.width, mask.height);
    for (const candidate of snapshot.occupancy.candidates.slice(0, 12)) {
      context.fillStyle = candidate.hardRejected ? 'rgba(255,80,90,.55)' : 'rgba(90,255,160,.72)';
      context.fillRect(candidate.position.x - 2, candidate.position.y - 2, 4, 4);
      context.fillText(candidate.score.toFixed(1), candidate.position.x + 5, candidate.position.y - 4);
    }
  }
}

export function getEntityRuntime(): EntityRuntimeApi {
  if (window.__ENTITY_07_RUNTIME__) return window.__ENTITY_07_RUNTIME__;
  const runtime = new EntityRuntimeController();
  window.__ENTITY_07_RUNTIME__ = runtime;
  return runtime;
}

export const entityRuntime = getEntityRuntime();
