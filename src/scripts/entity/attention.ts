import { ENTITY_CONFIG } from './config';
import { clamp, fractalNoise2, hashString, mix } from './random';
import type { Vec2 } from './types';

export type AttentionKind = 'project' | 'region' | 'pointer' | 'section' | 'memory' | 'containment' | 'quiet' | 'drift';

export interface AttentionCandidate {
  id: string;
  kind: AttentionKind;
  position: Vec2;
  salience: number;
  familiarity: number;
  novelty: number;
  uncertainty: number;
  active: boolean;
  lastSeenAt: number;
}
export interface AttentionSelectionContext {
  now: number;
  seed: number;
  currentTargetId: string | null;
  curiosity: number;
  fatigue: number;
  confidence: number;
  attentionalCertainty: number;
  pointerSpeed: number;
}

export interface AttentionSelection {
  id: string | null;
  secondaryId: string | null;
  kind: AttentionKind | null;
  position: Vec2;
  score: number;
  confidence: number;
  abandoned: boolean;
}

const KIND_BIAS: Record<AttentionKind, number> = {
  project: 0.34,
  region: 0.22,
  pointer: 0.08,
  section: 0.17,
  memory: 0.1,
  containment: 0.02,
  quiet: 0.06,
  drift: -0.02,
};

export function scoreAttentionCandidate(candidate: AttentionCandidate, context: AttentionSelectionContext): number {
  const ageSeconds = Math.max(0, context.now - candidate.lastSeenAt) / 1000;
  const agePenalty = clamp(ageSeconds / (candidate.kind === 'memory' ? 180 : 28)) * 0.42;
  const pointerUncertainty = candidate.kind === 'pointer' ? clamp(context.pointerSpeed / 1500) * 0.44 : 0;
  const switchPenalty = context.currentTargetId && context.currentTargetId !== candidate.id
    ? ENTITY_CONFIG.interaction.attentionSwitchCost
    : 0;
  const persistence = context.currentTargetId === candidate.id ? 0.3 : 0;
  const procedural = fractalNoise2(
    context.now * 0.000037 + hashString(candidate.id) * 0.000001,
    candidate.salience * 7.1,
    context.seed ^ hashString(candidate.kind),
  ) * 0.13;
  return candidate.salience * 0.82 + KIND_BIAS[candidate.kind] + (candidate.active ? 0.24 : 0) +
    candidate.familiarity * (0.2 + context.confidence * 0.24) +
    candidate.novelty * context.curiosity * 0.34 + persistence + procedural -
    candidate.uncertainty * 0.48 - context.fatigue * 0.16 - pointerUncertainty - agePenalty - switchPenalty;
}

export function selectAttentionTarget(
  candidates: AttentionCandidate[],
  context: AttentionSelectionContext,
  fallbackPosition: Vec2,
): AttentionSelection {
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreAttentionCandidate(candidate, context) }))
    .sort((left, right) => right.score - left.score);
  const autonomyNoise = fractalNoise2(
    context.now * 0.000021,
    context.seed * 0.00013,
    context.seed + 1907,
  );
  const noResponseUtility = 0.24 + (1 - context.attentionalCertainty) * 0.22 +
    context.fatigue * 0.24 + clamp(context.pointerSpeed / 1800) * 0.24 + autonomyNoise * 0.14;
  const primary = scored[0];
  if (!primary || primary.score < noResponseUtility) {
    return {
      id: null,
      secondaryId: null,
      kind: null,
      position: { ...fallbackPosition },
      score: noResponseUtility,
      confidence: clamp(context.attentionalCertainty * 0.36),
      abandoned: Boolean(context.currentTargetId),
    };
  }

  const secondary = scored[1];
  const splitAttention = secondary && context.curiosity > 0.54 &&
    primary.score - secondary.score < 0.18 && primary.candidate.kind !== 'pointer';
  const split = splitAttention ? mix(0.06, 0.16, context.curiosity) : 0;
  const position = splitAttention ? {
    x: mix(primary.candidate.position.x, secondary.candidate.position.x, split),
    y: mix(primary.candidate.position.y, secondary.candidate.position.y, split),
  } : { ...primary.candidate.position };
  return {
    id: primary.candidate.id,
    secondaryId: splitAttention ? secondary.candidate.id : null,
    kind: primary.candidate.kind,
    position,
    score: primary.score,
    confidence: clamp(0.28 + primary.score * 0.42 + context.attentionalCertainty * 0.25),
    abandoned: false,
  };
}
