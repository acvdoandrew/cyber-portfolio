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
const paletteOrder: PaletteId[] = [
  'archive',
  'carbon',
  'signal',
  'radiant',
  'field',
  'alloy',
];

const palettes: Record<PaletteId, Palette> = {
  archive: {
    paper: '#E7E4DC',
    ink: '#182521',
    accent: '#8E2148',
    scheme: 'light',
  },
  carbon: {
    paper: '#090A09',
    ink: '#F0EEE2',
    accent: '#D85D3F',
    scheme: 'dark',
  },
  signal: {
    paper: '#050806',
    ink: '#E6F2E9',
    accent: '#00D985',
    scheme: 'dark',
  },
  radiant: {
    paper: '#0B0905',
    ink: '#F2D66C',
    accent: '#F05A2A',
    scheme: 'dark',
  },
  field: {
    paper: '#061008',
    ink: '#9FD19D',
    accent: '#D6F06C',
    scheme: 'dark',
  },
  alloy: {
    paper: '#B4BCC1',
    ink: '#111314',
    accent: '#D14E32',
    scheme: 'light',
  },
};

const isPaletteId = (value: string | undefined): value is PaletteId =>
  Boolean(value && value in palettes);

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
  const root = document.documentElement;

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
  const rootValue = document.documentElement.dataset.palette;
  let id: PaletteId = isPaletteId(rootValue) ? rootValue : 'archive';

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
    const current = document.documentElement.dataset.palette;
    const index = isPaletteId(current) ? paletteOrder.indexOf(current) : 0;
    applyPalette(paletteOrder[(index + 1) % paletteOrder.length]);
  };

  button.addEventListener('click', cycle);
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    cycle();
  });
};

const initializeDisplayFilter = () => {
  const root = document.documentElement;
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

  let enabled = root.dataset.displayFilter !== 'off';
  try {
    enabled = localStorage.getItem(DISPLAY_FILTER_STORAGE_KEY) !== 'off';
  } catch {
    // Use the server-rendered default.
  }

  apply(enabled, false);
  button.addEventListener('click', () => {
    apply(button.getAttribute('aria-pressed') !== 'true');
  });
};

const initializeNavigation = () => {
  const masthead = document.querySelector<HTMLElement>('[data-masthead]');
  const button = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const nav = document.querySelector<HTMLElement>('#primary-navigation');
  if (!masthead || !button || !nav) return;

  const setOpen = (open: boolean) => {
    masthead.dataset.menuOpen = String(open);
    button.setAttribute('aria-expanded', String(open));
  };

  button.addEventListener('click', () => {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });
  nav.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      button.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!masthead.contains(event.target as Node)) setOpen(false);
  });
};

const initializePortfolioJourney = () => {
  const heroStage = document.querySelector<HTMLElement>('[data-hero-stage]');
  const journey = document.querySelector<HTMLElement>(
    '[data-portfolio-journey]',
  );
  const card = journey?.querySelector<HTMLElement>('[data-journey-card]');
  const viewport = journey?.querySelector<HTMLElement>(
    '[data-journey-viewport]',
  );
  const track = journey?.querySelector<HTMLElement>('[data-journey-track]');
  const sections = [
    ...(journey?.querySelectorAll<HTMLElement>('[data-journey-section]') ?? []),
  ];
  const contactSection = journey?.querySelector<HTMLElement>(
    '[data-contact-field]',
  );
  const chapter = journey?.querySelector<HTMLElement>('[data-journey-chapter]');
  const chapterIndex = journey?.querySelector<HTMLElement>(
    '[data-journey-chapter-index]',
  );
  const state = journey?.querySelector<HTMLElement>('[data-journey-state]');
  const masthead = document.querySelector<HTMLElement>('[data-masthead]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (
    !heroStage ||
    !journey ||
    !card ||
    !viewport ||
    !track ||
    !sections.length
  ) {
    return;
  }

  let frame = 0;
  let enhanced = false;
  let journeyTop = 0;
  let trackTravel = 0;
  let dwellDistance = 0;
  let releaseDistance = 0;
  let activeSection = -1;
  let measuredWidth = 0;
  let measuredHeight = 0;

  const clamp = (value: number) => Math.min(1, Math.max(0, value));

  const setActiveSection = (index: number) => {
    if (index === activeSection) return;
    const section =
      index === sections.length ? contactSection : sections[index];
    if (!section) return;
    activeSection = index;
    chapter?.replaceChildren(section.dataset.journeyLabel ?? 'FIELD');
    chapterIndex?.replaceChildren(
      section.dataset.journeyIndex ??
        String(index + 1).padStart(2, '0'),
    );
    journey.dataset.activeChapter = section.id;
  };

  const resetMotion = () => {
    journey.style.removeProperty('height');
    journey.style.setProperty('--card-entry-y', '0px');
    journey.style.setProperty('--card-release-y', '0px');
    journey.style.setProperty('--card-scale', '1');
    journey.style.setProperty('--card-opacity', '1');
    journey.style.setProperty('--journey-progress', '0%');
    journey.style.setProperty('--contact-reveal', '1');
    journey.style.setProperty('--contact-shift', '0px');
    journey.style.setProperty('--specimen-shift', '0px');
    journey.style.setProperty('--specimen-opacity', '1');
    journey.style.setProperty('--specimen-scan-y', '72%');
    heroStage.style.setProperty('--hero-shift', '0px');
    heroStage.style.setProperty('--hero-scale', '1');
    heroStage.style.setProperty('--hero-opacity', '1');
    track.style.transform = 'none';
    state?.replaceChildren('NATIVE DOCUMENT FLOW');
    setActiveSection(0);
  };

  const measure = () => {
    measuredWidth = window.innerWidth;
    measuredHeight = window.innerHeight;
    enhanced = measuredWidth >= 900 && !reducedMotion.matches;
    journey.dataset.journeyEnhanced = String(enhanced);

    if (!enhanced) {
      resetMotion();
      return;
    }

    const viewportHeight = viewport.clientHeight;
    trackTravel = Math.max(0, track.scrollHeight - viewportHeight);
    dwellDistance = Math.max(240, measuredHeight * 0.34);
    releaseDistance = Math.max(520, measuredHeight * 0.82);

    journey.style.height = `${
      measuredHeight + trackTravel + dwellDistance + releaseDistance
    }px`;
    journeyTop = journey.getBoundingClientRect().top + window.scrollY;
    schedule();
  };

  const update = () => {
    frame = 0;

    masthead?.setAttribute(
      'data-scrolled',
      String(window.scrollY > Math.max(24, measuredHeight * 0.03)),
    );

    if (!enhanced) return;

    const journeyRect = journey.getBoundingClientRect();
    const heroProgress = clamp(
      -heroStage.getBoundingClientRect().top /
        Math.max(heroStage.offsetHeight, 1),
    );
    const entry = clamp(
      (measuredHeight - journeyRect.top) / Math.max(measuredHeight, 1),
    );
    const localScroll = Math.max(0, window.scrollY - journeyTop);
    const trackOffset = Math.min(trackTravel, localScroll);
    const releaseStart = trackTravel + dwellDistance;
    const release = clamp(
      (localScroll - releaseStart) / Math.max(releaseDistance, 1),
    );
    const trackProgress = trackTravel ? trackOffset / trackTravel : 0;
    const contactProgress = clamp(
      (localScroll - releaseStart) / Math.max(releaseDistance * 0.72, 1),
    );

    heroStage.style.setProperty(
      '--hero-shift',
      `${(-heroProgress * measuredHeight * 0.055).toFixed(2)}px`,
    );
    heroStage.style.setProperty(
      '--hero-scale',
      (1 + heroProgress * 0.075).toFixed(4),
    );
    heroStage.style.setProperty(
      '--hero-opacity',
      (1 - heroProgress * 0.48).toFixed(4),
    );

    journey.style.setProperty(
      '--card-entry-y',
      `${((1 - entry) * measuredHeight * 0.2).toFixed(2)}px`,
    );
    journey.style.setProperty(
      '--card-release-y',
      `${(-release * measuredHeight * 1.04).toFixed(2)}px`,
    );
    journey.style.setProperty(
      '--card-scale',
      (0.95 + entry * 0.05 - release * 0.025).toFixed(4),
    );
    journey.style.setProperty(
      '--card-opacity',
      (0.4 + entry * 0.6 - release * 0.18).toFixed(4),
    );
    journey.style.setProperty(
      '--journey-progress',
      `${(trackProgress * 100).toFixed(2)}%`,
    );
    journey.style.setProperty(
      '--contact-reveal',
      contactProgress.toFixed(4),
    );
    journey.style.setProperty(
      '--contact-shift',
      `${((1 - contactProgress) * measuredHeight * 0.075).toFixed(2)}px`,
    );
    journey.style.setProperty(
      '--specimen-shift',
      `${((1 - contactProgress) * measuredHeight * 0.1).toFixed(2)}px`,
    );
    journey.style.setProperty(
      '--specimen-opacity',
      contactProgress.toFixed(4),
    );
    journey.style.setProperty(
      '--specimen-scan-y',
      `${(18 + contactProgress * 54).toFixed(2)}%`,
    );
    track.style.transform = `translate3d(0, ${-trackOffset.toFixed(2)}px, 0)`;

    if (entry < 0.98) {
      state?.replaceChildren('CARD APPROACH');
    } else if (trackOffset < trackTravel - 2) {
      state?.replaceChildren('SCROLL / INTERNAL FIELD');
    } else if (release < 0.01) {
      state?.replaceChildren('STACK / HOLD');
    } else {
      state?.replaceChildren('CONTACT / REVEAL');
    }

    if (contactProgress > 0.12) {
      setActiveSection(sections.length);
    } else {
      const sectionProbe = trackOffset + viewport.clientHeight * 0.42;
      let nextSection = 0;
      sections.forEach((section, index) => {
        if (section.offsetTop <= sectionProbe) {
          nextSection = index;
        }
      });
      setActiveSection(nextSection);
    }
  };

  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(update);
  };

  const scrollToSection = (section: HTMLElement, focus = false) => {
    if (!enhanced) return false;
    const offset = Math.min(trackTravel, Math.max(0, section.offsetTop));
    window.scrollTo({
      top: journeyTop + offset,
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
    });
    if (focus) section.focus({ preventScroll: true });
    return true;
  };

  const scrollToContact = (focus = false) => {
    if (!enhanced || !contactSection) return false;
    window.scrollTo({
      top:
        journeyTop +
        trackTravel +
        dwellDistance +
        releaseDistance * 0.92,
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
    });
    if (focus) contactSection.focus({ preventScroll: true });
    return true;
  };

  contactSection?.addEventListener('focusin', () => {
    if (enhanced) scrollToContact();
  });

  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const id = link.hash.slice(1);
      if (!id) return;

      if (id === 'home' && enhanced) {
        event.preventDefault();
        history.pushState(null, '', '#home');
        window.scrollTo({
          top: 0,
          behavior: reducedMotion.matches ? 'auto' : 'smooth',
        });
        return;
      }

      if (id === 'contact' && scrollToContact(true)) {
        event.preventDefault();
        history.pushState(null, '', '#contact');
        return;
      }

      const section = sections.find((candidate) => candidate.id === id);
      if (!section || !scrollToSection(section, true)) return;
      event.preventDefault();
      history.pushState(null, '', `#${id}`);
    });
  });

  track.addEventListener('focusin', (event) => {
    if (!enhanced || !(event.target instanceof HTMLElement)) return;
    const target = event.target;
    if (target.matches('[data-journey-section]')) return;
    window.requestAnimationFrame(() => {
      const targetRect = target.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const safeTop = viewportRect.top + 80;
      const safeBottom = viewportRect.bottom - 80;
      if (targetRect.top >= safeTop && targetRect.bottom <= safeBottom) return;
      window.scrollBy({
        top: targetRect.top - (viewportRect.top + viewportRect.height * 0.28),
        behavior: reducedMotion.matches ? 'auto' : 'smooth',
      });
    });
  });

  const observer = new ResizeObserver(() => {
    if (
      measuredWidth !== window.innerWidth ||
      measuredHeight !== window.innerHeight ||
      enhanced
    ) {
      measure();
    }
  });
  observer.observe(viewport);
  observer.observe(track);

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure, { once: true });
  reducedMotion.addEventListener('change', measure);
  document.fonts?.ready.then(measure);
  measure();
};

const initialize = () => {
  initializePalette();
  initializeDisplayFilter();
  initializeNavigation();
  initializePortfolioJourney();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
