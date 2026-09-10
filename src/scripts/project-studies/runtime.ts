import { PixelField, STUDY_WIDTH, STUDY_HEIGHT, STUDY_IDS, drawStudy, type StudyId } from './scenes';
import { writeDither } from './dither';

interface Study {
  figure: HTMLElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  pixels: ImageData;
  field: PixelField;
  id: StudyId;
  visible: boolean;
  time: number;
  frames: number;
  ink: number[];
  pointer: [number, number];
  target: [number, number];
}

const motion = matchMedia('(prefers-reduced-motion: reduce)');
const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
const pauseButton = document.querySelector<HTMLButtonElement>('[data-studies-pause]');
const studies: Study[] = [];
const events = new AbortController();
const options = { signal: events.signal };
let paused = false;
let frame = 0;
let previousTime = 0;
let disposed = false;

const isStill = () => paused || motion.matches || connection?.saveData === true;

function palette(study: Study) {
  const color = getComputedStyle(study.canvas).color.match(/[\d.]+/g);
  study.ink = color ? color.slice(0, 3).map(Number) : [32, 38, 33];
}

function draw(study: Study) {
  drawStudy(study.field, study.id, study.time, study.pointer);
  writeDither(study.field.values, study.pixels.data, study.ink);
  study.context.putImageData(study.pixels, 0, 0);
  study.figure.dataset.studyRenderer = 'canvas';
  study.figure.dataset.studyFrames = String(++study.frames);
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  previousTime = 0;
}

function updateControls() {
  if (!pauseButton) return;
  pauseButton.hidden = motion.matches || connection?.saveData === true || studies.length === 0;
  pauseButton.textContent = paused ? 'Play studies' : 'Pause studies';
  pauseButton.setAttribute('aria-pressed', String(paused));
}

function sync() {
  if (disposed) return;
  updateControls();
  const visible = studies.filter((study) => study.visible && !document.hidden);
  for (const study of studies) {
    study.figure.dataset.studyMotion = !study.visible || document.hidden ? 'offscreen' : isStill() ? 'still' : 'live';
  }
  if (isStill() || visible.length === 0) {
    stop();
    visible.forEach(draw);
  } else if (!frame) {
    previousTime = 0;
    frame = requestAnimationFrame(tick);
  }
}

function tick(timestamp: number) {
  frame = 0;
  if (disposed || document.hidden || isStill()) return;
  if (!previousTime) previousTime = timestamp;
  const delta = timestamp - previousTime;
  if (delta >= 1000 / 24) {
    previousTime = timestamp;
    const seconds = Math.min(delta / 1000, 0.1);
    for (const study of studies) {
      if (!study.visible) continue;
      study.time += seconds;
      const ease = 1 - Math.exp(-seconds * 4);
      study.pointer[0] += (study.target[0] - study.pointer[0]) * ease;
      study.pointer[1] += (study.target[1] - study.pointer[1]) * ease;
      draw(study);
    }
  }
  if (studies.some((study) => study.visible)) frame = requestAnimationFrame(tick);
}

const intersection = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const study = studies.find((candidate) => candidate.canvas === entry.target);
    if (study) study.visible = entry.isIntersecting && entry.intersectionRatio > 0;
  }
  sync();
}, { threshold: [0, 0.05] });

document.querySelectorAll<HTMLElement>('[data-project-study]').forEach((figure) => {
  if (figure.dataset.studyInitialized) return;
  const id = figure.dataset.projectStudy;
  const canvas = figure.querySelector<HTMLCanvasElement>('[data-study-canvas]');
  if (!canvas || !STUDY_IDS.includes(id as StudyId)) return;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;
  canvas.width = STUDY_WIDTH;
  canvas.height = STUDY_HEIGHT;
  context.imageSmoothingEnabled = false;
  const study: Study = {
    figure, canvas, context, id: id as StudyId,
    pixels: context.createImageData(STUDY_WIDTH, STUDY_HEIGHT),
    field: new PixelField(), visible: false, time: 8, frames: 0,
    ink: [32, 38, 33], pointer: [0, 0], target: [0, 0],
  };
  palette(study);
  draw(study);
  studies.push(study);
  figure.dataset.studyInitialized = 'true';
  figure.addEventListener('pointermove', (event) => {
    if (isStill() || event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    study.target = [
      Math.max(-1, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1)),
      Math.max(-1, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height) * 2 - 1)),
    ];
  }, { ...options, passive: true });
  figure.addEventListener('pointerleave', () => { study.target = [0, 0]; }, options);
  intersection.observe(canvas);
});

const paletteObserver = new MutationObserver(() => {
  studies.forEach((study) => { palette(study); draw(study); });
});
paletteObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] });
pauseButton?.addEventListener('click', () => { paused = !paused; sync(); }, options);
motion.addEventListener('change', () => {
  if (motion.matches) studies.forEach((study) => { study.time = 8; study.pointer = [0, 0]; });
  sync();
}, options);
connection?.addEventListener('change', sync, options);
document.addEventListener('visibilitychange', sync, options);
window.addEventListener('pageshow', sync, options);
window.addEventListener('pagehide', (event) => {
  stop();
  if (!event.persisted) {
    disposed = true;
    intersection.disconnect();
    paletteObserver.disconnect();
    events.abort();
  }
}, options);
sync();
