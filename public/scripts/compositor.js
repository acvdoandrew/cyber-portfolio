(() => {
  "use strict";

  const boot = () => {
    const canvas = document.getElementById("signal-compositor");
    if (!canvas || canvas.dataset.compositor === "ready") return;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;

    canvas.dataset.compositor = "ready";
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = navigator.connection?.saveData === true;
    const surfaces = new Map();

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

    const layouts = () => {
      if (state.width < 700) {
        return [
          { cx: 0.97, cy: 0.72, width: 154, height: 104, seed: 7, label: "CAPTURE_07" },
        ];
      }
      return [
        { cx: 0.015, cy: 0.21, width: 220, height: 126, seed: 3, label: "CAPTURE_03" },
        { cx: 0.985, cy: 0.43, width: 190, height: 248, seed: 7, label: "CAPTURE_07" },
        { cx: 0.1, cy: 0.76, width: 238, height: 132, seed: 11, label: "CAPTURE_11" },
        { cx: 0.86, cy: 0.87, width: 166, height: 92, seed: 19, label: "CAPTURE_19" },
      ];
    };

    const resize = () => {
      state.width = Math.max(1, innerWidth);
      state.height = Math.max(1, innerHeight);
      state.dpr = 1;
      canvas.width = Math.round(state.width * state.dpr);
      canvas.height = Math.round(state.height * state.dpr);
      context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      context.imageSmoothingEnabled = false;
      render(performance.now(), true);
    };

    const signalField = (u, v, params, pixelX, pixelY) => {
      let x = u + params.pointerPullX;
      let y = v + params.pointerPullY;

      if (params.tearClock > 0.925 && Math.abs(y - params.tearY) < 0.085) {
        x += (params.tearClock - 0.925) * 3.8 * params.tearDirection;
      }

      const radius = Math.hypot(x / (0.62 + params.breathe), y / (0.72 - params.breathe));
      const brokenOrbit = Math.exp(-Math.abs(radius - 0.72) * 24) *
        (hash(pixelX, pixelY, params.seed + params.ditherStep) > 0.31 ? 1 : 0);

      const spine = Math.exp(-Math.abs(x + Math.sin(y * 5 + params.spinePhase) * 0.045) * 18) *
        Math.exp(-Math.max(0, Math.abs(y) - 0.88) * 9);
      const taper = Math.exp(-Math.pow(x / (0.17 + (1 - clamp((y + 0.1) / 1.15, 0, 1)) * 0.17), 2) * 2.4) *
        Math.exp(-Math.pow((y - 0.18) / 0.76, 4));

      const wingY = -0.08 - Math.abs(x) * (0.14 + params.morph * 0.16);
      const wings = Math.exp(-Math.pow((Math.abs(x) - (0.38 + params.morph * 0.12)) / 0.29, 2) * 3.2) *
        Math.exp(-Math.pow((y - wingY) / (0.13 + params.morph * 0.045), 2) * 2.8);

      const bloomA = Math.exp(-((x + params.bloomAX) ** 2 + (y + params.bloomAY) ** 2) * params.bloomAScale);
      const bloomB = Math.exp(-((x - params.bloomBX) ** 2 + (y - params.bloomBY) ** 2) * 7.2);

      const filament = Math.exp(-Math.abs(Math.sin(x * 8.4 + y * 5.7 + params.filamentPhase)) * 15) *
        Math.exp(-radius * 1.8);
      const scan = Math.sin((y + params.scanPhase) * 58) > 0.86 ? 0.12 : 0;
      const grain = (hash(pixelX, pixelY, params.seed + params.grainStep) - 0.5) * 0.24;
      const vignette = clamp(1 - Math.pow(Math.abs(x), 3) - Math.pow(Math.abs(y), 3), 0, 1);

      return clamp((brokenOrbit * 0.42 + spine * 0.48 + taper * 0.34 + wings * 0.72 +
        bloomA * 0.28 + bloomB * 0.24 + filament * 0.2 + scan + grain) * vignette, 0, 1);
    };

    const drawCapture = (capture, index, time) => {
      const sourceWidth = Math.max(48, Math.round(capture.width / 3.1));
      const sourceHeight = Math.max(32, Math.round(capture.height / 3.1));
      const surface = getSurface(sourceWidth, sourceHeight);
      if (!surface) return;
      const buffer = surface.canvas;
      const bufferContext = surface.context;

      const image = bufferContext.createImageData(sourceWidth, sourceHeight);
      const frameSeed = capture.seed + Math.floor(time * 7.5);
      const params = {
        seed: capture.seed,
        morph: Math.sin(time * 0.72 + capture.seed) * 0.5 + 0.5,
        breathe: Math.sin(time * 1.17 + capture.seed * 0.4) * 0.055,
        pointerPullX: (state.pointerX - 0.5) * 0.09,
        pointerPullY: (state.pointerY - 0.5) * 0.06,
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
      };
      for (let y = 0; y < sourceHeight; y += 1) {
        for (let x = 0; x < sourceWidth; x += 1) {
          const u = (x / Math.max(1, sourceWidth - 1) - 0.5) * 2;
          const v = (y / Math.max(1, sourceHeight - 1) - 0.5) * 2;
          const field = signalField(u, v, params, x, y);
          const threshold = (BAYER[(x % 4) + (y % 4) * 4] + 0.5) / 16;
          const lit = field > 0.18 + threshold * 0.64;
          const offset = (y * sourceWidth + x) * 4;
          if (lit) {
            const accent = field > 0.74 && hash(x, y, frameSeed + 91) > 0.72;
            image.data[offset] = accent ? 182 : 228;
            image.data[offset + 1] = accent ? 123 : 224;
            image.data[offset + 2] = accent ? 151 : 218;
            image.data[offset + 3] = Math.round(150 + field * 105);
          }
        }
      }
      bufferContext.putImageData(image, 0, 0);

      const parallax = Math.sin(state.scroll * 0.004 + capture.seed) * 12;
      const left = capture.cx * state.width - capture.width / 2;
      const top = capture.cy * state.height - capture.height / 2 + parallax;
      context.save();
      context.imageSmoothingEnabled = false;
      context.globalAlpha = index === 1 ? 0.72 : 0.55;
      context.drawImage(buffer, left, top, capture.width, capture.height);

      context.globalAlpha = 0.48;
      context.strokeStyle = "rgba(224, 220, 214, 0.46)";
      context.lineWidth = 1;
      const corner = 11;
      context.beginPath();
      context.moveTo(left, top + corner); context.lineTo(left, top); context.lineTo(left + corner, top);
      context.moveTo(left + capture.width - corner, top); context.lineTo(left + capture.width, top); context.lineTo(left + capture.width, top + corner);
      context.moveTo(left, top + capture.height - corner); context.lineTo(left, top + capture.height); context.lineTo(left + corner, top + capture.height);
      context.moveTo(left + capture.width - corner, top + capture.height); context.lineTo(left + capture.width, top + capture.height); context.lineTo(left + capture.width, top + capture.height - corner);
      context.stroke();

      context.globalAlpha = 0.45;
      context.fillStyle = "rgba(224, 220, 214, 0.74)";
      context.font = '8px "Cascadia Mono", ui-monospace, monospace';
      context.textBaseline = "top";
      context.fillText(`${capture.label} / ${String(state.step % 100).padStart(2, "0")}`, left + 8, top + 7);
      context.restore();
    };

    const render = (timeMs, force = false) => {
      const time = force && reducedMotion.matches ? 0 : timeMs / 1000;
      state.step = Math.floor(time * 7);
      state.scroll = scrollY;
      context.clearRect(0, 0, state.width, state.height);
      layouts().forEach((capture, index) => drawCapture(capture, index, time));
    };

    const start = () => {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.lastFrameAt = 0;
      render(reducedMotion.matches || saveData ? 0 : performance.now(), true);
    };

    let resizeFrame = 0;
    addEventListener("resize", () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resize();
        start();
      });
    }, { passive: true });

    addEventListener("pointermove", (event) => {
      state.pointerX = event.clientX / Math.max(1, state.width);
      state.pointerY = event.clientY / Math.max(1, state.height);
    }, { passive: true });

    if (typeof reducedMotion.addEventListener === "function") reducedMotion.addEventListener("change", start);

    resize();
    start();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
