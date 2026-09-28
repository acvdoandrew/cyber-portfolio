import { hexDumpLine } from './format';

/** When the outro starts, measured from navigation start like the CSS timeline. */
export const BOOT_DURATION_MS = 3150;
const OUTRO_MS = 380;
const STORAGE_KEY = 'andrew.boot.v1';

const root = document.documentElement;
const screen = document.querySelector<HTMLElement>('[data-boot-screen]');

const complete = () => {
  root.dataset.boot = 'done';
  screen?.remove();
  window.dispatchEvent(new CustomEvent('console:booted'));
};

if (root.dataset.boot === 'run' && screen) {
  const events = new AbortController();
  const dump = [...screen.querySelectorAll<HTMLElement>('[data-boot-dump] span')];
  let tick = 0;
  let ended = false;

  const scramble = window.setInterval(() => {
    tick += 1;
    dump.forEach((line, row) => {
      line.textContent = hexDumpLine(row, tick + row * 3);
    });
  }, 110);

  const end = () => {
    if (ended) return;
    ended = true;
    events.abort();
    window.clearInterval(scramble);
    try {
      sessionStorage.setItem(STORAGE_KEY, 'done');
    } catch {
      // Without storage the sequence may play again next visit.
    }
    root.dataset.boot = 'out';
    window.setTimeout(complete, OUTRO_MS);
  };

  // Any intent to use the page skips straight to the outro.
  for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
    window.addEventListener(type, end, { signal: events.signal, passive: true });
  }
  window.setTimeout(end, Math.max(0, BOOT_DURATION_MS - performance.now()));
} else {
  screen?.remove();
  if (root.dataset.boot === 'run') complete();
}
