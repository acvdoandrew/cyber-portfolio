(() => {
  "use strict";

  const boot = () => {
    const canvas = document.getElementById("braille-entity");
    if (!canvas || canvas.dataset.entityEngine === "ready") return;

    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;

    canvas.dataset.entityEngine = "ready";
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("role", "presentation");
    canvas.tabIndex = -1;
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
    });

    const root = document.documentElement;
    const dock = document.getElementById("entity-dock");
    const toggle = document.getElementById("entity-toggle");
    const toggleLabel = toggle?.querySelector("[data-entity-label]");
    const releaseButton = document.getElementById("entity-release");
    const releaseLabel = releaseButton?.querySelector("[data-release-label]");
    const containmentLabel = document.querySelector("[data-containment-label]");
    const containmentState = document.getElementById("containment-state");
    const liveState = document.getElementById("entity-state");
    const formReadout = document.getElementById("entity-form");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const POWER_KEY = "andrew-entity";
    const RELEASE_KEY = "andrew-entity-released";
    const TAU = Math.PI * 2;
    const DOT_COLUMNS = 72;
    const DOT_ROWS = 64;
    const CELL_COLUMNS = DOT_COLUMNS / 2;
    const CELL_ROWS = DOT_ROWS / 4;
    const FRAME_INTERVAL = 1000 / 30;
    const ATTEMPT_TIME = 1750;
    const SCATTER_TIME = 1150;
    const BRAILLE_BITS = [
      [0x01, 0x08],
      [0x02, 0x10],
      [0x04, 0x20],
      [0x40, 0x80],
    ];

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const mix = (from, to, amount) => from + (to - from) * amount;
    const smoothstep = (value) => {
      const x = clamp(value, 0, 1);
      return x * x * (3 - 2 * x);
    };
    const easeOut = (value) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);

    const hash = (x, y, seed = 0) => {
      let value = Math.imul(x + 101 + seed * 17, 374761393) +
        Math.imul(y + 211 + seed * 29, 668265263);
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    };

    let randomState = 0xa53c9e17;
    const random = () => {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      return (randomState >>> 0) / 4294967296;
    };

    const viewport = { width: 1, height: 1, dpr: 1 };
    const metrics = { fontSize: 16, advance: 9.6, lineHeight: 17, width: 190, height: 190 };
    const pointer = { x: -1000, y: -1000, lastAt: -Infinity };
    const dockBounds = { left: 0, top: 0, right: 0, bottom: 0, width: 1, height: 1 };
    const sharedVisualState = window.__ANDREW_VISUAL_STATE__ ||= {
      revision: 0,
      pointer,
      entity: null,
    };
    sharedVisualState.pointer = pointer;
    let lastPublishedStatus = "";
    let lastPublishedReleased = false;
    let lastPublishedEnabled = true;

    const state = {
      enabled: true,
      released: false,
      elapsed: 0,
      lastFrameAt: 0,
      frameId: 0,
      x: NaN,
      y: NaN,
      targetX: NaN,
      targetY: NaN,
      dockX: NaN,
      dockY: NaN,
      nextRoamAt: 0,
      nextAttemptAt: 1200,
      attemptStartedAt: -Infinity,
      attemptEdge: "right",
      attemptActive: false,
      impactTriggered: false,
      gazeX: 0,
      gazeY: 0,
      scatterStartedAt: -Infinity,
      scatterSeed: 0,
      displayedStatus: "",
    };

    const fallbackColors = { cyan: "#a9bec0", pink: "#a96d86", lavender: "#eeece8" };
    let colors = { ...fallbackColors };

    const cssColor = (names, fallback) => {
      const styles = getComputedStyle(root);
      for (const name of names) {
        const candidate = styles.getPropertyValue(name).trim();
        if (candidate && (!window.CSS?.supports || window.CSS.supports("color", candidate))) return candidate;
      }
      return fallback;
    };

    const refreshColors = () => {
      colors = {
        cyan: cssColor(["--cyan", "--accent", "--text"], fallbackColors.cyan),
        pink: cssColor(["--pink", "--accent-pink"], fallbackColors.pink),
        lavender: cssColor(["--lavender", "--text"], fallbackColors.lavender),
      };
    };

    const safePoint = (x, y) => {
      const halfWidth = metrics.width / 2 + 18;
      const halfHeight = metrics.height / 2 + 18;
      const minX = Math.min(halfWidth, viewport.width / 2);
      const maxX = Math.max(viewport.width - halfWidth, viewport.width / 2);
      const minY = Math.min(halfHeight + 12, viewport.height / 2);
      const maxY = Math.max(viewport.height - halfHeight - 18, viewport.height / 2);
      return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
    };

    const refreshDockPoint = () => {
      let rect = { left: viewport.width * 0.55, top: viewport.height * 0.2, width: viewport.width * 0.35, height: viewport.height * 0.55 };
      if (dock) {
        const current = dock.getBoundingClientRect();
        if (current.width || current.height) rect = current;
      }
      dockBounds.left = rect.left;
      dockBounds.top = rect.top;
      dockBounds.width = rect.width;
      dockBounds.height = rect.height;
      dockBounds.right = rect.left + rect.width;
      dockBounds.bottom = rect.top + rect.height;
      state.dockX = rect.left + rect.width / 2;
      state.dockY = rect.top + rect.height / 2;
      if (!Number.isFinite(state.x)) {
        state.x = state.dockX;
        state.y = state.dockY;
        state.targetX = state.dockX;
        state.targetY = state.dockY;
      }
    };

    const resizeCanvas = () => {
      viewport.width = Math.max(1, innerWidth);
      viewport.height = Math.max(1, innerHeight);
      viewport.dpr = clamp(devicePixelRatio || 1, 1, 2);
      canvas.width = Math.round(viewport.width * viewport.dpr);
      canvas.height = Math.round(viewport.height * viewport.dpr);
      metrics.fontSize = clamp(viewport.width / 76, 9.5, 18);
      metrics.advance = metrics.fontSize * 0.61;
      metrics.lineHeight = metrics.fontSize * 1.04;
      metrics.width = (CELL_COLUMNS - 1) * metrics.advance + metrics.fontSize;
      metrics.height = (CELL_ROWS - 1) * metrics.lineHeight + metrics.fontSize;
      context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
      context.imageSmoothingEnabled = false;
      refreshColors();
      refreshDockPoint();
      if (state.released) {
        const safe = safePoint(state.x, state.y);
        state.x = safe.x;
        state.y = safe.y;
      }
    };

    const nearSegment = (px, py, ax, ay, bx, by, tolerance) => {
      const abx = bx - ax;
      const aby = by - ay;
      const lengthSquared = abx * abx + aby * aby || 1;
      const amount = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared, 0, 1);
      return Math.hypot(px - (ax + abx * amount), py - (ay + aby * amount)) < tolerance;
    };

    const watcherDot = (x, y) => {
      const nx = (x / (DOT_COLUMNS - 1) - 0.5) * 2;
      const ny = (y / (DOT_ROWS - 1) - 0.5) * 2;
      const absX = Math.abs(nx);
      const ditherPhase = Math.floor(state.elapsed / 135);
      const pulse = Math.sin(state.elapsed * 0.0018) * 0.012;
      const wingLift = Math.sin(state.elapsed * 0.00105 + 0.7) * 0.065;
      const crownSway = Math.sin(state.elapsed * 0.00063) * 0.026;
      const blinkClock = (state.elapsed + 310) % 4900;
      const blink = blinkClock > 4520 && blinkClock < 4720
        ? clamp(Math.abs(blinkClock - 4620) / 100, 0.06, 1)
        : 1;
      const eyeY = 0.02;
      const eyeCurve = (0.205 + pulse) * Math.sqrt(Math.max(0, 1 - Math.pow(absX / 0.8, 1.72)));
      const lidHeight = eyeCurve * blink;
      const upperY = eyeY - lidHeight;
      const lowerY = eyeY + lidHeight;
      const upperLid = absX < 0.81 && Math.abs(ny - upperY) < 0.026;
      const lowerLid = absX < 0.81 && Math.abs(ny - lowerY) < 0.026;
      const lidEcho = blink > 0.38 && absX < 0.72 && (
        Math.abs(ny - (upperY - 0.045)) < 0.017 ||
        Math.abs(ny - (lowerY + 0.045)) < 0.017
      ) && hash(x, y, 21) > 0.3;
      const innerLine = blink < 0.32 && absX < 0.69 && Math.abs(ny - eyeY) < 0.022;
      const lashPhase = Math.abs(Math.sin((nx + 1.04) * 29));
      const lashes = blink > 0.5 && absX > 0.32 && absX < 0.78 && lashPhase > 0.91 && (
        nearSegment(nx, ny, nx, upperY - 0.01, nx + Math.sign(nx || 1) * 0.025, upperY - 0.09, 0.018) ||
        nearSegment(nx, ny, nx, lowerY + 0.01, nx + Math.sign(nx || 1) * 0.02, lowerY + 0.065, 0.016)
      );

      const irisX = state.gazeX * 0.105;
      const irisY = eyeY + state.gazeY * 0.075;
      const irisDistance = Math.hypot((nx - irisX) / 0.19, (ny - irisY) / 0.2);
      const irisAngle = Math.atan2(ny - irisY, nx - irisX);
      const iris = blink > 0.24 && (
        Math.abs(irisDistance - 1) < 0.09 ||
        Math.abs(irisDistance - 0.7) < 0.045
      );
      const irisSpokes = blink > 0.24 && irisDistance > 0.44 && irisDistance < 0.94 &&
        Math.abs(Math.sin(irisAngle * 11 + state.elapsed * 0.00045)) > 0.88;
      const irisDither = blink > 0.24 && irisDistance < 1 && irisDistance > 0.42 &&
        hash(x, y, 51 + ditherPhase) > 0.79;
      const pupilDistance = Math.hypot((nx - irisX) / 0.074, (ny - irisY) / 0.128);
      const glint = blink > 0.4 && Math.hypot((nx - irisX + 0.029) / 0.014, (ny - irisY + 0.045) / 0.022) < 1;
      const insideEye = absX < 0.79 && Math.abs(ny - eyeY) < lidHeight - 0.012;
      const scleraDither = blink > 0.28 && insideEye && irisDistance > 1.08 &&
        hash(x, y, 117 + ditherPhase) > 0.91;

      const crown =
        nearSegment(nx, ny, 0, -0.31, crownSway, -0.96, 0.034) ||
        nearSegment(nx, ny, -0.04, -0.72, -0.2, -0.55, 0.032) ||
        nearSegment(nx, ny, 0.04, -0.72, 0.2, -0.55, 0.032) ||
        nearSegment(nx, ny, -0.2, -0.55, -0.48, -0.43, 0.03) ||
        nearSegment(nx, ny, 0.2, -0.55, 0.48, -0.43, 0.03) ||
        nearSegment(nx, ny, -0.08, -0.88, -0.17, -0.76, 0.02) ||
        nearSegment(nx, ny, 0.08, -0.88, 0.17, -0.76, 0.02);
      const crownNoise = ny < -0.32 && absX < 0.55 * (ny + 1.15) &&
        hash(x, y, 91 + ditherPhase) > 0.79;

      const leftWing =
        nearSegment(nx, ny, -0.76, -0.04, -0.98, -0.23 - wingLift, 0.035) ||
        nearSegment(nx, ny, -0.72, 0.02, -0.99, 0.2 + wingLift, 0.035) ||
        nearSegment(nx, ny, -0.62, -0.22, -0.88, -0.42 - wingLift, 0.03) ||
        nearSegment(nx, ny, -0.61, 0.21, -0.87, 0.4 + wingLift, 0.03) ||
        nearSegment(nx, ny, -0.84, -0.11, -0.94, 0.02, 0.021);
      const rightWing =
        nearSegment(nx, ny, 0.76, -0.04, 0.98, -0.23 - wingLift, 0.035) ||
        nearSegment(nx, ny, 0.72, 0.02, 0.99, 0.2 + wingLift, 0.035) ||
        nearSegment(nx, ny, 0.62, -0.22, 0.88, -0.42 - wingLift, 0.03) ||
        nearSegment(nx, ny, 0.61, 0.21, 0.87, 0.4 + wingLift, 0.03) ||
        nearSegment(nx, ny, 0.84, -0.11, 0.94, 0.02, 0.021);
      const wingNoise = absX > 0.55 && absX < 0.98 && Math.abs(ny) < 0.43 &&
        hash(x, y, 37 + ditherPhase) > 0.84;

      const lowerSigil =
        nearSegment(nx, ny, -0.52, 0.29, -0.28, 0.57, 0.035) ||
        nearSegment(nx, ny, 0.52, 0.29, 0.28, 0.57, 0.035) ||
        nearSegment(nx, ny, -0.28, 0.57, 0, 0.96, 0.035) ||
        nearSegment(nx, ny, 0.28, 0.57, 0, 0.96, 0.035) ||
        nearSegment(nx, ny, 0, 0.39, 0, 0.91, 0.03) ||
        nearSegment(nx, ny, -0.14, 0.68, 0.14, 0.68, 0.021);
      const lowerNoise = ny > 0.28 && ny < 0.91 && absX < 0.55 * (1 - (ny - 0.28) / 0.74) &&
        hash(x, y, 73 + ditherPhase) > 0.8;
      const ellipseRadius = Math.hypot(nx / 0.94, ny / 0.6);
      const brokenHalo = Math.abs(ellipseRadius - 1) < 0.027 && hash(x, y, 13 + Math.floor(ditherPhase / 2)) > 0.32;
      const haloAngle = Math.atan2(ny / 0.6, nx / 0.94);
      const haloRays = ellipseRadius > 0.96 && ellipseRadius < 1.12 &&
        Math.abs(Math.sin(haloAngle * 12 + state.elapsed * 0.00018)) < 0.07 &&
        hash(x, y, 151) > 0.28;

      if (glint) return 3;
      if (pupilDistance < 1) return 0;
      if (iris || irisSpokes || irisDither) return 3;
      if (upperLid || lowerLid || lidEcho || innerLine || lashes || scleraDither) return 2;
      if (crown || crownNoise || leftWing || rightWing || wingNoise || lowerSigil || lowerNoise || brokenHalo || haloRays) return 1;
      return 0;
    };

    let cachedGlyphs = [];
    let cachedGlyphPhase = -1;

    const buildGlyphs = () => {
      const glyphPhase = reduceMotion.matches ? 0 : Math.floor(state.elapsed / 88);
      if (glyphPhase === cachedGlyphPhase) return cachedGlyphs;
      const glyphs = [];
      for (let row = 0; row < CELL_ROWS; row += 1) {
        for (let column = 0; column < CELL_COLUMNS; column += 1) {
          let bits = 0;
          let eyeHits = 0;
          let irisHits = 0;
          for (let dotY = 0; dotY < 4; dotY += 1) {
            for (let dotX = 0; dotX < 2; dotX += 1) {
              const x = column * 2 + dotX;
              const y = row * 4 + dotY;
              const kind = watcherDot(x, y);
              if (kind) {
                bits |= BRAILLE_BITS[dotY][dotX];
                if (kind === 2) eyeHits += 1;
                if (kind === 3) irisHits += 1;
              }
            }
          }
          if (bits) {
            const part = irisHits ? "iris" : eyeHits ? "eye" : "body";
            if (part === "body" && hash(column, row, glyphPhase) > 0.945) {
              const mutableBits = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
              bits ^= mutableBits[Math.floor(hash(row, column, glyphPhase + 33) * mutableBits.length)];
              if (!bits) bits = 0x01;
            }
            glyphs.push({ character: String.fromCodePoint(0x2800 + bits), column, row, bits, part });
          }
        }
      }
      cachedGlyphPhase = glyphPhase;
      cachedGlyphs = glyphs;
      return cachedGlyphs;
    };

    const paintBitmapCell = (glyph, centerX, centerY) => {
      const stepX = metrics.advance / 2;
      const stepY = metrics.lineHeight / 4;
      const pixelWidth = Math.max(1, stepX * 0.78);
      const pixelHeight = Math.max(1, stepY * 0.74);
      for (let dotY = 0; dotY < 4; dotY += 1) {
        for (let dotX = 0; dotX < 2; dotX += 1) {
          if (!(glyph.bits & BRAILLE_BITS[dotY][dotX])) continue;
          const x = centerX + (dotX - 0.5) * stepX - pixelWidth / 2;
          const y = centerY + (dotY - 1.5) * stepY - pixelHeight / 2;
          context.fillRect(Math.round(x), Math.round(y), Math.ceil(pixelWidth), Math.ceil(pixelHeight));
        }
      }
    };

    const pickRoamTarget = () => {
      const safe = safePoint(viewport.width * (0.12 + random() * 0.76), viewport.height * (0.18 + random() * 0.66));
      if (Math.hypot(safe.x - state.x, safe.y - state.y) < metrics.width * 0.7) safe.x = state.x < viewport.width / 2 ? safePoint(viewport.width, safe.y).x : safePoint(0, safe.y).x;
      state.targetX = safe.x;
      state.targetY = safe.y;
      state.nextRoamAt = state.elapsed + 3200 + random() * 3800;
    };

    const startAttempt = () => {
      const edges = ["left", "right", "top", "bottom"];
      state.attemptEdge = edges[Math.floor(random() * edges.length)];
      state.attemptStartedAt = state.elapsed;
      state.attemptActive = true;
      state.impactTriggered = false;
    };

    const triggerImpact = () => {
      if (state.impactTriggered) return;
      state.impactTriggered = true;
      state.scatterStartedAt = state.elapsed;
      state.scatterSeed = Math.floor(random() * 10000);
      dock?.classList.remove("is-hit");
      void dock?.offsetWidth;
      dock?.classList.add("is-hit");
    };

    const containedPosition = () => {
      if (!state.attemptActive) return { x: state.dockX, y: state.dockY, status: "CONTAINED" };
      const progress = (state.elapsed - state.attemptStartedAt) / ATTEMPT_TIME;
      if (progress >= 1) {
        state.attemptActive = false;
        state.nextAttemptAt = state.elapsed + 2300 + random() * 3300;
        dock?.classList.remove("is-hit");
        return { x: state.dockX, y: state.dockY, status: "CONTAINED" };
      }

      const halfW = Math.max(12, dockBounds.width / 2 - metrics.width / 2 - 16);
      const halfH = Math.max(12, dockBounds.height / 2 - metrics.height / 2 - 16);
      let dx = 0;
      let dy = 0;
      if (state.attemptEdge === "left") dx = -halfW;
      if (state.attemptEdge === "right") dx = halfW;
      if (state.attemptEdge === "top") dy = -halfH;
      if (state.attemptEdge === "bottom") dy = halfH;

      let travel = 0;
      let status = "TESTING_WALL";
      if (progress < 0.47) travel = easeOut(progress / 0.47);
      else if (progress < 0.64) {
        triggerImpact();
        travel = 1 + Math.sin(progress * 150) * 0.045;
        status = "IMPACT";
      } else {
        travel = 1 - smoothstep((progress - 0.64) / 0.36);
        status = "RECOILING";
      }
      return { x: state.dockX + dx * travel, y: state.dockY + dy * travel, status };
    };

    const scatterAmount = () => {
      const progress = (state.elapsed - state.scatterStartedAt) / SCATTER_TIME;
      if (progress < 0 || progress >= 1) return 0;
      if (progress < 0.22) return easeOut(progress / 0.22);
      return 1 - smoothstep((progress - 0.22) / 0.78);
    };

    const currentStatus = (scatter = 0) => {
      if (!state.enabled) return "OFFLINE";
      if (reduceMotion.matches) return state.released ? "RELEASED_STATIC" : "CONTAINED_STATIC";
      if (scatter > 0.72 && !state.attemptActive) return "PIXELS_DISTURBED";
      if (state.released) return "ROAMING";
      if (state.attemptActive) return containedPosition().status;
      return "CONTAINED";
    };

    const syncReadouts = (status) => {
      if (liveState && status !== state.displayedStatus) {
        liveState.textContent = status;
        state.displayedStatus = status;
      }
      if (formReadout) formReadout.textContent = "WATCHER";
    };

    const publishVisualState = (status, scatter = 0, isStatic = false) => {
      const entity = {
        x: Number.isFinite(state.x) ? state.x : state.dockX,
        y: Number.isFinite(state.y) ? state.y : state.dockY,
        width: metrics.width,
        height: metrics.height,
        gazeX: state.gazeX,
        gazeY: state.gazeY,
        elapsed: state.elapsed,
        scatter,
        impact: status === "IMPACT" ? 1 : state.impactTriggered && state.attemptActive ? 0.42 : 0,
        enabled: state.enabled,
        released: state.released,
        static: isStatic,
        status,
        dock: { ...dockBounds },
      };
      sharedVisualState.entity = entity;
      sharedVisualState.revision += 1;

      const meaningfulChange = status !== lastPublishedStatus ||
        state.released !== lastPublishedReleased ||
        state.enabled !== lastPublishedEnabled || isStatic;
      lastPublishedStatus = status;
      lastPublishedReleased = state.released;
      lastPublishedEnabled = state.enabled;
      if (meaningfulChange) {
        window.dispatchEvent(new CustomEvent("andrew:entity-state", { detail: entity }));
      }
    };

    const render = (isStatic = false) => {
      context.clearRect(0, 0, viewport.width, viewport.height);
      if (!state.enabled) {
        publishVisualState("OFFLINE", 0, isStatic);
        return;
      }
      const bobX = isStatic ? 0 : Math.sin(state.elapsed * 0.00061) * 2.5;
      const bobY = isStatic ? 0 : Math.sin(state.elapsed * 0.00103 + 1.2) * 3.5;
      const centerX = state.x + bobX;
      const centerY = state.y + bobY;
      const scatter = isStatic ? 0 : scatterAmount();
      const status = currentStatus(scatter);
      syncReadouts(status);
      publishVisualState(status, scatter, isStatic);
      if (root.dataset.renderer === "webgl") return;

      const glyphs = buildGlyphs();
      const pointerFresh = !isStatic && performance.now() - pointer.lastAt < 1600;
      const pointerRadius = clamp(metrics.width * 0.64, 90, 135);

      context.save();
      context.shadowColor = colors.cyan;
      context.shadowBlur = 7 + scatter * 9;
      context.globalCompositeOperation = "lighter";

      const interferenceRow = isStatic ? -20 : (state.elapsed * 0.0042) % (CELL_ROWS + 8) - 4;
      const glitchClock = isStatic ? 999 : state.elapsed % 6100;
      const glitchCycle = Math.floor(state.elapsed / 6100);
      const glyphPhase = Math.floor(state.elapsed / 92);

      for (const glyph of glyphs) {
        const baseX = centerX + (glyph.column - (CELL_COLUMNS - 1) / 2) * metrics.advance;
        const baseY = centerY + (glyph.row - (CELL_ROWS - 1) / 2) * metrics.lineHeight;
        let offsetX = 0;
        let offsetY = 0;
        let proximity = 0;
        const band = Math.exp(-Math.pow((glyph.row - interferenceRow) / 1.45, 2));
        const signal = Math.sin(state.elapsed * 0.006 + glyph.column * 0.73 + glyph.row * 0.31);

        if (!isStatic) {
          offsetX += signal * (glyph.part === "body" ? 0.75 : 0.3);
          offsetY += Math.sin(state.elapsed * 0.0044 + glyph.column * 0.27) * 0.35;
          if (glitchClock < 290 && hash(glyph.row, glitchCycle, 201) > 0.58) {
            const burst = 1 - glitchClock / 290;
            offsetX += (hash(glyph.row, glyph.column, glitchCycle + 207) - 0.5) * 34 * burst;
          }
        }

        if (pointerFresh) {
          let dx = baseX - pointer.x;
          let dy = baseY - pointer.y;
          let distance = Math.hypot(dx, dy);
          if (distance < pointerRadius) {
            if (distance < 0.001) {
              const angle = hash(glyph.column, glyph.row, 7) * TAU;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              distance = 1;
            }
            proximity = Math.pow(1 - distance / pointerRadius, 2);
            offsetX += (dx / distance) * proximity * 18;
            offsetY += (dy / distance) * proximity * 18;
          }
        }

        if (scatter > 0) {
          const angle = hash(glyph.column, glyph.row, state.scatterSeed + 19) * TAU;
          const distance = (18 + hash(glyph.row, glyph.column, state.scatterSeed + 41) * 48) * scatter;
          offsetX += Math.cos(angle) * distance;
          offsetY += Math.sin(angle) * distance;
        }

        context.fillStyle = glyph.part === "iris" ? colors.cyan : colors.lavender;
        context.shadowColor = glyph.part === "iris" ? colors.cyan : colors.lavender;

        if (band > 0.08 && !isStatic) {
          context.globalAlpha = band * (glyph.part === "body" ? 0.13 : 0.2);
          paintBitmapCell(glyph, baseX + offsetX - 5 - band * 5, baseY + offsetY);
        }

        const baseAlpha = glyph.part === "iris" ? 1 : glyph.part === "eye" ? 0.93 : 0.5 + hash(glyph.column, glyph.row, glyph.bits) * 0.3;
        const temporalFlicker = isStatic ? 1 : 0.9 + hash(glyph.column, glyph.row, glyphPhase) * 0.1;
        context.globalAlpha = (baseAlpha * temporalFlicker + band * 0.16) * (1 - scatter * 0.18) + proximity * 0.14;
        paintBitmapCell(glyph, baseX + offsetX, baseY + offsetY);
      }
      context.restore();
    };

    const updateGaze = (delta) => {
      let targetX = Math.sin(state.elapsed * 0.00043) * 0.22;
      let targetY = Math.sin(state.elapsed * 0.00031 + 1.8) * 0.12;
      if (performance.now() - pointer.lastAt < 1600) {
        const dx = pointer.x - state.x;
        const dy = pointer.y - state.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        targetX = dx / length;
        targetY = dy / length;
      }
      const follow = 1 - Math.exp((-delta / 1000) * 7);
      state.gazeX = mix(state.gazeX, targetX, follow);
      state.gazeY = mix(state.gazeY, targetY, follow);
    };

    const update = (delta) => {
      state.elapsed += delta;
      if (state.released) {
        if (state.elapsed >= state.nextRoamAt) pickRoamTarget();
        const follow = 1 - Math.exp((-delta / 1000) * 0.72);
        state.x = mix(state.x, state.targetX, follow);
        state.y = mix(state.y, state.targetY, follow);
      } else {
        if (!state.attemptActive && state.elapsed >= state.nextAttemptAt) startAttempt();
        const position = containedPosition();
        const follow = 1 - Math.exp((-delta / 1000) * 8.5);
        state.x = mix(state.x, position.x, follow);
        state.y = mix(state.y, position.y, follow);
      }
      updateGaze(delta);
    };

    const frame = (time) => {
      state.frameId = 0;
      if (!state.enabled || reduceMotion.matches || document.hidden) return;
      if (state.lastFrameAt && time - state.lastFrameAt < FRAME_INTERVAL) {
        state.frameId = requestAnimationFrame(frame);
        return;
      }
      const delta = state.lastFrameAt ? clamp(time - state.lastFrameAt, 0, 50) : 16.7;
      state.lastFrameAt = time;
      update(delta);
      render(false);
      state.frameId = requestAnimationFrame(frame);
    };

    const start = () => {
      if (state.frameId || !state.enabled || reduceMotion.matches || document.hidden) return;
      state.lastFrameAt = 0;
      state.frameId = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (state.frameId) cancelAnimationFrame(state.frameId);
      state.frameId = 0;
      state.lastFrameAt = 0;
    };

    const renderStatic = () => {
      refreshDockPoint();
      const point = state.released
        ? safePoint(viewport.width - metrics.width / 2 - 12, viewport.height - metrics.height / 2 - 72)
        : { x: state.dockX, y: state.dockY };
      state.x = point.x;
      state.y = point.y;
      state.gazeX = 0;
      state.gazeY = 0;
      render(true);
    };

    const syncContainmentControls = () => {
      root.dataset.entityReleased = state.released ? "on" : "off";
      if (releaseButton) {
        releaseButton.setAttribute("aria-pressed", String(state.released));
        releaseButton.setAttribute("aria-label", state.released ? "Recall entity to its sandbox" : "Release entity from its sandbox");
        releaseButton.disabled = !state.enabled;
      }
      if (releaseLabel) releaseLabel.textContent = state.released ? "RECALL_ENTITY" : "RELEASE_ENTITY";
      if (containmentLabel) containmentLabel.textContent = state.released ? "ENTITY_ROAMING_PORTFOLIO" : "LOCAL_CONTAINMENT_ACTIVE";
      if (containmentState) containmentState.textContent = state.released ? "SANDBOX_OPEN" : "SANDBOX_SEALED";
      state.displayedStatus = "";
    };

    const applyRelease = (released, persist = true) => {
      state.released = Boolean(released);
      state.attemptActive = false;
      dock?.classList.remove("is-hit");
      refreshDockPoint();
      if (state.released) {
        const origin = safePoint(state.x, state.y);
        state.x = origin.x;
        state.y = origin.y;
        pickRoamTarget();
        state.scatterStartedAt = state.elapsed;
        state.scatterSeed = Math.floor(random() * 10000);
      } else {
        state.targetX = state.dockX;
        state.targetY = state.dockY;
        state.nextAttemptAt = state.elapsed + 1200 + random() * 1500;
      }
      syncContainmentControls();
      if (persist) {
        try { localStorage.setItem(RELEASE_KEY, state.released ? "on" : "off"); } catch { /* privacy mode */ }
      }
      if (state.enabled && reduceMotion.matches) renderStatic();
    };

    const applyEnabled = (enabled, persist = true) => {
      state.enabled = Boolean(enabled);
      canvas.hidden = !state.enabled;
      root.dataset.entity = state.enabled ? "on" : "off";
      if (toggle) {
        toggle.setAttribute("aria-pressed", String(state.enabled));
        toggle.setAttribute("aria-label", state.enabled ? "Disable entity" : "Enable entity");
      }
      if (toggleLabel) toggleLabel.textContent = state.enabled ? (toggle?.dataset.entityLabelOn || "ENT_ON") : (toggle?.dataset.entityLabelOff || "ENT_OFF");
      syncContainmentControls();
      if (persist) {
        try { localStorage.setItem(POWER_KEY, state.enabled ? "on" : "off"); } catch { /* privacy mode */ }
      }
      if (!state.enabled) {
        stop();
        context.clearRect(0, 0, viewport.width, viewport.height);
        syncReadouts("OFFLINE");
        publishVisualState("OFFLINE", 0, true);
      } else if (reduceMotion.matches) {
        stop();
        renderStatic();
      } else start();
    };

    let resizeFrame = 0;
    const onResize = () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resizeCanvas();
        if (state.enabled && reduceMotion.matches) renderStatic();
        else if (state.enabled) render(false);
      });
    };

    let scrollFrame = 0;
    const onScroll = () => {
      if (state.released || scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        refreshDockPoint();
        if (state.enabled && reduceMotion.matches) renderStatic();
      });
    };

    addEventListener("pointermove", (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.lastAt = performance.now();
    }, { passive: true });

    addEventListener("pointerdown", (event) => {
      if (!state.enabled || reduceMotion.matches || event.target === toggle || event.target === releaseButton || releaseButton?.contains(event.target)) return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.lastAt = performance.now();
      state.scatterStartedAt = state.elapsed;
      state.scatterSeed = Math.floor(random() * 10000);
    }, { passive: true });

    toggle?.addEventListener("click", () => applyEnabled(!state.enabled));
    releaseButton?.addEventListener("click", () => applyRelease(!state.released));
    addEventListener("resize", onResize, { passive: true });
    addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (state.enabled && reduceMotion.matches) renderStatic();
      else start();
    });

    window.addEventListener("andrew:renderer-change", () => {
      context.clearRect(0, 0, viewport.width, viewport.height);
      if (!state.enabled) return;
      if (reduceMotion.matches) renderStatic();
      else render(false);
    });

    const onMotionPreferenceChange = () => {
      stop();
      if (!state.enabled) return;
      if (reduceMotion.matches) renderStatic();
      else start();
    };
    if (typeof reduceMotion.addEventListener === "function") reduceMotion.addEventListener("change", onMotionPreferenceChange);
    else reduceMotion.addListener(onMotionPreferenceChange);

    const themeObserver = new MutationObserver(() => {
      refreshColors();
      if (state.enabled && reduceMotion.matches) renderStatic();
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });

    resizeCanvas();
    let savedPower = null;
    let savedRelease = null;
    try {
      savedPower = localStorage.getItem(POWER_KEY);
      savedRelease = localStorage.getItem(RELEASE_KEY);
    } catch { /* use defaults */ }
    applyRelease(savedRelease === "on", false);
    applyEnabled(savedPower !== "off", false);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
