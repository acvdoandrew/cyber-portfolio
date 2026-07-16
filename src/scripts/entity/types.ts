export type SpatialMode =
  | 'SEALED'
  | 'RELEASING'
  | 'FREE'
  | 'RELOCATING'
  | 'RETURNING'
  | 'HIDDEN';

export type CognitiveState =
  | 'DORMANT'
  | 'OBSERVING'
  | 'CURIOUS'
  | 'INSPECTING'
  | 'THINKING'
  | 'FRAGMENTING'
  | 'REFORMING';

export type MotorIntent =
  | 'IDLE'
  | 'TRACK'
  | 'ORIENT'
  | 'APPROACH'
  | 'REACH'
  | 'WITHDRAW'
  | 'DISSOLVE'
  | 'REASSEMBLE'
  | 'AVOID';

export type BehaviorEpisodeKind =
  | 'SURVEY'
  | 'SPECIMEN'
  | 'ACKNOWLEDGE'
  | 'INSPECT'
  | 'ROAM'
  | 'SELF_MAINTAIN'
  | 'DECLINE';

export type BehaviorPhase =
  | 'ORIENT'
  | 'COMMIT'
  | 'TRANSIT'
  | 'ENGAGE'
  | 'SETTLE'
  | 'EXIT';

export type QualityTier = 'ultra' | 'high' | 'medium' | 'low' | 'mobile' | 'static';

export type SpecimenKind = 'black-hole' | 'galaxy' | 'relay' | 'graph' | 'orbit';

export interface SpecimenCouplingState {
  kind: SpecimenKind | null;
  strength: number;
  phase: number;
  direction: Vec2;
  distance: number;
}

export type PerceptionEventType =
  | 'POINTER_MOVE'
  | 'POINTER_IDLE'
  | 'POINTER_ENTER_REGION'
  | 'POINTER_LEAVE_REGION'
  | 'PROJECT_HOVER_START'
  | 'PROJECT_HOVER_END'
  | 'PROJECT_FOCUS'
  | 'PROJECT_BLUR'
  | 'PROJECT_ACTIVATED'
  | 'REGION_FOCUS'
  | 'REGION_BLUR'
  | 'REGION_ACTIVATED'
  | 'SCROLL_START'
  | 'SCROLL_IMPULSE'
  | 'SCROLL_SETTLED'
  | 'SECTION_ENTER'
  | 'SECTION_LEAVE'
  | 'PAGE_HIDDEN'
  | 'PAGE_VISIBLE'
  | 'RELEASE_REQUESTED'
  | 'RETURN_REQUESTED'
  | 'ENTITY_ENABLED'
  | 'ENTITY_DISABLED'
  | 'LAYOUT_CHANGED';

export type PerceptionSource = 'pointer' | 'keyboard' | 'touch' | 'scroll' | 'system';

export interface Vec2 {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PerceptionEvent {
  type: PerceptionEventType;
  timestamp: number;
  targetId?: string;
  positionViewport?: Vec2;
  velocityViewport?: Vec2;
  salience: number;
  source: PerceptionSource;
}

export interface InteractionMemory {
  targetId: string;
  hoverCount: number;
  focusCount: number;
  activationCount: number;
  accumulatedDwellMs: number;
  lastSeenAt: number;
  lastActivatedAt: number | null;
  affinity: number;
  uncertainty: number;
  novelty: number;
  cooldown: number;
}

export interface EntityInternalState {
  curiosity: number;
  arousal: number;
  cohesion: number;
  entropy: number;
  confidence: number;
  fatigue: number;
  trust: number;
  attentionConfidence: number;
  socialDistance: number;
}

export interface AnchorCandidate {
  id: string;
  position: Vec2;
  score: number;
  hardRejected: boolean;
  overlapRatio: number;
  reasons: string[];
}

export type ObstacleKind = 'content' | 'interactive' | 'heading' | 'project' | 'modal' | 'reading-line';

export interface EntityObstacle {
  id: string;
  rect: RectLike;
  kind: ObstacleKind;
  priority: number;
  visible: boolean;
}

export interface OccupancySnapshot {
  width: number;
  height: number;
  columns: number;
  rows: number;
  grid: Uint8Array;
  obstacles: EntityObstacle[];
  candidates: AnchorCandidate[];
  revision: number;
}

export const BODY_REGION = {
  CRANIAL_CORE: 0,
  CRANIAL_EDGE: 1,
  LOWER_HEAD: 2,
  NECK_BRIDGE: 3,
  LEFT_TRAPEZIUS: 4,
  RIGHT_TRAPEZIUS: 5,
  LEFT_SHOULDER: 6,
  RIGHT_SHOULDER: 7,
  UPPER_TORSO: 8,
  LOWER_TORSO: 9,
  PLUME: 10,
  FREE_FIELD: 11,
} as const;

export type BodyRegion = (typeof BODY_REGION)[keyof typeof BODY_REGION];

export interface EntityTopology {
  count: number;
  targets: Float32Array;
  listeningTargets: Float32Array;
  properties: Float32Array;
  appearance: Float32Array;
  regionCounts: Uint32Array;
  source: 'compact-faceless-humanoid-field';
}

export interface EntityPostureState {
  headTilt: number;
  lean: number;
  breath: number;
  shoulderSettle: number;
  shoulderCounter: number;
  surfaceFlow: number;
}

export interface EntityRuntimeFrame {
  revision: number;
  timestamp: number;
  delta: number;
  sessionSeed: number;
  spatialMode: SpatialMode;
  cognitiveState: CognitiveState;
  motorIntent: MotorIntent;
  episodeKind: BehaviorEpisodeKind | null;
  episodePhase: BehaviorPhase | null;
  episodeTargetId: string | null;
  episodeCommitment: number;
  activeHostId: string | null;
  attentionStrength: number;
  inspectionStrength: number;
  directionalBias: number;
  specimen: SpecimenCouplingState;
  lastVisibleActionAt: number;
  internal: EntityInternalState;
  activeAnchorId: string | null;
  attentionTargetId: string | null;
  attentionPosition: Vec2;
  gazeOrientation: Vec2;
  headOrientation: Vec2;
  gazeVelocity: Vec2;
  headVelocity: Vec2;
  pointerPosition: Vec2;
  pointerVelocity: Vec2;
  pointerProximity: number;
  pointerIntrusion: number;
  anchor: Vec2;
  anchorFrom: Vec2;
  anchorTarget: Vec2;
  anchorVelocity: Vec2;
  entityWidth: number;
  entityHeight: number;
  containmentRect: RectLike;
  containmentStrength: number;
  transitionProgress: number;
  relocationCurve: number;
  reachPosition: Vec2;
  reachStrength: number;
  scrollVelocity: number;
  scrollAcceleration: number;
  scrollEnergy: number;
  scrollOrigin: number;
  interactionEnergy: number;
  formCoherence: number;
  boundRatio: number;
  posture: EntityPostureState;
  quality: QualityTier;
  enabled: boolean;
  visible: boolean;
  released: boolean;
  reducedMotion: boolean;
  simulationPaused: boolean;
  theme: 'dark' | 'light';
  status: string;
  frameTimeAverage: number;
  activeParticleCount: number;
}

export interface EntityRuntimeDebugSnapshot {
  frame: EntityRuntimeFrame;
  occupancy: OccupancySnapshot;
  memory: InteractionMemory[];
  recentEvents: PerceptionEvent[];
  candidateUtilities: Record<CognitiveState, number>;
  eventQueueDepth: number;
  particlePoolId: string;
  currentVisibleSection: string | null;
  debugState: {
    enabled: boolean;
    anchorFrozen: boolean;
    forcedCognitiveState: CognitiveState | null;
  };
}

export interface EntityRuntimeApi {
  readonly frame: EntityRuntimeFrame;
  readonly particlePoolId: string;
  update(time: number, delta: number): EntityRuntimeFrame;
  enqueue(event: PerceptionEvent): void;
  requestRelease(source?: PerceptionSource): void;
  requestReturn(source?: PerceptionSource): void;
  toggleRelease(source?: PerceptionSource): void;
  setEnabled(enabled: boolean, source?: PerceptionSource): void;
  setQuality(quality: QualityTier): void;
  setActiveParticleCount(count: number): void;
  getOccupancy(): OccupancySnapshot;
  getDebugSnapshot(): EntityRuntimeDebugSnapshot;
  requestLayoutRefresh(reason?: string): void;
  dispose(): void;
}

declare global {
  interface Window {
    __ENTITY_07_RUNTIME__?: EntityRuntimeApi;
    __ANDREW_VISUAL_STATE__?: {
      revision: number;
      pointer: { x: number; y: number; lastAt: number };
      entity: EntityRuntimeFrame | null;
    };
  }
}
