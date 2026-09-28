import { ByteField, type ByteInks, type Ink } from './entity/bytes';
import {
  attemptAt,
  review,
  ENTITY_CELL,
  ENTITY_HEIGHT,
  ENTITY_RIM,
  ENTITY_WIDTH,
  FORM_LABELS,
  FormBuilder,
  type Attempt,
  type Review,
} from './entity/forms';

const FRAME_INTERVAL = 1000 / 30;
const HUD_INTERVAL = 120;
const STILL_TIME = 8;
type Connection = EventTarget & { saveData?: boolean };

const parseInk = (value: string, fallback: Ink): Ink => {
  const text = value.trim();
  const hex = text.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const number = Number.parseInt(hex[1], 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  }
  const numbers = text.match(/[\d.]+/g)?.map(Number);
  if (!numbers || numbers.length < 3) return fallback;
  return text.startsWith('color(')
    ? [numbers[0] * 255, numbers[1] * 255, numbers[2] * 255]
    : [numbers[0], numbers[1], numbers[2]];
};

const pad = (value: number) => String(value).padStart(2, '0');

class ByteEntity {
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly connection = (navigator as Navigator & { connection?: Connection }).connection;
  private readonly events = new AbortController();
  private readonly intersection: IntersectionObserver;
  private readonly paletteObserver: MutationObserver;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly pixels: ImageData | null;
  private readonly builder = new FormBuilder();
  private readonly bytes = new ByteField({
    width: ENTITY_WIDTH,
    height: ENTITY_HEIGHT,
    cell: ENTITY_CELL,
    ingress: { y: ENTITY_RIM + 2, left: ENTITY_WIDTH * 0.07, right: ENTITY_WIDTH * 0.93 },
    seed: 1907,
  });
  private readonly pauseButton: HTMLButtonElement | null;
  private readonly panel: HTMLElement | null;
  private readonly tags: Record<'head' | 'left' | 'right', HTMLElement | null>;
  private inks: ByteInks = { settled: [252, 232, 196], flight: [30, 203, 255], discard: [241, 125, 60] };
  private frame = 0;
  private lastTime = 0;
  private lastHud = 0;
  private elapsed = 0;
  private frameCount = 0;
  private attempt: Attempt = attemptAt(0);
  private attemptStart = 0;
  private nextDoubt = 9;
  private tearUntil = 0;
  private verdict: Review | null = null;
  /** Best match this attempt has reached: once a check answers, churn can't un-answer it. */
  private bestMatch = 0;
  private log: string[] = [];
  private disposed = false;
  private paused = false;
  private visible = false;
  private pointerInside = false;
  private focused = false;
  private isReading = false;
  private attention = 0;
  private pointer: [number, number] = [0, -0.16];
  private targetPointer: [number, number] = [0, 0];
  private readingTarget: [number, number] = [0, -0.15];

  constructor(
    private readonly figure: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    figure.dataset.intelligenceInitialized = 'true';
    figure.dataset.renderer = 'poster';
    const scene = figure.closest<HTMLElement>('[data-contact-scene]') ?? stage;
    const view = figure.closest<HTMLElement>('[data-view]') ?? scene;
    this.panel = view.querySelector('[data-review]');
    this.pauseButton = view.querySelector('[data-intelligence-pause]');
    this.tags = {
      head: stage.querySelector('[data-entity-tag="head"]'),
      left: stage.querySelector('[data-entity-tag="left"]'),
      right: stage.querySelector('[data-entity-tag="right"]'),
    };
    canvas.width = ENTITY_WIDTH;
    canvas.height = ENTITY_HEIGHT;
    this.context = canvas.getContext('2d', { alpha: true });
    this.pixels = this.context?.createImageData(ENTITY_WIDTH, ENTITY_HEIGHT) ?? null;
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
    }, options);
    scene.addEventListener('focusin', () => {
      this.focused = true;
    }, options);
    scene.addEventListener('focusout', (event) => {
      this.focused = event.relatedTarget instanceof Node && scene.contains(event.relatedTarget);
    }, options);
    scene.addEventListener('terminal:typing', ((event: CustomEvent<{ line: number; progress: number; complete: boolean }>) => {
      this.isReading = !event.detail.complete;
      this.readingTarget = [(event.detail.progress - 0.5) * 0.6, -0.12 - event.detail.line * 0.035];
    }) as EventListener, options);
    this.pauseButton?.addEventListener('click', () => {
      this.paused = !this.paused;
      const button = this.pauseButton!;
      button.setAttribute('aria-pressed', String(this.paused));
      button.setAttribute('aria-label', `${this.paused ? 'Resume' : 'Pause'} the entity`);
      button.textContent = this.paused ? 'resume entity' : 'pause entity';
      this.sync();
    }, options);
    document.addEventListener('visibilitychange', this.sync, options);
    window.addEventListener('console:channel', this.sync, options);
    window.addEventListener('pageshow', this.sync, options);
    window.addEventListener('pagehide', (event) => {
      this.stop();
      if (!event.persisted) this.dispose();
    }, options);
    this.motion.addEventListener('change', this.sync, options);
    this.connection?.addEventListener('change', this.sync, options);

    this.intersection = new IntersectionObserver(this.sync);
    this.intersection.observe(stage);
    this.paletteObserver = new MutationObserver(() => {
      this.readPalette();
      this.render();
    });
    this.paletteObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] });
    this.readPalette();
    // With motion, the first frame starts empty and the bytes rise out of the terminal.
    if (this.stillPreference) this.still();
    else this.updateHud(STILL_TIME, false);
    this.sync();
  }

  private get stillPreference() {
    return this.motion.matches || this.connection?.saveData === true;
  }

  private sync = () => {
    if (this.disposed) return;
    const rect = this.stage.getBoundingClientRect();
    this.visible = !document.hidden && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    if (this.pauseButton) this.pauseButton.hidden = this.stillPreference;
    if (!this.visible) {
      this.figure.dataset.motion = 'offscreen';
      this.stop();
      return;
    }
    const still = this.stillPreference || this.paused;
    this.figure.dataset.motion = still ? 'still' : 'live';
    if (this.stillPreference) {
      this.stop();
      this.still();
    } else if (this.paused) {
      this.stop();
    } else if (!this.frame) {
      if (!Number.isFinite(this.attempt.duration)) {
        this.attempt = attemptAt(2);
        this.attemptStart = this.elapsed;
      }
      this.lastTime = 0;
      this.frame = requestAnimationFrame(this.tick);
    }
  };

  /** A settled body, for reduced motion and before the first live frame. */
  private still() {
    this.attempt = { index: 2, form: 'anatomy', duration: Infinity };
    this.bytes.setTarget(this.builder.build({ form: 'anatomy', time: STILL_TIME, attention: 0, pointer: [0, -0.16] }));
    this.bytes.settle();
    this.render();
    this.updateHud(STILL_TIME, true);
    this.log = [];
    this.pushLog('form held — motion reduced');
  }

  private tick = (timestamp: number) => {
    this.frame = 0;
    if (!this.visible || this.paused || this.stillPreference || this.disposed) return;
    if (!this.lastTime) this.lastTime = timestamp;
    const delta = timestamp - this.lastTime;
    if (delta >= FRAME_INTERVAL) {
      this.lastTime = timestamp;
      this.advance(Math.min(delta / 1000, 0.1));
      if (timestamp - this.lastHud >= HUD_INTERVAL) {
        this.lastHud = timestamp;
        this.updateHud(this.elapsed, false);
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private advance(seconds: number) {
    this.elapsed += seconds;
    const ease = 1 - Math.exp(-seconds * 2.5);
    const target = this.focused ? 1 : this.pointerInside
      ? Math.max(0.55, 1 - Math.hypot(...this.targetPointer) * 0.9) : this.isReading ? 0.3 : 0;
    this.attention += (target - this.attention) * ease;
    const gaze = this.pointerInside
      ? this.targetPointer
      : this.isReading ? this.readingTarget : [Math.sin(this.elapsed * 0.32) * 0.3, -0.16 + Math.sin(this.elapsed * 0.21) * 0.04];
    this.pointer[0] += (gaze[0] - this.pointer[0]) * ease;
    this.pointer[1] += (gaze[1] - this.pointer[1]) * ease;

    // Attempts run on their own clock; being watched pulls it to its best guess.
    const age = this.elapsed - this.attemptStart;
    const attended = this.attention > 0.5;
    if (age > this.attempt.duration || (attended && this.attempt.form !== 'anatomy' && age > 1.6)) {
      this.nextAttempt(attended && this.attempt.form !== 'anatomy');
    }

    // The target follows the live pose, rebuilt at half the frame rate.
    if (this.frameCount % 2 === 0) {
      this.bytes.setTarget(this.builder.build({
        form: this.attempt.form,
        time: this.elapsed + STILL_TIME,
        attention: this.attention,
        pointer: this.pointer,
      }));
    }

    this.doubt(attended);
    this.bytes.step(seconds, {
      churn: attended ? 0.01 : 0.03,
      error: attended ? 0.015 : 0.07,
      pull: attended ? 2.2 : 1.5,
    });
    this.render();
  }

  private nextAttempt(interrupted: boolean) {
    let index = this.attempt.index + 1;
    if (interrupted) while (attemptAt(index).form !== 'anatomy') index += 1;
    if (interrupted) this.pushLog(`#${pad(this.attempt.index + 1)} ${FORM_LABELS[this.attempt.form]} — dropped, you’re here`);
    this.attempt = attemptAt(index);
    this.attemptStart = this.elapsed;
    this.verdict = null;
    this.bestMatch = 0;
  }

  /** Second thoughts: a torn band of rows, or a patch of bytes let go and re-sent. */
  private doubt(attended: boolean) {
    if (this.elapsed >= this.tearUntil) this.bytes.tear.fill(0);
    if (this.elapsed < this.nextDoubt) return;
    const wait = attended ? 11 : 5.5;
    this.nextDoubt = this.elapsed + wait + Math.random() * wait;
    if (this.attempt.form !== 'anatomy' || this.elapsed - this.attemptStart < 4) return;
    if (Math.random() < 0.55) {
      const rows = this.bytes.rows;
      const start = Math.floor(rows * (0.08 + Math.random() * 0.5));
      const height = 2 + Math.floor(Math.random() * 5);
      const shift = (Math.random() < 0.5 ? -1 : 1) * ENTITY_CELL * (1 + Math.floor(Math.random() * 3));
      for (let row = start; row < Math.min(rows, start + height); row++) this.bytes.tear[row] = shift;
      this.tearUntil = this.elapsed + 0.18 + Math.random() * 0.2;
    } else {
      const top = ENTITY_HEIGHT * (0.05 + Math.random() * 0.5);
      const band = 14 + Math.random() * 30;
      const left = ENTITY_WIDTH * (0.2 + Math.random() * 0.35);
      this.bytes.shed(left, top, left + ENTITY_WIDTH * (0.15 + Math.random() * 0.3), top + band, 1 + Math.floor(Math.random() * 2));
    }
  }

  private render() {
    if (!this.context || !this.pixels) return;
    this.bytes.render(this.pixels.data, this.inks);
    this.context.putImageData(this.pixels, 0, 0);
    this.figure.dataset.renderer = 'pixels';
    this.figure.dataset.frames = String(++this.frameCount);
  }

  private updateHud(time: number, still: boolean) {
    const pointer: [number, number] = still ? [0, -0.16] : this.pointer;
    const landmarks = this.builder.landmarks(time, pointer);
    const match = this.bytes.match();
    const form = this.attempt.form;
    this.figure.dataset.form = form;
    this.figure.dataset.match = match.toFixed(3);

    const place = (
      element: HTMLElement | null,
      [x, y]: readonly [number, number],
      width: number,
      height: number,
      label: string,
    ) => {
      if (!element) return;
      const region = this.bytes.match(x - width / 2, y - height / 2, x + width / 2, y + height / 2);
      element.style.left = `${((x - width / 2) / ENTITY_WIDTH) * 100}%`;
      element.style.top = `${((y - height / 2) / ENTITY_HEIGHT) * 100}%`;
      element.style.width = `${(width / ENTITY_WIDTH) * 100}%`;
      element.style.height = `${(height / ENTITY_HEIGHT) * 100}%`;
      element.dataset.confident = String(region >= 0.7);
      const text = `${label}${region >= 0.7 ? '' : '?'}`;
      const labelElement = element.querySelector('[data-tag-label]');
      if (labelElement && labelElement.textContent !== text) labelElement.textContent = text;
      element.querySelector('[data-tag-value]')?.replaceChildren(region.toFixed(2));
    };
    const headSize = landmarks.headRadius * 2.3;
    place(this.tags.head, landmarks.head, headSize, headSize * 1.22, 'HEAD');
    const handSize = landmarks.headRadius * 1.25;
    place(this.tags.left, landmarks.hands[0], handSize, handSize * 0.9, 'HAND.L');
    place(this.tags.right, landmarks.hands[1], handSize, handSize * 0.9, 'HAND.R');

    const panel = this.panel;
    if (!panel) return;
    this.bestMatch = Math.max(this.bestMatch, match);
    const result = review(form, still ? 1 : this.bestMatch, still ? 0 : this.attention);
    const previous = this.verdict?.verdict ?? 'REVIEWING';
    if (!still && result.verdict !== 'REVIEWING' && result.verdict !== previous) {
      this.pushLog(`#${pad(this.attempt.index + 1)} ${FORM_LABELS[form]} — ${result.verdict.toLowerCase()} ${result.passes}/3`);
    }
    this.verdict = result;
    panel.querySelectorAll<HTMLElement>('[data-check]').forEach((check, index) => {
      const vote = result.votes[index] ?? 'pending';
      if (check.dataset.vote !== vote) check.dataset.vote = vote;
      check.querySelector('[data-check-vote]')?.replaceChildren(vote === 'pending' ? '· · ·' : vote.toUpperCase());
      check.querySelector('[data-check-reason]')?.replaceChildren(result.reasons[index] ?? '');
    });
    const verdict = panel.querySelector<HTMLElement>('.review__verdict');
    if (verdict && verdict.dataset.verdict !== result.verdict) {
      verdict.dataset.verdict = result.verdict;
      panel.querySelector('[data-review-verdict]')?.replaceChildren(
        result.verdict === 'REVIEWING' ? 'REVIEWING' : `${result.verdict} · ${result.passes}/3`,
      );
    }
    panel.querySelector('[data-review-attempt]')?.replaceChildren(pad(this.attempt.index + 1));
    panel.querySelector('[data-review-form]')?.replaceChildren(FORM_LABELS[form]);
    panel.querySelector('[data-review-match]')?.replaceChildren(match.toFixed(2));
    panel.querySelector<HTMLElement>('[data-review-meter]')?.style.setProperty('--match', match.toFixed(3));
    panel.querySelector('[data-review-bytes]')?.replaceChildren(
      still ? '—' : `${this.bytes.delivered.toLocaleString('en-US')} · ${this.bytes.flights} aloft`,
    );
  }

  private pushLog(entry: string) {
    this.log = [entry, ...this.log].slice(0, 4);
    const list = this.panel?.querySelector('[data-review-log]');
    if (!list) return;
    list.replaceChildren(...this.log.map((text, index) => {
      const item = document.createElement('li');
      item.textContent = text;
      if (index === 0) item.dataset.fresh = 'true';
      return item;
    }));
  }

  private readPalette() {
    const styles = getComputedStyle(document.documentElement);
    this.inks = {
      settled: parseInk(getComputedStyle(this.canvas).color, this.inks.settled),
      flight: parseInk(styles.getPropertyValue('--cool'), this.inks.flight),
      discard: parseInk(styles.getPropertyValue('--line'), this.inks.discard),
    };
  }

  private stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
  }

  private dispose() {
    this.disposed = true;
    this.stop();
    this.events.abort();
    this.intersection.disconnect();
    this.paletteObserver.disconnect();
  }
}

document.querySelectorAll<HTMLElement>('[data-intelligence]').forEach((figure) => {
  if (figure.dataset.intelligenceInitialized) return;
  const stage = figure.querySelector<HTMLElement>('[data-intelligence-stage]');
  const canvas = figure.querySelector<HTMLCanvasElement>('[data-intelligence-canvas]');
  if (stage && canvas) new ByteEntity(figure, stage, canvas);
});
