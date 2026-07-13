(() => {
  "use strict";

  const boot = () => {
    const canvas = document.getElementById("signal-compositor");
    if (!canvas || canvas.dataset.compositor === "ready") return;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;

    canvas.dataset.compositor = "ready";
    const root = document.documentElement;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = navigator.connection?.saveData === true;
    const surfaces = new Map();
    const SPECIMEN_SEEDS = {
      "black-hole": 3,
      relay: 7,
      graph: 11,
      orbit: 19,
      galaxy: 23,
    };
    const ACTIVE_FRAME_INTERVAL = 1000 / 12;

    const BAYER = [
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5,
    ];
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const fract = (value) => value - Math.floor(value);
    const hash = (x, y, seed) => {
      let value = Math.imul((x | 0) + 101 + (seed | 0) * 17, 374761393) +
        Math.imul((y | 0) + 211 + (seed | 0) * 29, 668265263);
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    };
    const smoothstep = (edge0, edge1, value) => {
      const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
      return amount * amount * (3 - 2 * amount);
    };
    const lineMask = (distance, width) => 1 - smoothstep(width, width + 0.018, distance);
    const segmentDistance = (x, y, ax, ay, bx, by) => {
      const pax = x - ax;
      const pay = y - ay;
      const bax = bx - ax;
      const bay = by - ay;
      const amount = clamp((pax * bax + pay * bay) / Math.max(0.0001, bax * bax + bay * bay), 0, 1);
      return Math.hypot(pax - bax * amount, pay - bay * amount);
    };
    const parseColor = (value, fallback) => {
      const hex = value.trim().match(/^#([\da-f]{6})$/i)?.[1];
      if (hex) return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
      const rgb = value.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
      return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback;
    };

    const state = {
      width: 1,
      height: 1,
      dpr: 1,
      frame: 0,
      lastFrameAt: 0,
      step: 0,
      pointerX: 0.5,
      pointerY: 0.5,
      scroll: 0,
      palette: {
        violet: [201, 194, 202],
        pink: [169, 109, 134],
        cyan: [169, 190, 192],
        corner: "rgba(224, 220, 214, 0.46)",
      },
    };
    let queuedFrame = 0;

    const refreshPalette = () => {
      const styles = getComputedStyle(root);
      const violet = styles.getPropertyValue("--violet").trim() || "#c9c2ca";
      const pink = styles.getPropertyValue("--pink").trim() || "#a96d86";
      const cyan = styles.getPropertyValue("--cyan").trim() || "#a9bec0";
      state.palette = {
        violet: parseColor(violet, [201, 194, 202]),
        pink: parseColor(pink, [169, 109, 134]),
        cyan: parseColor(cyan, [169, 190, 192]),
        corner: violet,
      };
    };

    const getSurface = (width, height) => {
      const key = `${width}x${height}`;
      if (surfaces.has(key)) return surfaces.get(key);
      const surface = document.createElement("canvas");
      surface.width = width;
      surface.height = height;
      const surfaceContext = surface.getContext("2d", { alpha: true });
      if (!surfaceContext) return null;
      const entry = { canvas: surface, context: surfaceContext };
      surfaces.set(key, entry);
      return entry;
    };

    const layouts = () => [...document.querySelectorAll("[data-specimen]")].map((element) => {
      const id = element.dataset.specimen || "";
      const visual = element.querySelector("[data-specimen-visual], .section-specimen__visual") || element;
      const rect = visual.getBoundingClientRect();
      const seedValue = element.dataset.specimenSeed || visual.dataset.specimenSeed;
      const seed = Number.parseInt(seedValue || "", 10);
      return {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        seed: Number.isFinite(seed) ? seed : SPECIMEN_SEEDS[id] || 0,
        id,
        visible: rect.width > 0 && rect.height > 0 &&
          rect.right > 0 && rect.left < state.width && rect.bottom > 0 && rect.top < state.height,
      };
    }).filter((capture) => capture.id && capture.visible);

    const resize = () => {
      state.width = Math.max(1, innerWidth);
      state.height = Math.max(1, innerHeight);
      state.dpr = 1;
      canvas.width = Math.round(state.width * state.dpr);
      canvas.height = Math.round(state.height * state.dpr);
      context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      context.imageSmoothingEnabled = false;
      render(performance.now());
    };

    const signalField = (u, v, params) => {
      let x = u + params.pointerPullX;
      let y = v + params.pointerPullY;

      if (params.tearClock > 0.925 && Math.abs(y - params.tearY) < 0.085) {
        x += (params.tearClock - 0.925) * 3.8 * params.tearDirection;
      }

      x += Math.sin(y * 24 - params.time * 4.2) * params.proximity * 0.045;
      const localY = -y;
      const t = params.time * 0.28 + params.seed;
      const noise = hash(
        Math.floor((x + 1) * 45),
        Math.floor((localY + 1) * 45),
        Math.floor(params.time * 7 + params.seed),
      );
      let field = 0;

      if (params.seed < 5) {
        const discRadius = Math.hypot(x / 0.9, localY / 0.3);
        const outerDisc = lineMask(Math.abs(discRadius - 0.78), 0.026);
        const innerDisc = lineMask(Math.abs(discRadius - 0.5), 0.02);
        const horizonRadius = Math.hypot(x / 0.19, localY / 0.27);
        const horizon = lineMask(Math.abs(horizonRadius - 1), 0.055);
        const accretion = lineMask(Math.abs(localY + Math.sin(x * 7 + t) * 0.025), 0.022) * (Math.abs(x) <= 0.82 ? 1 : 0);
        const lensing = lineMask(Math.abs(Math.hypot(x / 0.48, localY / 0.68) - 1), 0.018) * (noise >= 0.24 ? 1 : 0);
        const starNoise = noise >= 0.94 && horizonRadius >= 1.14 && discRadius <= 1 ? 1 : 0;
        field = outerDisc * 0.82 + innerDisc * 0.48 + horizon + accretion * 0.72 + lensing * 0.55 + starNoise * 0.34;
      } else if (params.seed < 9) {
        const tower = Math.abs(x) <= 0.24 && Math.abs(localY) <= 0.82 ? 1 : 0;
        const taperWidth = 0.1 + (localY + 1) * 0.16;
        const taper = Math.abs(x) <= taperWidth && localY >= -0.88 && localY <= 0.72 ? 1 : 0;
        const ribs = Math.abs(Math.sin(localY * 31 + t)) >= 0.86 ? tower : 0;
        const antenna = lineMask(segmentDistance(x, localY, 0, -0.96, Math.sin(t) * 0.08, -0.56), 0.022);
        const sideSignal = lineMask(Math.abs(Math.abs(x) - 0.48), 0.018) * (Math.abs(localY) <= 0.46 ? 1 : 0);
        field = taper * 0.5 + ribs * 0.74 + antenna + sideSignal * (noise >= 0.48 ? 1 : 0);
      } else if (params.seed < 15) {
        const trunk = lineMask(Math.abs(x + Math.sin(localY * 5 + t) * 0.07), 0.025) * (localY >= -0.82 ? 1 : 0);
        let branches = lineMask(segmentDistance(x, localY, 0, -0.25, -0.68, 0.18), 0.022);
        branches += lineMask(segmentDistance(x, localY, 0.02, -0.05, 0.72, 0.35), 0.022);
        branches += lineMask(segmentDistance(x, localY, -0.02, 0.2, -0.56, 0.68), 0.018);
        branches += lineMask(segmentDistance(x, localY, 0.01, 0.3, 0.5, 0.78), 0.018);
        const spores = noise >= 0.91 && Math.hypot(x, localY) <= 0.94 ? 1 : 0;
        field = trunk * 0.86 + branches * 0.72 + spores * 0.52;
      } else if (params.seed < 22) {
        const radius = Math.hypot(x / 0.76, localY / 0.7);
        const rings = lineMask(Math.abs(radius - 0.42), 0.018) + lineMask(Math.abs(radius - 0.76), 0.018);
        const cross = lineMask(Math.abs(x), 0.014) * (Math.abs(localY) <= 0.88 ? 1 : 0) +
          lineMask(Math.abs(localY), 0.014) * (Math.abs(x) <= 0.88 ? 1 : 0);
        const satelliteX = Math.cos(t) * 0.56;
        const satelliteY = Math.sin(t) * 0.48;
        const satellite = 1 - smoothstep(0.035, 0.075, Math.hypot(x - satelliteX, localY - satelliteY));
        const ticks = Math.abs(Math.sin(Math.atan2(localY, x) * 18 - t)) >= 0.94 && radius >= 0.66 && radius <= 0.9 ? 1 : 0;
        field = rings * (noise >= 0.26 ? 1 : 0) + cross * 0.46 + satellite + ticks * 0.62;
      } else {
        const galaxyRadius = Math.hypot(x / 0.94, localY / 0.58);
        const galaxyAngle = Math.atan2(localY, x);
        let spiral = lineMask(Math.abs(Math.sin(galaxyAngle * 2 - galaxyRadius * 10 + t * 0.3)), 0.085);
        spiral *= galaxyRadius >= 0.14 && galaxyRadius <= 0.94 ? 1 : 0;
        const coreX = x / 0.2;
        const coreY = localY / 0.12;
        const core = Math.exp(-(coreX * coreX + coreY * coreY) * 2.2);
        const starField = noise >= 0.93 && galaxyRadius <= 1 ? 1 : 0;
        const planetX = Math.cos(t * 0.8) * 0.68;
        const planetY = Math.sin(t * 0.8) * 0.4;
        const planet = 1 - smoothstep(0.025, 0.065, Math.hypot(x - planetX, localY - planetY));
        field = spiral * 0.82 + core + starField * 0.56 + planet;
      }

      const wakeRadius = fract(params.time * 0.52 + params.seed * 0.037) * 1.42;
      const wake = lineMask(Math.abs(Math.hypot(x - params.entityX, y - params.entityY) - wakeRadius), 0.024) * params.proximity;

      return clamp(Math.max(field, wake * 0.8), 0, 1);
    };

    const drawCapture = (capture, time) => {
      const sourceWidth = Math.max(48, Math.round(capture.width / 3.1));
      const sourceHeight = Math.max(32, Math.round(capture.height / 3.1));
      const surface = getSurface(sourceWidth, sourceHeight);
      if (!surface) return;
      const buffer = surface.canvas;
      const bufferContext = surface.context;

      const image = bufferContext.createImageData(sourceWidth, sourceHeight);
      const frameSeed = capture.seed + Math.floor(time * 7.5);
      const entity = window.__ANDREW_VISUAL_STATE__?.entity;
      const captureCenterX = capture.cx;
      const captureCenterY = capture.cy;
      const entityDistance = entity?.released
        ? Math.hypot(entity.x - captureCenterX, entity.y - captureCenterY)
        : Infinity;
      const proximity = clamp(1 - entityDistance / Math.max(150, Math.max(capture.width, capture.height) * 0.9), 0, 1);
      const params = {
        seed: capture.seed,
        morph: Math.sin(time * 0.72 + capture.seed) * 0.5 + 0.5,
        breathe: Math.sin(time * 1.17 + capture.seed * 0.4) * 0.055,
        pointerPullX: reducedMotion.matches || saveData ? 0 : (state.pointerX - 0.5) * 0.09,
        pointerPullY: reducedMotion.matches || saveData ? 0 : (state.pointerY - 0.5) * 0.06,
        tearClock: fract(time * 0.11 + capture.seed * 0.173),
        tearY: Math.sin(capture.seed * 4.17) * 0.5,
        tearDirection: capture.seed % 2 ? 1 : -1,
        ditherStep: Math.floor(time * 5),
        grainStep: Math.floor(time * 8),
        spinePhase: time * 0.42,
        filamentPhase: time * 0.7 + capture.seed,
        scanPhase: time * 0.19,
        bloomAX: 0.22 * Math.sin(time * 0.53 + capture.seed),
        bloomAY: 0.12 * Math.cos(time * 0.47),
        bloomAScale: 5.5 + (Math.sin(time * 0.72 + capture.seed) * 0.5 + 0.5) * 2.2,
        bloomBX: 0.31 * Math.cos(time * 0.39 + capture.seed),
        bloomBY: 0.2 * Math.sin(time * 0.61),
        time,
        proximity,
        entityX: entity ? (entity.x - captureCenterX) / Math.max(1, capture.width / 2) : 4,
        entityY: entity ? (entity.y - captureCenterY) / Math.max(1, capture.height / 2) : 4,
      };
      for (let y = 0; y < sourceHeight; y += 1) {
        for (let x = 0; x < sourceWidth; x += 1) {
          const u = (x / Math.max(1, sourceWidth - 1) - 0.5) * 2;
          const v = (y / Math.max(1, sourceHeight - 1) - 0.5) * 2;
          const field = signalField(u, v, params);
          const threshold = (BAYER[(x % 4) + (y % 4) * 4] + 0.5) / 16;
          const lit = field > 0.18 + threshold * 0.64 - proximity * 0.11;
          const offset = (y * sourceWidth + x) * 4;
          if (lit) {
            const accent = field > 0.74 && hash(x, y, frameSeed + 91) > 0.72;
            const color = proximity > 0.02
              ? (accent ? state.palette.cyan : state.palette.pink)
              : (accent ? state.palette.pink : state.palette.violet);
            image.data[offset] = color[0];
            image.data[offset + 1] = color[1];
            image.data[offset + 2] = color[2];
            image.data[offset + 3] = Math.round(150 + field * 105);
          }
        }
      }
      bufferContext.putImageData(image, 0, 0);

      const left = capture.cx - capture.width / 2;
      const top = capture.cy - capture.height / 2;
      context.save();
      context.imageSmoothingEnabled = false;
      context.globalAlpha = capture.id === "relay" ? 0.72 : 0.55;
      context.drawImage(buffer, left, top, capture.width, capture.height);

      context.globalAlpha = 0.48;
      context.strokeStyle = state.palette.corner;
      context.lineWidth = 1;
      const corner = 11;
      context.beginPath();
      context.moveTo(left, top + corner); context.lineTo(left, top); context.lineTo(left + corner, top);
      context.moveTo(left + capture.width - corner, top); context.lineTo(left + capture.width, top); context.lineTo(left + capture.width, top + corner);
      context.moveTo(left, top + capture.height - corner); context.lineTo(left, top + capture.height); context.lineTo(left + corner, top + capture.height);
      context.moveTo(left + capture.width - corner, top + capture.height); context.lineTo(left + capture.width, top + capture.height); context.lineTo(left + capture.width, top + capture.height - corner);
      context.stroke();

      context.restore();
    };

    const render = (timeMs) => {
      const time = reducedMotion.matches || saveData ? 0 : timeMs / 1000;
      state.step = Math.floor(time * 7);
      state.scroll = scrollY;
      context.clearRect(0, 0, state.width, state.height);
      layouts().forEach((capture) => drawCapture(capture, time));
    };

    const shouldAnimate = () => !document.hidden && !reducedMotion.matches && !saveData &&
      root.dataset.renderer !== "webgl" && window.__ANDREW_VISUAL_STATE__?.entity?.released === true;

    const animate = (time) => {
      if (!shouldAnimate()) {
        state.frame = 0;
        return;
      }
      if (time - state.lastFrameAt >= ACTIVE_FRAME_INTERVAL) {
        state.lastFrameAt = time;
        render(time);
      }
      state.frame = requestAnimationFrame(animate);
    };

    const start = () => {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.lastFrameAt = 0;
      render(performance.now());
      if (shouldAnimate()) state.frame = requestAnimationFrame(animate);
    };

    const queueRender = () => {
      if (queuedFrame) return;
      queuedFrame = requestAnimationFrame((time) => {
        queuedFrame = 0;
        render(time);
      });
    };

    let resizeFrame = 0;
    let resizeTimer = 0;
    addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          resize();
          start();
        });
      }, 160);
    }, { passive: true });

    addEventListener("pointermove", (event) => {
      state.pointerX = event.clientX / Math.max(1, state.width);
      state.pointerY = event.clientY / Math.max(1, state.height);
      if (!reducedMotion.matches && !saveData && !state.frame) queueRender();
    }, { passive: true });

    addEventListener("scroll", queueRender, { passive: true });
    addEventListener("andrew:specimen-change", start);
    addEventListener("andrew:artifact-change", queueRender);
    addEventListener("andrew:entity-state", start);
    addEventListener("andrew:renderer-change", start);
    addEventListener("andrew:theme-change", () => {
      refreshPalette();
      start();
    });
    document.addEventListener("visibilitychange", start);

    if (typeof reducedMotion.addEventListener === "function") reducedMotion.addEventListener("change", start);

    refreshPalette();
    resize();
    start();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
