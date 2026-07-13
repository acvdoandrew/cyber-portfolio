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
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    });

    const root = document.documentElement;
    const heroDock = document.getElementById("entity-dock");
    const sessionDock = document.querySelector("[data-session-entity-dock]") ||
      document.querySelector(".session-gate__portrait");
    let activeDock = null;
    const toggle = document.getElementById("entity-toggle");
    const toggleLabel = toggle?.querySelector("[data-entity-label]");
    const releaseButton = document.getElementById("entity-release");
    const releaseLabel = releaseButton?.querySelector("[data-release-label]");
    const containmentLabel = document.querySelector("[data-containment-label]");
    const containmentState = document.getElementById("containment-state");
    const liveState = document.getElementById("entity-state");
    const formReadout = document.getElementById("entity-form");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const artifactElements = [...document.querySelectorAll("[data-artifact]")];
    let artifactTargets = [];
    const specimenElements = [...document.querySelectorAll("[data-specimen]")];
    const specimenTargets = specimenElements.map((element) => ({
      element,
      id: element.dataset.specimen || "unknown",
    }));
    const watcherPortrait = new Image();
    watcherPortrait.decoding = "async";
    watcherPortrait.src = "/assets/watcher-face-v3.webp";
    const lightWatcherPortrait = document.createElement("canvas");
    let lightWatcherPortraitReady = false;

    const POWER_KEY = "andrew-entity";
    const RELEASE_KEY = "andrew-entity-released";
    const TAU = Math.PI * 2;
    const DOT_COLUMNS = 72;
    const DOT_ROWS = 64;
    const CELL_COLUMNS = DOT_COLUMNS / 2;
    const CELL_ROWS = DOT_ROWS / 4;
    const CANVAS_ACTIVE_FRAME_RATE = coarsePointer.matches ? 15 : 30;
    const CANVAS_IDLE_FRAME_RATE = coarsePointer.matches ? 8 : 12;
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
      velocityX: 0,
      velocityY: 0,
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
      containmentStatus: "CONTAINED",
      dockVisible: true,
      sessionDockActive: false,
      dockScale: 1,
      dockScaleTarget: 1,
      targetArtifact: "",
      targetSpecimen: "",
      activeArtifact: "",
      artifactInfluence: 0,
      artifactScale: 1,
      activeSpecimen: "",
      specimenInfluence: 0,
      specimenContactStartedAt: -Infinity,
    };

    const ARTIFACT_STATUS = {
      "black-hole": "GRAVITY_CAPTURE",
      galaxy: "DEEP_FIELD_SPIRAL",
      relay: "RELAY_HANDSHAKE",
      graph: "TRACING_BRANCH_GRAPH",
      orbit: "TARGET_LOCKED",
    };

    const fallbackColors = {
      cyan: "#a9bec0",
      pink: "#a96d86",
      lavender: "#eeece8",
      watcherBlue: "#5268ff",
      watcherIce: "#dce3ff",
    };
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
        watcherBlue: cssColor(["--watcher-blue", "--cyan"], fallbackColors.watcherBlue),
        watcherIce: cssColor(["--watcher-ice", "--text"], fallbackColors.watcherIce),
      };
    };

    const parseRgb = (color, fallback = [23, 21, 24]) => {
      const hex = color.match(/^#([\da-f]{6})$/i)?.[1];
      if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
      const rgb = color.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
      return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback;
    };

    const lightPortraitSource = () => {
      if (lightWatcherPortraitReady) return lightWatcherPortrait;
      if (!watcherPortrait.complete || !watcherPortrait.naturalWidth) return watcherPortrait;
      lightWatcherPortrait.width = watcherPortrait.naturalWidth;
      lightWatcherPortrait.height = watcherPortrait.naturalHeight;
      const lightContext = lightWatcherPortrait.getContext("2d", { alpha: true });
      if (!lightContext) return watcherPortrait;
      lightContext.drawImage(watcherPortrait, 0, 0);
      const image = lightContext.getImageData(0, 0, lightWatcherPortrait.width, lightWatcherPortrait.height);
      const ink = parseRgb(cssColor(["--text"], "#171518"));
      for (let offset = 0; offset < image.data.length; offset += 4) {
        const luminance = (image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114) / 255;
        const material = Math.pow(luminance, 0.76);
        image.data[offset] = ink[0];
        image.data[offset + 1] = ink[1];
        image.data[offset + 2] = ink[2];
        image.data[offset + 3] = Math.min(255, Math.round(image.data[offset + 3] * material * 2.15));
      }
      lightContext.clearRect(0, 0, lightWatcherPortrait.width, lightWatcherPortrait.height);
      lightContext.putImageData(image, 0, 0);
      lightWatcherPortraitReady = true;
      return lightWatcherPortrait;
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

    const refreshArtifactTargets = () => {
      artifactTargets = artifactElements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element,
          id: element.dataset.artifact || "unknown",
          pageX: rect.left + window.scrollX + rect.width / 2,
          pageY: rect.top + window.scrollY + rect.height / 2,
          width: rect.width,
          height: rect.height,
        };
      }).filter((target) => target.width > 0 && target.height > 0);
    };

    const artifactPoint = (target) => {
      const x = target.pageX - window.scrollX;
      const y = target.pageY - window.scrollY;
      const halfWidth = target.width / 2;
      const halfHeight = target.height / 2;
      return {
        x,
        y,
        visible: x + halfWidth > -40 && x - halfWidth < viewport.width + 40 &&
          y + halfHeight > -40 && y - halfHeight < viewport.height + 40,
      };
    };

    const visibleArtifactTargets = () => artifactTargets.filter((target) => artifactPoint(target).visible);

    const specimenPoint = (target) => {
      const rect = target.element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return {
        x,
        y,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0 && rect.right > -40 && rect.left < viewport.width + 40 &&
          rect.bottom > -40 && rect.top < viewport.height + 40,
      };
    };

    const visibleSpecimenTargets = () => specimenTargets.filter((target) => specimenPoint(target).visible);

    const refreshDockPoint = () => {
      const nextDock = root.classList.contains("session-pending") && sessionDock ? sessionDock : heroDock;
      const dockChanged = activeDock !== nextDock;
      if (dockChanged) {
        activeDock?.classList.remove("is-hit");
        activeDock = nextDock;
      }
      state.sessionDockActive = Boolean(sessionDock && activeDock === sessionDock && root.classList.contains("session-pending"));
      if (dockChanged && state.sessionDockActive) {
        state.attemptActive = false;
        state.nextAttemptAt = state.elapsed + 140;
        state.containmentStatus = "GATEHOUSE_PATROL";
      }
      let rect = { left: viewport.width * 0.55, top: viewport.height * 0.2, width: viewport.width * 0.35, height: viewport.height * 0.55 };
      if (activeDock) {
        const current = activeDock.getBoundingClientRect();
        if (current.width || current.height) rect = current;
      }
      state.dockVisible = rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width;
      dockBounds.left = rect.left;
      dockBounds.top = rect.top;
      dockBounds.width = rect.width;
      dockBounds.height = rect.height;
      dockBounds.right = rect.left + rect.width;
      dockBounds.bottom = rect.top + rect.height;
      state.dockX = rect.left + rect.width / 2;
      state.dockY = rect.top + rect.height / 2;
      const portraitSize = metrics.height * 1.22;
      state.dockScaleTarget = state.sessionDockActive
        ? clamp(Math.min(rect.width, rect.height) / Math.max(1, portraitSize) * 0.7, 0.32, 0.78)
        : (!state.released && !state.dockVisible ? 0.55 : 0.84);
      if (!state.dockVisible && !state.released) {
        state.attemptActive = false;
        activeDock?.classList.remove("is-hit");
      }
      if (!Number.isFinite(state.x)) {
        state.dockScale = state.dockScaleTarget;
        state.x = state.dockX;
        state.y = state.dockY;
        state.targetX = state.dockX;
        state.targetY = state.dockY;
      }
    };

    const resizeCanvas = () => {
      viewport.width = Math.max(1, innerWidth);
      viewport.height = Math.max(1, innerHeight);
      viewport.dpr = coarsePointer.matches ? 1 : clamp(devicePixelRatio || 1, 1, 1.5);
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
      refreshArtifactTargets();
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
      const pixelWidth = Math.max(1, stepX * 0.94);
      const pixelHeight = Math.max(1, stepY * 0.26);
      for (let dotY = 0; dotY < 4; dotY += 1) {
        for (let dotX = 0; dotX < 2; dotX += 1) {
          if (!(glyph.bits & BRAILLE_BITS[dotY][dotX])) continue;
          const x = centerX + (dotX - 0.5) * stepX - pixelWidth / 2;
          const y = centerY + (dotY - 1.5) * stepY - pixelHeight / 2;
          context.fillRect(Math.round(x), Math.round(y), Math.ceil(pixelWidth), Math.ceil(pixelHeight));
        }
      }
    };

    const paintPortrait = (centerX, centerY, scatter, isStatic) => {
      const isLight = root.dataset.themeResolved === "light";
      const portraitSource = isLight ? lightPortraitSource() : watcherPortrait;
      const size = metrics.height * 1.22 * state.dockScale * state.artifactScale;
      const left = centerX - size / 2;
      const top = centerY - size / 2;
      const sourceWidth = portraitSource instanceof HTMLImageElement ? portraitSource.naturalWidth : portraitSource.width;
      const sourceSize = (portraitSource instanceof HTMLImageElement ? portraitSource.naturalHeight : portraitSource.height) || 512;
      const sourceStep = root.dataset.fxQuality === "low" ? 5 : 4;
      const time = state.elapsed / 1000;
      const glitchClock = isStatic ? 999 : state.elapsed % 6100;
      const glitchCycle = Math.floor(state.elapsed / 6100);

      context.save();
      context.globalCompositeOperation = isLight ? "source-over" : "screen";
      context.imageSmoothingEnabled = true;
      for (let sourceY = 0; sourceY < sourceSize; sourceY += sourceStep) {
        const progress = sourceY / sourceSize;
        let offsetX = isStatic ? 0 : Math.sin(progress * 18 + time * 1.6) * 0.7;
        if (glitchClock < 260 && hash(sourceY, glitchCycle, 307) > 0.72) {
          offsetX += (hash(sourceY, glitchCycle, 311) - 0.5) * 24 * (1 - glitchClock / 260);
        }
        if (scatter > 0) offsetX += (hash(sourceY, state.scatterSeed, 331) - 0.5) * 42 * scatter;
        const destinationY = top + progress * size;
        context.globalAlpha = 0.58 + hash(sourceY, 0, Math.floor(time * 7)) * 0.3;
        context.drawImage(
          portraitSource,
          0,
          sourceY,
          sourceWidth,
          1,
          left + offsetX,
          destinationY,
          size,
          Math.max(1, size / sourceSize * 1.45),
        );
      }
      context.restore();

      const pulse = isStatic ? 1 : 0.94 + Math.sin(time * 2.15) * 0.06;
      const auraRadius = size * 0.058 * pulse;
      const coreRadius = size * 0.018;
      const gazeOffsetX = state.gazeX * size * 0.009;
      const gazeOffsetY = state.gazeY * size * 0.005;
      const eyeY = centerY - size * 0.064 + gazeOffsetY;

      context.save();
      context.globalCompositeOperation = isLight ? "source-over" : "lighter";
      for (const anchor of [-0.092, 0.108]) {
        const eyeX = centerX + anchor * size + gazeOffsetX;
        context.save();
        context.translate(eyeX, eyeY);
        context.scale(1.38, 0.64);
        const aura = context.createRadialGradient(0, 0, 0, 0, 0, auraRadius);
        aura.addColorStop(0, isLight ? "rgba(23, 21, 24, 0.98)" : "rgba(255, 253, 248, 0.98)");
        aura.addColorStop(0.18, isLight ? "rgba(73, 107, 112, 0.88)" : "rgba(238, 236, 232, 0.94)");
        aura.addColorStop(0.42, isLight ? "rgba(135, 83, 107, 0.34)" : "rgba(201, 194, 202, 0.48)");
        aura.addColorStop(1, "rgba(169, 109, 134, 0)");
        context.globalAlpha = (1 - scatter * 0.16) * pulse;
        context.fillStyle = aura;
        context.beginPath();
        context.arc(0, 0, auraRadius, 0, TAU);
        context.fill();

        context.globalAlpha = 0.92;
        context.fillStyle = isLight ? "rgba(23, 21, 24, 0.96)" : "rgba(255, 254, 250, 0.96)";
        context.beginPath();
        context.arc(0, 0, coreRadius, 0, TAU);
        context.fill();
        context.restore();
      }
      context.restore();
    };

    const pickRoamTarget = () => {
      const visibleArtifacts = visibleArtifactTargets();
      const visibleSpecimens = visibleSpecimenTargets();
      const visitArtifact = visibleArtifacts.length && random() < 0.84;
      const visitSpecimen = !artifactTargets.length && visibleSpecimens.length && random() < 0.84;
      let safe;
      if (visitArtifact) {
        const artifact = visibleArtifacts[Math.floor(random() * visibleArtifacts.length)];
        const point = artifactPoint(artifact);
        safe = safePoint(
          point.x + (random() - 0.5) * Math.min(artifact.width * 0.18, 48),
          point.y + (random() - 0.5) * Math.min(artifact.height * 0.18, 40),
        );
        state.targetArtifact = artifact.id;
        state.targetSpecimen = "";
      } else if (visitSpecimen) {
        const specimen = visibleSpecimens[Math.floor(random() * visibleSpecimens.length)];
        const point = specimenPoint(specimen);
        safe = safePoint(
          point.x,
          point.y,
        );
        state.targetArtifact = "";
        state.targetSpecimen = specimen.id;
      } else {
        safe = safePoint(viewport.width * (0.12 + random() * 0.76), viewport.height * (0.18 + random() * 0.66));
        if (Math.hypot(safe.x - state.x, safe.y - state.y) < metrics.width * 0.7) {
          safe.x = state.x < viewport.width / 2 ? safePoint(viewport.width, safe.y).x : safePoint(0, safe.y).x;
        }
        state.targetArtifact = "";
        state.targetSpecimen = "";
      }
      state.targetX = safe.x;
      state.targetY = safe.y;
      const visitingObject = visitArtifact || visitSpecimen;
      state.nextRoamAt = state.elapsed + (visitingObject ? 6200 : 2800) + random() * (visitingObject ? 1800 : 3400);
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
      activeDock?.classList.remove("is-hit");
      void activeDock?.offsetWidth;
      activeDock?.classList.add("is-hit");
    };

    const containedPosition = () => {
      if (!state.dockVisible) return { x: state.dockX, y: state.dockY, status: "CONTAINED" };
      const sessionPatrol = state.sessionDockActive;
      if (!state.attemptActive) {
        if (!sessionPatrol) return { x: state.dockX, y: state.dockY, status: "CONTAINED" };
        const entityRadius = metrics.height * 1.22 * state.dockScale / 2;
        const idleHalfW = Math.max(8, dockBounds.width / 2 - entityRadius - 12);
        const idleHalfH = Math.max(8, dockBounds.height / 2 - entityRadius - 12);
        return {
          x: state.dockX + Math.sin(state.elapsed * 0.0021) * idleHalfW * 0.42,
          y: state.dockY + Math.sin(state.elapsed * 0.00155 + 0.9) * idleHalfH * 0.34,
          status: "GATEHOUSE_PATROL",
        };
      }
      const attemptTime = sessionPatrol ? 920 : ATTEMPT_TIME;
      const progress = (state.elapsed - state.attemptStartedAt) / attemptTime;
      if (progress >= 1) {
        state.attemptActive = false;
        state.nextAttemptAt = state.elapsed + (sessionPatrol ? 160 + random() * 260 : 2300 + random() * 3300);
        activeDock?.classList.remove("is-hit");
        return { x: state.dockX, y: state.dockY, status: sessionPatrol ? "GATEHOUSE_PATROL" : "CONTAINED" };
      }

      const entityRadius = metrics.height * 1.22 * state.dockScale / 2;
      const halfW = Math.max(10, dockBounds.width / 2 - entityRadius - 12);
      const halfH = Math.max(10, dockBounds.height / 2 - entityRadius - 12);
      let dx = 0;
      let dy = 0;
      if (state.attemptEdge === "left") dx = -halfW;
      if (state.attemptEdge === "right") dx = halfW;
      if (state.attemptEdge === "top") dy = -halfH;
      if (state.attemptEdge === "bottom") dy = halfH;

      let travel = 0;
      let status = sessionPatrol ? "TESTING_GATE" : "TESTING_WALL";
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

    const updateArtifactInteraction = () => {
      let nearest = null;
      let nearestDistance = Infinity;

      if (state.enabled && state.released) {
        for (const artifact of artifactTargets) {
          const point = artifactPoint(artifact);
          if (!point.visible) continue;
          const distance = Math.hypot(state.x - point.x, state.y - point.y);
          if (distance < nearestDistance) {
            nearest = artifact;
            nearestDistance = distance;
          }
        }
      }

      let nextId = "";
      let influence = 0;
      if (nearest) {
        const contactRadius = clamp(
          Math.max(metrics.width * 0.82, Math.min(Math.max(nearest.width, nearest.height) * 0.46, 270)),
          140,
          280,
        );
        const releaseRadius = state.activeArtifact === nearest.id ? contactRadius * 1.28 : contactRadius;
        if (nearestDistance < releaseRadius) {
          nextId = nearest.id;
          influence = 1 - clamp(nearestDistance / releaseRadius, 0, 1);
        }
      }

      state.artifactInfluence = influence;
      if (nextId === state.activeArtifact) return;

      state.activeArtifact = nextId;
      artifactElements.forEach((element) => {
        const active = element.dataset.artifact === nextId;
        element.classList.toggle("is-active", active);
        if (active) element.dataset.artifactState = ARTIFACT_STATUS[nextId] || "SIGNAL_CONTACT";
        else delete element.dataset.artifactState;
      });
      if (nextId) root.dataset.artifactContact = nextId;
      else delete root.dataset.artifactContact;
      window.dispatchEvent(new CustomEvent("andrew:artifact-change", {
        detail: {
          id: nextId,
          influence: state.artifactInfluence,
          status: nextId ? ARTIFACT_STATUS[nextId] || "SIGNAL_CONTACT" : "ROAMING",
        },
      }));
    };

    const updateSpecimenInteraction = () => {
      let nearest = null;
      let nearestDistance = Infinity;
      if (state.enabled && state.released) {
        for (const specimen of visibleSpecimenTargets()) {
          const point = specimenPoint(specimen);
          const distance = Math.hypot(state.x - point.x, state.y - point.y);
          if (distance < nearestDistance) {
            nearest = specimen;
            nearestDistance = distance;
          }
        }
      }

      const contactRadius = clamp(metrics.width * 0.78, 130, 220);
      const releaseRadius = nearest?.id === state.activeSpecimen ? contactRadius * 1.22 : contactRadius;
      const nextId = nearest && nearestDistance < releaseRadius ? nearest.id : "";
      state.specimenInfluence = nextId ? 1 - clamp(nearestDistance / releaseRadius, 0, 1) : 0;
      if (nextId === state.activeSpecimen) return;

      state.activeSpecimen = nextId;
      state.specimenContactStartedAt = nextId ? state.elapsed : -Infinity;
      specimenElements.forEach((element) => {
        element.classList.toggle("is-active", element.dataset.specimen === nextId);
      });
      if (nextId) root.dataset.specimenContact = nextId;
      else delete root.dataset.specimenContact;
      window.dispatchEvent(new CustomEvent("andrew:specimen-change", {
        detail: {
          id: nextId,
          influence: state.specimenInfluence,
          status: nextId ? ARTIFACT_STATUS[nextId] || "SIGNAL_CONTACT" : "ROAMING",
        },
      }));
    };

    const currentStatus = (scatter = 0) => {
      if (!state.enabled) return "OFFLINE";
      if (reduceMotion.matches) return state.released ? "RELEASED_STATIC" : "CONTAINED_STATIC";
      if (!state.released && !state.dockVisible) return "CONTAINED";
      if (scatter > 0.72 && !state.attemptActive) return "PIXELS_DISTURBED";
      if (state.activeArtifact) return ARTIFACT_STATUS[state.activeArtifact] || "SIGNAL_CONTACT";
      if (state.activeSpecimen) return ARTIFACT_STATUS[state.activeSpecimen] || `INSPECTING_${state.activeSpecimen.toUpperCase()}`;
      if (state.released) return "ROAMING";
      return state.containmentStatus;
    };

    const syncReadouts = (status) => {
      if (liveState && status !== state.displayedStatus) {
        liveState.textContent = status;
        state.displayedStatus = status;
      }
      if (formReadout) formReadout.textContent = "WATCHER";
    };

    const publishVisualState = (status, scatter = 0, isStatic = false) => {
      const entity = sharedVisualState.entity || {};
      entity.x = Number.isFinite(state.x) ? state.x : state.dockX;
      entity.y = Number.isFinite(state.y) ? state.y : state.dockY;
      const portraitSize = metrics.height * 1.22;
      entity.width = portraitSize * state.dockScale * state.artifactScale;
      entity.height = portraitSize * state.dockScale * state.artifactScale;
      entity.gazeX = state.gazeX;
      entity.gazeY = state.gazeY;
      entity.elapsed = state.elapsed;
      entity.scatter = scatter;
      entity.impact = status === "IMPACT" ? 1 : state.impactTriggered && state.attemptActive ? 0.42 : 0;
      entity.enabled = state.enabled;
      entity.released = state.released;
      entity.static = isStatic;
      entity.status = status;
      entity.artifact = state.activeArtifact;
      entity.artifactInfluence = state.artifactInfluence;
      entity.specimen = state.activeSpecimen;
      entity.specimenInfluence = state.specimenInfluence;
      entity.dock = dockBounds;
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
      const usingWebgl = root.dataset.renderer === "webgl";
      if (!usingWebgl) context.clearRect(0, 0, viewport.width, viewport.height);
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
      if (!state.released && !state.dockVisible) return;
      if (usingWebgl) return;
      if (watcherPortrait.complete && watcherPortrait.naturalWidth) {
        paintPortrait(centerX, centerY, scatter, isStatic);
        return;
      }

      const glyphs = buildGlyphs();
      const pointerFresh = !isStatic && performance.now() - pointer.lastAt < 1600;
      const pointerRadius = clamp(metrics.width * 0.64, 90, 135);

      context.save();
      context.shadowColor = colors.cyan;
      context.shadowBlur = 0;
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
      } else if (state.activeArtifact) {
        const artifact = artifactTargets.find((target) => target.id === state.activeArtifact);
        if (artifact) {
          const point = artifactPoint(artifact);
          const dx = point.x - state.x;
          const dy = point.y - state.y;
          const length = Math.max(1, Math.hypot(dx, dy));
          targetX = dx / length;
          targetY = dy / length;
        }
      } else if (state.activeSpecimen) {
        const specimen = specimenTargets.find((target) => target.id === state.activeSpecimen);
        if (specimen) {
          const point = specimenPoint(specimen);
          const dx = point.x - state.x;
          const dy = point.y - state.y;
          const length = Math.max(1, Math.hypot(dx, dy));
          targetX = dx / length;
          targetY = dy / length;
        }
      }
      const follow = 1 - Math.exp((-delta / 1000) * 7);
      state.gazeX = mix(state.gazeX, targetX, follow);
      state.gazeY = mix(state.gazeY, targetY, follow);
    };

    const springTo = (targetX, targetY, delta, omega) => {
      const step = Math.min(delta / 1000, 0.05);
      const decay = Math.exp(-omega * step);
      const offsetX = state.x - targetX;
      const offsetY = state.y - targetY;
      const tempX = (state.velocityX + omega * offsetX) * step;
      const tempY = (state.velocityY + omega * offsetY) * step;
      state.velocityX = (state.velocityX - omega * tempX) * decay;
      state.velocityY = (state.velocityY - omega * tempY) * decay;
      state.x = targetX + (offsetX + tempX) * decay;
      state.y = targetY + (offsetY + tempY) * decay;
    };

    const engagedArtifactMotion = () => {
      const artifact = artifactTargets.find((target) => target.id === state.activeArtifact);
      if (!artifact) return null;
      const point = artifactPoint(artifact);
      if (!point.visible) return null;

      const time = state.elapsed / 1000;
      const influence = smoothstep(state.artifactInfluence);
      let x = point.x;
      let y = point.y;
      let omega = 3.2;
      let scale = 1;

      switch (artifact.id) {
        case "black-hole": {
          const radius = mix(Math.min(74, Math.max(42, artifact.width * 0.18)), 7, influence);
          const angle = time * mix(1.1, 3.8, influence);
          x += Math.cos(angle) * radius;
          y += Math.sin(angle) * radius * 0.58;
          omega = mix(3.4, 7.2, influence);
          scale = mix(1, 0.64, influence);
          break;
        }
        case "galaxy": {
          const radius = mix(Math.min(112, Math.max(68, artifact.width * 0.26)), 48, influence);
          const angle = -time * mix(0.8, 1.65, influence);
          x += Math.cos(angle) * radius;
          y += Math.sin(angle) * radius * 0.56;
          omega = 3.8;
          scale = 1 + Math.sin(time * 2.2) * 0.025 * influence;
          break;
        }
        case "relay": {
          const pulse = Math.sin(time * 5.8);
          const carrier = Math.sin(time * 17.0) * 5 * influence;
          x += Math.min(78, artifact.width * 0.2) + carrier;
          y += pulse * 32 + Math.sin(time * 29.0) * 3 * influence;
          omega = 5.2;
          scale = 1 + Math.max(0, pulse) * 0.055 * influence;
          break;
        }
        case "graph": {
          x += Math.sin(time * 2.7) * Math.min(92, artifact.width * 0.25);
          y += Math.sin(time * 5.4 + 0.8) * Math.min(54, artifact.height * 0.22);
          omega = 5.6;
          scale = 0.96 + Math.sin(time * 5.4) * 0.025 * influence;
          break;
        }
        case "orbit": {
          const radius = Math.min(92, Math.max(58, Math.min(artifact.width, artifact.height) * 0.34));
          const angle = time * 1.45;
          x += Math.cos(angle) * radius;
          y += Math.sin(angle) * radius * 0.68;
          omega = 4.5;
          scale = 0.98 + Math.cos(angle * 2) * 0.025 * influence;
          break;
        }
      }

      const safe = safePoint(x, y);
      return { x: safe.x, y: safe.y, omega, scale };
    };

    const releaseSpecimenTarget = (specimen) => {
      const point = specimenPoint(specimen);
      const pointX = point.x;
      const pointY = point.y;
      let awayX = state.x - pointX;
      let awayY = state.y - pointY;
      let distance = Math.hypot(awayX, awayY);
      if (distance < 1) {
        const angle = random() * TAU;
        awayX = Math.cos(angle);
        awayY = Math.sin(angle);
        distance = 1;
      }
      const escapeDistance = metrics.width * (specimen.id === "black-hole" ? 1.55 : 1.08);
      const escape = safePoint(
        pointX + awayX / distance * escapeDistance,
        pointY + awayY / distance * escapeDistance,
      );
      state.targetSpecimen = "";
      state.targetX = escape.x;
      state.targetY = escape.y;
      state.nextRoamAt = state.elapsed + 1700 + random() * 1000;
      if (specimen.id === "black-hole") {
        state.scatterStartedAt = state.elapsed;
        state.scatterSeed = Math.floor(random() * 10000);
        state.velocityX += awayX / distance * 360;
        state.velocityY += awayY / distance * 360;
      }
    };

    const engagedSpecimenMotion = () => {
      if (!state.activeSpecimen || state.targetSpecimen !== state.activeSpecimen) return null;
      const specimen = specimenTargets.find((target) => target.id === state.activeSpecimen);
      if (!specimen) return null;
      const point = specimenPoint(specimen);
      if (!point.visible) return null;

      const durations = {
        "black-hole": 3900,
        relay: 3200,
        graph: 4000,
        orbit: 2900,
        galaxy: 4300,
      };
      const duration = durations[specimen.id] || 3200;
      const elapsed = Math.max(0, state.elapsed - state.specimenContactStartedAt);
      if (elapsed >= duration) {
        releaseSpecimenTarget(specimen);
        return null;
      }

      const progress = smoothstep(elapsed / duration);
      const time = elapsed / 1000;
      const centerX = point.x;
      const centerY = point.y;
      let x = centerX;
      let y = centerY;
      let omega = 4.2;
      let scale = 1;

      switch (specimen.id) {
        case "black-hole": {
          const radius = mix(Math.min(82, metrics.width * 0.4), 7, progress);
          const angle = time * mix(1.15, 4.6, progress) + state.specimenContactStartedAt * 0.001;
          x += Math.cos(angle) * radius;
          y += Math.sin(angle) * radius * 0.56;
          omega = mix(4.1, 8.6, progress);
          scale = mix(1, 0.62, progress);
          break;
        }
        case "galaxy": {
          const radius = mix(54, Math.min(112, metrics.width * 0.5), progress);
          const angle = -time * 1.08 - state.specimenContactStartedAt * 0.0004;
          x += Math.cos(angle) * radius;
          y += Math.sin(angle) * radius * 0.5;
          omega = 3.8;
          scale = 1 + Math.sin(time * 2.1) * 0.035;
          break;
        }
        case "relay": {
          const pulse = Math.sin(time * 5.8);
          x += Math.min(76, metrics.width * 0.38) + Math.sin(time * 17) * 5;
          y += pulse * 35 + Math.sin(time * 29) * 3;
          omega = 5.4;
          scale = 1 + Math.max(0, pulse) * 0.07;
          break;
        }
        case "graph": {
          const nodes = [
            [0, 0.34], [-0.34, 0.02], [-0.22, -0.34],
            [0.3, -0.29], [0.39, 0.16], [0, 0.34],
          ];
          const travel = clamp(elapsed / duration, 0, 0.999) * (nodes.length - 1);
          const index = Math.floor(travel);
          const segment = smoothstep(travel - index);
          const from = nodes[index];
          const to = nodes[Math.min(index + 1, nodes.length - 1)];
          const span = Math.min(150, metrics.width * 0.72);
          x += mix(from[0], to[0], segment) * span;
          y += mix(from[1], to[1], segment) * span * 0.72;
          omega = 6.2;
          scale = 0.96 + Math.pow(Math.abs(Math.cos(segment * Math.PI)), 8) * 0.08;
          break;
        }
        case "orbit": {
          const lock = smoothstep(Math.min(1, elapsed / 620));
          const jitter = (1 - lock) * 16 + 1.5;
          x += mix(74, 45, lock) + Math.sin(time * 21) * jitter;
          y += mix(-34, -10, lock) + Math.cos(time * 25) * jitter * 0.55;
          omega = mix(5.5, 9.2, lock);
          scale = mix(1, 0.93, lock) + Math.sin(time * 14) * 0.008;
          break;
        }
      }

      const safe = safePoint(x, y);
      return { x: safe.x, y: safe.y, omega, scale };
    };

    const update = (delta) => {
      state.elapsed += delta;
      state.dockScale = mix(state.dockScale, state.dockScaleTarget, 1 - Math.exp((-delta / 1000) * 4.8));
      if (state.released) {
        if (state.targetArtifact) {
          const target = artifactTargets.find((artifact) => artifact.id === state.targetArtifact);
          const point = target && artifactPoint(target);
          if (point?.visible) {
            const safe = safePoint(point.x, point.y);
            state.targetX = safe.x;
            state.targetY = safe.y;
          } else {
            state.targetArtifact = "";
            state.nextRoamAt = state.elapsed;
          }
        }
        if (state.targetSpecimen) {
          const target = specimenTargets.find((specimen) => specimen.id === state.targetSpecimen);
          const point = target && specimenPoint(target);
          if (point?.visible) {
            const safe = safePoint(point.x, point.y);
            state.targetX = safe.x;
            state.targetY = safe.y;
          } else {
            state.targetSpecimen = "";
            state.nextRoamAt = state.elapsed;
          }
        }
        if (state.elapsed >= state.nextRoamAt) pickRoamTarget();
        const artifactMotion = engagedArtifactMotion();
        const specimenMotion = engagedSpecimenMotion();
        if (artifactMotion) {
          springTo(artifactMotion.x, artifactMotion.y, delta, artifactMotion.omega);
          state.artifactScale = mix(state.artifactScale, artifactMotion.scale, 1 - Math.exp((-delta / 1000) * 5));
        } else if (specimenMotion) {
          springTo(specimenMotion.x, specimenMotion.y, delta, specimenMotion.omega);
          state.artifactScale = mix(state.artifactScale, specimenMotion.scale, 1 - Math.exp((-delta / 1000) * 5));
        } else {
          springTo(state.targetX, state.targetY, delta, 1.85);
          state.artifactScale = mix(state.artifactScale, 1, 1 - Math.exp((-delta / 1000) * 4));
        }
      } else {
        if (!state.attemptActive && state.elapsed >= state.nextAttemptAt) startAttempt();
        const position = containedPosition();
        state.containmentStatus = position.status;
        springTo(position.x, position.y, delta, state.sessionDockActive ? 8.2 : 10.5);
        state.artifactScale = mix(state.artifactScale, 1, 1 - Math.exp((-delta / 1000) * 6));
      }
      updateArtifactInteraction();
      updateSpecimenInteraction();
      updateGaze(delta);
    };

    const frame = (time) => {
      state.frameId = 0;
      if (!state.enabled || reduceMotion.matches || document.hidden) return;
      const recentlyInteracted = time - pointer.lastAt < 12000 || state.released;
      const usingWebgl = root.dataset.renderer === "webgl";
      const activeRate = usingWebgl && !coarsePointer.matches ? 60 : CANVAS_ACTIVE_FRAME_RATE;
      const idleRate = usingWebgl && !coarsePointer.matches ? 24 : CANVAS_IDLE_FRAME_RATE;
      const frameInterval = 1000 / (recentlyInteracted ? activeRate : idleRate);
      if (state.lastFrameAt && time - state.lastFrameAt < frameInterval - 0.5) {
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
      state.released = Boolean(released) && !root.classList.contains("session-pending");
      state.attemptActive = false;
      state.velocityX = 0;
      state.velocityY = 0;
      activeDock?.classList.remove("is-hit");
      refreshDockPoint();
      if (state.released) {
        const origin = safePoint(state.x, state.y);
        state.x = origin.x;
        state.y = origin.y;
        pickRoamTarget();
        state.scatterStartedAt = state.elapsed;
        state.scatterSeed = Math.floor(random() * 10000);
      } else {
        state.targetArtifact = "";
        state.targetSpecimen = "";
        state.targetX = state.dockX;
        state.targetY = state.dockY;
        state.nextAttemptAt = state.elapsed + (state.sessionDockActive ? 140 : 1200 + random() * 1500);
      }
      updateArtifactInteraction();
      updateSpecimenInteraction();
      syncContainmentControls();
      if (persist) {
        try { localStorage.setItem(RELEASE_KEY, state.released ? "on" : "off"); } catch { /* privacy mode */ }
      }
      if (state.enabled && reduceMotion.matches) renderStatic();
    };

    const applyEnabled = (enabled, persist = true) => {
      state.enabled = Boolean(enabled);
      if (!state.enabled) {
        updateArtifactInteraction();
        updateSpecimenInteraction();
      }
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
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          resizeCanvas();
          if (state.enabled && reduceMotion.matches) renderStatic();
          else if (state.enabled) render(false);
        });
      }, 160);
    };

    let scrollFrame = 0;
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        if (!state.released) refreshDockPoint();
        else if (!state.targetArtifact && !state.targetSpecimen && !state.activeArtifact && !state.activeSpecimen &&
          (visibleArtifactTargets().length || visibleSpecimenTargets().length)) {
          state.nextRoamAt = Math.min(state.nextRoamAt, state.elapsed + 120);
        }
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
    let releaseAfterSession = false;
    window.addEventListener("andrew:session-open", () => {
      activeDock?.classList.remove("is-hit");
      state.attemptActive = false;
      state.impactTriggered = false;
      state.containmentStatus = "CONTAINMENT_TRANSFER";
      refreshDockPoint();
      state.targetX = state.dockX;
      state.targetY = state.dockY;
      state.nextAttemptAt = state.elapsed + 1500 + random() * 1200;
      start();
      if (releaseAfterSession) {
        window.setTimeout(() => {
          if (!root.classList.contains("session-pending")) applyRelease(true, false);
        }, reduceMotion.matches ? 0 : 680);
      }
    }, { once: true });

    const onMotionPreferenceChange = () => {
      stop();
      if (!state.enabled) return;
      if (reduceMotion.matches) renderStatic();
      else start();
    };
    reduceMotion.addEventListener("change", onMotionPreferenceChange);

    const themeObserver = new MutationObserver(() => {
      lightWatcherPortraitReady = false;
      refreshColors();
      if (state.enabled) render(reduceMotion.matches);
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class", "data-theme", "data-theme-resolved"] });

    resizeCanvas();
    let savedPower = null;
    let savedRelease = null;
    try {
      savedPower = localStorage.getItem(POWER_KEY);
      savedRelease = localStorage.getItem(RELEASE_KEY);
    } catch { /* use defaults */ }
    releaseAfterSession = savedRelease === "on" && root.classList.contains("session-pending");
    applyRelease(savedRelease === "on" && !releaseAfterSession, false);
    applyEnabled(savedPower !== "off", false);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
