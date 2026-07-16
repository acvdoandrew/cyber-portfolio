import { ENTITY_CONFIG } from './config';
import { clamp, fractalNoise2, mix, SeededRandom } from './random';
import type {
  CognitiveState,
  EntityInternalState,
  InteractionMemory,
  MotorIntent,
  PerceptionEvent,
  PerceptionSource,
  SpatialMode,
  Vec2,
} from './types';

const COGNITIVE_STATES: CognitiveState[] = [
  'DORMANT',
  'OBSERVING',
  'CURIOUS',
  'INSPECTING',
  'THINKING',
  'FRAGMENTING',
  'REFORMING',
];

const DEFAULT_INTERNAL: EntityInternalState = {
  curiosity: 0.38,
  arousal: 0.16,
  cohesion: 0.72,
  entropy: 0.2,
  confidence: 0.36,
  fatigue: 0.08,
  trust: 0.12,
  attentionConfidence: 0.18,
  socialDistance: 0.7,
};

interface PendingAttention {
  id: string;
  startedAt: number;
  thresholdMs: number;
  salience: number;
  position: Vec2;
  source: PerceptionSource;
}

interface TargetEngagement {
  position: Vec2;
  salience: number;
  hoverActive: boolean;
  focusActive: boolean;
  holdUntil: number;
}

export interface BrainContext {
  now: number;
  delta: number;
  spatialMode: SpatialMode;
  released: boolean;
  reducedMotion: boolean;
  pointerDistanceToEntity: number;
  activeSectionId: string | null;
  transitionProgress?: number;
}

export interface BrainOutput {
  cognitiveState: CognitiveState;
  motorIntent: MotorIntent;
  internal: EntityInternalState;
  attentionTargetId: string | null;
  attentionPosition: Vec2;
  interactionEnergy: number;
  stateChanged: boolean;
  stateReason: string;
}

interface DriveImpulses {
  novelty: number;
  interaction: number;
  scroll: number;
  uncertainty: number;
  calm: number;
}

function makeMemory(targetId: string, now: number): InteractionMemory {
  return {
    targetId,
    hoverCount: 0,
    focusCount: 0,
    activationCount: 0,
    accumulatedDwellMs: 0,
    lastSeenAt: now,
    lastActivatedAt: null,
    affinity: 0,
    uncertainty: 0.5,
    novelty: 1,
    cooldown: 0,
  };
}

function defaultUtilities(): Record<CognitiveState, number> {
  return {
    DORMANT: 0,
    OBSERVING: 0,
    CURIOUS: 0,
    INSPECTING: 0,
    THINKING: 0,
    FRAGMENTING: 0,
    REFORMING: 0,
  };
}

export class EntityBrain {
  readonly sessionSeed: number;
  readonly internal: EntityInternalState = { ...DEFAULT_INTERNAL };
  private rng: SeededRandom;
  private queue: PerceptionEvent[] = [];
  private memory = new Map<string, InteractionMemory>();
  private targetEngagements = new Map<string, TargetEngagement>();
  private sectionDwellStarts = new Map<string, number>();
  private pendingAttention: PendingAttention | null = null;
  private attentionTargetId: string | null = null;
  private attentionPosition: Vec2 = { x: 0.82, y: 0.52 };
  private cognitiveState: CognitiveState = 'DORMANT';
  private previousState: CognitiveState = 'DORMANT';
  private motorIntent: MotorIntent = 'IDLE';
  private stateEnteredAt = 0;
  private stateReason = 'boot';
  private stateChanged = false;
  private refractoryUntil = 0;
  private nextDecisionAt = 0;
  private minimumDwellUntil = 0;
  private lastInteractionAt = 0;
  private lastMemoryDecayAt = 0;
  private activeDwellStart = 0;
  private activeDwellTarget: string | null = null;
  private interactionEnergy = 0;
  private impulses: DriveImpulses = { novelty: 0, interaction: 0, scroll: 0, uncertainty: 0, calm: 0 };
  private rapidTargets: Array<{ id: string; timestamp: number }> = [];
  private utilities = defaultUtilities();
  private fragmentRecoveryPressure = 0;

  constructor(seed: number, restoredMemory?: InteractionMemory[]) {
    this.sessionSeed = seed >>> 0;
    this.rng = new SeededRandom(this.sessionSeed);
    if (restoredMemory) {
      for (const entry of restoredMemory.slice(0, ENTITY_CONFIG.brain.memoryLimit)) {
        if (!entry?.targetId) continue;
        this.memory.set(entry.targetId, {
          ...makeMemory(entry.targetId, entry.lastSeenAt || 0),
          ...entry,
          novelty: Number.isFinite(entry.novelty) ? clamp(entry.novelty) : 0.72,
          cooldown: Number.isFinite(entry.cooldown) ? clamp(entry.cooldown) : 0,
        });
      }
    }
  }

  enqueue(event: PerceptionEvent): void {
    if (this.queue.length >= ENTITY_CONFIG.brain.eventQueueLimit) this.queue.shift();
    this.queue.push(event);
  }

  update(context: BrainContext): BrainOutput {
    this.stateChanged = false;
    this.consumeEvents(context.now);
    this.resolvePendingAttention(context.now);
    this.updateMemory(context.now);
    this.updateDrives(context);
    this.evaluateState(context);
    this.motorIntent = this.chooseMotorIntent(context);
    return {
      cognitiveState: this.cognitiveState,
      motorIntent: this.motorIntent,
      internal: this.internal,
      attentionTargetId: this.attentionTargetId,
      attentionPosition: this.attentionPosition,
      interactionEnergy: this.interactionEnergy,
      stateChanged: this.stateChanged,
      stateReason: this.stateReason,
    };
  }

  getMemory(): InteractionMemory[] {
    return [...this.memory.values()].map((entry) => ({ ...entry }));
  }

  getUtilities(): Record<CognitiveState, number> {
    return { ...this.utilities };
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  getLastInteractionAt(): number {
    return this.lastInteractionAt;
  }

  flush(now: number): void {
    this.consumeEvents(now);
    this.resolvePendingAttention(now);
    this.updateMemory(now);
  }

  private memoryFor(targetId: string, now: number): InteractionMemory {
    let entry = this.memory.get(targetId);
    if (!entry) {
      if (this.memory.size >= ENTITY_CONFIG.brain.memoryLimit) {
        const oldest = [...this.memory.values()].sort((left, right) => left.lastSeenAt - right.lastSeenAt)[0];
        if (oldest) this.memory.delete(oldest.targetId);
      }
      entry = makeMemory(targetId, now);
      this.memory.set(targetId, entry);
    }
    return entry;
  }

  private engagementFor(targetId: string, position: Vec2, salience: number): TargetEngagement {
    let engagement = this.targetEngagements.get(targetId);
    if (!engagement) {
      engagement = {
        position: { ...position },
        salience,
        hoverActive: false,
        focusActive: false,
        holdUntil: 0,
      };
      this.targetEngagements.set(targetId, engagement);
    }
    engagement.position = { ...position };
    engagement.salience = Math.max(engagement.salience * 0.8, salience);
    return engagement;
  }

  private recognitionFor(entry: InteractionMemory): number {
    return clamp(
      entry.affinity * 0.58 +
      Math.min(0.28, entry.hoverCount * 0.045 + entry.focusCount * 0.065) +
      Math.min(0.22, entry.activationCount * 0.11) +
      Math.min(0.18, entry.accumulatedDwellMs / 60000),
    );
  }

  private consumeEvents(now: number): void {
    while (this.queue.length) {
      const event = this.queue.shift();
      if (!event) break;
      const position = event.positionViewport;
      const velocity = event.velocityViewport;
      const targetId = event.targetId;
      switch (event.type) {
        case 'POINTER_MOVE': {
          const speed = velocity ? Math.hypot(velocity.x, velocity.y) : 0;
          this.impulses.interaction += event.salience * 0.08;
          this.impulses.novelty += clamp(speed / 1800) * 0.035;
          this.lastInteractionAt = event.timestamp;
          if (!this.attentionTargetId && position) this.attentionPosition = { ...position };
          break;
        }
        case 'POINTER_IDLE':
          this.impulses.calm += event.salience * 0.16;
          break;
        case 'POINTER_ENTER_REGION':
        case 'PROJECT_HOVER_START':
        case 'PROJECT_FOCUS':
        case 'REGION_FOCUS': {
          if (!targetId || !position) break;
          const entry = this.memoryFor(targetId, event.timestamp);
          const engagement = this.engagementFor(targetId, position, event.salience);
          const focused = event.type === 'PROJECT_FOCUS' || event.type === 'REGION_FOCUS';
          if (focused) engagement.focusActive = true;
          else engagement.hoverActive = true;
          entry.lastSeenAt = event.timestamp;
          if (focused) entry.focusCount += 1;
          else entry.hoverCount += 1;
          const recognition = this.recognitionFor(entry);
          const threshold = (focused
            ? ENTITY_CONFIG.interaction.focusDwellMs
            : this.rng.range(...ENTITY_CONFIG.interaction.hoverDwellMs)) *
            mix(
              ENTITY_CONFIG.interaction.recognitionDwellScale[1],
              ENTITY_CONFIG.interaction.recognitionDwellScale[0],
              recognition,
            );
          this.pendingAttention = {
            id: targetId,
            startedAt: event.timestamp,
            thresholdMs: threshold,
            salience: event.salience + entry.affinity * 0.34 + (focused ? 0.2 : 0) - entry.cooldown * 0.14,
            position: { ...position },
            source: event.source,
          };
          this.rapidTargets.push({ id: targetId, timestamp: event.timestamp });
          const cutoff = event.timestamp - ENTITY_CONFIG.interaction.rapidTargetWindowMs;
          this.rapidTargets = this.rapidTargets.filter((sample) => sample.timestamp >= cutoff);
          const rapidlyVisitedTargets = new Set(this.rapidTargets.map((sample) => sample.id)).size;
          if (rapidlyVisitedTargets >= ENTITY_CONFIG.interaction.rapidTargetLimit) {
            this.impulses.uncertainty += 0.28;
            this.pendingAttention.salience *= 0.62;
            entry.uncertainty = clamp(entry.uncertainty + 0.08);
          }
          this.lastInteractionAt = event.timestamp;
          this.impulses.novelty += (0.05 + entry.novelty * 0.16) * event.salience;
          entry.novelty = clamp(entry.novelty - (focused ? 0.07 : 0.045));
          entry.cooldown = Math.max(0, entry.cooldown - 0.08);
          break;
        }
        case 'POINTER_LEAVE_REGION':
        case 'PROJECT_HOVER_END':
        case 'PROJECT_BLUR':
        case 'REGION_BLUR': {
          if (!targetId) break;
          const engagement = this.targetEngagements.get(targetId);
          const focused = event.type === 'PROJECT_BLUR' || event.type === 'REGION_BLUR';
          if (engagement) {
            if (focused) engagement.focusActive = false;
            else engagement.hoverActive = false;
          }
          const stillEngaged = Boolean(engagement?.hoverActive || engagement?.focusActive);
          if (!stillEngaged) {
            this.completeDwell(targetId, event.timestamp);
            if (this.pendingAttention?.id === targetId) this.pendingAttention = null;
            const entry = this.memoryFor(targetId, event.timestamp);
            const recognition = this.recognitionFor(entry);
            if (engagement) {
              engagement.holdUntil = event.timestamp + this.rng.range(0.84, 1.16) * mix(
                ENTITY_CONFIG.interaction.familiarAttentionHoldMs[0],
                ENTITY_CONFIG.interaction.familiarAttentionHoldMs[1],
                recognition,
              );
            }
            if (this.attentionTargetId === targetId && (!engagement || engagement.holdUntil <= event.timestamp)) {
              this.attentionTargetId = null;
              this.internal.attentionConfidence *= 0.72;
            }
          }
          break;
        }
        case 'PROJECT_ACTIVATED':
        case 'REGION_ACTIVATED': {
          if (!targetId) break;
          const entry = this.memoryFor(targetId, event.timestamp);
          entry.activationCount += 1;
          entry.lastActivatedAt = event.timestamp;
          entry.lastSeenAt = event.timestamp;
          entry.affinity = clamp(entry.affinity + 0.22 * event.salience);
          entry.uncertainty = clamp(entry.uncertainty - 0.18);
          entry.novelty = clamp(entry.novelty - 0.16);
          entry.cooldown = clamp(entry.cooldown + 0.18);
          if (position) {
            this.pendingAttention = {
              id: targetId,
              startedAt: event.timestamp,
              thresholdMs: 0,
              salience: 1.2 + entry.affinity * 0.32,
              position: { ...position },
              source: event.source,
            };
          }
          this.impulses.interaction += 0.48 * event.salience;
          this.impulses.novelty += 0.08 + entry.novelty * 0.12;
          this.lastInteractionAt = event.timestamp;
          break;
        }
        case 'SCROLL_START':
          this.impulses.scroll += 0.22 * event.salience;
          this.impulses.interaction += 0.08;
          this.lastInteractionAt = event.timestamp;
          break;
        case 'SCROLL_IMPULSE': {
          const acceleration = velocity ? Math.abs(velocity.y) : 0;
          this.impulses.scroll += clamp(event.salience + acceleration / 2200) * 0.5;
          this.impulses.interaction += event.salience * 0.12;
          this.lastInteractionAt = event.timestamp;
          break;
        }
        case 'SCROLL_SETTLED':
          this.impulses.calm += 0.08;
          break;
        case 'SECTION_ENTER': {
          if (targetId) {
            const entry = this.memoryFor(`section:${targetId}`, event.timestamp);
            const familiar = clamp(entry.hoverCount * 0.08 + entry.accumulatedDwellMs / 90000);
            entry.hoverCount += 1;
            entry.lastSeenAt = event.timestamp;
            entry.novelty = clamp(entry.novelty - 0.08);
            this.sectionDwellStarts.set(targetId, event.timestamp);
            this.impulses.novelty += (1 - familiar) * 0.26 * event.salience;
          }
          break;
        }
        case 'SECTION_LEAVE': {
          if (!targetId) break;
          const startedAt = this.sectionDwellStarts.get(targetId);
          this.sectionDwellStarts.delete(targetId);
          if (!startedAt) break;
          const entry = this.memoryFor(`section:${targetId}`, event.timestamp);
          const dwell = Math.max(0, event.timestamp - startedAt);
          entry.accumulatedDwellMs += dwell;
          entry.affinity = clamp(entry.affinity + Math.min(0.1, dwell / 90000));
          entry.uncertainty = clamp(entry.uncertainty - Math.min(0.08, dwell / 120000));
          break;
        }
        case 'RELEASE_REQUESTED':
        case 'RETURN_REQUESTED':
          this.impulses.interaction += 0.72;
          this.impulses.novelty += 0.4;
          this.lastInteractionAt = event.timestamp;
          break;
        case 'ENTITY_DISABLED':
          this.impulses.calm += 0.5;
          break;
        case 'ENTITY_ENABLED':
          this.impulses.novelty += 0.3;
          this.impulses.interaction += 0.25;
          break;
        case 'PAGE_VISIBLE':
          this.impulses.novelty += 0.12;
          break;
        case 'PAGE_HIDDEN':
          this.completeDwell(this.activeDwellTarget, event.timestamp);
          for (const engagement of this.targetEngagements.values()) {
            engagement.hoverActive = false;
            engagement.focusActive = false;
            engagement.holdUntil = 0;
          }
          this.pendingAttention = null;
          this.attentionTargetId = null;
          this.impulses.calm += 0.18;
          break;
        case 'LAYOUT_CHANGED':
          this.impulses.novelty += 0.035 * event.salience;
          break;
      }
    }
    if (!this.lastInteractionAt) this.lastInteractionAt = now;
  }

  private resolvePendingAttention(now: number): void {
    if (this.attentionTargetId) {
      const engagement = this.targetEngagements.get(this.attentionTargetId);
      const active = Boolean(engagement?.hoverActive || engagement?.focusActive);
      if (!active && (!engagement || now >= engagement.holdUntil)) {
        this.attentionTargetId = null;
        this.internal.attentionConfidence *= 0.72;
      }
    }
    const pending = this.pendingAttention;
    if (!pending || now - pending.startedAt < pending.thresholdMs) return;
    const currentMemory = this.attentionTargetId ? this.memory.get(this.attentionTargetId) : null;
    const currentSalience = currentMemory ? 0.42 + currentMemory.affinity * 0.4 : 0;
    const switchCost = this.attentionTargetId && this.attentionTargetId !== pending.id
      ? ENTITY_CONFIG.interaction.attentionSwitchCost
      : 0;
    if (pending.salience >= currentSalience + switchCost || this.attentionTargetId === pending.id) {
      this.completeDwell(this.activeDwellTarget, now);
      this.attentionTargetId = pending.id;
      this.attentionPosition = { ...pending.position };
      this.activeDwellTarget = pending.id;
      this.activeDwellStart = now;
      const entry = this.memoryFor(pending.id, now);
      this.internal.attentionConfidence = clamp(0.36 + entry.affinity * 0.46 + pending.salience * 0.2);
      this.internal.confidence = clamp(this.internal.confidence + entry.affinity * 0.035);
      this.interactionEnergy = clamp(this.interactionEnergy + pending.salience * 0.32, 0, 2);
    }
    this.pendingAttention = null;
  }

  private completeDwell(targetId: string | null, now: number): void {
    if (!targetId || this.activeDwellTarget !== targetId || !this.activeDwellStart) return;
    const entry = this.memoryFor(targetId, now);
    const dwell = Math.max(0, now - this.activeDwellStart);
    entry.accumulatedDwellMs += dwell;
    entry.lastSeenAt = now;
    entry.affinity = clamp(entry.affinity + Math.min(0.18, dwell / 26000));
    entry.uncertainty = clamp(entry.uncertainty - Math.min(0.16, dwell / 36000));
    entry.novelty = clamp(entry.novelty - Math.min(0.18, dwell / 48000));
    entry.cooldown = clamp(entry.cooldown + Math.min(0.38, dwell / 22000));
    this.activeDwellTarget = null;
    this.activeDwellStart = 0;
  }

  private updateMemory(now: number): void {
    if (now - this.lastMemoryDecayAt < 1000) return;
    const elapsedSeconds = this.lastMemoryDecayAt ? (now - this.lastMemoryDecayAt) / 1000 : 1;
    this.lastMemoryDecayAt = now;
    for (const entry of this.memory.values()) {
      const ageSeconds = Math.max(0, (now - entry.lastSeenAt) / 1000);
      const ageScale = 1 + clamp(ageSeconds / 180, 0, 3);
      const engagement = this.targetEngagements.get(entry.targetId);
      if (engagement?.hoverActive || engagement?.focusActive) {
        entry.lastSeenAt = now;
        if (this.activeDwellTarget === entry.targetId && this.activeDwellStart) {
          const dwell = Math.max(0, now - this.activeDwellStart);
          entry.accumulatedDwellMs += dwell;
          entry.affinity = clamp(entry.affinity + Math.min(0.18, dwell / 26000));
          entry.uncertainty = clamp(entry.uncertainty - Math.min(0.16, dwell / 36000));
          entry.novelty = clamp(entry.novelty - Math.min(0.18, dwell / 48000));
          entry.cooldown = clamp(entry.cooldown + Math.min(0.38, dwell / 22000));
          this.activeDwellStart = now;
        }
      }
      entry.affinity = clamp(entry.affinity - ENTITY_CONFIG.brain.memoryDecayPerSecond * elapsedSeconds * ageScale);
      entry.uncertainty = clamp(entry.uncertainty + ENTITY_CONFIG.brain.memoryDecayPerSecond * elapsedSeconds * 0.42);
      entry.novelty = clamp(entry.novelty + ENTITY_CONFIG.brain.memoryDecayPerSecond * elapsedSeconds * 0.18);
      entry.cooldown = clamp(entry.cooldown - elapsedSeconds * 0.025);
      if (engagement && !engagement.hoverActive && !engagement.focusActive && now - entry.lastSeenAt > 60000) {
        this.targetEngagements.delete(entry.targetId);
      }
    }
  }

  private idlePressure(now: number): number {
    const idleSeconds = Math.max(0, (now - this.lastInteractionAt) / 1000);
    const thresholdNoise = clamp(
      fractalNoise2(this.lastInteractionAt * 0.000017, this.sessionSeed * 0.00019, this.sessionSeed + 421) * 0.5 + 0.5,
    );
    const threshold = mix(
      ENTITY_CONFIG.brain.idleEntropyRangeSeconds[0],
      ENTITY_CONFIG.brain.idleEntropyRangeSeconds[1],
      thresholdNoise,
    );
    return clamp((idleSeconds - threshold) / Math.max(12, threshold * 0.82));
  }

  private updateDrives(context: BrainContext): void {
    const delta = Math.min(context.delta, 0.05);
    const idle = this.idlePressure(context.now);
    const target = this.attentionTargetId ? 1 : 0;
    const currentMemory = this.attentionTargetId ? this.memory.get(this.attentionTargetId) : null;
    const familiarity = currentMemory?.affinity ?? 0;
    const stateNoise = fractalNoise2(context.now * 0.000027, this.sessionSeed * 0.0001, this.sessionSeed);
    const fragmentation = this.cognitiveState === 'FRAGMENTING' ? 1 : 0;
    const reforming = this.cognitiveState === 'REFORMING' ? 1 : 0;
    const inspecting = this.cognitiveState === 'INSPECTING' ? 1 : 0;
    const thinking = this.cognitiveState === 'THINKING' ? 1 : 0;
    const spatialTransition = ['RELEASING', 'RELOCATING', 'RETURNING'].includes(context.spatialMode) ? 1 : 0;
    const activity = clamp(this.impulses.interaction + this.impulses.scroll * 0.55, 0, 1.5);

    const derivative = {
      curiosity: this.impulses.novelty * 0.52 + target * 0.1 + stateNoise * 0.025 - ENTITY_CONFIG.brain.driveDecay.curiosity * this.internal.curiosity,
      arousal: activity * 0.5 + this.impulses.scroll * 0.38 + spatialTransition * 0.16 - this.impulses.calm * 0.16 - ENTITY_CONFIG.brain.driveDecay.arousal * this.internal.arousal,
      cohesion: inspecting * 0.24 + reforming * 0.52 + target * 0.08 - fragmentation * 0.68 - spatialTransition * 0.32 - idle * 0.055 - ENTITY_CONFIG.brain.driveDecay.cohesion * (this.internal.cohesion - 0.62),
      entropy: idle * 0.095 + thinking * 0.085 + fragmentation * 0.31 + spatialTransition * 0.08 - target * 0.11 - reforming * 0.52 - ENTITY_CONFIG.brain.driveDecay.entropy * this.internal.entropy,
      confidence: target * (0.035 + familiarity * 0.065) + this.internal.attentionConfidence * 0.04 - this.impulses.uncertainty * 0.25 - ENTITY_CONFIG.brain.driveDecay.confidence * (this.internal.confidence - 0.32),
      fatigue: (activity + inspecting * 0.25) * 0.045 - (this.cognitiveState === 'DORMANT' ? 0.08 : 0) - ENTITY_CONFIG.brain.driveDecay.fatigue * this.internal.fatigue,
      trust: target * (0.005 + familiarity * 0.012) + this.impulses.calm * 0.01 - ENTITY_CONFIG.brain.driveDecay.trust * this.internal.trust,
      attentionConfidence: target * 0.2 - (1 - target) * 0.14 - this.impulses.uncertainty * 0.2 - ENTITY_CONFIG.brain.driveDecay.attentionConfidence * this.internal.attentionConfidence,
      socialDistance: this.impulses.uncertainty * 0.16 + clamp(1 - context.pointerDistanceToEntity / 150) * 0.18 - this.internal.trust * 0.05 - ENTITY_CONFIG.brain.driveDecay.socialDistance * (this.internal.socialDistance - 0.62),
    };

    for (const key of Object.keys(derivative) as Array<keyof EntityInternalState>) {
      this.internal[key] = clamp(this.internal[key] + derivative[key] * delta);
    }
    if (context.reducedMotion) {
      this.internal.cohesion = Math.max(this.internal.cohesion, ENTITY_CONFIG.reducedMotion.minimumCoherence);
      this.internal.entropy = Math.min(this.internal.entropy, 0.32);
    }
    this.interactionEnergy = Math.max(0, this.interactionEnergy * Math.exp(-delta * 0.48) + activity * delta * 0.28);
    this.impulses.novelty *= Math.exp(-delta * 1.2);
    this.impulses.interaction *= Math.exp(-delta * 2.2);
    this.impulses.scroll *= Math.exp(-delta * 2.8);
    this.impulses.uncertainty *= Math.exp(-delta * 0.72);
    this.impulses.calm *= Math.exp(-delta * 0.9);
    this.fragmentRecoveryPressure = this.cognitiveState === 'FRAGMENTING'
      ? clamp(this.fragmentRecoveryPressure + delta * (0.05 + (1 - this.internal.fatigue) * 0.055))
      : Math.max(0, this.fragmentRecoveryPressure - delta * 0.18);
  }

  private evaluateState(context: BrainContext): void {
    if (!this.stateEnteredAt) this.enterState('DORMANT', context.now, 'boot');
    const salientAttention = Boolean(
      this.attentionTargetId &&
      this.internal.attentionConfidence > 0.56 &&
      this.interactionEnergy > 0.18,
    );
    if (context.now < this.nextDecisionAt || (context.now < this.minimumDwellUntil && !salientAttention)) return;
    const idle = this.idlePressure(context.now);
    const currentMemory = this.attentionTargetId ? this.memory.get(this.attentionTargetId) : null;
    const features: Record<string, number> = {
      ...this.internal,
      idle,
      target: this.attentionTargetId ? 1 : 0,
      novelty: Math.max(this.impulses.novelty, currentMemory?.novelty ?? 0),
      uncertainty: currentMemory?.uncertainty ?? this.impulses.uncertainty,
      affinity: currentMemory?.affinity ?? 0,
      reformNeed: this.fragmentRecoveryPressure,
    };

    let bestState = this.cognitiveState;
    let bestUtility = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < COGNITIVE_STATES.length; index += 1) {
      const candidate = COGNITIVE_STATES[index];
      if (context.reducedMotion && (candidate === 'FRAGMENTING' || candidate === 'REFORMING')) {
        this.utilities[candidate] = -10;
        continue;
      }
      const weights = ENTITY_CONFIG.brain.stateWeights[candidate];
      let utility = 0;
      for (const [feature, weight] of Object.entries(weights)) utility += (features[feature] || 0) * weight;
      utility += fractalNoise2(context.now * 0.000071 + index * 13.7, this.sessionSeed * 0.00031, this.sessionSeed + index * 97) * 0.17;
      if (candidate === this.cognitiveState) utility += ENTITY_CONFIG.brain.utilityHysteresis;
      else utility -= ENTITY_CONFIG.brain.transitionCost;
      if (candidate === this.previousState && this.interactionEnergy < 0.72) utility -= ENTITY_CONFIG.brain.previousStatePenalty;
      if (candidate === 'FRAGMENTING' && this.internal.entropy < 0.55) utility -= 0.7;
      if (candidate === 'REFORMING' && this.fragmentRecoveryPressure < 0.32 && this.cognitiveState !== 'FRAGMENTING') utility -= 0.85;
      if (candidate === 'INSPECTING' && !this.attentionTargetId) utility -= 1.1;
      if (candidate === 'INSPECTING' && currentMemory) utility -= currentMemory.cooldown * 0.28;
      if (candidate === 'DORMANT' && this.attentionTargetId) utility -= 0.65;
      this.utilities[candidate] = utility;
      if (utility > bestUtility) {
        bestUtility = utility;
        bestState = candidate;
      }
    }

    const currentUtility = this.utilities[this.cognitiveState];
    const strongInterrupt = this.interactionEnergy > 0.95 || this.internal.entropy > 0.84;
    if (
      bestState !== this.cognitiveState &&
      context.now >= this.refractoryUntil &&
      (strongInterrupt || bestUtility > currentUtility + ENTITY_CONFIG.brain.utilityHysteresis)
    ) {
      this.enterState(bestState, context.now, strongInterrupt ? 'salient-interrupt' : 'weighted-utility');
    }
    this.nextDecisionAt = context.now + this.rng.range(...ENTITY_CONFIG.brain.decisionIntervalSeconds) * 1000;
  }

  private enterState(next: CognitiveState, now: number, reason: string): void {
    if (next !== this.cognitiveState) this.previousState = this.cognitiveState;
    this.cognitiveState = next;
    this.stateEnteredAt = now;
    this.stateReason = reason;
    this.stateChanged = true;
    const dwell = ENTITY_CONFIG.brain.stateMinimumDwell[next];
    this.minimumDwellUntil = now + this.rng.range(dwell[0], dwell[1]) * 1000;
    this.refractoryUntil = now + this.rng.range(...ENTITY_CONFIG.brain.refractorySeconds) * 1000;
    this.nextDecisionAt = Math.min(this.minimumDwellUntil, now + this.rng.range(...ENTITY_CONFIG.brain.decisionIntervalSeconds) * 1000);
    if (next === 'REFORMING') this.fragmentRecoveryPressure = 0;
  }

  private chooseMotorIntent(context: BrainContext): MotorIntent {
    if (context.spatialMode === 'HIDDEN') return 'WITHDRAW';
    if (context.spatialMode === 'RELEASING' || context.spatialMode === 'RELOCATING' || context.spatialMode === 'RETURNING') {
      return (context.transitionProgress || 0) < 0.52 ? 'DISSOLVE' : 'REASSEMBLE';
    }
    if (context.pointerDistanceToEntity < 78 && this.internal.trust < 0.55) return 'AVOID';
    if (this.cognitiveState === 'FRAGMENTING') return 'DISSOLVE';
    if (this.cognitiveState === 'REFORMING') return 'REASSEMBLE';
    if (this.cognitiveState === 'INSPECTING' && this.attentionTargetId) return 'REACH';
    if (this.cognitiveState === 'CURIOUS' && this.attentionTargetId) return context.released ? 'APPROACH' : 'ORIENT';
    if (this.cognitiveState === 'CURIOUS') return 'ORIENT';
    if (this.attentionTargetId) return 'TRACK';
    return 'IDLE';
  }
}
