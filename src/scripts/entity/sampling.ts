import { ENTITY_CONFIG } from './config';

/**
 * Maps instance prefixes across the complete simulation texture.
 * The configured stride is coprime with every supported texture area, so the
 * mapping is a permutation: no particle is duplicated and every smaller
 * quality tier retains a representative slice of the same pool.
 */
export function progressiveParticleIndex(index: number, count: number, seed = 0): number {
  if (count <= 1) return 0;
  const offset = (seed >>> 0) % count;
  return (index * ENTITY_CONFIG.particles.referenceStride + offset) % count;
}
