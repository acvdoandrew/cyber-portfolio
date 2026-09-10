import { typingTimeline, typingFrame } from './terminal-timeline';

document.querySelectorAll<HTMLElement>('[data-contact-terminal]').forEach((terminal) => {
  if (terminal.dataset.initialized) return;
  terminal.dataset.initialized = 'true';
  const scene = terminal.closest<HTMLElement>('[data-contact-scene]');
  const journey = terminal.closest<HTMLElement>('[data-portfolio-journey]');
  const lines = [...terminal.querySelectorAll<HTMLElement>('[data-type-line]')];
  const schedule = typingTimeline(lines.map((line) => Number(line.dataset.typeLength)));
  const button = terminal.querySelector<HTMLButtonElement>('[data-terminal-skip]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  let elapsed = 0;
  let previous = 0;
  let frame = 0;
  let started = false;
  let complete = false;

  const visible = () => {
    const rect = terminal.getBoundingClientRect();
    const revealed = !journey || journey.dataset.journeyEnhanced !== 'true'
      || Number(journey.style.getPropertyValue('--contact-reveal')) > 0.45;
    return revealed && !document.hidden && rect.bottom > 0 && rect.top < innerHeight;
  };

  const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; };
  const signal = (line: number, progress: number, done: boolean) => {
    scene?.dispatchEvent(new CustomEvent('terminal:typing', { detail: { line, progress, complete: done } }));
  };
  const finish = () => {
    started = true;
    complete = true;
    stop();
    terminal.dataset.typing = 'false';
    if (button) { button.textContent = 'replay'; button.setAttribute('aria-label', 'Replay contact typing'); }
    signal(schedule.length - 1, 1, true);
  };

  const tick = (timestamp: number) => {
    frame = 0;
    if (!visible() || complete) { previous = 0; return; }
    if (!previous) previous = timestamp;
    elapsed += Math.min(timestamp - previous, 100);
    previous = timestamp;
    const state = typingFrame(schedule, elapsed);
    lines.forEach((line, index) => {
      line.style.setProperty('--typed-chars', String(state.counts[index]));
      line.dataset.typeActive = String(index === state.line);
    });
    signal(state.line, state.progress, state.complete);
    if (state.complete) finish();
    else frame = requestAnimationFrame(tick);
  };

  const start = () => {
    started = true;
    complete = false;
    elapsed = 0;
    terminal.dataset.typing = 'true';
    lines.forEach((line) => line.style.setProperty('--typed-chars', '0'));
    if (button) { button.hidden = false; button.textContent = 'skip'; button.setAttribute('aria-label', 'Show all contact details now'); }
  };

  const sync = () => {
    if (reduced.matches) { finish(); if (button) button.hidden = true; return; }
    if (!visible()) { stop(); return; }
    if (!started) start();
    if (!complete && !frame) frame = requestAnimationFrame(tick);
  };
  button?.addEventListener('click', () => {
    if (!complete) finish();
    else { start(); sync(); }
  }, { signal: events.signal });
  terminal.addEventListener('focusin', (event) => {
    if ((event.target as HTMLElement).closest('a')) finish();
  }, { signal: events.signal });
  reduced.addEventListener('change', sync, { signal: events.signal });
  document.addEventListener('visibilitychange', sync, { signal: events.signal });
  window.addEventListener('scroll', sync, { passive: true, signal: events.signal });
  window.addEventListener('pageshow', sync, { signal: events.signal });
  const intersection = new IntersectionObserver(sync);
  intersection.observe(terminal);
  const reveal = new MutationObserver(sync);
  if (journey) reveal.observe(journey, { attributes: true, attributeFilter: ['style', 'data-journey-enhanced'] });
  window.addEventListener('pagehide', (event) => {
    stop();
    if (!event.persisted) { events.abort(); intersection.disconnect(); reveal.disconnect(); }
  }, { signal: events.signal });
  sync();
});
