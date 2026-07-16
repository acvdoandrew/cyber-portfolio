import { ENTITY_CONFIG } from './config';
import { clamp, smoothstep } from './random';
import type { SpatialMode } from './types';

export function containmentStrengthFor(mode: SpatialMode, transitionProgress: number): number {
  if (mode === 'SEALED') return 1;
  if (mode === 'RELEASING') {
    return clamp(1 - smoothstep(
      (transitionProgress - ENTITY_CONFIG.containment.maskDissolveStart) /
      (ENTITY_CONFIG.containment.maskDissolveEnd - ENTITY_CONFIG.containment.maskDissolveStart),
    ));
  }
  if (mode === 'RETURNING') return clamp(smoothstep((transitionProgress - 0.48) / 0.46));
  return 0;
}

export function spatialModeIsReleased(mode: SpatialMode): boolean {
  return mode === 'RELEASING' || mode === 'FREE' || mode === 'RELOCATING';
}

export function expensiveSimulationShouldPause(documentHidden: boolean, visible: boolean): boolean {
  return documentHidden || !visible;
}

export function largeMotionAllowed(reducedMotion: boolean): boolean {
  return !reducedMotion;
}
