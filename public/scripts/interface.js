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

    // Cursor illumination is subtle and independent from the Braille entity repulsion.
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

    initialiseSignalField(reducedMotion);

    window.addEventListener('pagehide', () => window.clearInterval(clockTimer), { once: true });
  });

  function initialiseSignalField(reducedMotion) {
    const canvas = document.getElementById('signal-field');
    const context = canvas?.getContext('2d', { alpha: true, desynchronized: true });
    if (!canvas || !context) return;

    const saveData = navigator.connection?.saveData === true;
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
      state.dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
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
      if (!force && time - state.last < 42) {
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
      if (document.documentElement.dataset.renderer === 'webgl') {
        context.clearRect(0, 0, state.width, state.height);
        return;
      }
      if (reducedMotion.matches || saveData) draw(performance.now(), true);
      else state.frame = requestAnimationFrame(draw);
    };

    window.addEventListener('resize', () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resize();
        start();
      });
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(state.frame);
      if (!document.hidden) start();
    });

    window.addEventListener('andrew:renderer-change', start);

    if (typeof reducedMotion.addEventListener === 'function') {
      reducedMotion.addEventListener('change', start);
    }

    resize();
    start();
  }
})();
