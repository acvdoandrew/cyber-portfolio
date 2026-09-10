import { manifestationAt } from './intelligence-state';
import { drawIntelligence, TERMINAL_ENTITY_WIDTH, TERMINAL_ENTITY_HEIGHT } from './intelligence-geometry';
import { PixelField } from './project-studies/scenes';
import { writeDither } from './project-studies/dither';

const FRAME_INTERVAL = 1000 / 24;
const STILL_TIME = 8;
type Connection = EventTarget & { saveData?: boolean };

class ContactIntelligence {
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly connection = (navigator as Navigator & { connection?: Connection }).connection;
  private readonly journey: HTMLElement | null;
  private readonly status: HTMLElement | null;
  private readonly pauseButton: HTMLButtonElement | null;
  private readonly events = new AbortController();
  private readonly resize: ResizeObserver;
  private readonly intersection: IntersectionObserver;
  private readonly paletteObserver: MutationObserver;
  private readonly journeyObserver: MutationObserver;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly field = new PixelField(TERMINAL_ENTITY_WIDTH, TERMINAL_ENTITY_HEIGHT);
  private readonly pixels: ImageData | null;
  private frame = 0;
  private frameCount = 0;
  private syncFrame = 0;
  private lastTime = 0;
  private elapsed = 0;
  private disposed = false;
  private paused = false;
  private visible = false;
  private pointerInside = false;
  private focused = false;
  private attention = 0;
  private pointer: [number, number] = [0, 0];
  private targetPointer: [number, number] = [0, 0];
  private readingTarget: [number, number] = [0, -0.15];
  private isReading = false;
  private ink = [241, 237, 226];

  constructor(
    private readonly figure: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    figure.dataset.intelligenceInitialized = 'true';
    figure.dataset.renderer = 'poster';
    this.journey = figure.closest('[data-portfolio-journey]');
    this.status = figure.querySelector('[data-intelligence-state]');
    const scene = figure.closest<HTMLElement>('[data-contact-scene]') ?? stage;
    this.pauseButton = scene.querySelector('[data-intelligence-pause]');
    canvas.width = TERMINAL_ENTITY_WIDTH;
    canvas.height = TERMINAL_ENTITY_HEIGHT;
    this.context = canvas.getContext('2d', { alpha: true });
    this.pixels = this.context?.createImageData(TERMINAL_ENTITY_WIDTH, TERMINAL_ENTITY_HEIGHT) ?? null;
    if (this.context) this.context.imageSmoothingEnabled = false;
    const options = { signal: this.events.signal };

    scene.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const bounds = scene.getBoundingClientRect();
      this.pointerInside = true;
      this.targetPointer = [
        Math.max(-0.5, Math.min(0.5, (event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5)),
        Math.max(-0.5, Math.min(0.5, 0.5 - (event.clientY - bounds.top) / Math.max(1, bounds.height))),
      ];
    }, { ...options, passive: true });
    scene.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.targetPointer = [0, 0];
    }, options);
    scene.addEventListener('focusin', () => { this.focused = true; }, options);
    scene.addEventListener('focusout', (event) => {
      this.focused = event.relatedTarget instanceof Node && scene.contains(event.relatedTarget);
    }, options);
    scene.addEventListener('terminal:typing', ((event: CustomEvent<{ line: number; progress: number; complete: boolean }>) => {
      this.isReading = !event.detail.complete;
      this.readingTarget = [(event.detail.progress - 0.5) * 0.6, -0.12 - event.detail.line * 0.035];
    }) as EventListener, options);
    this.pauseButton?.addEventListener('click', () => {
      this.paused = !this.paused;
      this.pauseButton!.setAttribute('aria-pressed', String(this.paused));
      this.pauseButton!.setAttribute('aria-label', `${this.paused ? 'Resume' : 'Pause'} intelligence animation`);
      this.pauseButton!.textContent = this.paused ? 'resume art' : 'pause art';
      this.sync();
    }, options);
    document.addEventListener('visibilitychange', this.queueSync, options);
    window.addEventListener('scroll', this.queueSync, { ...options, passive: true });
    window.addEventListener('resize', this.queueSync, { ...options, passive: true });
    window.addEventListener('pageshow', this.queueSync, options);
    window.addEventListener('pagehide', (event) => {
      this.stop();
      if (!event.persisted) this.dispose();
    }, options);
    this.motion.addEventListener('change', this.queueSync, options);
    this.connection?.addEventListener('change', this.queueSync, options);

    this.resize = new ResizeObserver(this.queueSync);
    this.resize.observe(stage);
    this.intersection = new IntersectionObserver(this.queueSync);
    this.intersection.observe(stage);
    this.paletteObserver = new MutationObserver(() => {
      this.readPalette();
      this.draw(this.stillPreference ? STILL_TIME : this.elapsed);
    });
    this.paletteObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-palette'],
    });
    this.journeyObserver = new MutationObserver(this.queueSync);
    if (this.journey) this.journeyObserver.observe(this.journey, {
      attributes: true, attributeFilter: ['style', 'data-journey-enhanced'],
    });
    this.readPalette();
    this.draw(STILL_TIME);
    this.queueSync();
  }

  private get stillPreference() {
    return this.motion.matches || this.connection?.saveData === true;
  }

  private queueSync = () => {
    if (this.syncFrame || this.disposed) return;
    this.syncFrame = requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.sync();
    });
  };

  private sync() {
    if (this.disposed) return;
    const rect = this.stage.getBoundingClientRect();
    const revealed = !this.journey || this.journey.dataset.journeyEnhanced !== 'true'
      || Number(this.journey.style.getPropertyValue('--contact-reveal')) > 0.025;
    this.visible = revealed && !document.hidden && rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < innerHeight;
    this.figure.dataset.visible = String(this.visible);
    if (!this.visible) {
      this.figure.dataset.motion = 'offscreen';
      this.stop();
      return;
    }
    if (!this.context) return;
    const still = this.stillPreference || this.paused;
    this.figure.dataset.motion = still ? 'still' : 'live';
    if (this.pauseButton) this.pauseButton.hidden = this.stillPreference;
    if (still) {
      this.stop();
      this.draw(this.stillPreference ? STILL_TIME : this.elapsed);
      if (this.status) this.status.textContent = 'Form held';
    } else if (!this.frame) {
      this.lastTime = 0;
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  private tick = (timestamp: number) => {
    this.frame = 0;
    if (!this.visible || this.paused || this.stillPreference || this.disposed || !this.context) return;
    if (!this.lastTime) this.lastTime = timestamp;
    const delta = timestamp - this.lastTime;
    if (delta >= FRAME_INTERVAL) {
      this.lastTime = timestamp;
      const seconds = Math.min(delta / 1000, 0.1);
      this.elapsed += seconds;
      const target = this.focused ? 1 : this.pointerInside
        ? Math.max(0.3, 1 - Math.hypot(...this.targetPointer) * 0.9) : this.isReading ? 0.7 : 0;
      const ease = 1 - Math.exp(-seconds * 2.5);
      this.attention += (target - this.attention) * ease;
      const gaze = this.pointerInside ? this.targetPointer : this.isReading ? this.readingTarget : [Math.sin(this.elapsed * 0.32) * 0.3, -0.16 + Math.sin(this.elapsed * 0.21) * 0.04];
      this.pointer[0] += (gaze[0] - this.pointer[0]) * ease;
      this.pointer[1] += (gaze[1] - this.pointer[1]) * ease;
      this.draw(this.elapsed);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private draw(time: number) {
    if (!this.context || !this.pixels) return;
    const attention = this.stillPreference ? 0 : this.attention;
    const pointer: [number, number] = this.stillPreference ? [0, 0] : this.pointer;
    const coherence = drawIntelligence(this.field, time, attention, pointer, 'terminal');
    writeDither(this.field.values, this.pixels.data, this.ink, TERMINAL_ENTITY_WIDTH, TERMINAL_ENTITY_HEIGHT);
    this.context.putImageData(this.pixels, 0, 0);
    this.figure.dataset.renderer = 'pixels';
    this.figure.dataset.coherence = coherence.toFixed(3);
    this.figure.dataset.frames = String(++this.frameCount);
    const { label } = manifestationAt(time, attention);
    if (this.status && this.status.textContent !== label) this.status.textContent = label;
  }

  private readPalette() {
    const color = getComputedStyle(this.canvas).color.match(/[\d.]+/g);
    if (color) this.ink = color.slice(0, 3).map(Number);
  }

  private stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
  }

  private dispose() {
    this.disposed = true;
    this.stop();
    cancelAnimationFrame(this.syncFrame);
    this.events.abort();
    this.resize.disconnect();
    this.intersection.disconnect();
    this.paletteObserver.disconnect();
    this.journeyObserver.disconnect();
  }
}

document.querySelectorAll<HTMLElement>('[data-intelligence]').forEach((figure) => {
  if (figure.dataset.intelligenceInitialized) return;
  const stage = figure.querySelector<HTMLElement>('[data-intelligence-stage]');
  const canvas = figure.querySelector<HTMLCanvasElement>('[data-intelligence-canvas]');
  if (stage && canvas) new ContactIntelligence(figure, stage, canvas);
});
