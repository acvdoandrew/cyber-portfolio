/** Hero scope: a cyan marker that scans the field, then locks onto the cursor. */
const LENS = 0.375;
const VIEWBOX_CENTER = 300;
const VIEWBOX_LENS = 225;

const signed = (value: number) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(3)}`;

function initializeScope(scope: HTMLElement) {
  const target = scope.querySelector<HTMLElement>('[data-scope-target]');
  const mode = scope.querySelector<HTMLElement>('[data-scope-mode]');
  const readout = scope.querySelector<HTMLElement>('[data-scope-readout]');
  const hint = scope.querySelector<HTMLElement>('[data-scope-hint]');
  const track = scope.querySelector<SVGLineElement>('[data-scope-track]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!target) return;

  const position: [number, number] = [0.32, -0.24];
  let goal: [number, number] = [0, 0];
  let inside = false;
  let visible = false;
  let elapsed = 0;
  let last = 0;
  let lastText = 0;
  let frame = 0;

  scope.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const bounds = scope.getBoundingClientRect();
    const radius = bounds.width * LENS;
    let x = (event.clientX - bounds.left - bounds.width / 2) / radius;
    let y = (event.clientY - bounds.top - bounds.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    goal = [x, y];
    inside = true;
  }, { passive: true });
  scope.addEventListener('pointerleave', () => {
    inside = false;
  });

  const render = (now: number) => {
    const size = scope.clientWidth;
    const px = size / 2 + position[0] * size * LENS;
    const py = size / 2 + position[1] * size * LENS;
    target.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    target.dataset.side = position[0] > 0.2 ? 'left' : 'right';
    track?.setAttribute('x2', (VIEWBOX_CENTER + position[0] * VIEWBOX_LENS).toFixed(1));
    track?.setAttribute('y2', (VIEWBOX_CENTER + position[1] * VIEWBOX_LENS).toFixed(1));

    if (now - lastText < 90) return;
    lastText = now;
    const lock = Math.round(Math.max(0, 1 - Math.hypot(goal[0] - position[0], goal[1] - position[1])) * 100);
    mode?.replaceChildren(inside ? `TRACKING ${String(lock).padStart(3, '0')}%` : 'SCANNING');
    // Field coordinates grow upward, like the shader's pointer uniform.
    readout?.replaceChildren(`X ${signed(position[0])}  Y ${signed(-position[1])}`);
    hint?.replaceChildren(inside ? 'target locked' : 'move your cursor');
  };

  const tick = (now: number) => {
    frame = 0;
    if (!visible || document.hidden || motion.matches) {
      last = 0;
      return;
    }
    const seconds = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;
    elapsed += seconds;
    if (!inside) {
      goal = [
        Math.sin(elapsed * 0.37) * 0.52 + Math.sin(elapsed * 0.11 + 2) * 0.16,
        Math.sin(elapsed * 0.53 + 1.3) * 0.44,
      ];
    }
    const ease = 1 - Math.exp(-seconds * (inside ? 11 : 2.4));
    position[0] += (goal[0] - position[0]) * ease;
    position[1] += (goal[1] - position[1]) * ease;
    render(now);
    frame = requestAnimationFrame(tick);
  };

  const sync = () => {
    if (!frame && visible && !document.hidden && !motion.matches) {
      frame = requestAnimationFrame(tick);
    }
  };

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }).observe(scope);
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  render(0);
}

const scope = document.querySelector<HTMLElement>('[data-scope]');
if (scope && !scope.dataset.scopeInitialized) {
  scope.dataset.scopeInitialized = 'true';
  initializeScope(scope);
}
