import { ENTITY_CONFIG } from './config';
import { clamp } from './random';
import type { AnchorCandidate, CognitiveState, EntityObstacle, OccupancySnapshot, ObstacleKind, RectLike, Vec2 } from './types';

interface AnchorScoreInput {
  id: string;
  position: Vec2;
  viewport: { width: number; height: number };
  fieldSize: { width: number; height: number };
  obstacles: EntityObstacle[];
  currentAnchor: Vec2;
  pointer: Vec2;
  preferred: Vec2;
  sectionFocusY?: number;
  recentAnchors?: Vec2[];
  interestPosition?: Vec2;
  cognitiveState?: CognitiveState;
  interestTargetId?: string;
  activeSectionId?: string;
}

interface SelectAnchorInput {
  viewport: { width: number; height: number };
  fieldSize: { width: number; height: number };
  obstacles: EntityObstacle[];
  currentAnchor: Vec2;
  pointer: Vec2;
  sectionFocusY?: number;
  recentAnchors?: Vec2[];
  mobile?: boolean;
  interestPosition?: Vec2;
  cognitiveState?: CognitiveState;
  explicitAnchors?: Array<{ id: string; position: Vec2 }>;
  interestTargetId?: string;
  activeSectionId?: string;
}

function makeRect(center: Vec2, width: number, height: number): RectLike {
  return {
    left: center.x - width * 0.5,
    top: center.y - height * 0.5,
    right: center.x + width * 0.5,
    bottom: center.y + height * 0.5,
    width,
    height,
  };
}

function rectFromDom(rect: DOMRect): RectLike {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function intersectionArea(left: RectLike, right: RectLike): number {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

function segmentIntersectsRect(from: Vec2, to: Vec2, rect: RectLike): boolean {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const p = [-deltaX, deltaX, -deltaY, deltaY];
  const q = [from.x - rect.left, rect.right - from.x, from.y - rect.top, rect.bottom - from.y];
  let enter = 0;
  let leave = 1;
  for (let index = 0; index < 4; index += 1) {
    if (Math.abs(p[index]) < 0.000001) {
      if (q[index] < 0) return false;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) enter = Math.max(enter, ratio);
    else leave = Math.min(leave, ratio);
    if (enter > leave) return false;
  }
  return true;
}

export function relocationPathIsClear(
  from: Vec2,
  to: Vec2,
  obstacles: EntityObstacle[],
  corridor = 0,
): boolean {
  return !obstacles.some((obstacle) => obstacle.visible &&
    segmentIntersectsRect(from, to, corridor > 0 ? expandRect(obstacle.rect, corridor) : obstacle.rect));
}

export function expandRect(rect: RectLike, amount: number): RectLike {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

export function preferredAnchorPosition(
  viewport: { width: number; height: number },
  mobile = viewport.width < 700,
): Vec2 {
  const wideDesktop = viewport.width >= 1600;
  return {
    x: viewport.width * (mobile ? 0.72 : wideDesktop ? 0.7 : 0.84),
    y: viewport.height * (mobile ? 0.66 : wideDesktop ? 0.6 : 0.54),
  };
}

export function specimenApproachPositions(
  rect: Pick<RectLike, 'left' | 'right'>,
  approach: 'left' | 'right' | 'either',
  fieldWidth: number,
): Array<{ suffix: 'approach-left' | 'approach-right'; x: number }> {
  const standoff = fieldWidth * 0.58;
  const positions: Array<{ suffix: 'approach-left' | 'approach-right'; x: number }> = [];
  if (approach !== 'right') positions.push({ suffix: 'approach-left', x: rect.left - standoff });
  if (approach !== 'left') positions.push({ suffix: 'approach-right', x: rect.right + standoff });
  return positions;
}

/**
 * Novel roaming should explore the other half of the viewport instead of
 * repeatedly selecting another point on the same rail. The neutral band keeps
 * ordinary continuity intact when the entity is already near the center.
 */
export function oppositeSideNoveltyWeight(currentX: number, candidateX: number, viewportWidth: number): number {
  const current = currentX / Math.max(1, viewportWidth);
  const candidate = candidateX / Math.max(1, viewportWidth);
  if (current >= 0.58 && candidate <= 0.46) return 3.8;
  if (current <= 0.42 && candidate >= 0.54) return 3.4;
  if (current >= 0.58 && candidate < current - 0.18) return 1.75;
  if (current <= 0.42 && candidate > current + 0.18) return 1.65;
  return 1;
}

export function scoreAnchorCandidate(input: AnchorScoreInput): AnchorCandidate {
  const { viewport, fieldSize, position, obstacles } = input;
  const fieldRect = makeRect(position, fieldSize.width, fieldSize.height);
  const coreRect = makeRect(position, fieldSize.width * 0.48, fieldSize.height * 0.62);
  const fieldArea = Math.max(1, fieldRect.width * fieldRect.height);
  const coreArea = Math.max(1, coreRect.width * coreRect.height);
  const reasons: string[] = [];
  let weightedOverlap = 0;
  let coreOverlap = 0;
  let criticalIntersection = false;

  for (const obstacle of obstacles) {
    if (!obstacle.visible) continue;
    const fieldIntersection = intersectionArea(fieldRect, obstacle.rect);
    if (!fieldIntersection) continue;
    const coreIntersection = intersectionArea(coreRect, obstacle.rect);
    weightedOverlap += fieldIntersection * obstacle.priority;
    coreOverlap += coreIntersection;
    if (coreIntersection / coreArea > ENTITY_CONFIG.anchors.perObstacleCoreOverlapRatio) {
      criticalIntersection = true;
      reasons.push(`core:${obstacle.id}`);
    }
    if (
      fieldIntersection > fieldArea * ENTITY_CONFIG.anchors.peripheralProtectedOverlapRatio &&
      ['interactive', 'modal'].includes(obstacle.kind)
    ) {
      criticalIntersection = true;
      reasons.push(`protected:${obstacle.id}`);
    }
  }

  const overlapRatio = coreOverlap / coreArea;
  const edgeClearance = input.viewport.width < 700
    ? ENTITY_CONFIG.anchors.viewportEdgeClearance.mobile
    : input.viewport.width < 1050
      ? ENTITY_CONFIG.anchors.viewportEdgeClearance.medium
      : ENTITY_CONFIG.anchors.viewportEdgeClearance.desktop;
  const clipped = fieldRect.left < edgeClearance || fieldRect.right > viewport.width - edgeClearance ||
    fieldRect.top < edgeClearance || fieldRect.bottom > viewport.height - edgeClearance;
  if (clipped) reasons.push('viewport-edge');
  const hardRejected = clipped || criticalIntersection || overlapRatio > ENTITY_CONFIG.anchors.hardCoreOverlapRatio;

  const negativeSpaceScore = 1 - clamp(weightedOverlap / fieldArea, 0, 1.5);
  const preferredDistance = Math.hypot(position.x - input.preferred.x, position.y - input.preferred.y) /
    Math.max(1, Math.hypot(viewport.width, viewport.height));
  const preferredSideBias = 1 - clamp(preferredDistance * 1.8);
  const continuityDistance = Math.hypot(position.x - input.currentAnchor.x, position.y - input.currentAnchor.y) /
    Math.max(1, Math.hypot(viewport.width, viewport.height));
  const continuityBias = (1 - clamp(continuityDistance)) * ENTITY_CONFIG.anchors.continuityWeight;
  const cursorDistance = Math.hypot(position.x - input.pointer.x, position.y - input.pointer.y);
  const cursorCollisionPenalty = 1 - clamp(cursorDistance / ENTITY_CONFIG.anchors.cursorClearance);
  const sectionAffinity = input.sectionFocusY == null
    ? 0
    : 1 - clamp(Math.abs(position.y - input.sectionFocusY) / Math.max(1, viewport.height * 0.65));
  const readingPathPenalty = input.sectionFocusY == null
    ? 0
    : (1 - clamp(Math.abs(position.y - input.sectionFocusY) / Math.max(70, fieldSize.height * 0.7))) *
      (1 - clamp((position.x / viewport.width - 0.56) / 0.34));
  const interestDistance = input.interestPosition
    ? Math.hypot(position.x - input.interestPosition.x, position.y - input.interestPosition.y)
    : Infinity;
  const idealInterestDistance = Math.max(fieldSize.width * 0.9, viewport.width * 0.16);
  const interestAffinity = input.interestPosition
    ? 1 - clamp(Math.abs(interestDistance - idealInterestDistance) / Math.max(idealInterestDistance * 1.8, 1))
    : 0;
  const recentPenalty = (input.recentAnchors || []).reduce((penalty, anchor) => {
    const distance = Math.hypot(position.x - anchor.x, position.y - anchor.y);
    return Math.max(penalty, (1 - clamp(distance / Math.max(180, fieldSize.width * 1.4))) * ENTITY_CONFIG.anchors.recentAnchorPenalty);
  }, 0);
  const excessiveTravelPenalty = clamp(continuityDistance * ENTITY_CONFIG.anchors.travelPenalty);
  const edgeDistance = Math.min(position.x, viewport.width - position.x, position.y, viewport.height - position.y);
  const viewportEdgePenalty = 1 - clamp(edgeDistance / Math.max(fieldSize.width * 0.6, 180));
  const horizontalRatio = position.x / Math.max(1, viewport.width);
  const wideEdgeParkingPenalty = viewport.width >= 1600
    ? clamp((horizontalRatio - 0.84) / 0.1) * 0.78 + (input.id.startsWith('right-rail') ? 0.18 : 0)
    : 0;
  const stateInterestWeight = input.cognitiveState === 'INSPECTING'
    ? 0.7
    : input.cognitiveState === 'CURIOUS'
      ? 0.48
      : 0.18;
  const stateContinuity = input.cognitiveState === 'DORMANT' || input.cognitiveState === 'THINKING' ? 0.24 : 0;
  const projectHostMatch = input.interestTargetId
    ? input.id.startsWith(`host:project:${input.interestTargetId}:`)
    : false;
  const sectionHostMatch = input.activeSectionId
    ? input.id.startsWith(`host:section:${input.activeSectionId}:`)
    : false;
  const hostAffinity = projectHostMatch ? 3.2 : sectionHostMatch ? 1.35 : input.id.startsWith('host:') ? 0.08 : 0;
  const score = negativeSpaceScore * 2.2 + preferredSideBias * 0.72 + continuityBias + stateContinuity * (1 - continuityDistance) +
    sectionAffinity * 0.32 + interestAffinity * stateInterestWeight + hostAffinity - readingPathPenalty * 0.54 -
    cursorCollisionPenalty * 0.52 - viewportEdgePenalty * 0.68 - recentPenalty - excessiveTravelPenalty -
    wideEdgeParkingPenalty -
    (hardRejected ? 100 : 0);

  return { id: input.id, position: { ...position }, score, hardRejected, overlapRatio, reasons };
}

export function selectSafeAnchor(input: SelectAnchorInput): { selected: AnchorCandidate; candidates: AnchorCandidate[] } {
  const { viewport } = input;
  const mobile = input.mobile ?? viewport.width < 700;
  const preferredPairs = mobile
    ? ENTITY_CONFIG.anchors.mobilePreferred
    : viewport.width < 1050
      ? ENTITY_CONFIG.anchors.mediumPreferred
      : viewport.width < 1600
        ? [
            [0.86, 0.79],
            [ENTITY_CONFIG.anchors.desktopPreferredX[0], ENTITY_CONFIG.anchors.desktopPreferredY[0]],
            [0.88, 0.3],
            [0.74, 0.76],
          ]
        : [
          [0.855, 0.252],
          [0.605, 0.765],
          [0.71, 0.28],
          [0.78, 0.72],
          [0.86, 0.32],
          [ENTITY_CONFIG.anchors.desktopPreferredX[0], ENTITY_CONFIG.anchors.desktopPreferredY[0]],
        ];
  const preferred = preferredAnchorPosition(viewport, mobile);
  const positions: Array<{ id: string; position: Vec2 }> = preferredPairs.map(([x, y], index) => ({
    id: `preferred-${index}`,
    position: { x: viewport.width * x, y: viewport.height * y },
  }));
  for (const anchor of input.explicitAnchors || []) positions.push({ id: anchor.id, position: { ...anchor.position } });
  const edgeClearance = mobile
    ? ENTITY_CONFIG.anchors.viewportEdgeClearance.mobile
    : viewport.width < 1050
      ? ENTITY_CONFIG.anchors.viewportEdgeClearance.medium
      : ENTITY_CONFIG.anchors.viewportEdgeClearance.desktop;
  const rightRailX = viewport.width - edgeClearance - input.fieldSize.width * 0.5;
  for (const [index, y] of [0.3, 0.54, 0.76].entries()) {
    positions.push({
      id: `right-rail-${index}`,
      position: {
        x: rightRailX,
        y: clamp(viewport.height * y, edgeClearance + input.fieldSize.height * 0.5, viewport.height - edgeClearance - input.fieldSize.height * 0.5),
      },
    });
  }
  if (!mobile) {
    const leftRailX = edgeClearance + input.fieldSize.width * 0.5;
    for (const [index, y] of [0.3, 0.54, 0.76].entries()) {
      positions.push({
        id: `left-rail-${index}`,
        position: {
          x: leftRailX,
          y: clamp(viewport.height * y, edgeClearance + input.fieldSize.height * 0.5, viewport.height - edgeClearance - input.fieldSize.height * 0.5),
        },
      });
    }
  }
  const columns = mobile ? 5 : 9;
  const rows = mobile ? 6 : 7;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      positions.push({
        id: `grid-${column}-${row}`,
        position: {
          x: viewport.width * (0.08 + (column / Math.max(1, columns - 1)) * 0.84),
          y: viewport.height * (0.1 + (row / Math.max(1, rows - 1)) * 0.8),
        },
      });
    }
  }
  const candidates = positions.map(({ id, position }) => scoreAnchorCandidate({
    id,
    position,
    viewport,
    fieldSize: input.fieldSize,
    obstacles: input.obstacles,
    currentAnchor: input.currentAnchor,
    pointer: input.pointer,
    preferred,
    sectionFocusY: input.sectionFocusY,
    recentAnchors: input.recentAnchors,
    interestPosition: input.interestPosition,
    cognitiveState: input.cognitiveState,
    interestTargetId: input.interestTargetId,
    activeSectionId: input.activeSectionId,
  })).sort((left, right) => right.score - left.score);
  const selected = candidates.find((candidate) => !candidate.hardRejected) || candidates[0] || {
    id: 'fallback',
    position: { x: viewport.width * 0.82, y: viewport.height * 0.54 },
    score: -100,
    hardRejected: true,
    overlapRatio: 1,
    reasons: ['no-candidate'],
  };
  return { selected, candidates };
}

function obstacleKind(element: Element): ObstacleKind {
  if (element.matches('[role="dialog"],dialog')) return 'modal';
  if (element.matches('[data-entity-project],.casefile')) return 'project';
  if (element.matches('a,button,input,textarea,select,[tabindex]:not([tabindex="-1"])')) return 'interactive';
  if (element.matches('h1,h2,h3')) return 'heading';
  return 'content';
}

function obstaclePriority(kind: ObstacleKind): number {
  if (kind === 'modal') return 1.5;
  if (kind === 'interactive') return 1.35;
  if (kind === 'heading') return 1.28;
  if (kind === 'project') return 1.2;
  if (kind === 'reading-line') return 1.1;
  return 0.78;
}

export class EntityOccupancyMap {
  private abortController = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private elementIds = new WeakMap<Element, string>();
  private idCounter = 0;
  private refreshTimer = 0;
  private activeSections = new Map<string, number>();
  private recentAnchors: Vec2[] = [];
  private snapshot: OccupancySnapshot = {
    width: 1,
    height: 1,
    columns: ENTITY_CONFIG.occupancy.columns,
    rows: ENTITY_CONFIG.occupancy.rows,
    grid: new Uint8Array(ENTITY_CONFIG.occupancy.columns * ENTITY_CONFIG.occupancy.rows),
    obstacles: [],
    candidates: [],
    revision: 0,
  };

  constructor() {
    if (typeof document === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleRefresh('resize-observer'));
    this.resizeObserver.observe(document.documentElement);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const id = element.dataset.section || element.id;
        if (!id) continue;
        if (entry.isIntersecting) this.activeSections.set(id, entry.intersectionRatio);
        else this.activeSections.delete(id);
      }
      this.scheduleRefresh('section-intersection');
    }, { threshold: [0, 0.18, 0.4, 0.65] });
    document.querySelectorAll<HTMLElement>('[data-section]').forEach((element) => this.intersectionObserver?.observe(element));
    this.mutationObserver = new MutationObserver(() => this.scheduleRefresh('mutation'));
    this.mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'open', 'aria-hidden', 'data-theme-resolved'],
    });
    const signal = this.abortController.signal;
    addEventListener('resize', () => this.scheduleRefresh('window-resize'), { passive: true, signal });
    addEventListener('scroll', () => this.scheduleRefresh('scroll-settled'), { passive: true, signal });
    document.addEventListener('transitionend', (event) => {
      const target = event.target;
      if (target instanceof Element && target.matches('[data-reveal],.entity-viewport,.entity-console')) {
        this.scheduleRefresh('layout-transition-end');
      }
    }, { signal });
    visualViewport?.addEventListener('resize', () => this.scheduleRefresh('visual-viewport'), { passive: true, signal });
    visualViewport?.addEventListener('scroll', () => this.scheduleRefresh('visual-viewport-scroll'), { passive: true, signal });
    document.fonts?.ready.then(() => this.scheduleRefresh('fonts-ready')).catch(() => undefined);
    this.refresh();
  }

  getSnapshot(): OccupancySnapshot {
    return this.snapshot;
  }

  getContainmentRect(): RectLike {
    const selector = document.documentElement.classList.contains('session-pending')
      ? '[data-session-entity-dock]'
      : '[data-entity-anchor="containment"],#entity-dock';
    const element = document.querySelector<HTMLElement>(selector);
    const rect = element?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) return rectFromDom(rect);
    return {
      left: innerWidth * 0.64,
      top: innerHeight * 0.2,
      right: innerWidth * 0.94,
      bottom: innerHeight * 0.78,
      width: innerWidth * 0.3,
      height: innerHeight * 0.58,
    };
  }

  chooseAnchor(
    currentAnchor: Vec2,
    pointer: Vec2,
    fieldSize: { width: number; height: number },
    options: {
      interestPosition?: Vec2;
      cognitiveState?: CognitiveState;
      interestTargetId?: string;
      activeSectionId?: string;
      specimenSectionId?: string;
    } = {},
  ): AnchorCandidate {
    const activeSection = [...this.activeSections.entries()].sort((left, right) => right[1] - left[1])[0];
    const section = activeSection ? document.querySelector<HTMLElement>(`[data-section="${CSS.escape(activeSection[0])}"]`) : null;
    const sectionRect = section?.getBoundingClientRect();
    const explicitAnchors = [...document.querySelectorAll<HTMLElement>('[data-entity-anchor]')]
      .filter((element) => element.dataset.entityAnchor !== 'containment' && !element.closest('[aria-hidden="true"]'))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight)
      .map(({ element, rect }) => ({
        id: `explicit:${element.dataset.entityAnchor || element.id || 'anchor'}`,
        position: { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 },
      }));
    const specimenAnchors = [...document.querySelectorAll<HTMLElement>('[data-entity-specimen-anchor]')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => element.dataset.entitySpecimenAnchor === `section:${options.specimenSectionId}` &&
        rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth)
      .map(({ element, rect }) => ({
        id: `host:${element.dataset.entitySpecimenAnchor}:explicit`,
        position: { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 },
      }));
    const hostAnchors = [...document.querySelectorAll<HTMLElement>('[data-entity-host]')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => Boolean(element.dataset.entityHost) && rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth)
      .flatMap(({ element, rect }) => {
        const host = element.dataset.entityHost!;
        const y = clamp(rect.top + rect.height * 0.5, fieldSize.height * 0.5 + 8, innerHeight - fieldSize.height * 0.5 - 8);
        const centers: Array<{ suffix: string; x: number }> = [];
        if (host.startsWith('section:')) {
          // Specimen encounters happen beside the artifact. The peripheral field
          // may bridge the remaining gap, but the dense core never reconstructs
          // directly over the specimen or the copy around it.
          const requestedApproach = element.dataset.entityApproach;
          const approach = requestedApproach === 'left' || requestedApproach === 'right'
            ? requestedApproach
            : 'either';
          centers.push(...specimenApproachPositions(rect, approach, fieldSize.width));
        } else {
          centers.push({ suffix: 'center', x: rect.left + rect.width * 0.5 });
        }
        if (!host.startsWith('section:') && rect.width >= fieldSize.width * 1.7) {
          centers.push(
            { suffix: 'near', x: rect.left + Math.max(fieldSize.width * 0.57, rect.width * 0.28) },
            { suffix: 'far', x: rect.right - Math.max(fieldSize.width * 0.57, rect.width * 0.28) },
          );
        }
        return centers.map(({ suffix, x }) => ({
          id: `host:${host}:${suffix}`,
          position: {
            x: clamp(x, fieldSize.width * 0.5 + 8, innerWidth - fieldSize.width * 0.5 - 8),
            y,
          },
        }));
      });
    const result = selectSafeAnchor({
      viewport: { width: this.snapshot.width, height: this.snapshot.height },
      fieldSize,
      obstacles: this.snapshot.obstacles,
      currentAnchor,
      pointer,
      sectionFocusY: sectionRect ? clamp(sectionRect.top + Math.min(sectionRect.height, innerHeight) * 0.48, 0, innerHeight) : undefined,
      recentAnchors: this.recentAnchors,
      mobile: this.snapshot.width < 700,
      interestPosition: options.interestPosition,
      cognitiveState: options.cognitiveState,
      explicitAnchors: [...hostAnchors, ...specimenAnchors, ...explicitAnchors],
      interestTargetId: options.interestTargetId,
      activeSectionId: options.activeSectionId || activeSection?.[0],
    });
    this.snapshot.candidates = result.candidates;
    return result.selected;
  }

  rememberAnchor(anchor: Vec2): void {
    this.recentAnchors.unshift({ ...anchor });
    this.recentAnchors.length = Math.min(this.recentAnchors.length, 4);
  }

  scheduleRefresh(_reason = 'manual'): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refresh(), ENTITY_CONFIG.occupancy.refreshDebounceMs);
  }

  refresh(): void {
    if (typeof document === 'undefined') return;
    const width = Math.max(1, visualViewport?.width || innerWidth);
    const height = Math.max(1, visualViewport?.height || innerHeight);
    const obstacles: EntityObstacle[] = [];
    const elements = document.querySelectorAll<HTMLElement>(ENTITY_CONFIG.occupancy.semanticSelector);
    for (const element of elements) {
      if (element.closest(ENTITY_CONFIG.occupancy.ignoreSelector) || element.closest('#entity-runtime-root')) continue;
      if (element.matches('[data-entity-obstacle]') && element.querySelector('[data-entity-host]')) continue;
      if (!document.documentElement.classList.contains('session-pending') && element.closest('#session-gate')) continue;
      if (element.closest('[aria-hidden="true"]')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.04) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width * rect.height < ENTITY_CONFIG.occupancy.minimumRectArea) continue;
      if (rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width) continue;
      const kind = obstacleKind(element);
      const clearance = width < 700
        ? ENTITY_CONFIG.anchors.contentClearance.mobile
        : width < 1050
          ? ENTITY_CONFIG.anchors.contentClearance.medium
          : ENTITY_CONFIG.anchors.contentClearance.desktop;
      const clipped: RectLike = {
        left: clamp(rect.left, 0, width),
        top: clamp(rect.top, 0, height),
        right: clamp(rect.right, 0, width),
        bottom: clamp(rect.bottom, 0, height),
        width: clamp(rect.right, 0, width) - clamp(rect.left, 0, width),
        height: clamp(rect.bottom, 0, height) - clamp(rect.top, 0, height),
      };
      let id = element.dataset.entityObstacle || element.dataset.entityProject || element.id || this.elementIds.get(element);
      if (!id) {
        id = `obstacle-${++this.idCounter}`;
        this.elementIds.set(element, id);
      }
      obstacles.push({
        id,
        rect: expandRect(clipped, kind === 'content' ? clearance * 0.42 : clearance * 0.7),
        kind,
        priority: obstaclePriority(kind),
        visible: true,
      });
    }
    const activeElement = document.activeElement as HTMLElement | null;
    if (activeElement && activeElement !== document.body) {
      const rect = activeElement.getBoundingClientRect();
      if (rect.width && rect.height) {
        const lineRect: RectLike = {
          left: 0,
          right: width,
          top: clamp(rect.top + rect.height * 0.5 - ENTITY_CONFIG.occupancy.readingLineHeight * 0.5, 0, height),
          bottom: clamp(rect.top + rect.height * 0.5 + ENTITY_CONFIG.occupancy.readingLineHeight * 0.5, 0, height),
          width,
          height: ENTITY_CONFIG.occupancy.readingLineHeight,
        };
        obstacles.push({ id: 'active-reading-line', rect: lineRect, kind: 'reading-line', priority: obstaclePriority('reading-line'), visible: true });
      }
    }
    const columns = ENTITY_CONFIG.occupancy.columns;
    const rows = ENTITY_CONFIG.occupancy.rows;
    const grid = new Uint8Array(columns * rows);
    for (const obstacle of obstacles) {
      const left = clamp(Math.floor(obstacle.rect.left / width * columns), 0, columns - 1);
      const right = clamp(Math.ceil(obstacle.rect.right / width * columns), 0, columns);
      const top = clamp(Math.floor(obstacle.rect.top / height * rows), 0, rows - 1);
      const bottom = clamp(Math.ceil(obstacle.rect.bottom / height * rows), 0, rows);
      const value = Math.round(clamp(obstacle.priority / 1.5) * 255);
      for (let row = top; row < bottom; row += 1) {
        for (let column = left; column < right; column += 1) {
          const index = row * columns + column;
          grid[index] = Math.max(grid[index], value);
        }
      }
    }
    this.snapshot = {
      width,
      height,
      columns,
      rows,
      grid,
      obstacles,
      candidates: this.snapshot.candidates,
      revision: this.snapshot.revision + 1,
    };
  }

  dispose(): void {
    this.abortController.abort();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.mutationObserver?.disconnect();
    window.clearTimeout(this.refreshTimer);
  }
}
