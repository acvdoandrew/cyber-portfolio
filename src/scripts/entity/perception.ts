import { ENTITY_CONFIG } from './config';
import { clamp } from './random';
import type { PerceptionEvent, Vec2 } from './types';

function finitePoint(point: Vec2 | undefined): Vec2 | undefined {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return { x: point.x, y: point.y };
}
function normalizeEvent(event: PerceptionEvent): PerceptionEvent {
  return {
    type: event.type,
    timestamp: Number.isFinite(event.timestamp) ? event.timestamp : 0,
    source: event.source,
    salience: clamp(Number.isFinite(event.salience) ? event.salience : 0),
    ...(event.targetId ? { targetId: event.targetId } : {}),
    ...(finitePoint(event.positionViewport) ? { positionViewport: finitePoint(event.positionViewport) } : {}),
    ...(finitePoint(event.velocityViewport) ? { velocityViewport: finitePoint(event.velocityViewport) } : {}),
  };
}

/**
 * A bounded, frame-drained perception stream. DOM listeners only publish here;
 * cognition consumes the normalized events once per runtime update.
 */
export class EntityPerceptionStream {
  private queue: PerceptionEvent[] = [];
  private recent: PerceptionEvent[] = [];
  private disposed = false;

  push(event: PerceptionEvent): void {
    if (this.disposed) return;
    const normalized = normalizeEvent(event);
    if (this.queue.length >= ENTITY_CONFIG.brain.eventQueueLimit) this.queue.shift();
    this.queue.push(normalized);
    this.recent.unshift(normalized);
    this.recent.length = Math.min(this.recent.length, ENTITY_CONFIG.brain.recentEventLimit);
  }

  drain(consumer: (event: PerceptionEvent) => void): number {
    if (this.disposed) return 0;
    const count = this.queue.length;
    for (const event of this.queue) consumer(event);
    this.queue.length = 0;
    return count;
  }

  get depth(): number {
    return this.queue.length;
  }

  getRecent(): PerceptionEvent[] {
    return this.recent.map((event) => ({
      ...event,
      ...(event.positionViewport ? { positionViewport: { ...event.positionViewport } } : {}),
      ...(event.velocityViewport ? { velocityViewport: { ...event.velocityViewport } } : {}),
    }));
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.recent.length = 0;
  }
}
