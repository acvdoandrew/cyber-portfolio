const CANVAS_SELECTOR = 'canvas[data-recursive-field]';
const STAGE_SELECTOR = '[data-recursive-field-stage]';
const FIGURE_SELECTOR = '[data-recursive-figure]';
const STATUS_SELECTOR = '[data-field-status]';
const POSTER_SELECTOR = 'img[data-recursive-poster]';

const MAX_DPR = 1.25;
const MAX_BUFFER_EDGE = 960;
const STANDARD_RENDER_SCALE = 0.64;
const REDUCED_RENDER_SCALE = 0.48;
const STATIC_TIME_SECONDS = 8;
const POINTER_DISPLACEMENT = 0.055;

const DEFAULT_PAPER: Color = [0.906, 0.894, 0.863];
const DEFAULT_INK: Color = [0.094, 0.145, 0.129];

const VERTEX_SOURCE = /* glsl */ `#version 300 es
  in vec2 a_position;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SOURCE = /* glsl */ `#version 300 es
  precision highp float;

  uniform vec2 u_resolution;
  uniform vec2 u_pointer;
  uniform float u_time;
  uniform vec3 u_paper;
  uniform vec3 u_ink;

  out vec4 outColor;

  mat2 rotate2d(float angle) {
    float cosine = cos(angle);
    float sine = sin(angle);
    return mat2(cosine, -sine, sine, cosine);
  }

  float bayer4(vec2 pixel) {
    ivec2 point = ivec2(mod(floor(pixel), 4.0));
    int index = point.x + point.y * 4;
    float value = 0.0;

    if (index == 0) value = 0.0;
    else if (index == 1) value = 8.0;
    else if (index == 2) value = 2.0;
    else if (index == 3) value = 10.0;
    else if (index == 4) value = 12.0;
    else if (index == 5) value = 4.0;
    else if (index == 6) value = 14.0;
    else if (index == 7) value = 6.0;
    else if (index == 8) value = 3.0;
    else if (index == 9) value = 11.0;
    else if (index == 10) value = 1.0;
    else if (index == 11) value = 9.0;
    else if (index == 12) value = 15.0;
    else if (index == 13) value = 7.0;
    else if (index == 14) value = 13.0;
    else value = 5.0;

    return (value + 0.5) / 16.0;
  }

  float recursiveField(vec2 position, float time) {
    float energy = 0.0;
    float weight = 1.0;
    position *= rotate2d(0.18 * sin(time * 0.19));

    for (int iteration = 0; iteration < 6; iteration++) {
      float pass = float(iteration);
      position = abs(position);
      position =
        position / clamp(dot(position, position), 0.12, 4.0) -
        vec2(0.79, 0.57);
      position *= rotate2d(
        0.48 + 0.08 * sin(time * 0.21 + pass * 1.7)
      );

      float radius = length(position);
      float shell = exp(
        -20.0 *
        abs(radius - (0.63 + 0.035 * sin(time * 0.34 + pass)))
      );
      float filaments = pow(
        0.5 +
        0.5 *
        cos(
          10.0 * atan(position.y, position.x) +
          radius * 7.0 -
          time
        ),
        7.0
      );

      energy += shell * (0.64 + 0.68 * filaments) / weight;
      weight *= 1.32;
    }

    return energy;
  }

  void main() {
    vec2 fragment = gl_FragCoord.xy;
    vec2 uv =
      (2.0 * fragment - u_resolution.xy) /
      min(u_resolution.x, u_resolution.y);
    uv += clamp(u_pointer, vec2(-1.0), vec2(1.0)) * ${POINTER_DISPLACEMENT.toFixed(3)};

    float time = u_time;
    float radius = length(uv);
    float angle = atan(uv.y, uv.x);

    vec2 mirrored = vec2(abs(uv.x), uv.y);
    float recursive = recursiveField(mirrored * 1.06, time);

    float rings =
      0.5 +
      0.5 *
      cos(
        31.0 * log(radius + 0.17) -
        10.0 * angle -
        1.35 * time +
        2.6 * sin(3.0 * angle + time * 0.24)
      );
    rings = pow(rings, 8.0) * exp(-0.38 * radius);

    float oppositeRings =
      0.5 +
      0.5 *
      cos(
        26.0 * radius +
        8.0 * angle +
        0.82 * time +
        2.0 * sin(5.0 * angle - time * 0.31)
      );
    oppositeRings = pow(oppositeRings, 11.0);

    float spokes = pow(
      abs(
        cos(
          angle * 12.0 +
          2.4 * sin(radius * 5.0 - time * 0.46)
        )
      ),
      24.0
    );
    float iris = exp(
      -6.0 *
      abs(radius - (0.24 + 0.025 * sin(time * 0.6)))
    );
    float center =
      exp(-7.5 * radius) *
      (0.55 + 0.45 * cos(angle * 8.0 + time));
    float outerFade = 1.0 - smoothstep(0.22, 1.65, radius);

    float value =
      recursive * 0.54 +
      rings * 0.46 +
      oppositeRings * 0.22 +
      spokes *
        (0.1 + 0.3 * (1.0 - smoothstep(0.2, 1.5, radius))) +
      iris * 0.38 +
      center * 0.24;

    value *= outerFade;
    value +=
      0.055 *
      sin(fragment.y * 0.37 + time * 2.0);
    value = smoothstep(0.16, 0.93, value);

    float threshold = bayer4(fragment) * 0.86 + 0.07;
    float bit = step(threshold, value);
    outColor = vec4(mix(u_paper, u_ink, bit), 1.0);
  }
`;

type Color = readonly [number, number, number];
type FieldStatus = 'booting' | 'live' | 'still' | 'paused' | 'fallback';
type FieldQuality = 'standard' | 'reduced';
type FallbackReason =
  | 'save-data'
  | 'webgl2-unavailable'
  | 'shader-compile'
  | 'program-link'
  | 'context-lost'
  | 'initialization-failed';

interface SaveDataConnection extends EventTarget {
  readonly saveData?: boolean;
}

interface RecursiveFieldNavigator extends Navigator {
  readonly connection?: SaveDataConnection;
}

interface ProgramState {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  vertexArray: WebGLVertexArrayObject;
  resolution: WebGLUniformLocation;
  pointer: WebGLUniformLocation;
  time: WebGLUniformLocation;
  paper: WebGLUniformLocation;
  ink: WebGLUniformLocation;
}

interface StatusDetail {
  status: FieldStatus;
  reason: string;
  renderer: 'pending' | 'webgl2' | 'poster';
  motion: 'live' | 'still';
}

interface PaletteChangeDetail {
  id?: string;
  paper?: string;
  ink?: string;
  accent?: string;
}

class FieldInitializationError extends Error {
  constructor(
    readonly reason: Extract<
      FallbackReason,
      'shader-compile' | 'program-link' | 'initialization-failed'
    >,
    message: string,
  ) {
    super(message);
    this.name = 'FieldInitializationError';
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseColorChannel(value: string): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return value.endsWith('%')
    ? clamp(parsed / 100, 0, 1)
    : clamp(parsed / 255, 0, 1);
}

function parseColor(value: string, fallback: Color): Color {
  const color = value.trim();
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);

  if (hex) {
    const source = hex[1];
    const expanded =
      source.length === 3 || source.length === 4
        ? source
            .slice(0, 3)
            .split('')
            .map((channel) => channel + channel)
            .join('')
        : source.slice(0, 6);

    return [
      Number.parseInt(expanded.slice(0, 2), 16) / 255,
      Number.parseInt(expanded.slice(2, 4), 16) / 255,
      Number.parseInt(expanded.slice(4, 6), 16) / 255,
    ];
  }

  const functional = color.match(/^rgba?\((.+)\)$/i);
  if (functional) {
    const channels = functional[1]
      .split('/')[0]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(parseColorChannel);

    if (channels.length === 3 && channels.every((channel) => channel !== null)) {
      return channels as unknown as Color;
    }
  }

  return fallback;
}

function readCustomProperty(
  styles: CSSStyleDeclaration,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = styles.getPropertyValue(name).trim();
    if (value) return value;
  }
  return '';
}

function isElementInViewport(element: Element): boolean {
  const bounds = element.getBoundingClientRect();
  if (bounds.width === 0 && bounds.height === 0) return true;
  return (
    bounds.bottom > 0 &&
    bounds.right > 0 &&
    bounds.top < window.innerHeight &&
    bounds.left < window.innerWidth
  );
}

class RecursiveFieldRuntime {
  private readonly stage: HTMLElement;
  private readonly figure: HTMLElement | null;
  private readonly visibilityTarget: HTMLElement;
  private readonly statusNode: HTMLElement | null;
  private readonly poster: HTMLImageElement | null;
  private readonly reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  private readonly connection = (navigator as RecursiveFieldNavigator).connection;

  private gl: WebGL2RenderingContext | null = null;
  private programState: ProgramState | null = null;
  private frame = 0;
  private frameCount = 0;
  private programBuilds = 0;
  private elapsedSeconds = 0;
  private previousTimestamp: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private paper: Color = DEFAULT_PAPER;
  private ink: Color = DEFAULT_INK;
  private quality: FieldQuality = 'standard';
  private slowFrames = 0;
  private layoutKey = '';
  private isIntersecting: boolean;
  private isContextLost = false;
  private isFallback = false;
  private isDisposed = false;
  private needsResize = true;
  private needsStillDraw = true;

  private readonly intersectionObserver: IntersectionObserver | null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly paletteObserver: MutationObserver;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.figure = canvas.closest<HTMLElement>(FIGURE_SELECTOR);
    this.stage =
      canvas.closest<HTMLElement>(STAGE_SELECTOR) ??
      canvas.parentElement ??
      this.figure ??
      canvas;
    this.visibilityTarget = this.stage;
    this.statusNode =
      this.figure?.querySelector<HTMLElement>(STATUS_SELECTOR) ??
      this.stage.querySelector<HTMLElement>(STATUS_SELECTOR) ??
      document.querySelector<HTMLElement>(STATUS_SELECTOR);
    this.poster =
      this.figure?.querySelector<HTMLImageElement>(POSTER_SELECTOR) ?? null;
    this.isIntersecting = isElementInViewport(this.visibilityTarget);

    canvas.dataset.fieldInitialized = 'true';
    canvas.dataset.fieldRenderer = 'pending';
    canvas.dataset.fieldMotion = this.reducedMotion.matches ? 'still' : 'live';
    canvas.dataset.fieldPointerMax = POINTER_DISPLACEMENT.toFixed(3);
    canvas.dataset.fieldProgramBuilds = '0';
    canvas.dataset.fieldFrames = '0';
    canvas.dataset.fieldQuality = this.quality;
    canvas.dataset.fieldVisible = String(this.isIntersecting);
    canvas.dataset.fieldSaveData = String(this.saveData);
    this.setStatus('booting', 'initializing');

    this.intersectionObserver =
      'IntersectionObserver' in window
        ? new IntersectionObserver(this.onIntersection, {
            rootMargin: '0px',
            threshold: 0,
          })
        : null;
    this.intersectionObserver?.observe(this.visibilityTarget);

    this.resizeObserver =
      'ResizeObserver' in window
        ? new ResizeObserver(this.onResize)
        : null;
    this.resizeObserver?.observe(this.stage);

    this.paletteObserver = new MutationObserver(this.onPaletteMutation);
    this.paletteObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-palette', 'class', 'style'],
    });
    this.paletteObserver.observe(canvas, {
      attributes: true,
      attributeFilter: [
        'data-paper',
        'data-ink',
        'data-field-paper',
        'data-field-ink',
      ],
    });

    this.stage.addEventListener('pointermove', this.onPointerMove, {
      passive: true,
    });
    this.stage.addEventListener('pointerleave', this.onPointerLeave, {
      passive: true,
    });
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('resize', this.onWindowResize, { passive: true });
    window.addEventListener('pagehide', this.onPageHide, { once: true });
    window.addEventListener('palettechange', this.onPaletteChange);
    window.addEventListener('portfolio:palettechange', this.onPaletteChange);
    this.reducedMotion.addEventListener?.('change', this.onMotionPreference);
    this.connection?.addEventListener?.('change', this.onConnectionChange);

    this.readPalette();

    if (this.saveData) {
      this.enterFallback('save-data');
      return;
    }

    this.initialize();
  }

  private get saveData(): boolean {
    return this.connection?.saveData === true;
  }

  private initialize(reason = 'ready'): void {
    if (this.isDisposed || this.saveData) return;

    this.isFallback = false;
    this.disposeProgram();

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
    } catch {
      gl = null;
    }

    if (!gl) {
      this.enterFallback('webgl2-unavailable');
      return;
    }

    this.gl = gl;

    try {
      this.programState = this.createProgram(gl);
      this.programBuilds += 1;
      this.canvas.dataset.fieldProgramBuilds = String(this.programBuilds);
      this.showRenderer('webgl2');
      this.needsResize = true;
      this.needsStillDraw = true;
      this.syncLoop(reason);
    } catch (error) {
      const fallbackReason =
        error instanceof FieldInitializationError
          ? error.reason
          : 'initialization-failed';
      this.enterFallback(fallbackReason);
    }
  }

  private createShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string,
  ): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new FieldInitializationError(
        'initialization-failed',
        'Unable to allocate a WebGL shader.',
      );
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed.';
      gl.deleteShader(shader);
      throw new FieldInitializationError('shader-compile', message);
    }

    return shader;
  }

  private createProgram(gl: WebGL2RenderingContext): ProgramState {
    const vertexShader = this.createShader(
      gl,
      gl.VERTEX_SHADER,
      VERTEX_SOURCE,
    );
    let fragmentShader: WebGLShader | null = null;
    let program: WebGLProgram | null = null;

    try {
      fragmentShader = this.createShader(
        gl,
        gl.FRAGMENT_SHADER,
        FRAGMENT_SOURCE,
      );
      program = gl.createProgram();
      if (!program) {
        throw new FieldInitializationError(
          'initialization-failed',
          'Unable to allocate a WebGL program.',
        );
      }

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new FieldInitializationError(
          'program-link',
          gl.getProgramInfoLog(program) || 'Shader program linking failed.',
        );
      }

      const buffer = gl.createBuffer();
      const vertexArray = gl.createVertexArray();
      if (!buffer || !vertexArray) {
        if (buffer) gl.deleteBuffer(buffer);
        if (vertexArray) gl.deleteVertexArray(vertexArray);
        throw new FieldInitializationError(
          'initialization-failed',
          'Unable to allocate field geometry.',
        );
      }

      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );

      const position = gl.getAttribLocation(program, 'a_position');
      if (position < 0) {
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(vertexArray);
        throw new FieldInitializationError(
          'program-link',
          'The field position attribute is unavailable.',
        );
      }
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const resolution = gl.getUniformLocation(program, 'u_resolution');
      const pointer = gl.getUniformLocation(program, 'u_pointer');
      const time = gl.getUniformLocation(program, 'u_time');
      const paper = gl.getUniformLocation(program, 'u_paper');
      const ink = gl.getUniformLocation(program, 'u_ink');

      if (!resolution || !pointer || !time || !paper || !ink) {
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(vertexArray);
        throw new FieldInitializationError(
          'program-link',
          'One or more field uniforms are unavailable.',
        );
      }

      gl.bindVertexArray(null);
      return {
        program,
        buffer,
        vertexArray,
        resolution,
        pointer,
        time,
        paper,
        ink,
      };
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
    }
  }

  private readPalette(): void {
    const styles = getComputedStyle(this.canvas);
    const paperValue =
      this.canvas.dataset.fieldPaper ??
      this.canvas.dataset.paper ??
      readCustomProperty(styles, [
        '--paper',
        '--color-paper',
        '--palette-paper',
      ]);
    const inkValue =
      this.canvas.dataset.fieldInk ??
      this.canvas.dataset.ink ??
      readCustomProperty(styles, ['--ink', '--color-ink', '--palette-ink']);

    this.paper = parseColor(paperValue, DEFAULT_PAPER);
    this.ink = parseColor(inkValue, DEFAULT_INK);
    this.canvas.dataset.fieldPalette =
      document.documentElement.dataset.palette ?? 'archive';
  }

  private getLayoutKey(): string {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.round((bounds.width || this.canvas.clientWidth) * 100);
    const height = Math.round((bounds.height || this.canvas.clientHeight) * 100);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR).toFixed(2);
    return `${width}x${height}@${dpr}`;
  }

  private resize(): void {
    const gl = this.gl;
    if (!gl) return;

    const bounds = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, bounds.width || this.canvas.clientWidth);
    const cssHeight = Math.max(1, bounds.height || this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const renderScale =
      this.quality === 'reduced'
        ? REDUCED_RENDER_SCALE
        : STANDARD_RENDER_SCALE;

    let width = Math.max(1, Math.floor(cssWidth * dpr * renderScale));
    let height = Math.max(1, Math.floor(cssHeight * dpr * renderScale));
    const edgeScale = Math.min(1, MAX_BUFFER_EDGE / Math.max(width, height));
    width = Math.max(1, Math.floor(width * edgeScale));
    height = Math.max(1, Math.floor(height * edgeScale));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    this.canvas.dataset.fieldDpr = dpr.toFixed(2);
    this.canvas.dataset.fieldScale = renderScale.toFixed(2);
    this.canvas.dataset.fieldResolution = `${width}x${height}`;
    this.layoutKey = this.getLayoutKey();
    this.needsResize = false;
  }

  private draw = (timestamp: number): void => {
    this.frame = 0;

    if (
      this.isDisposed ||
      this.isFallback ||
      this.isContextLost ||
      document.hidden ||
      !this.isIntersecting
    ) {
      this.syncLoop();
      return;
    }

    const gl = this.gl;
    const state = this.programState;
    if (!gl || !state) {
      this.enterFallback('initialization-failed');
      return;
    }

    const isStill = this.reducedMotion.matches;
    if (this.needsResize) this.resize();

    if (!isStill && this.previousTimestamp !== null) {
      const deltaMilliseconds = clamp(timestamp - this.previousTimestamp, 0, 100);
      this.elapsedSeconds += deltaMilliseconds * 0.001;
      this.trackFrameCost(deltaMilliseconds);
    }
    this.previousTimestamp = isStill ? null : timestamp;

    gl.useProgram(state.program);
    gl.bindVertexArray(state.vertexArray);
    gl.uniform2f(state.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(
      state.pointer,
      isStill ? 0 : this.pointerX,
      isStill ? 0 : this.pointerY,
    );
    gl.uniform1f(
      state.time,
      isStill ? STATIC_TIME_SECONDS : this.elapsedSeconds,
    );
    gl.uniform3f(state.paper, this.paper[0], this.paper[1], this.paper[2]);
    gl.uniform3f(state.ink, this.ink[0], this.ink[1], this.ink[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    this.frameCount += 1;
    if (isStill || this.frameCount % 30 === 0) {
      this.canvas.dataset.fieldFrames = String(this.frameCount);
    }

    if (isStill) {
      this.needsStillDraw = false;
      this.setStatus('still', 'reduced-motion');
      return;
    }

    this.setStatus('live', 'ready');
    this.frame = requestAnimationFrame(this.draw);
  };

  private trackFrameCost(deltaMilliseconds: number): void {
    if (this.quality === 'reduced') return;

    this.slowFrames =
      deltaMilliseconds > 30
        ? this.slowFrames + 1
        : Math.max(0, this.slowFrames - 2);

    if (this.slowFrames < 12) return;

    this.quality = 'reduced';
    this.slowFrames = 0;
    this.needsResize = true;
    this.canvas.dataset.fieldQuality = this.quality;
  }

  private syncLoop(reason = 'ready'): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.previousTimestamp = null;

    if (
      this.isDisposed ||
      this.isFallback ||
      this.isContextLost ||
      !this.programState
    ) {
      return;
    }

    if (document.hidden) {
      this.setStatus('paused', 'hidden');
      return;
    }

    if (!this.isIntersecting) {
      this.setStatus('paused', 'offscreen');
      return;
    }

    if (this.reducedMotion.matches) {
      this.setStatus('still', 'reduced-motion');
      if (!this.needsStillDraw && this.frameCount > 0) return;
    } else {
      this.setStatus('live', reason);
    }
    this.frame = requestAnimationFrame(this.draw);
  }

  private enterFallback(reason: FallbackReason): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.previousTimestamp = null;
    this.isFallback = true;
    this.showRenderer('poster');
    this.disposeProgram();
    this.setStatus('fallback', reason);
  }

  private showRenderer(renderer: 'webgl2' | 'poster'): void {
    this.canvas.dataset.fieldRenderer = renderer;
    this.canvas.hidden = renderer === 'poster';

    if (this.poster) {
      this.poster.hidden = renderer === 'webgl2';
      this.poster.dataset.fieldRenderer = renderer;
    }

    if (this.figure) {
      this.figure.dataset.fieldRenderer = renderer;
    }
  }

  private setStatus(status: FieldStatus, reason: string): void {
    const renderer = (this.canvas.dataset.fieldRenderer ??
      'pending') as StatusDetail['renderer'];
    const motion = this.reducedMotion.matches ? 'still' : 'live';
    const changed =
      this.canvas.dataset.fieldStatus !== status ||
      this.canvas.dataset.fieldReason !== reason ||
      this.canvas.dataset.fieldMotion !== motion;

    this.canvas.dataset.fieldStatus = status;
    this.canvas.dataset.fieldState = status;
    this.canvas.dataset.fieldReason = reason;
    this.canvas.dataset.fieldMotion = motion;
    this.canvas.dataset.fieldActive = String(
      status === 'live' || status === 'still',
    );
    this.canvas.dataset.fieldAnimating = String(status === 'live');

    if (this.figure) {
      this.figure.dataset.fieldStatus = status;
      this.figure.dataset.fieldState = status;
      this.figure.dataset.fieldReason = reason;
    }

    if (this.statusNode) {
      this.statusNode.textContent =
        status === 'live'
          ? 'LIVE'
          : status === 'still'
            ? 'STATIC'
            : status === 'paused'
              ? 'PAUSED'
              : status === 'fallback'
                ? 'FALLBACK'
                : 'INITIALIZING';
      this.statusNode.dataset.fieldReason = reason;
      this.statusNode.dataset.fieldState = status;
    }

    if (!changed) return;

    const detail: StatusDetail = {
      status,
      reason,
      renderer,
      motion,
    };
    this.canvas.dispatchEvent(
      new CustomEvent<StatusDetail>('recursive-field:status', {
        bubbles: true,
        detail,
      }),
    );
  }

  private disposeProgram(): void {
    const gl = this.gl;
    const state = this.programState;
    this.programState = null;

    if (!gl || !state || gl.isContextLost()) return;
    gl.deleteBuffer(state.buffer);
    gl.deleteVertexArray(state.vertexArray);
    gl.deleteProgram(state.program);
  }

  private onIntersection = (entries: IntersectionObserverEntry[]): void => {
    const entry = entries.find(
      (candidate) => candidate.target === this.visibilityTarget,
    );
    if (!entry) return;

    const wasIntersecting = this.isIntersecting;
    this.isIntersecting = entry.isIntersecting;
    this.canvas.dataset.fieldVisible = String(this.isIntersecting);
    if (wasIntersecting === this.isIntersecting) return;
    this.syncLoop(this.isIntersecting ? 'visible' : 'offscreen');
  };

  private onResize = (): void => {
    const nextLayoutKey = this.getLayoutKey();
    if (nextLayoutKey === this.layoutKey && !this.needsResize) return;

    this.needsResize = true;
    this.needsStillDraw = true;
    if (this.reducedMotion.matches) this.syncLoop('resized');
  };

  private onWindowResize = (): void => {
    this.onResize();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.reducedMotion.matches) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    this.pointerX = clamp(
      ((event.clientX - bounds.left) / bounds.width - 0.5) * 2,
      -1,
      1,
    );
    this.pointerY = clamp(
      -((event.clientY - bounds.top) / bounds.height - 0.5) * 2,
      -1,
      1,
    );
  };

  private onPointerLeave = (): void => {
    this.pointerX = 0;
    this.pointerY = 0;
  };

  private onPaletteMutation = (): void => {
    this.readPalette();
    this.needsStillDraw = true;
    if (this.reducedMotion.matches) this.syncLoop('palette');
  };

  private onPaletteChange = (event: Event): void => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as PaletteChangeDetail | undefined)
        : undefined;

    if (detail?.paper && detail.ink) {
      this.paper = parseColor(detail.paper, this.paper);
      this.ink = parseColor(detail.ink, this.ink);
      if (detail.id) this.canvas.dataset.fieldPalette = detail.id;
      this.needsStillDraw = true;
      if (this.reducedMotion.matches) this.syncLoop('palette');
      return;
    }

    this.onPaletteMutation();
  };

  private onVisibilityChange = (): void => {
    this.syncLoop(document.hidden ? 'hidden' : 'visible');
  };

  private onMotionPreference = (): void => {
    this.canvas.dataset.fieldMotion = this.reducedMotion.matches
      ? 'still'
      : 'live';
    if (this.reducedMotion.matches) this.needsStillDraw = true;
    this.syncLoop('motion-preference');
  };

  private onConnectionChange = (): void => {
    this.canvas.dataset.fieldSaveData = String(this.saveData);
    if (this.saveData) {
      this.enterFallback('save-data');
    } else if (
      this.isFallback &&
      this.canvas.dataset.fieldReason === 'save-data'
    ) {
      this.initialize('save-data-disabled');
    }
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.isContextLost = true;
    this.programState = null;
    this.enterFallback('context-lost');
  };

  private onContextRestored = (): void => {
    this.isContextLost = false;
    this.gl = null;
    this.initialize('context-restored');
  };

  private onPageHide = (): void => {
    this.dispose();
  };

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    cancelAnimationFrame(this.frame);
    this.disposeProgram();
    this.intersectionObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.paletteObserver.disconnect();
    this.stage.removeEventListener('pointermove', this.onPointerMove);
    this.stage.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    );
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('palettechange', this.onPaletteChange);
    window.removeEventListener('portfolio:palettechange', this.onPaletteChange);
    this.reducedMotion.removeEventListener?.(
      'change',
      this.onMotionPreference,
    );
    this.connection?.removeEventListener?.(
      'change',
      this.onConnectionChange,
    );
    delete this.canvas.dataset.fieldInitialized;
  }
}

export function initializeRecursiveField(
  root: ParentNode = document,
): (() => void) | null {
  const canvas = root.querySelector<HTMLCanvasElement>(CANVAS_SELECTOR);
  if (!canvas || canvas.dataset.fieldInitialized === 'true') return null;

  const runtime = new RecursiveFieldRuntime(canvas);
  return () => runtime.dispose();
}

function boot(): void {
  initializeRecursiveField();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
