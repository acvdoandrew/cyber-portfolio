import { formatClock, formatUptime, utcOffsetLabel } from './format';
import { hashFor, resolveHash, step, type Route } from './routes';
import { setSevenSeg } from './seven-seg';

type PaletteId =
  | 'archive'
  | 'carbon'
  | 'signal'
  | 'radiant'
  | 'field'
  | 'alloy';

type Palette = {
  paper: string;
  ink: string;
  accent: string;
  scheme: 'light' | 'dark';
};

const STORAGE_KEY = 'portfolio.palette.v1';
const DISPLAY_FILTER_STORAGE_KEY = 'portfolio.display-filter.v1';
const SESSION_KEY = 'andrew.session.v1';
const BOOT_KEY = 'andrew.boot.v1';
const DEFAULT_PALETTE: PaletteId = 'radiant';
const paletteOrder: PaletteId[] = [
  'archive',
  'carbon',
  'signal',
  'radiant',
  'field',
  'alloy',
];

const palettes: Record<PaletteId, Palette> = {
  archive: { paper: '#F2F3EE', ink: '#202621', accent: '#A3422B', scheme: 'light' },
  carbon: { paper: '#090A09', ink: '#F0EEE2', accent: '#D85D3F', scheme: 'dark' },
  signal: { paper: '#050806', ink: '#E6F2E9', accent: '#00D985', scheme: 'dark' },
  radiant: { paper: '#0B0905', ink: '#F2D66C', accent: '#F05A2A', scheme: 'dark' },
  field: { paper: '#061008', ink: '#9FD19D', accent: '#D6F06C', scheme: 'dark' },
  alloy: { paper: '#B4BCC1', ink: '#111314', accent: '#D14E32', scheme: 'light' },
};

const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const isPaletteId = (value: string | undefined): value is PaletteId =>
  Boolean(value && value in palettes);

/** Replays a one-shot glitch on an element. */
const glitch = (element: Element | null | undefined) => {
  if (!element || reducedMotion.matches) return;
  element.classList.remove('glitching');
  void (element as HTMLElement).offsetWidth;
  element.classList.add('glitching');
  window.setTimeout(() => element.classList.remove('glitching'), 520);
};

/* Palette ----------------------------------------------------------------- */

const updatePaletteControl = (id: PaletteId) => {
  const button = document.querySelector<HTMLButtonElement>('[data-palette-cycle]');
  if (!button) return;

  const currentIndex = paletteOrder.indexOf(id);
  const next = paletteOrder[(currentIndex + 1) % paletteOrder.length];
  const announcement = `Current palette ${id}. Activate for ${next}.`;

  button.setAttribute('aria-label', announcement);
  button.dataset.currentPalette = id;
  button.querySelector('[data-palette-current]')?.replaceChildren(id);
  button.querySelector('[data-palette-announcement]')?.replaceChildren(announcement);
};

const applyPalette = (id: PaletteId, persist = true) => {
  const palette = palettes[id];

  root.dataset.palette = id;
  root.style.colorScheme = palette.scheme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', palette.paper);
  document
    .querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
    ?.setAttribute('content', palette.scheme);
  updatePaletteControl(id);

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // The palette remains usable when storage is unavailable.
    }
  }

  window.dispatchEvent(
    new CustomEvent('palettechange', {
      detail: { id, ...palette },
    }),
  );
};

const initializePalette = () => {
  const rootValue = root.dataset.palette;
  let id: PaletteId = isPaletteId(rootValue) ? rootValue : DEFAULT_PALETTE;

  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? undefined;
    if (isPaletteId(stored)) id = stored;
  } catch {
    // Use the server-rendered default.
  }

  applyPalette(id, false);
  const button = document.querySelector<HTMLButtonElement>('[data-palette-cycle]');
  if (!button) return;

  const cycle = () => {
    const current = root.dataset.palette;
    const index = isPaletteId(current) ? paletteOrder.indexOf(current) : 0;
    applyPalette(paletteOrder[(index + 1) % paletteOrder.length]);
    glitch(document.querySelector('[data-scene-number]'));
  };

  button.addEventListener('click', cycle);
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    cycle();
  });
};

/* CRT --------------------------------------------------------------------- */

const initializeDisplayFilter = () => {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-display-filter-toggle]',
  );
  if (!button) return;

  const apply = (enabled: boolean, persist = true) => {
    root.dataset.displayFilter = enabled ? 'on' : 'off';
    button.setAttribute('aria-pressed', String(enabled));

    const label = enabled
      ? 'Disable CRT display filter'
      : 'Enable CRT display filter';
    const announcement = enabled
      ? 'CRT display filter enabled. Activate to disable.'
      : 'CRT display filter disabled. Activate to enable.';

    button.setAttribute('aria-label', label);
    button
      .querySelector('[data-display-filter-announcement]')
      ?.replaceChildren(announcement);

    if (persist) {
      try {
        localStorage.setItem(
          DISPLAY_FILTER_STORAGE_KEY,
          enabled ? 'on' : 'off',
        );
      } catch {
        // The control remains usable when storage is unavailable.
      }
    }
  };

  let enabled = root.dataset.displayFilter === 'on';
  try {
    enabled = localStorage.getItem(DISPLAY_FILTER_STORAGE_KEY) === 'on';
  } catch {
    // Use the server-rendered default.
  }

  apply(enabled, false);
  button.addEventListener('click', () => {
    apply(button.getAttribute('aria-pressed') !== 'true');
  });
};

/* Router ------------------------------------------------------------------
   Every channel owns the whole viewport. The hash names the channel, or a
   project inside Work; history keeps back and forward working. */

const initializeRouter = () => {
  const views = [...document.querySelectorAll<HTMLElement>('[data-view]')];
  const channelIds = views.map((view) => view.dataset.view ?? '');
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-channel-link]')];
  const tabs = [...document.querySelectorAll<HTMLAnchorElement>('[data-unit-tab]')];
  const unitIds = tabs.map((tab) => tab.dataset.unitTab ?? '');
  const tag = document.querySelector<HTMLElement>('[data-scene-number]');
  const path = document.querySelector<HTMLElement>('[data-scene-path]');
  const cut = document.querySelector<HTMLElement>('[data-cut]');
  const stage = document.querySelector<HTMLElement>('[data-stage]');
  if (!views.length) return;

  const meta = (channel: string) => {
    const link = links.find((candidate) => candidate.dataset.channelLink === channel);
    return {
      number: link?.dataset.number ?? '00',
      label: link?.textContent?.replace(/^\s*\d+\s*/, '').trim() || channel,
      path: link?.dataset.path ?? `~/${channel}`,
      card: link?.dataset.card ?? '',
    };
  };

  let current: Route = {
    channel: channelIds.includes(root.dataset.channel ?? '') ? root.dataset.channel! : channelIds[0],
    unit: unitIds.includes(root.dataset.unit ?? '') ? root.dataset.unit! : unitIds[0] ?? null,
  };
  let cutTimer = 0;
  let enterTimer = 0;

  const playCut = (channel: string) => {
    if (!cut || reducedMotion.matches) return;
    const { number, label, card } = meta(channel);
    cut.querySelector('[data-cut-number]')?.replaceChildren(number);
    cut.querySelector('[data-cut-ghost]')?.replaceChildren(number);
    cut.querySelector('[data-cut-title]')?.replaceChildren(label);
    cut.querySelector('[data-cut-line]')?.replaceChildren(card);
    cut.dataset.cut = 'off';
    void cut.offsetWidth;
    cut.dataset.cut = 'on';
    window.clearTimeout(cutTimer);
    cutTimer = window.setTimeout(() => {
      cut.dataset.cut = 'off';
    }, 760);
  };

  /** Power the view on: panels flicker in and its display lines glitch once. */
  const enter = (view: HTMLElement | undefined) => {
    if (!view) return;
    views.forEach((candidate) => delete candidate.dataset.entering);
    if (reducedMotion.matches) return;
    void view.offsetWidth;
    view.dataset.entering = 'true';
    window.clearTimeout(enterTimer);
    enterTimer = window.setTimeout(() => delete view.dataset.entering, 1100);
    view.querySelectorAll('.display__line').forEach((line, index) => {
      if ((line as HTMLElement).offsetParent) window.setTimeout(() => glitch(line), 220 + index * 140);
    });
  };

  const focusTarget = (route: Route) => {
    if (route.channel === 'work' && route.unit) {
      return tabs.find((tab) => tab.dataset.unitTab === route.unit);
    }
    const view = views[channelIds.indexOf(route.channel)];
    return view?.querySelector<HTMLElement>('h1[tabindex], h2[tabindex]') ?? view;
  };

  const apply = (
    next: Route,
    { push = false, focus = false, initial = false }: { push?: boolean; focus?: boolean; initial?: boolean } = {},
  ) => {
    const channel = channelIds.includes(next.channel) ? next.channel : channelIds[0];
    const unit = next.unit && unitIds.includes(next.unit) ? next.unit : current.unit;
    const changedChannel = channel !== current.channel;
    const changedUnit = unit !== current.unit;
    current = { channel, unit };

    root.dataset.channel = channel;
    if (unit) root.dataset.unit = unit;
    const { number, label, path: channelPath } = meta(channel);
    links.forEach((link) => {
      if (link.dataset.channelLink === channel) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    tabs.forEach((tab) => {
      const selected = tab.dataset.unitTab === unit;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    tag?.replaceChildren(number);
    path?.replaceChildren(channel === 'work' && unit ? `${channelPath}/${unit}` : channelPath);
    document.title = channel === channelIds[0] ? 'andrew@home' : `${label} — andrew@home`;

    if (push) {
      const hash = hashFor({ channel, unit: next.unit && channel === 'work' ? unit : null });
      if (location.hash !== hash) history.pushState({ channel, unit }, '', hash);
    }

    // Each channel opens at its top, wherever the last one was left.
    if (changedChannel || initial) stage?.scrollTo({ top: 0 });
    if (!initial && changedChannel) {
      glitch(tag);
      playCut(channel);
      const rect = tag?.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent('console:scene', {
        detail: { scene: number, x: rect ? rect.left + rect.width / 2 : 0, y: rect ? rect.top + rect.height / 2 : 0 },
      }));
    }
    if (!initial && (changedChannel || changedUnit)) {
      const view = views[channelIds.indexOf(channel)];
      enter(changedChannel ? view : view?.querySelector<HTMLElement>(`[data-unit-panel="${unit}"]`) ?? view);
    }
    if (focus) focusTarget(current)?.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent('console:channel', { detail: { ...current } }));
  };

  const routeOf = (hash: string) => {
    const route = resolveHash(hash, channelIds, unitIds);
    const key = hash.replace(/^#/, '').toLowerCase();
    // Only hashes the deck owns are routed; the skip link and friends behave normally.
    const known = channelIds.includes(route.channel) && (route.unit !== null || channelIds.includes(key) || key === 'capabilities');
    return known ? route : null;
  };

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const route = routeOf(link.hash);
    if (!route) return;
    event.preventDefault();
    const inTabs = Boolean(link.closest('[role="tablist"]'));
    apply(route, { push: true, focus: !inTabs || route.channel !== current.channel });
  });

  /** Follow the address bar, and rewrite old or alias hashes to their canonical form. */
  const followLocation = (initial = false) => {
    const route = resolveHash(location.hash, channelIds, unitIds);
    apply(route, { initial });
    if (location.hash.length > 1) {
      const canonical = hashFor({ channel: route.channel, unit: route.channel === 'work' ? route.unit : null });
      if (canonical !== location.hash) history.replaceState(null, '', canonical);
    }
  };

  window.addEventListener('popstate', () => followLocation());

  const typing = (target: EventTarget | null) =>
    Boolean((target as Element | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
    if (root.dataset.boot === 'run') return;
    const inTabs = Boolean((event.target as Element | null)?.closest?.('[role="tablist"]'));

    if (/^[0-9]$/.test(event.key)) {
      const channel = channelIds[Number(event.key)];
      if (!channel) return;
      event.preventDefault();
      apply({ channel, unit: null }, { push: true, focus: true });
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const channel = step(channelIds, current.channel, event.key === 'ArrowLeft' ? -1 : 1);
      apply({ channel, unit: null }, { push: true, focus: true });
      return;
    }
    if (current.channel !== 'work' || !unitIds.length) return;
    let unit: string | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      unit = step(unitIds, current.unit ?? unitIds[0], event.key === 'ArrowUp' ? -1 : 1);
    } else if (inTabs && event.key === 'Home') {
      unit = unitIds[0];
    } else if (inTabs && event.key === 'End') {
      unit = unitIds[unitIds.length - 1];
    }
    if (!unit) return;
    event.preventDefault();
    apply({ channel: 'work', unit }, { push: true, focus: inTabs });
  });

  followLocation(true);
  afterBoot(() => enter(views[channelIds.indexOf(current.channel)]));
};

/* Clock, session, and frame rate ------------------------------------------ */

const sessionStart = () => {
  const now = Date.now();
  try {
    const stored = Number(sessionStorage.getItem(SESSION_KEY));
    if (Number.isFinite(stored) && stored > 0 && stored <= now) return stored;
    sessionStorage.setItem(SESSION_KEY, String(now));
  } catch {
    // Fall back to this page load.
  }
  return now;
};

const initializeClock = () => {
  const clock = document.querySelector<SVGSVGElement>('[data-clock] svg');
  const beat = document.querySelector<HTMLElement>('.beat');
  const uptime = document.querySelector<HTMLElement>('[data-info-uptime]');
  const offset = document.querySelector<HTMLElement>('[data-utc-offset]');
  const start = sessionStart();
  offset?.replaceChildren(`ET · ${utcOffsetLabel(new Date())}`);

  const tick = () => {
    const now = new Date();
    if (clock) setSevenSeg(clock, formatClock(now));
    if (beat) beat.dataset.beat = String(now.getSeconds() % 4);
    uptime?.replaceChildren(formatUptime(now.getTime() - start));
    window.setTimeout(tick, 1005 - (Date.now() % 1000));
  };
  tick();
};

const initializeTelemetry = () => {
  const fps = document.querySelector<HTMLElement>('[data-info-fps]');
  const monitors = [...document.querySelectorAll<HTMLElement>('[data-project-study]')].map((figure) => ({
    figure,
    frames: figure.querySelector<HTMLElement>('[data-monitor-frames]'),
  }));
  let frames = 0;
  let last = 0;
  let frame = 0;

  const sample = (now: number) => {
    frames += 1;
    if (!last) last = now;
    if (now - last >= 500) {
      fps?.replaceChildren(String(Math.round((frames * 1000) / (now - last))));
      frames = 0;
      last = now;
      for (const monitor of monitors) {
        const count = monitor.figure.dataset.studyFrames;
        if (monitor.frames && count) monitor.frames.textContent = count.padStart(4, '0');
      }
    }
    frame = requestAnimationFrame(sample);
  };

  const sync = () => {
    cancelAnimationFrame(frame);
    frames = 0;
    last = 0;
    if (!document.hidden) frame = requestAnimationFrame(sample);
  };
  document.addEventListener('visibilitychange', sync);
  sync();
};

/* Idle glitches, reboot, and overdrive ------------------------------------ */

const initializeHeroGlitch = () => {
  const lines = [...document.querySelectorAll('[data-hero-title] .display__line')];
  const hero = document.querySelector('#home');
  if (!lines.length || !hero) return;

  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  }).observe(hero);

  const schedule = () => {
    window.setTimeout(() => {
      if (visible && !document.hidden) {
        glitch(lines[Math.floor(Math.random() * lines.length)]);
      }
      schedule();
    }, 7000 + Math.random() * 8000);
  };
  schedule();
};

const initializeReboot = () => {
  const button = document.querySelector<HTMLButtonElement>('[data-reboot]');
  if (!button) return;
  if (reducedMotion.matches) {
    button.hidden = true;
    return;
  }
  button.addEventListener('click', () => {
    try {
      sessionStorage.removeItem(BOOT_KEY);
    } catch {
      // Storage is optional; the reload still returns Home.
    }
    location.replace(location.pathname + location.search);
  });
};

const initializeOverdrive = () => {
  const word = 'overdrive';
  let buffer = '';
  let timer = 0;

  const trigger = () => {
    if (reducedMotion.matches || root.dataset.overdrive) return;
    root.dataset.overdrive = 'on';
    window.dispatchEvent(new CustomEvent('console:overdrive'));
    document.querySelectorAll('.display__line').forEach((line, index) => {
      window.setTimeout(() => glitch(line), index * 70);
    });
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      delete root.dataset.overdrive;
    }, 3400);
  };

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    if ((event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
    buffer = (buffer + event.key.toLowerCase()).slice(-word.length);
    if (buffer === word) {
      buffer = '';
      trigger();
    }
  });
};

/* Start ------------------------------------------------------------------- */

const afterBoot = (callback: () => void) => {
  if (root.dataset.boot === 'run' || root.dataset.boot === 'out') {
    window.addEventListener('console:booted', callback, { once: true });
  } else {
    callback();
  }
};

const initialize = () => {
  initializePalette();
  initializeDisplayFilter();
  initializeRouter();
  initializeClock();
  initializeTelemetry();
  initializeReboot();
  initializeOverdrive();
  afterBoot(initializeHeroGlitch);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
