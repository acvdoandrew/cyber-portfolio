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

const initializeProjectPreview = () => {
  const selectors = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-project-select]'),
  ];
  const panels = [
    ...document.querySelectorAll<HTMLElement>('[data-project-panel]'),
  ];
  const liveLabel = document.querySelector<HTMLElement>('[data-preview-live-label]');
  const preview = document.querySelector<HTMLElement>('.project-preview');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (!selectors.length || !panels.length) return;

  const select = (id: string) => {
    let matched = false;
    selectors.forEach((button) => {
      const active = button.dataset.projectSelect === id;
      button.setAttribute('aria-pressed', String(active));
      button.dataset.active = String(active);
      if (active) {
        matched = true;
        liveLabel?.replaceChildren(button.dataset.projectTitle ?? id);
      }
    });
    if (!matched) return;

    panels.forEach((panel) => {
      const active = panel.dataset.projectPanel === id;
      panel.hidden = !active;
      panel.dataset.active = String(active);
    });
  };

  selectors.forEach((button, index) => {
    const activate = () => select(button.dataset.projectSelect ?? '');
    button.addEventListener('click', () => {
      activate();
      if (window.innerWidth <= 860) {
        preview?.scrollIntoView({
          block: 'start',
          behavior: reducedMotion.matches ? 'auto' : 'smooth',
        });
      }
    });
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch') activate();
    });
    button.addEventListener('focus', activate);
    button.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (event.key === 'ArrowDown') nextIndex = (index + 1) % selectors.length;
      if (event.key === 'ArrowUp') {
        nextIndex = (index - 1 + selectors.length) % selectors.length;
      }
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = selectors.length - 1;

      selectors[nextIndex].focus();
      select(selectors[nextIndex].dataset.projectSelect ?? '');
    });
  });

  select(selectors[0].dataset.projectSelect ?? '');
};

const initialize = () => {
  initializePalette();
  initializeNavigation();
  initializeProjectPreview();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
