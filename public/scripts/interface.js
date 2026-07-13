(() => {
  'use strict';

  const ready = (callback) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  };

  ready(() => {
    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    root.classList.add('reveal-enabled');

    // Appearance control: follow the OS, or explicitly use light/dark mode.
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = themeToggle?.querySelector('[data-theme-label]');
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const themeModes = ['system', 'light', 'dark'];
    const normaliseTheme = (theme) => themeModes.includes(theme) ? theme : 'system';
    const setTheme = (requestedTheme, persist = true) => {
      const theme = normaliseTheme(requestedTheme);
      const resolved = theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme;
      const nextTheme = themeModes[(themeModes.indexOf(theme) + 1) % themeModes.length];
      root.dataset.theme = theme;
      root.dataset.themeResolved = resolved;
      root.style.colorScheme = resolved;
      themeToggle?.setAttribute('aria-label', `Appearance: ${theme} theme. Switch to ${nextTheme} theme`);
      themeToggle?.setAttribute('title', `Appearance: ${theme}`);
      if (themeLabel) themeLabel.textContent = `${theme.toUpperCase()}_THEME`;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f2f0eb' : '#050505');
      if (persist) {
        try { localStorage.setItem('andrew-theme', theme); } catch { /* privacy mode */ }
      }
      window.dispatchEvent(new CustomEvent('andrew:theme-change', { detail: { theme, resolved } }));
    };
    setTheme(root.dataset.theme || 'system', false);
    themeToggle?.addEventListener('click', () => {
      const current = normaliseTheme(root.dataset.theme);
      setTheme(themeModes[(themeModes.indexOf(current) + 1) % themeModes.length]);
    });
    systemTheme.addEventListener?.('change', () => {
      if (root.dataset.theme === 'system') setTheme('system', false);
    });

    // Keep shortcut labels consistent with the visitor's operating system.
    const platform = navigator.userAgentData?.platform || navigator.userAgent || '';
    const commandShortcut = /mac|iphone|ipad|ipod/i.test(platform) ? '⌘ K' : 'CTRL K';
    document.querySelectorAll('[data-command-shortcut]').forEach((label) => {
      label.textContent = commandShortcut;
    });

    // Manual gatehouse. The visitor opens the terminal; the Watcher never
    // grants admission on a timer.
    const sessionGate = document.getElementById('session-gate');
    const sessionEnter = document.getElementById('session-enter');
    const sessionEnterLabel = sessionEnter?.querySelector('[data-session-enter-label]');
    const sessionStatus = document.getElementById('session-status');
    const sessionGuardState = document.getElementById('session-guard-state');
    const cleanSessionName = (value) => (value || 'guest')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 18) || 'guest';
    const setSessionName = (value) => {
      const name = cleanSessionName(value);
      document.querySelectorAll('[data-session-user]').forEach((target) => {
        target.textContent = name;
      });
      return name;
    };

    let sessionOpened = false;
    let admissionStarted = false;
    const openSession = (requestedName) => {
      if (sessionOpened) return;
      sessionOpened = true;
      const name = setSessionName(requestedName);
      root.dataset.sessionPhase = 'granted';
      if (sessionStatus) sessionStatus.textContent = 'ENTRY_GRANTED // WATCHER_SEALED';
      if (sessionGuardState) sessionGuardState.textContent = 'CONTAINMENT_VERIFIED';
      root.dataset.session = 'opening';
      window.setTimeout(() => {
        if (sessionStatus) sessionStatus.textContent = `SESSION_OPEN // ${name}@vos`;
        root.dataset.session = 'open';
        delete root.dataset.sessionPhase;
        root.classList.remove('session-pending');
        sessionGate?.setAttribute('aria-hidden', 'true');
        window.dispatchEvent(new CustomEvent('andrew:session-open', { detail: { name } }));
        document.getElementById('main-content')?.focus({ preventScroll: true });
      }, reducedMotion.matches ? 0 : 460);
    };

    const requestAdmission = () => {
      if (admissionStarted || sessionOpened) return;
      admissionStarted = true;
      sessionEnter?.setAttribute('disabled', '');
      if (sessionEnterLabel) sessionEnterLabel.textContent = 'OPENING_GATE';
      root.dataset.session = 'admitting';
      root.dataset.sessionPhase = 'admitting';
      if (sessionStatus) sessionStatus.textContent = 'TERMINAL_APERTURE // OPENING';
      if (sessionGuardState) sessionGuardState.textContent = 'ESCORTING_GUEST';
      window.setTimeout(() => openSession('guest'), reducedMotion.matches ? 0 : 980);
    };

    root.dataset.session = 'guarded';
    root.dataset.sessionPhase = 'awaiting';
    setSessionName('guest');
    if (sessionStatus) sessionStatus.textContent = 'WATCHER_07 // AWAITING_GUEST_ACTION';
    if (sessionGuardState) sessionGuardState.textContent = 'CONTAINED // OBSERVING';
    sessionEnter?.addEventListener('click', requestAdmission);

    // Display texture control. The entity script intentionally owns its own toggle.
    const crtToggle = document.getElementById('crt-toggle');
    const crtLabel = crtToggle?.querySelector('[data-crt-label]');

    const setCrt = (enabled, persist = true) => {
      root.dataset.crt = enabled ? 'on' : 'off';
      crtToggle?.setAttribute('aria-pressed', String(enabled));
      crtToggle?.setAttribute('aria-label', enabled ? 'Disable CRT texture' : 'Enable CRT texture');
      if (crtLabel) crtLabel.textContent = enabled ? 'CRT_ON' : 'CRT_OFF';
      if (persist) {
        try {
          localStorage.setItem('andrew-crt', enabled ? 'on' : 'off');
        } catch {
          // The switch still works when storage is blocked.
        }
      }
    };

    setCrt(root.dataset.crt !== 'off', false);
    crtToggle?.addEventListener('click', () => setCrt(root.dataset.crt === 'off'));

    // Boston / Cambridge clock.
    const timeElement = document.getElementById('local-time');
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const updateClock = () => {
      if (timeElement) timeElement.textContent = `${timeFormatter.format(new Date())} ET`;
    };
    updateClock();
    const clockTimer = window.setInterval(updateClock, 1000);

    // Shared scroll work is kept behind a single animation frame.
    const progressBar = document.getElementById('scroll-progress-bar');
    let scrollFrame = 0;
    const updateScroll = () => {
      scrollFrame = 0;
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, window.scrollY / scrollable));
      if (progressBar) progressBar.style.width = `${progress * 100}%`;
    };
    const requestScrollUpdate = () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
    };
    window.addEventListener('scroll', requestScrollUpdate, { passive: true });
    window.addEventListener('resize', requestScrollUpdate, { passive: true });
    updateScroll();

    // Cursor illumination is subtle and independent from the Watcher repulsion.
    let pointerFrame = 0;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 3;
    window.addEventListener('pointermove', (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        root.style.setProperty('--mx', `${pointerX}px`);
        root.style.setProperty('--my', `${pointerY}px`);
      });
    }, { passive: true });

    // Progressive enhancement: content remains visible if observers are unavailable.
    const revealItems = [...document.querySelectorAll('[data-reveal]')];
    if (!('IntersectionObserver' in window) || reducedMotion.matches) {
      revealItems.forEach((item) => item.classList.add('is-visible'));
    } else {
      const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.11, rootMargin: '0px 0px -7% 0px' });
      revealItems.forEach((item) => revealObserver.observe(item));
    }

    // Decorative project animation runs only while its visual bay is onscreen.
    const visualBays = [...document.querySelectorAll('[data-visual-bay]')];
    const setVisualBayActive = (bay, active) => {
      bay.classList.toggle('is-visual-active', active);
      bay.querySelectorAll('svg').forEach((svg) => {
        try {
          if (active) svg.unpauseAnimations?.();
          else svg.pauseAnimations?.();
        } catch {
          // SMIL controls are not implemented consistently across browsers.
        }
      });
    };
    if ('IntersectionObserver' in window && !reducedMotion.matches) {
      const visualObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => setVisualBayActive(entry.target, entry.isIntersecting));
      }, { rootMargin: '18% 0px 18% 0px', threshold: 0.01 });
      visualBays.forEach((bay) => {
        setVisualBayActive(bay, false);
        visualObserver.observe(bay);
      });
    } else {
      visualBays.forEach((bay) => setVisualBayActive(bay, true));
    }

    // Sticky navigation state and mobile menu.
    const header = document.querySelector('[data-header]');
    const menuToggle = document.querySelector('[data-menu-toggle]');
    const navLinks = [...document.querySelectorAll('[data-nav-target]')];
    const sections = [...document.querySelectorAll('[data-section]')];

    const closeMenu = () => {
      header?.removeAttribute('data-menu-open');
      menuToggle?.setAttribute('aria-expanded', 'false');
    };

    menuToggle?.addEventListener('click', () => {
      const isOpen = header?.hasAttribute('data-menu-open');
      if (isOpen) closeMenu();
      else {
        header?.setAttribute('data-menu-open', '');
        menuToggle.setAttribute('aria-expanded', 'true');
      }
    });

    navLinks.forEach((link) => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    const activateNav = (id) => {
      navLinks.forEach((link) => {
        const active = link.dataset.navTarget === id;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    };

    if ('IntersectionObserver' in window) {
      const sectionObserver = new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) activateNav(visible.target.id);
      }, { threshold: [0.12, 0.3, 0.55], rootMargin: '-18% 0px -56% 0px' });
      sections.forEach((section) => sectionObserver.observe(section));
    }
    activateNav('home');

    // Copyable email with a screen-reader announcement.
    const copyButton = document.querySelector('[data-copy-email]');
    const copyLabel = copyButton?.querySelector('[data-copy-label]');
    const copyStatus = document.getElementById('copy-status');
    copyButton?.addEventListener('click', async () => {
      const email = copyButton.dataset.copyEmail || '';
      let copied = false;
      try {
        await navigator.clipboard.writeText(email);
        copied = true;
      } catch {
        const field = document.createElement('textarea');
        field.value = email;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        copied = document.execCommand('copy');
        field.remove();
      }
      if (copyLabel) copyLabel.textContent = copied ? 'COPIED_TO_BUFFER' : 'COPY_FAILED';
      if (copyStatus) copyStatus.textContent = copied ? `Copied ${email}` : 'Email copy failed';
      window.setTimeout(() => {
        if (copyLabel) copyLabel.textContent = 'COPY_EMAIL';
      }, 2200);
    });

    // Command deck: optional, never required for normal navigation.
    const deck = document.getElementById('command-deck');
    const deckInput = document.getElementById('command-input');
    const commandButtons = [...document.querySelectorAll('#command-list [data-command]')];
    const commandEmpty = document.getElementById('command-empty');
    const commandSelection = document.getElementById('command-selection');
    let selectedIndex = 0;

    const visibleCommands = () => commandButtons.filter((button) => !button.hidden);
    const selectCommand = (index) => {
      const visible = visibleCommands();
      if (!visible.length) return;
      selectedIndex = (index + visible.length) % visible.length;
      commandButtons.forEach((button) => {
        button.classList.remove('is-selected');
      });
      visible[selectedIndex].classList.add('is-selected');
      visible[selectedIndex].scrollIntoView({ block: 'nearest' });
      if (commandSelection) {
        commandSelection.textContent = `Selected ${visible[selectedIndex].textContent?.trim() || 'command'}`;
      }
    };

    const filterCommands = () => {
      const query = (deckInput?.value || '').trim().toLowerCase().replace(/^\//, '');
      commandButtons.forEach((button) => {
        const haystack = `${button.dataset.command || ''} ${button.textContent || ''}`.toLowerCase();
        button.hidden = Boolean(query) && !haystack.includes(query);
      });
      if (commandEmpty) commandEmpty.hidden = visibleCommands().length > 0;
      selectedIndex = 0;
      selectCommand(0);
    };

    const openDeck = () => {
      if (!(deck instanceof HTMLDialogElement) || deck.open) return;
      deck.showModal();
      if (deckInput) {
        deckInput.value = '';
        filterCommands();
        requestAnimationFrame(() => deckInput.focus());
      }
    };

    const closeDeck = () => {
      if (deck instanceof HTMLDialogElement && deck.open) deck.close();
    };

    document.querySelectorAll('[data-command-open]').forEach((button) => {
      button.addEventListener('click', openDeck);
    });

    const executeCommand = (button) => {
      if (!button) return;
      const target = button.dataset.target;
      const href = button.dataset.href;
      const action = button.dataset.action;
      closeDeck();

      if (target) {
        document.getElementById(target)?.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      } else if (href) {
        window.open(href, '_blank', 'noopener,noreferrer');
      } else if (action === 'crt') {
        crtToggle?.click();
      } else if (action === 'entity') {
        document.getElementById('entity-toggle')?.click();
      } else if (action === 'release') {
        document.getElementById('entity-release')?.click();
      }
    };

    commandButtons.forEach((button) => {
      button.addEventListener('click', () => executeCommand(button));
      button.addEventListener('pointerenter', () => {
        const visible = visibleCommands();
        selectCommand(visible.indexOf(button));
      });
    });

    deckInput?.addEventListener('input', filterCommands);
    deckInput?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectCommand(selectedIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectCommand(selectedIndex - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        executeCommand(visibleCommands()[selectedIndex]);
      }
    });

    deck?.addEventListener('click', (event) => {
      if (event.target === deck) closeDeck();
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (deck instanceof HTMLDialogElement && deck.open) closeDeck();
        else openDeck();
      } else if (event.key === '/' && !typing && !(deck instanceof HTMLDialogElement && deck.open)) {
        event.preventDefault();
        openDeck();
      } else if (!typing && !root.classList.contains('session-pending') && event.key.toLowerCase() === 'y') {
        if (root.dataset.entityReleased !== 'on') document.getElementById('entity-release')?.click();
      } else if (!typing && !root.classList.contains('session-pending') && event.key.toLowerCase() === 'n') {
        if (root.dataset.entityReleased === 'on') document.getElementById('entity-release')?.click();
      }
    });

    // Very small pointer tilt, limited to precise pointing devices.
    const canTilt = window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reducedMotion.matches;
    if (canTilt) {
      document.querySelectorAll('[data-tilt]').forEach((card) => {
        card.addEventListener('pointermove', (event) => {
          const rect = card.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width - 0.5;
          const y = (event.clientY - rect.top) / rect.height - 0.5;
          card.style.transform = `perspective(1200px) rotateX(${(-y * 1.1).toFixed(2)}deg) rotateY(${(x * 1.1).toFixed(2)}deg)`;
        });
        card.addEventListener('pointerleave', () => {
          card.style.transform = '';
        });
      });
    }

    initialiseSpecimenRain(reducedMotion);
    initialiseSignalField(reducedMotion);

    window.addEventListener('pagehide', () => window.clearInterval(clockTimer), { once: true });
  });

  function initialiseSpecimenRain(reducedMotion) {
    const canvas = document.getElementById('signal-rain');
    const context = canvas?.getContext('2d', { alpha: true, desynchronized: true });
    if (!canvas || !context) return;

    const saveData = navigator.connection?.saveData === true;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const BAYER = [
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5,
    ];
    const state = {
      width: 1,
      height: 1,
      frame: 0,
      last: 0,
      step: 0,
      drops: [],
      dust: [],
      colors: { pink: '#a96d86', cyan: '#a9bec0', violet: '#c9c2ca', text: '#eeece8' },
    };

    const refreshColors = () => {
      const styles = getComputedStyle(document.documentElement);
      const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
      state.colors = {
        pink: read('--pink', '#a96d86'),
        cyan: read('--cyan', '#a9bec0'),
        violet: read('--violet', '#c9c2ca'),
        text: read('--text', '#eeece8'),
      };
    };

    // The specimen compositor uses integer hashing and Bayer thresholds instead
    // of smooth particles. Keep the rain in that same broken, printed texture.
    const hash = (x, y, seed) => {
      let value = Math.imul((x | 0) + 101 + (seed | 0) * 17, 374761393) +
        Math.imul((y | 0) + 211 + (seed | 0) * 29, 668265263);
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    };

    const makeDrop = (index) => {
      const column = hash(index, 17, 41);
      const depth = hash(index, 31, 73);
      return {
        x: column * (state.width + 160) - 80,
        y: hash(index, 47, 97) * (state.height + 120) - 60,
        speed: 18 + depth * 35,
        drift: 8 + depth * 17,
        size: depth > 0.78 ? 3 : depth > 0.28 ? 2 : 1,
        pieces: 2 + Math.floor(hash(index, 59, 109) * 4),
        phase: Math.floor(hash(index, 71, 127) * 16),
        tone: hash(index, 83, 149),
      };
    };

    const rebuild = () => {
      refreshColors();
      state.width = Math.max(1, window.innerWidth);
      state.height = Math.max(1, window.innerHeight);
      // One backing-store pixel is one visible specimen pixel. This deliberately
      // avoids DPR smoothing and keeps every fleck square-edged.
      canvas.width = state.width;
      canvas.height = state.height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.imageSmoothingEnabled = false;

      const area = state.width * state.height;
      const dropCount = Math.max(54, Math.min(190, Math.round(area / (coarsePointer ? 26000 : 15000))));
      const dustCount = Math.max(260, Math.min(1250, Math.round(area / (coarsePointer ? 4300 : 1850))));
      state.drops = Array.from({ length: dropCount }, (_, index) => makeDrop(index));
      state.dust = Array.from({ length: dustCount }, (_, index) => ({
        x: Math.floor(hash(index, 131, 173) * state.width),
        y: Math.floor(hash(index, 151, 191) * state.height),
        size: hash(index, 163, 211) > 0.91 ? 2 : 1,
        phase: Math.floor(hash(index, 179, 227) * 16),
        tone: hash(index, 193, 251),
      }));
      draw(performance.now(), true);
    };

    const draw = (time, force = false) => {
      const interval = coarsePointer ? 1000 / 10 : 1000 / 15;
      if (!force && time - state.last < interval) {
        state.frame = requestAnimationFrame(draw);
        return;
      }

      const elapsed = state.last ? Math.min(0.12, (time - state.last) / 1000) : 0;
      state.last = time;
      state.step += 1;
      context.clearRect(0, 0, state.width, state.height);

      const glitch = state.step % 137 === 0 || state.step % 137 === 1;
      const tearY = Math.floor(hash(state.step, 239, 269) * state.height);
      const paused = reducedMotion.matches || saveData || force;

      state.dust.forEach((speck, index) => {
        const threshold = (BAYER[((speck.x & 3) + (speck.y & 3) * 4)] + 0.5) / 16;
        const signal = hash(index, state.step >> 2, 283);
        if (signal < 0.42 + threshold * 0.36) return;
        const tear = glitch && Math.abs(speck.y - tearY) < 18 ? (index & 1 ? 8 : -6) : 0;
        context.globalAlpha = signal > 0.9 ? 0.3 : 0.14;
        context.fillStyle = speck.tone > 0.86 ? state.colors.pink : speck.tone > 0.64 ? state.colors.cyan : state.colors.violet;
        context.fillRect(speck.x + tear, speck.y, speck.size, speck.size);
      });

      state.drops.forEach((drop, index) => {
        if (!paused) {
          drop.x -= drop.drift * elapsed;
          drop.y += drop.speed * elapsed;
          if (drop.y > state.height + 16 || drop.x < -24) {
            drop.x = hash(index, state.step, 307) * (state.width + 100);
            drop.y = -8 - hash(index, state.step, 311) * 90;
          }
        }

        // A drop is a loose diagonal group of square pixels, never a line.
        for (let piece = 0; piece < drop.pieces; piece += 1) {
          const gate = hash(index * 7 + piece, state.step >> 1, 331);
          const bx = Math.round(drop.x + piece * (drop.size + 1));
          const by = Math.round(drop.y - piece * (drop.size + 2));
          const threshold = (BAYER[((bx & 3) + (by & 3) * 4)] + 0.5) / 16;
          if (gate < 0.18 + threshold * 0.28) continue;
          const tear = glitch && Math.abs(by - tearY) < 18 ? 9 : 0;
          context.globalAlpha = 0.2 + gate * 0.2;
          context.fillStyle = drop.tone > 0.9 ? state.colors.pink : drop.tone > 0.68 ? state.colors.cyan : state.colors.text;
          context.fillRect(bx + tear, by, drop.size, drop.size);
        }
      });
      context.globalAlpha = 1;

      if (!paused && !document.hidden) state.frame = requestAnimationFrame(draw);
    };

    const start = () => {
      cancelAnimationFrame(state.frame);
      state.last = 0;
      if (document.documentElement.classList.contains('session-pending')) return;
      if (reducedMotion.matches || saveData) draw(performance.now(), true);
      else state.frame = requestAnimationFrame(draw);
    };

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        rebuild();
        start();
      }, 160);
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(state.frame);
      if (!document.hidden) start();
    });
    window.addEventListener('andrew:session-open', start, { once: true });
    window.addEventListener('andrew:theme-change', () => {
      refreshColors();
      draw(performance.now(), true);
    });
    if (typeof reducedMotion.addEventListener === 'function') reducedMotion.addEventListener('change', start);

    rebuild();
    start();
  }

  function initialiseSignalField(reducedMotion) {
    const canvas = document.getElementById('signal-field');
    const context = canvas?.getContext('2d', { alpha: true, desynchronized: true });
    if (!canvas || !context) return;

    const saveData = navigator.connection?.saveData === true;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const state = { width: 1, height: 1, dpr: 1, frame: 0, last: 0, nodes: [] };
    let resizeFrame = 0;

    const randomNode = (edgeBiased = false) => {
      let x = Math.random();
      if (edgeBiased && Math.random() > 0.45) x = Math.random() > 0.5 ? Math.random() * 0.18 : 0.82 + Math.random() * 0.18;
      return {
        x: x * state.width,
        y: Math.random() * state.height,
        vx: (Math.random() - 0.5) * 0.055,
        vy: (Math.random() - 0.5) * 0.045,
        phase: Math.random() * Math.PI * 2,
      };
    };

    const resize = () => {
      state.width = Math.max(1, window.innerWidth);
      state.height = Math.max(1, window.innerHeight);
      state.dpr = coarsePointer ? 1 : Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(state.width * state.dpr);
      canvas.height = Math.round(state.height * state.dpr);
      context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      const count = Math.max(18, Math.min(42, Math.round(state.width / 34)));
      state.nodes = Array.from({ length: count }, () => randomNode(true));
      draw(performance.now(), true);
    };

    const draw = (time, force = false) => {
      if (document.documentElement.dataset.renderer === 'webgl') {
        context.clearRect(0, 0, state.width, state.height);
        return;
      }
      if (!force && time - state.last < (coarsePointer ? 1000 / 15 : 42)) {
        state.frame = requestAnimationFrame(draw);
        return;
      }
      state.last = time;
      context.clearRect(0, 0, state.width, state.height);

      const styles = getComputedStyle(document.documentElement);
      const line = styles.getPropertyValue('--violet').trim() || '#b7a6ff';
      const dot = styles.getPropertyValue('--cyan').trim() || '#64e8ff';

      if (!reducedMotion.matches && !saveData && !force) {
        state.nodes.forEach((node) => {
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < -8) node.x = state.width + 8;
          if (node.x > state.width + 8) node.x = -8;
          if (node.y < -8) node.y = state.height + 8;
          if (node.y > state.height + 8) node.y = -8;
        });
      }

      context.lineWidth = 0.65;
      for (let i = 0; i < state.nodes.length; i += 1) {
        const a = state.nodes[i];
        for (let j = i + 1; j < state.nodes.length; j += 1) {
          const b = state.nodes[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > 125) continue;
          context.globalAlpha = (1 - distance / 125) * 0.095;
          context.strokeStyle = line;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }

      state.nodes.forEach((node, index) => {
        const pulse = 0.35 + Math.sin(time * 0.0012 + node.phase) * 0.2;
        context.globalAlpha = index % 7 === 0 ? pulse : 0.18;
        context.fillStyle = index % 7 === 0 ? dot : line;
        context.fillRect(Math.round(node.x), Math.round(node.y), index % 7 === 0 ? 2 : 1, index % 7 === 0 ? 2 : 1);
      });
      context.globalAlpha = 1;

      if (!force && !reducedMotion.matches && !saveData && !document.hidden) {
        state.frame = requestAnimationFrame(draw);
      }
    };

    const start = () => {
      cancelAnimationFrame(state.frame);
      state.last = 0;
      if (document.documentElement.classList.contains('session-pending')) return;
      if (document.documentElement.dataset.renderer === 'webgl') {
        context.clearRect(0, 0, state.width, state.height);
        return;
      }
      if (reducedMotion.matches || saveData) draw(performance.now(), true);
      else state.frame = requestAnimationFrame(draw);
    };

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          resize();
          start();
        });
      }, 160);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(state.frame);
      if (!document.hidden) start();
    });

    window.addEventListener('andrew:renderer-change', start);
    window.addEventListener('andrew:theme-change', () => draw(performance.now(), true));
    window.addEventListener('andrew:session-open', start, { once: true });

    if (typeof reducedMotion.addEventListener === 'function') {
      reducedMotion.addEventListener('change', start);
    }

    resize();
    start();
  }
})();
