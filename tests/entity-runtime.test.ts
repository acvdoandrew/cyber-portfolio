import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EntityBrain } from '../src/scripts/entity/brain';
import { selectAttentionTarget } from '../src/scripts/entity/attention';
import {
  oppositeSideNoveltyWeight,
  relocationPathIsClear,
  scoreAnchorCandidate,
  selectSafeAnchor,
  specimenApproachPositions,
} from '../src/scripts/entity/occupancy';
import { EntityPerceptionStream } from '../src/scripts/entity/perception';
import {
  containmentStrengthFor,
  expensiveSimulationShouldPause,
  largeMotionAllowed,
  spatialModeIsReleased,
} from '../src/scripts/entity/policy';
import { progressiveParticleIndex } from '../src/scripts/entity/sampling';
import { createFacelessHumanoidTopology } from '../src/scripts/entity/topology';
import { ENTITY_CONFIG } from '../src/scripts/entity/config';
import { BODY_REGION } from '../src/scripts/entity/types';
import type { CognitiveState, EntityTopology, PerceptionEvent, PerceptionEventType, PerceptionSource } from '../src/scripts/entity/types';

const repository = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(resolve(repository, path), 'utf8');

function runBrain(seed: number, engaged: boolean, reducedMotion = false) {
  const brain = new EntityBrain(seed);
  const states: CognitiveState[] = [];
  let lastOutput;
  for (let step = 0; step < 72; step += 1) {
    const now = 1000 + step * 1000;
    const events: PerceptionEvent[] = [];
    if (engaged && step === 2) {
      events.push({
        type: 'PROJECT_HOVER_START', timestamp: now, targetId: 'project:edge',
        positionViewport: { x: 1080, y: 420 }, salience: 0.9, source: 'pointer',
      });
    }
    if (engaged && step === 5) {
      events.push({
        type: 'PROJECT_FOCUS', timestamp: now, targetId: 'project:edge',
        positionViewport: { x: 1080, y: 420 }, salience: 0.96, source: 'keyboard',
      });
    }
    if (engaged && step === 9) {
      events.push({
        type: 'PROJECT_ACTIVATED', timestamp: now, targetId: 'project:edge',
        positionViewport: { x: 1080, y: 420 }, salience: 1, source: 'keyboard',
      });
    }
    if (engaged && step > 10 && step < 25 && step % 3 === 0) {
      events.push({
        type: 'POINTER_MOVE', timestamp: now,
        positionViewport: { x: 850 + step * 8, y: 410 },
        velocityViewport: { x: 180, y: -24 }, salience: 0.32, source: 'pointer',
      });
    }
    events.forEach((event) => brain.enqueue(event));
    lastOutput = brain.update({
      now,
      delta: 1,
      spatialMode: 'FREE',
      released: true,
      reducedMotion,
      pointerDistanceToEntity: 280,
      activeSectionId: 'work',
    });
    states.push(lastOutput.cognitiveState);
  }
  return {
    states,
    internal: { ...lastOutput!.internal },
    memory: brain.getMemory(),
    utilities: brain.getUtilities(),
  };
}

function runEngagement(
  startType: PerceptionEventType,
  endType: PerceptionEventType,
  sourceType: PerceptionSource,
) {
  const brain = new EntityBrain(1707);
  let firstAttentionAt: number | null = null;
  for (let step = 0; step <= 34; step += 1) {
    const now = 1000 + step * 100;
    if (step === 0) {
      brain.enqueue({
        type: startType,
        timestamp: now,
        targetId: 'project:parity',
        positionViewport: { x: 980, y: 410 },
        salience: 0.92,
        source: sourceType,
      });
    }
    if (step === 25) {
      brain.enqueue({
        type: endType,
        timestamp: now,
        targetId: 'project:parity',
        positionViewport: { x: 980, y: 410 },
        salience: 0.5,
        source: sourceType,
      });
    }
    const output = brain.update({
      now,
      delta: 0.1,
      spatialMode: 'FREE',
      released: true,
      reducedMotion: false,
      pointerDistanceToEntity: 320,
      activeSectionId: 'work',
    });
    if (output.attentionTargetId === 'project:parity' && firstAttentionAt == null) firstAttentionAt = now;
  }
  return { firstAttentionAt, memory: brain.getMemory().find((entry) => entry.targetId === 'project:parity')! };
}

function recognitionLatency(familiar: boolean): number {
  const restored = familiar ? [{
    targetId: 'project:known',
    hoverCount: 5,
    focusCount: 2,
    activationCount: 1,
    accumulatedDwellMs: 18000,
    lastSeenAt: 900,
    lastActivatedAt: 700,
    affinity: 0.72,
    uncertainty: 0.12,
    novelty: 0.18,
    cooldown: 0,
  }] : undefined;
  const brain = new EntityBrain(2707, restored);
  brain.enqueue({
    type: 'PROJECT_HOVER_START',
    timestamp: 1000,
    targetId: 'project:known',
    positionViewport: { x: 920, y: 380 },
    salience: 0.9,
    source: 'pointer',
  });
  for (let step = 0; step <= 24; step += 1) {
    const now = 1000 + step * 50;
    const output = brain.update({
      now,
      delta: 0.05,
      spatialMode: 'FREE',
      released: true,
      reducedMotion: false,
      pointerDistanceToEntity: 260,
      activeSectionId: 'work',
    });
    if (output.attentionTargetId === 'project:known') return now - 1000;
  }
  return Infinity;
}

function regionBounds(topology: EntityTopology, regions: number[], listening = false) {
  const values = listening ? topology.listeningTargets : topology.targets;
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  let count = 0;
  for (let index = 0; index < topology.count; index += 1) {
    const offset = index * 4;
    if (!regions.includes(Math.round(topology.targets[offset + 3]))) continue;
    minimumX = Math.min(minimumX, values[offset]);
    maximumX = Math.max(maximumX, values[offset]);
    minimumY = Math.min(minimumY, values[offset + 1]);
    maximumY = Math.max(maximumY, values[offset + 1]);
    count += 1;
  }
  return { minimumX, maximumX, minimumY, maximumY, width: maximumX - minimumX, height: maximumY - minimumY, count };
}

test('there is one runtime owner and one GPU particle-pool construction site', () => {
  const layout = source('src/layouts/BaseLayout.astro');
  const gpu = source('src/scripts/gpu-runtime.ts');
  const runtime = source('src/scripts/entity/runtime.ts');
  assert.equal((layout.match(/id="gpu-stage"/g) || []).length, 1);
  assert.equal((layout.match(/id="braille-entity"/g) || []).length, 1);
  assert.doesNotMatch(layout, /scripts\/entity\.js/);
  assert.equal((gpu.match(/new EntityParticleField\(/g) || []).length, 1);
  assert.match(gpu, /if \(this\.particleField\) return;/);
  assert.match(runtime, /if \(window\.__ENTITY_07_RUNTIME__\) return window\.__ENTITY_07_RUNTIME__/);
  assert.match(runtime, /particlePoolId/);
});

test('release and toggle controls converge on the same runtime API', () => {
  const runtime = source('src/scripts/entity/runtime.ts');
  const interfaceSource = source('public/scripts/interface.js');
  const deck = source('src/components/CommandDeck.astro');
  const styles = source('src/styles/global.css');
  assert.match(runtime, /command === 'release'\) this\.requestRelease/);
  assert.match(runtime, /command === 'toggle'\) this\.setEnabled/);
  assert.match(runtime, /getElementById\('entity-release'\).*toggleRelease/);
  assert.match(runtime, /getElementById\('entity-toggle'\).*setEnabled/);
  assert.match(deck, /\/release-entity/);
  assert.match(deck, /\/toggle-entity/);
  assert.match(interfaceSource, /command: 'toggle-release'/);
  assert.match(runtime, /dataset\.entityReleaseIntent = 'on'/);
  assert.match(runtime, /this\.hiddenReason === 'occupancy' \|\| spatialModeIsReleased/);
  assert.match(styles, /data-entity-release-intent="on"/);
});

test('seeded cognitive behavior is reproducible and interaction history changes it', () => {
  const first = runBrain(707, true);
  const second = runBrain(707, true);
  const passive = runBrain(707, false);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.states, passive.states);
  assert.notDeepEqual(first.utilities, passive.utilities);
  const memory = first.memory.find((entry) => entry.targetId === 'project:edge');
  assert.ok(memory);
  assert.equal(memory.hoverCount, 1);
  assert.equal(memory.focusCount, 1);
  assert.equal(memory.activationCount, 1);
  assert.ok(memory.affinity > 0);
  assert.ok(memory.novelty < 1);
  assert.ok(memory.cooldown >= 0);
});

test('project hover and keyboard focus have equivalent attention and memory paths', () => {
  const hover = runEngagement('PROJECT_HOVER_START', 'PROJECT_HOVER_END', 'pointer');
  const focus = runEngagement('PROJECT_FOCUS', 'PROJECT_BLUR', 'keyboard');
  assert.notEqual(hover.firstAttentionAt, null);
  assert.notEqual(focus.firstAttentionAt, null);
  assert.equal(hover.memory.hoverCount, 1);
  assert.equal(hover.memory.focusCount, 0);
  assert.equal(focus.memory.hoverCount, 0);
  assert.equal(focus.memory.focusCount, 1);
  assert.ok(hover.memory.accumulatedDwellMs > 0);
  assert.ok(focus.memory.accumulatedDwellMs > 0);
  assert.ok(hover.memory.affinity > 0);
  assert.ok(focus.memory.affinity > 0);
});

test('sustained interest accrues dwell and affinity before the target is left', () => {
  const brain = new EntityBrain(1807);
  brain.enqueue({
    type: 'PROJECT_HOVER_START',
    timestamp: 1000,
    targetId: 'project:continuous',
    positionViewport: { x: 920, y: 410 },
    salience: 0.94,
    source: 'pointer',
  });
  for (let step = 0; step <= 40; step += 1) {
    brain.update({
      now: 1000 + step * 100,
      delta: 0.1,
      spatialMode: 'FREE',
      released: true,
      reducedMotion: false,
      pointerDistanceToEntity: 260,
      activeSectionId: 'work',
    });
  }
  const memory = brain.getMemory().find((entry) => entry.targetId === 'project:continuous');
  assert.ok(memory);
  assert.ok(memory.accumulatedDwellMs >= 1800);
  assert.ok(memory.affinity > 0.05);
  assert.equal(memory.hoverCount, 1);
});

test('familiar targets are recognized sooner and session memory remains bounded', () => {
  assert.ok(recognitionLatency(true) < recognitionLatency(false));
  const brain = new EntityBrain(3707);
  for (let index = 0; index < ENTITY_CONFIG.brain.memoryLimit + 9; index += 1) {
    brain.enqueue({
      type: 'PROJECT_ACTIVATED',
      timestamp: 1000 + index,
      targetId: `project:${index}`,
      positionViewport: { x: 800, y: 400 },
      salience: 1,
      source: 'keyboard',
    });
  }
  brain.update({
    now: 2000,
    delta: 0.05,
    spatialMode: 'FREE',
    released: true,
    reducedMotion: false,
    pointerDistanceToEntity: 300,
    activeSectionId: 'work',
  });
  assert.equal(brain.getMemory().length, ENTITY_CONFIG.brain.memoryLimit);
  assert.ok(brain.getMemory().some((entry) => entry.targetId === `project:${ENTITY_CONFIG.brain.memoryLimit + 8}`));
});

test('session memory affinity decays slowly while novelty recovers and cooldown clears', () => {
  const brain = new EntityBrain(4707, [{
    targetId: 'project:remembered',
    hoverCount: 4,
    focusCount: 2,
    activationCount: 1,
    accumulatedDwellMs: 14000,
    lastSeenAt: 1000,
    lastActivatedAt: 900,
    affinity: 0.8,
    uncertainty: 0.14,
    novelty: 0.2,
    cooldown: 0.72,
  }]);
  const context = {
    delta: 0.05,
    spatialMode: 'FREE' as const,
    released: true,
    reducedMotion: false,
    pointerDistanceToEntity: 400,
    activeSectionId: 'work',
  };
  brain.update({ ...context, now: 1000 });
  const before = brain.getMemory()[0];
  brain.update({ ...context, now: 61000 });
  const after = brain.getMemory()[0];
  assert.ok(after.affinity < before.affinity && after.affinity > 0.7);
  assert.ok(after.uncertainty > before.uncertainty);
  assert.ok(after.novelty > before.novelty);
  assert.ok(after.cooldown < before.cooldown);
});

test('the perception stream normalizes, bounds, drains, and disposes events', () => {
  const stream = new EntityPerceptionStream();
  for (let index = 0; index < ENTITY_CONFIG.brain.eventQueueLimit + 12; index += 1) {
    stream.push({
      type: 'POINTER_MOVE',
      timestamp: index,
      positionViewport: index === 0 ? { x: Number.NaN, y: 10 } : { x: index, y: index + 1 },
      velocityViewport: { x: index, y: -index },
      salience: 4,
      source: 'pointer',
    });
  }
  assert.equal(stream.depth, ENTITY_CONFIG.brain.eventQueueLimit);
  assert.equal(stream.getRecent().length, ENTITY_CONFIG.brain.recentEventLimit);
  assert.equal(stream.getRecent()[0].salience, 1);
  let drained = 0;
  assert.equal(stream.drain(() => { drained += 1; }), ENTITY_CONFIG.brain.eventQueueLimit);
  assert.equal(drained, ENTITY_CONFIG.brain.eventQueueLimit);
  assert.equal(stream.depth, 0);
  stream.dispose();
  stream.push({ type: 'POINTER_IDLE', timestamp: 9999, salience: 0.5, source: 'pointer' });
  assert.equal(stream.depth, 0);
  assert.equal(stream.getRecent().length, 0);
});

test('attention selection favors sustained projects over erratic pointer motion and can abstain', () => {
  const context = {
    now: 12000,
    seed: 707,
    currentTargetId: null,
    curiosity: 0.72,
    fatigue: 0.12,
    confidence: 0.66,
    attentionalCertainty: 0.74,
    pointerSpeed: 1650,
  };
  const selected = selectAttentionTarget([
    {
      id: 'project:edge', kind: 'project' as const, position: { x: 940, y: 420 }, salience: 0.94,
      familiarity: 0.58, novelty: 0.3, uncertainty: 0.08, active: true, lastSeenAt: 12000,
    },
    {
      id: 'pointer', kind: 'pointer' as const, position: { x: 300, y: 240 }, salience: 0.84,
      familiarity: 0.1, novelty: 0.2, uncertainty: 0.92, active: true, lastSeenAt: 12000,
    },
  ], context, { x: 720, y: 400 });
  assert.equal(selected.id, 'project:edge');

  const abstained = selectAttentionTarget([{
    id: 'autonomous:drift', kind: 'drift', position: { x: 720, y: 400 }, salience: 0.03,
    familiarity: 0, novelty: 0, uncertainty: 1, active: false, lastSeenAt: 0,
  }], {
    ...context,
    currentTargetId: 'pointer',
    curiosity: 0,
    fatigue: 1,
    confidence: 0,
    attentionalCertainty: 0,
    pointerSpeed: 1900,
  }, { x: 720, y: 400 });
  assert.equal(abstained.id, null);
  assert.equal(abstained.abandoned, true);
});

test('pointer hover and keyboard focus are both normalized through delegated perception', () => {
  const runtime = source('src/scripts/entity/runtime.ts');
  const projects = source('src/components/Projects.astro');
  assert.match(runtime, /addEventListener\('pointerover'/);
  assert.match(runtime, /'PROJECT_HOVER_START'/);
  assert.match(runtime, /addEventListener\('focusin'/);
  assert.match(runtime, /'PROJECT_FOCUS'/);
  assert.match(runtime, /this\.inputModality = 'keyboard'/);
  assert.match(runtime, /source: this\.inputModality/);
  assert.match(runtime, /type: 'POINTER_IDLE'/);
  assert.match(runtime, /type: 'SCROLL_START'/);
  assert.match(runtime, /'PAGE_HIDDEN' : 'PAGE_VISIBLE'/);
  assert.match(runtime, /AbortController/);
  assert.match(runtime, /this\.abortController\.abort\(\)/);
  assert.match(runtime, /\{ passive: true, signal \}/);
  assert.equal((projects.match(/data-entity-project=/g) || []).length, (projects.match(/tabindex="0"/g) || []).length);
});

test('anchor scoring hard-rejects structural-core overlap with readable content', () => {
  const rejected = scoreAnchorCandidate({
    id: 'blocked',
    position: { x: 1100, y: 450 },
    viewport: { width: 1440, height: 900 },
    fieldSize: { width: 296, height: 390 },
    obstacles: [{
      id: 'project-title', visible: true, kind: 'heading', priority: 1.3,
      rect: { left: 1040, top: 390, right: 1210, bottom: 500, width: 170, height: 110 },
    }],
    currentAnchor: { x: 1200, y: 520 },
    pointer: { x: 300, y: 300 },
    preferred: { x: 1210, y: 490 },
  });
  assert.equal(rejected.hardRejected, true);
  assert.ok(rejected.overlapRatio > 0.05);
  assert.ok(rejected.reasons.some((reason) => reason.startsWith('core:')));
});

test('anchor scoring rejects controls in the peripheral field and reports when no safe anchor exists', () => {
  const protectedControl = scoreAnchorCandidate({
    id: 'cta-field-overlap',
    position: { x: 700, y: 400 },
    viewport: { width: 1200, height: 800 },
    fieldSize: { width: 300, height: 390 },
    obstacles: [{
      id: 'primary-cta', visible: true, kind: 'interactive', priority: 1.35,
      rect: { left: 790, top: 310, right: 870, bottom: 490, width: 80, height: 180 },
    }],
    currentAnchor: { x: 700, y: 400 },
    pointer: { x: 100, y: 100 },
    preferred: { x: 900, y: 400 },
  });
  assert.equal(protectedControl.hardRejected, true);
  assert.ok(protectedControl.reasons.includes('protected:primary-cta'));

  const unavailable = selectSafeAnchor({
    viewport: { width: 800, height: 600 },
    fieldSize: { width: 230, height: 292 },
    obstacles: [{
      id: 'protected-reading-surface', visible: true, kind: 'content', priority: 1,
      rect: { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 },
    }],
    currentAnchor: { x: 650, y: 300 },
    pointer: { x: 300, y: 300 },
  });
  assert.equal(unavailable.selected.hardRejected, true);
});

test('a matching project visual bay wins as a safe observation host', () => {
  const result = selectSafeAnchor({
    viewport: { width: 1440, height: 900 },
    fieldSize: { width: 230, height: 292 },
    obstacles: [{
      id: 'project-copy', visible: true, kind: 'content', priority: 0.9,
      rect: { left: 760, top: 210, right: 1180, bottom: 700, width: 420, height: 490 },
    }],
    currentAnchor: { x: 1220, y: 280 },
    pointer: { x: 500, y: 430 },
    interestPosition: { x: 700, y: 440 },
    interestTargetId: 'rust-edge-compute',
    activeSectionId: 'work',
    explicitAnchors: [
      { id: 'host:project:rust-edge-compute:center', position: { x: 570, y: 440 } },
      { id: 'host:section:work:center', position: { x: 1240, y: 440 } },
    ],
  });
  assert.equal(result.selected.hardRejected, false);
  assert.equal(result.selected.id, 'host:project:rust-edge-compute:center');
});

test('behavior episodes connect equal pointer and focus signals to visible inspection', () => {
  const runtime = source('src/scripts/entity/runtime.ts');
  const types = source('src/scripts/entity/types.ts');
  const projects = source('src/components/Projects.astro');
  assert.match(types, /'ACKNOWLEDGE'[\s\S]*'INSPECT'[\s\S]*'ROAM'[\s\S]*'DECLINE'/);
  assert.match(runtime, /beginProjectEngagement\(id, element, 'hover', now\)/);
  assert.match(runtime, /beginProjectEngagement\(id, element, 'focus', now\)/);
  assert.match(runtime, /startEpisode\([\s\S]{0,80}'ACKNOWLEDGE'/);
  assert.match(runtime, /startEpisode\('INSPECT', 'TRANSIT'/);
  assert.match(runtime, /this\.motorIntent = 'REACH'/);
  assert.match(runtime, /this\.sectionRelocationEligibleAt = 0;/);
  assert.equal((projects.match(/data-entity-host="project:/g) || []).length, 3);
  assert.equal((projects.match(/class="casefile-copy" data-entity-obstacle=/g) || []).length, 3);
});

test('section specimens are explicit autonomous destinations with a coupled inspection episode', () => {
  const runtime = source('src/scripts/entity/runtime.ts');
  const types = source('src/scripts/entity/types.ts');
  const specimen = source('src/components/SectionSpecimen.astro');
  assert.match(types, /'SPECIMEN'/);
  assert.match(specimen, /data-entity-specimen=\{entityHost\}/);
  assert.match(runtime, /beginSpecimenInspection/);
  assert.match(runtime, /startEpisode\('SPECIMEN', 'ORIENT'/);
  assert.match(runtime, /advanceSpecimen/);
  assert.match(runtime, /data\.specimenContact|dataset\.specimenContact/);
  assert.match(runtime, /dispatchEvent\(new CustomEvent\('andrew:specimen-change'/);
});

test('specimens expose adjacent approaches and never require a center-overlay anchor', () => {
  const either = specimenApproachPositions({ left: 620, right: 920 }, 'either', 230);
  assert.deepEqual(either.map((entry) => entry.suffix), ['approach-left', 'approach-right']);
  assert.ok(either[0].x < 620);
  assert.ok(either[1].x > 920);
  assert.deepEqual(
    specimenApproachPositions({ left: 620, right: 920 }, 'right', 230).map((entry) => entry.suffix),
    ['approach-right'],
  );
  const occupancy = source('src/scripts/entity/occupancy.ts');
  assert.match(occupancy, /specimenApproachPositions\(rect, approach, fieldSize\.width\)/);
  assert.doesNotMatch(occupancy, /host\.startsWith\('section:'\)[\s\S]{0,260}suffix: 'center'/);
});

test('the hero galaxy owns a reachable observatory bay while Contact keeps its placement', () => {
  const hero = source('src/components/Hero.astro');
  const contact = source('src/components/Contact.astro');
  const css = source('src/styles/global.css');
  assert.match(hero, /class="hero-specimen-bay"[\s\S]{0,180}<SectionSpecimen kind="galaxy"/);
  assert.match(hero, /data-entity-specimen-anchor="section:home"/);
  assert.doesNotMatch(hero, /class="hero-copy"[\s\S]{0,420}<SectionSpecimen kind="galaxy"/);
  assert.doesNotMatch(hero, /class="entity-console[^\n]*data-entity-obstacle/);
  assert.match(hero, /class="console-topline" data-entity-obstacle="console-status"/);
  assert.match(css, /\.hero-specimen-bay[\s\S]{0,260}position: absolute/);
  assert.match(css, /@media \(max-width: 1020px\)[\s\S]*\.hero-specimen-bay[\s\S]{0,120}position: relative/);
  assert.match(contact, /class="contact-heading-row"[\s\S]{0,180}<SectionSpecimen kind="relay"/);
  assert.match(css, /\.contact-heading-row \{[\s\S]{0,180}grid-template-columns: minmax\(0, 1fr\) minmax\(184px, 228px\)/);
  const occupancy = source('src/scripts/entity/occupancy.ts');
  assert.match(occupancy, /data-entity-specimen-anchor/);
  assert.match(occupancy, /element\.dataset\.entitySpecimenAnchor === `section:\$\{options\.specimenSectionId\}`/);
});

test('specimen identity reaches both renderers as five distinct monochrome dynamics', () => {
  const types = source('src/scripts/entity/types.ts');
  const runtime = source('src/scripts/entity/runtime.ts');
  const gpuField = source('src/scripts/entity-particle-field.ts');
  const canvasField = source('src/scripts/entity/canvas-renderer.ts');
  assert.match(types, /SpecimenKind = 'black-hole' \| 'galaxy' \| 'relay' \| 'graph' \| 'orbit'/);
  assert.match(runtime, /this\.frame\.specimen\.kind = specimenKind/);
  assert.match(runtime, /specimenKind: options\.specimenKind \?\? null/);
  assert.match(runtime, /episode\.specimenKind \|\| elementSpecimenKind/);
  assert.match(runtime, /SPECIMEN_MESSAGES\[specimenKind\]/);
  assert.ok(ENTITY_CONFIG.interaction.specimenHoldMs[0] >= 4000);
  for (const marker of ['blackHoleCoupling', 'galaxyCoupling', 'relayCoupling', 'graphCoupling', 'orbitCoupling']) {
    assert.match(gpuField, new RegExp(marker));
  }
  for (const kind of ['black-hole', 'galaxy', 'relay', 'graph', 'orbit']) {
    assert.match(canvasField, new RegExp(`frame\\.specimen\\.kind === '${kind}'`));
  }
  assert.match(gpuField, /specimenClock = mix\(uTime, uSpecimen\.z \* 6\.2831853, reducedMotion\)/);
  assert.match(runtime, /Math\.min\(0\.68, specimenStrength\)/);
});

test('the relay specimen uses stable internal geometry instead of the ambient fragment sprite', () => {
  const specimen = source('src/components/SectionSpecimen.astro');
  const css = source('src/styles/global.css');
  assert.match(specimen, /section-specimen__relay-geometry/);
  assert.match(specimen, /section-specimen__relay-spine/);
  assert.match(specimen, /section-specimen__relay-rings/);
  assert.match(css, /\.section-specimen--relay \.section-specimen__fragment \{\s*display: none/);
  assert.match(css, /\.section-specimen__relay-rings[\s\S]{0,240}clip-path/);
});

test('head observation has a larger composed envelope with delayed support follow', () => {
  const gpuField = source('src/scripts/entity-particle-field.ts');
  const canvasField = source('src/scripts/entity/canvas-renderer.ts');
  assert.ok(ENTITY_CONFIG.gaze.maximumYaw >= 0.46);
  assert.ok(ENTITY_CONFIG.gaze.maximumPitch >= 0.3);
  assert.ok(ENTITY_CONFIG.gaze.headFollow.yaw > ENTITY_CONFIG.gaze.headFollow.pitch);
  assert.match(gpuField, /head \* uGazeHead\.z \* \(0\.31 \+ target\.z \* 0\.28\)/);
  assert.match(gpuField, /shoulders \* 0\.18/);
  assert.match(canvasField, /horizontalSupport = neck \? 0\.72/);
});

test('novel roaming strongly favors the opposite half after rail parking', () => {
  assert.ok(oppositeSideNoveltyWeight(1700, 240, 1920) >= 3);
  assert.ok(oppositeSideNoveltyWeight(220, 1640, 1920) >= 3);
  assert.equal(oppositeSideNoveltyWeight(960, 1200, 1920), 1);
  const runtime = source('src/scripts/entity/runtime.ts');
  assert.match(runtime, /oppositeAlternatives\.length \? oppositeAlternatives/);
  assert.match(runtime, /safeDissolvedCrossing/);
});

test('the 1440px hero keeps a legal compact entity anchor in the far-right rail', () => {
  const result = selectSafeAnchor({
    viewport: { width: 1440, height: 900 },
    fieldSize: { width: 230, height: 292.1 },
    obstacles: [{
      id: 'hero-status-panel', visible: true, kind: 'content', priority: 0.78,
      rect: { left: 837, top: 170, right: 1204, bottom: 815, width: 367, height: 645 },
    }],
    currentAnchor: { x: 1040, y: 450 },
    pointer: { x: 500, y: 400 },
  });
  assert.equal(result.selected.hardRejected, false);
  assert.ok(result.selected.position.x >= 1260);
  assert.ok(result.selected.position.x + 115 <= 1440 - ENTITY_CONFIG.anchors.viewportEdgeClearance.desktop);
});

test('a wide hero prefers an integrated safe shoulder over extreme edge parking', () => {
  const result = selectSafeAnchor({
    viewport: { width: 2048, height: 1116 },
    fieldSize: { width: 296, height: 375.92 },
    obstacles: [
      { id: 'hero-copy', visible: true, kind: 'content', priority: 0.78, rect: { left: 500, top: 140, right: 1110, bottom: 660, width: 610, height: 520 } },
      { id: 'entity-console', visible: true, kind: 'content', priority: 0.78, rect: { left: 1150, top: 300, right: 1668, bottom: 664, width: 518, height: 364 } },
      { id: 'proof-rail', visible: true, kind: 'content', priority: 0.78, rect: { left: 404, top: 797, right: 1700, bottom: 985, width: 1296, height: 188 } },
      { id: 'terminal-control', visible: true, kind: 'interactive', priority: 1.35, rect: { left: 1378, top: 814, right: 1683, bottom: 968, width: 305, height: 154 } },
    ],
    currentAnchor: { x: 1420, y: 500 },
    pointer: { x: 1030, y: 180 },
  });
  assert.equal(result.selected.hardRejected, false);
  assert.ok(result.selected.position.x < 2048 * 0.88);
  assert.ok(result.selected.position.y < 1116 * 0.4);
  assert.doesNotMatch(result.selected.id, /^right-rail/);
  assert.ok(result.candidates.some((candidate) => candidate.id.startsWith('left-rail') && !candidate.hardRejected));
});

test('particle visibility survives dense and undersampled quality tiers', () => {
  assert.ok(ENTITY_CONFIG.particles.densityAlpha.high >= 0.5);
  assert.ok(ENTITY_CONFIG.particles.densityAlpha.low >= 0.75);
  assert.ok(ENTITY_CONFIG.theme.dark.alpha >= 0.95);
  const particleField = source('src/scripts/entity-particle-field.ts');
  assert.match(particleField, /Math\.max\(1, this\.viewport\.bufferWidth \/ this\.viewport\.width\)/);
  assert.match(particleField, /presenceGain/);
});

test('roaming routes reject protected reading paths while allowing clear rails', () => {
  const obstacles = [{
    id: 'hero-copy', visible: true, kind: 'content' as const, priority: 0.78,
    rect: { left: 420, top: 180, right: 1120, bottom: 720, width: 700, height: 540 },
  }];
  assert.equal(relocationPathIsClear({ x: 1780, y: 280 }, { x: 180, y: 340 }, obstacles, 48), false);
  assert.equal(relocationPathIsClear({ x: 1780, y: 280 }, { x: 1870, y: 720 }, obstacles, 48), true);
  const gpuField = source('src/scripts/entity-particle-field.ts');
  const canvasField = source('src/scripts/entity/canvas-renderer.ts');
  assert.match(gpuField, /relocationFade/);
  assert.match(canvasField, /relocationFade/);
});

test('mobile anchor selection can occupy the quiet band without covering primary copy', () => {
  const result = selectSafeAnchor({
    viewport: { width: 390, height: 844 },
    fieldSize: { width: 136.5, height: 173.36 },
    obstacles: [
      { id: 'mobile-heading', visible: true, kind: 'heading', priority: 1.28, rect: { left: 14, top: 390, right: 376, bottom: 510, width: 362, height: 120 } },
      { id: 'mobile-intro', visible: true, kind: 'content', priority: 0.78, rect: { left: 14, top: 535, right: 376, bottom: 670, width: 362, height: 135 } },
      { id: 'mobile-navigation', visible: true, kind: 'interactive', priority: 1.35, rect: { left: 0, top: 0, right: 390, bottom: 72, width: 390, height: 72 } },
    ],
    currentAnchor: { x: 300, y: 300 },
    pointer: { x: 40, y: 700 },
    mobile: true,
  });
  assert.equal(result.selected.hardRejected, false);
  assert.ok(result.selected.position.y < 390 - 173.36 * 0.31);
});

test('containment policy clips sealed/returning modes and never clips free mode', () => {
  assert.equal(containmentStrengthFor('SEALED', 0), 1);
  assert.equal(containmentStrengthFor('FREE', 0), 0);
  assert.equal(containmentStrengthFor('RELOCATING', 0.5), 0);
  assert.ok(containmentStrengthFor('RELEASING', 0.7) < 1);
  assert.equal(containmentStrengthFor('RELEASING', 1), 0);
  assert.equal(containmentStrengthFor('RETURNING', 0), 0);
  assert.ok(containmentStrengthFor('RETURNING', 0.8) > 0);
  assert.equal(containmentStrengthFor('RETURNING', 1), 1);
  assert.equal(spatialModeIsReleased('FREE'), true);
  assert.equal(spatialModeIsReleased('RETURNING'), false);
});

test('relocation is staggered particle flow with outer-first detach and broad-first reform', () => {
  const runtime = source('src/scripts/entity/runtime.ts');
  const gpuField = source('src/scripts/entity-particle-field.ts');
  const canvasField = source('src/scripts/entity/canvas-renderer.ts');
  assert.match(runtime, /beginSpatialTransition\('RELOCATING'/);
  assert.match(runtime, /spatialCoherence = mix\(1, 0\.24/);
  assert.match(gpuField, /curvedAnchor\(/);
  assert.match(gpuField, /outerFirst/);
  assert.match(gpuField, /reformFinish/);
  assert.match(gpuField, /broadSilhouette/);
  assert.match(gpuField, /float residual = step\(seed, 0\.018\)/);
  assert.match(canvasField, /ENTITY_CONFIG\.relocation\.residualRatio/);
  assert.doesNotMatch(runtime, /style\.transform\s*=.*anchor/);
});

test('reduced motion suppresses fragmentation, relocation, reach, and scroll waves', () => {
  const reduced = runBrain(808, false, true);
  assert.equal(reduced.states.includes('FRAGMENTING'), false);
  assert.equal(reduced.states.includes('REFORMING'), false);
  assert.equal(largeMotionAllowed(true), false);
  const runtime = source('src/scripts/entity/runtime.ts');
  const particleField = source('src/scripts/entity-particle-field.ts');
  assert.match(runtime, /this\.reducedMotion\.matches \? 0 : this\.scroll\.energy/);
  assert.match(runtime, /!this\.reducedMotion\.matches && innerWidth >= 700/);
  assert.match(runtime, /this\.reducedMotion\.matches \|\| distance < 54/);
  assert.match(runtime, /this\.stableAnchor = \{ \.\.\.selected\.position \}/);
  assert.match(particleField, /scrollEnergy = uScroll\.z \* \(1\.0 - reducedMotion\)/);
});

test('both renderers expose the faceless directional response and one inspection filament', () => {
  const gpuField = source('src/scripts/entity-particle-field.ts');
  const canvasField = source('src/scripts/entity/canvas-renderer.ts');
  assert.match(gpuField, /directionalBias/);
  assert.match(gpuField, /directionalSurface/);
  assert.match(gpuField, /inspectionStrength/);
  assert.match(gpuField, /tendrilMember/);
  assert.match(canvasField, /frame\.directionalBias/);
  assert.match(canvasField, /frame\.inspectionStrength/);
  assert.match(canvasField, /reachThreshold/);
});

test('pointer-through deformation is localized and implemented in both renderers', () => {
  const runtime = source('src/scripts/entity/runtime.ts');
  const gpuField = source('src/scripts/entity-particle-field.ts');
  const canvasField = source('src/scripts/entity/canvas-renderer.ts');
  assert.match(runtime, /pointerIntrusion/);
  assert.match(runtime, /ellipseDistance/);
  assert.match(gpuField, /uPointerField/);
  assert.match(gpuField, /pointerContact/);
  assert.match(gpuField, /cranialCore \* 0\.42/);
  assert.match(canvasField, /frame\.pointerIntrusion/);
  assert.match(canvasField, /pointerContact/);
  assert.match(canvasField, /cranialCore \? 0\.58/);
});

test('page visibility and disabled withdrawal pause expensive simulation', () => {
  assert.equal(expensiveSimulationShouldPause(true, true), true);
  assert.equal(expensiveSimulationShouldPause(false, false), true);
  assert.equal(expensiveSimulationShouldPause(false, true), false);
  const runtime = source('src/scripts/entity/runtime.ts');
  assert.match(runtime, /document\.hidden \? 'PAGE_HIDDEN' : 'PAGE_VISIBLE'/);
  assert.match(runtime, /this\.frame\.simulationPaused = document\.hidden/);
});

test('runtime cleanup owns page listeners, observers, perception, timers, and queued frames', () => {
  const runtime = source('src/scripts/entity/runtime.ts');
  const occupancy = source('src/scripts/entity/occupancy.ts');
  assert.match(runtime, /private abortController = new AbortController\(\)/);
  assert.match(runtime, /this\.abortController\.abort\(\)/);
  assert.match(runtime, /this\.sectionObserver\?\.disconnect\(\)/);
  assert.match(runtime, /this\.themeObserver\?\.disconnect\(\)/);
  assert.match(runtime, /this\.perception\.dispose\(\)/);
  assert.match(runtime, /clearTimeout\(this\.thoughtHideTimer\)/);
  assert.match(runtime, /cancelAnimationFrame\(frame\)/);
  assert.match(occupancy, /this\.resizeObserver\?\.disconnect\(\)/);
  assert.match(occupancy, /this\.intersectionObserver\?\.disconnect\(\)/);
  assert.match(occupancy, /this\.mutationObserver\?\.disconnect\(\)/);
});

test('theme changes preserve runtime, pool identity, and particle textures', () => {
  const runtime = source('src/scripts/entity/runtime.ts');
  const gpu = source('src/scripts/gpu-runtime.ts');
  assert.match(runtime, /this\.frame\.theme = document\.documentElement\.dataset\.themeResolved/);
  assert.match(runtime, /this\.occupancy\.scheduleRefresh\('theme-change'\)/);
  assert.doesNotMatch(runtime, /theme-change[\s\S]{0,180}(dispose|createParticleField)/);
  assert.doesNotMatch(gpu, /themeObserver[\s\S]{0,260}createParticleField/);
});

test('adaptive quality prefixes retain a representative slice of the complete particle pool', () => {
  const fullCount = 256 * 256;
  const lowCount = 128 * 128;
  const seed = 707;
  const topology = createFacelessHumanoidTopology(fullCount, seed);
  const seen = new Set<number>();
  const sampledRegions = new Uint32Array(topology.regionCounts.length);
  const indexBuckets = new Uint32Array(16);
  for (let index = 0; index < lowCount; index += 1) {
    const particleIndex = progressiveParticleIndex(index, fullCount, seed);
    seen.add(particleIndex);
    indexBuckets[Math.min(15, Math.floor(particleIndex / fullCount * 16))] += 1;
    sampledRegions[Math.round(topology.targets[particleIndex * 4 + 3])] += 1;
  }
  assert.equal(seen.size, lowCount);
  assert.ok(indexBuckets.every((count) => Math.abs(count - lowCount / 16) <= 4));
  for (let region = 0; region < sampledRegions.length; region += 1) {
    const sampledRatio = sampledRegions[region] / lowCount;
    const completeRatio = topology.regionCounts[region] / fullCount;
    assert.ok(Math.abs(sampledRatio - completeRatio) < 0.004);
  }
  const renderer = source('src/scripts/entity-particle-field.ts');
  assert.match(renderer, /progressiveParticleIndex\(index, this\.count, sessionSeed\)/);
});

test('topology is a newly authored compact faceless humanoid field', () => {
  const topology = createFacelessHumanoidTopology(12000, 909);
  assert.equal(topology.source, 'compact-faceless-humanoid-field');
  assert.equal(topology.count, 12000);
  assert.equal(topology.listeningTargets.length, topology.targets.length);
  assert.equal(topology.regionCounts.reduce((sum, count) => sum + count, 0), topology.count);
  assert.ok(topology.regionCounts.every((count) => count > 0));
  const regionNames = Object.keys(BODY_REGION).join(' ');
  assert.doesNotMatch(regionNames, /EYE|BROW|NOSE|MOUTH|LIP|CHEEK/i);
  const rendererSources = [
    source('src/scripts/entity/topology.ts'),
    source('src/scripts/entity/runtime.ts'),
    source('src/scripts/entity-particle-field.ts'),
    source('src/scripts/entity/canvas-renderer.ts'),
  ].join('\n');
  assert.doesNotMatch(rendererSources, /leftBlink|rightBlink|browCompression|browLift|jawRelease|jawLateral|lipCompression|mouthPart/);
  assert.doesNotMatch(rendererSources, /LEFT_EYE|RIGHT_EYE|LEFT_BROW|RIGHT_BROW|NOSE_BRIDGE|MOUTH_REGION/);
  const scriptFiles = readdirSync(resolve(repository, 'src/scripts'), { recursive: true })
    .filter((entry) => String(entry).endsWith('.ts'))
    .map((entry) => source(`src/scripts/${String(entry)}`))
    .join('\n');
  assert.doesNotMatch(scriptFiles, /watcher-face|face-v[0-9]|TextureLoader/);
  assert.doesNotMatch(source('src/scripts/entity/topology.ts'), /\.png|\.webp|\.jpg|\.glb/);
});

test('coherent proportions enforce a short integrated neck and broad connected shoulders', () => {
  const topology = createFacelessHumanoidTopology(48000, 707);
  const proportions = ENTITY_CONFIG.body.proportions;
  const configuredHeadHeight = proportions.headBottom - proportions.headTop;
  const configuredHeadWidth = proportions.headHalfWidth * 2;
  const visibleNeckRatio = (proportions.shoulderTop - proportions.headBottom) / configuredHeadHeight;
  const neckWidthRatio = proportions.neckHalfWidth * 2 / configuredHeadWidth;
  const shoulderWidthRatio = proportions.shoulderHalfWidth * 2 / configuredHeadWidth;
  assert.ok(visibleNeckRatio >= 0.14 && visibleNeckRatio <= 0.24, `visible neck ratio ${visibleNeckRatio}`);
  assert.ok(neckWidthRatio >= 0.42 && neckWidthRatio <= 0.58, `neck width ratio ${neckWidthRatio}`);
  assert.ok(shoulderWidthRatio >= 2.3 && shoulderWidthRatio <= 2.8, `shoulder ratio ${shoulderWidthRatio}`);

  const head = regionBounds(topology, [BODY_REGION.CRANIAL_CORE, BODY_REGION.CRANIAL_EDGE, BODY_REGION.LOWER_HEAD]);
  const support = regionBounds(topology, [BODY_REGION.NECK_BRIDGE, BODY_REGION.LEFT_TRAPEZIUS, BODY_REGION.RIGHT_TRAPEZIUS]);
  const shoulders = regionBounds(topology, [BODY_REGION.LEFT_SHOULDER, BODY_REGION.RIGHT_SHOULDER]);
  const torso = regionBounds(topology, [BODY_REGION.UPPER_TORSO, BODY_REGION.LOWER_TORSO]);
  assert.ok(support.minimumY < head.maximumY && support.maximumY > shoulders.minimumY);
  assert.ok(torso.minimumY < shoulders.maximumY && torso.maximumY > shoulders.minimumY);
  assert.ok(shoulders.width > head.width * 2.2);
  assert.ok(torso.width > head.width * 1.7);
});

test('particle allocation gives the head, support, shoulders, torso, and field balanced visual weight', () => {
  const topology = createFacelessHumanoidTopology(100000, 77);
  const ratio = (...regions: number[]) => regions.reduce((sum, region) => sum + topology.regionCounts[region], 0) / topology.count;
  assert.ok(Math.abs(ratio(BODY_REGION.CRANIAL_CORE, BODY_REGION.CRANIAL_EDGE, BODY_REGION.LOWER_HEAD) - 0.3) < 0.002);
  assert.ok(Math.abs(ratio(BODY_REGION.NECK_BRIDGE) - 0.04) < 0.002);
  assert.ok(Math.abs(ratio(BODY_REGION.LEFT_TRAPEZIUS, BODY_REGION.RIGHT_TRAPEZIUS, BODY_REGION.LEFT_SHOULDER, BODY_REGION.RIGHT_SHOULDER) - 0.25) < 0.002);
  assert.ok(Math.abs(ratio(BODY_REGION.UPPER_TORSO, BODY_REGION.LOWER_TORSO) - 0.29) < 0.002);
  assert.ok(Math.abs(ratio(BODY_REGION.PLUME, BODY_REGION.FREE_FIELD) - 0.12) < 0.002);
});

test('the listening form stays connected and cannot stretch into a head on a stalk', () => {
  const topology = createFacelessHumanoidTopology(48000, 1717);
  const coherentHead = regionBounds(topology, [BODY_REGION.CRANIAL_CORE, BODY_REGION.CRANIAL_EDGE, BODY_REGION.LOWER_HEAD]);
  const listeningHead = regionBounds(topology, [BODY_REGION.CRANIAL_CORE, BODY_REGION.CRANIAL_EDGE, BODY_REGION.LOWER_HEAD], true);
  const listeningSupport = regionBounds(topology, [BODY_REGION.NECK_BRIDGE, BODY_REGION.LEFT_TRAPEZIUS, BODY_REGION.RIGHT_TRAPEZIUS], true);
  const listeningShoulders = regionBounds(topology, [BODY_REGION.LEFT_SHOULDER, BODY_REGION.RIGHT_SHOULDER], true);
  assert.ok(listeningHead.height < coherentHead.height * 1.35);
  assert.ok(listeningSupport.minimumY < listeningHead.maximumY);
  assert.ok(listeningSupport.maximumY > listeningShoulders.minimumY);
  assert.ok(listeningShoulders.width > listeningHead.width * 1.9);
});
