import type {
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { EntityParticleField } from './entity-particle-field';
import { entityRuntime } from './entity/runtime';
import type { SpatialMode } from './entity/types';

type QualityTier = 'high' | 'low' | 'static';

declare global {
  interface Window {
    __ANDREW_GPU_DISPOSE__?: () => void;
  }
}

window.__ANDREW_GPU_DISPOSE__?.();
delete window.__ANDREW_GPU_DISPOSE__;

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const SOURCE_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec4 uEntity;
  uniform vec4 uEntityMeta;
  uniform vec4 uCaptures[5];
  uniform float uCaptureSeeds[5];
  uniform vec4 uPortals[3];
  uniform float uPortalCount;
  uniform float uGlitch;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h);
  }

  float lineMask(float distanceValue, float widthValue) {
    return 1.0 - smoothstep(widthValue, widthValue + 0.018, distanceValue);
  }

  float bayer4(vec2 pixel) {
    vec2 p = mod(floor(pixel), 4.0);
    float x = p.x;
    float y = p.y;
    if (y < 1.0) {
      if (x < 1.0) return 0.0 / 16.0;
      if (x < 2.0) return 8.0 / 16.0;
      if (x < 3.0) return 2.0 / 16.0;
      return 10.0 / 16.0;
    }
    if (y < 2.0) {
      if (x < 1.0) return 12.0 / 16.0;
      if (x < 2.0) return 4.0 / 16.0;
      if (x < 3.0) return 14.0 / 16.0;
      return 6.0 / 16.0;
    }
    if (y < 3.0) {
      if (x < 1.0) return 3.0 / 16.0;
      if (x < 2.0) return 11.0 / 16.0;
      if (x < 3.0) return 1.0 / 16.0;
      return 9.0 / 16.0;
    }
    if (x < 1.0) return 15.0 / 16.0;
    if (x < 2.0) return 7.0 / 16.0;
    if (x < 3.0) return 13.0 / 16.0;
    return 5.0 / 16.0;
  }

  float captureField(vec2 local, float seed) {
    float t = uTime * 0.28 + seed;
    float noise = hash21(floor((local + 1.0) * 45.0) + floor(uTime * 7.0 + seed));
    if (seed < 5.0) {
      float discRadius = length(local / vec2(0.9, 0.3));
      float outerDisc = lineMask(abs(discRadius - 0.78), 0.026);
      float innerDisc = lineMask(abs(discRadius - 0.5), 0.02);
      float horizonRadius = length(local / vec2(0.19, 0.27));
      float horizon = lineMask(abs(horizonRadius - 1.0), 0.055);
      float accretion = lineMask(abs(local.y + sin(local.x * 7.0 + t) * 0.025), 0.022) * step(abs(local.x), 0.82);
      float lensing = lineMask(abs(length(local / vec2(0.48, 0.68)) - 1.0), 0.018) * step(0.24, noise);
      float starNoise = step(0.94, noise) * step(1.14, horizonRadius) * step(discRadius, 1.0);
      return clamp(outerDisc * 0.82 + innerDisc * 0.48 + horizon + accretion * 0.72 + lensing * 0.55 + starNoise * 0.34, 0.0, 1.0);
    }
    if (seed < 9.0) {
      float tower = step(abs(local.x), 0.24) * step(abs(local.y), 0.82);
      float taper = step(abs(local.x), 0.1 + (local.y + 1.0) * 0.16) * step(-0.88, local.y) * step(local.y, 0.72);
      float ribs = step(0.86, abs(sin(local.y * 31.0 + t))) * tower;
      float antenna = lineMask(sdSegment(local, vec2(0.0, -0.96), vec2(sin(t) * 0.08, -0.56)), 0.022);
      float sideSignal = lineMask(abs(abs(local.x) - 0.48), 0.018) * step(abs(local.y), 0.46);
      return clamp(taper * 0.5 + ribs * 0.74 + antenna + sideSignal * step(0.48, noise), 0.0, 1.0);
    }
    if (seed < 15.0) {
      float trunk = lineMask(abs(local.x + sin(local.y * 5.0 + t) * 0.07), 0.025) * step(-0.82, local.y);
      float branches = lineMask(sdSegment(local, vec2(0.0, -0.25), vec2(-0.68, 0.18)), 0.022);
      branches += lineMask(sdSegment(local, vec2(0.02, -0.05), vec2(0.72, 0.35)), 0.022);
      branches += lineMask(sdSegment(local, vec2(-0.02, 0.2), vec2(-0.56, 0.68)), 0.018);
      branches += lineMask(sdSegment(local, vec2(0.01, 0.3), vec2(0.5, 0.78)), 0.018);
      float spores = step(0.91, noise) * step(length(local), 0.94);
      return clamp(trunk * 0.86 + branches * 0.72 + spores * 0.52, 0.0, 1.0);
    }
    if (seed < 22.0) {
      float radius = length(local / vec2(0.76, 0.7));
      float rings = lineMask(abs(radius - 0.42), 0.018) + lineMask(abs(radius - 0.76), 0.018);
      float cross = lineMask(abs(local.x), 0.014) * step(abs(local.y), 0.88) + lineMask(abs(local.y), 0.014) * step(abs(local.x), 0.88);
      vec2 satelliteCenter = vec2(cos(t) * 0.56, sin(t) * 0.48);
      float satellite = 1.0 - smoothstep(0.035, 0.075, length(local - satelliteCenter));
      float ticks = step(0.94, abs(sin(atan(local.y, local.x) * 18.0 - t))) * step(0.66, radius) * step(radius, 0.9);
      return clamp(rings * step(0.26, noise) + cross * 0.46 + satellite + ticks * 0.62, 0.0, 1.0);
    }
    float galaxyRadius = length(local / vec2(0.94, 0.58));
    float galaxyAngle = atan(local.y, local.x);
    float spiral = lineMask(abs(sin(galaxyAngle * 2.0 - galaxyRadius * 10.0 + t * 0.3)), 0.085);
    spiral *= step(0.14, galaxyRadius) * step(galaxyRadius, 0.94);
    float core = exp(-dot(local / vec2(0.2, 0.12), local / vec2(0.2, 0.12)) * 2.2);
    float starField = step(0.93, noise) * step(galaxyRadius, 1.0);
    vec2 planetCenter = vec2(cos(t * 0.8) * 0.68, sin(t * 0.8) * 0.4);
    float planet = 1.0 - smoothstep(0.025, 0.065, length(local - planetCenter));
    return clamp(spiral * 0.82 + core + starField * 0.56 + planet, 0.0, 1.0);
  }

  vec2 capturePlate(vec2 uv, vec2 center, vec2 size, float seed) {
    vec2 p = (uv - center) / max(size, vec2(0.0001));
    if (abs(p.x) > 1.04 || abs(p.y) > 1.04) return vec2(0.0);
    float entityNear = uEntityMeta.y * (1.0 - smoothstep(
      0.035,
      0.2,
      length((center - uEntity.xy) * vec2(uResolution.x / uResolution.y, 1.0))
    ));
    vec2 entityLocal = (uEntity.xy - center) / size;
    float wakeRadius = fract(uTime * 0.52 + seed * 0.037) * 1.42;
    float wake = lineMask(abs(length(p - entityLocal) - wakeRadius), 0.024) * entityNear;
    p.x += sin(p.y * 24.0 - uTime * 4.2) * entityNear * 0.045;
    float inside = step(abs(p.x), 1.0) * step(abs(p.y), 1.0);
    float tearRow = step(abs(p.y - sin(seed * 2.3) * 0.38), 0.07) * uGlitch;
    p.x += tearRow * (0.18 + hash21(vec2(seed, floor(uTime * 17.0))) * 0.22);
    float field = captureField(p, seed);
    float threshold = 0.18 + bayer4(gl_FragCoord.xy) * 0.64 - entityNear * 0.12;
    float sideCorners = lineMask(abs(abs(p.x) - 0.94), 0.012) * step(0.69, abs(p.y));
    float topCorners = lineMask(abs(abs(p.y) - 0.94), 0.012) * step(0.69, abs(p.x));
    float frame = clamp(sideCorners + topCorners, 0.0, 1.0);
    float scanBreak = step(0.91, sin((p.y + uTime * 0.08) * 74.0)) * step(0.72, hash21(floor(p * 40.0) + seed));
    float mask = inside * max(step(threshold, field), max(frame * 0.85, max(scanBreak * 0.35, wake * 0.8)));
    return vec2(mask, mask * entityNear);
  }

  float portalPattern(vec2 p, int index) {
    float edge = step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
    if (index == 0) {
      vec2 grid = abs(fract(p * vec2(9.0, 6.0)) - 0.5);
      float lines = step(0.485, max(grid.x, grid.y)) * 0.18;
      float route = lineMask(abs(p.y - (0.5 + sin(p.x * 8.0 + uTime * 1.4) * 0.16)), 0.012);
      float pulse = exp(-pow(fract(p.x * 2.0 - uTime * 0.32) - 0.5, 2.0) * 90.0) * route;
      return edge * clamp(lines + route * 0.36 + pulse, 0.0, 1.0);
    }
    if (index == 1) {
      float result = 0.0;
      for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 center = vec2(
          fract(sin(fi * 17.3 + 1.4) * 73.1 + uTime * (0.018 + fi * 0.001)),
          fract(cos(fi * 11.7 + 2.1) * 51.4 + uTime * (0.014 + fi * 0.0012))
        );
        result += 1.0 - smoothstep(0.012, 0.026, length(p - center));
        result += lineMask(abs(length(p - center) - 0.08 - sin(uTime + fi) * 0.015), 0.006) * 0.24;
      }
      return edge * clamp(result, 0.0, 1.0);
    }
    float lane = floor(p.y * 7.0);
    float offset = fract(p.x * 5.0 - uTime * (0.18 + lane * 0.012));
    float token = step(0.12, offset) * step(offset, 0.48) * step(0.12, fract(p.y * 7.0)) * step(fract(p.y * 7.0), 0.72);
    float verify = lineMask(abs(p.x - (0.72 + sin(p.y * 18.0 + uTime) * 0.08)), 0.012);
    return edge * clamp(token * 0.62 + verify * 0.5, 0.0, 1.0);
  }

  void main() {
    vec2 uv = vUv;
    vec3 color = vec3(0.0);
    float alpha = 0.0;

    vec2 captureSignal = vec2(0.0);
    for (int i = 0; i < 5; i++) {
      vec4 captureRect = uCaptures[i];
      if (captureRect.z <= 0.0 || captureRect.w <= 0.0) continue;
      captureSignal = max(
        captureSignal,
        capturePlate(uv, captureRect.xy, captureRect.zw, uCaptureSeeds[i])
      );
    }
    color += vec3(0.84, 0.83, 0.81) * captureSignal.x * 0.42;
    color += vec3(0.66, 0.43, 0.55) * captureSignal.y * 0.62;
    alpha = max(alpha, captureSignal.x * 0.36);
    alpha = max(alpha, captureSignal.y * 0.68);

    for (int i = 0; i < 3; i++) {
      if (float(i) >= uPortalCount) continue;
      vec4 rect = uPortals[i];
      vec2 local = (uv - rect.xy) / max(rect.zw, vec2(0.0001));
      float portalInside = step(0.0, local.x) * step(local.x, 1.0) * step(0.0, local.y) * step(local.y, 1.0);
      float portalRow = step(0.8, hash21(vec2(floor(local.y * 44.0), floor(uTime * 17.0) + float(i) * 7.0))) * uGlitch * portalInside;
      local.x += (hash21(vec2(floor(local.y * 31.0), float(i) + floor(uTime * 13.0))) - 0.5) * portalRow * 0.2;
      float motif = portalPattern(local, i);
      float scanDrop = step(0.91, hash21(vec2(floor(local.y * 58.0), floor(uTime * 7.0) + float(i) * 3.0)));
      motif *= 1.0 - scanDrop * (0.26 + uGlitch * 0.34);
      motif += portalRow * step(0.62, hash21(floor(local * vec2(70.0, 46.0)))) * portalInside * 0.42;
      float threshold = 0.2 + bayer4(gl_FragCoord.xy) * 0.58;
      motif = step(threshold, motif);
      color += vec3(0.78, 0.79, 0.78) * motif * 0.48;
      alpha = max(alpha, motif * 0.38);
    }

    if (uGlitch > 0.01) {
      float row = step(0.78, hash21(vec2(floor(uv.y * 48.0), floor(uTime * 19.0))));
      color += row * uGlitch * vec3(0.18, 0.08, 0.13);
      alpha = max(alpha, row * uGlitch * 0.18);
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

const FEEDBACK_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uCurrent;
  uniform sampler2D uPrevious;
  uniform vec2 uTexel;
  uniform float uTime;
  uniform float uDecay;
  uniform float uGlitch;
  uniform float uEmergencePulse;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    float rowNoise = hash21(vec2(floor(uv.y * 80.0), floor(uTime * 13.0)));
    float tear = step(0.82, rowNoise) * (uGlitch + uEmergencePulse);
    vec2 drift = vec2((rowNoise - 0.5) * tear * 0.018, uTexel.y * 0.45);
    vec4 current = texture2D(uCurrent, uv);
    vec4 previous = texture2D(uPrevious, uv - drift);
    previous.rgb *= uDecay;
    previous.a *= uDecay * 0.975;
    vec4 result = max(current, previous);
    result.rgb += previous.rgb * tear * 0.16;
    gl_FragColor = result;
  }
`;

const COMPOSITE_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSource;
  uniform sampler2D uFeedback;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uCrt;
  uniform float uQuality;
  uniform float uLightTheme;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float bayer4(vec2 pixel) {
    vec2 p = mod(floor(pixel), 4.0);
    return fract((p.x * 0.5 + p.y * 0.75 + p.x * p.y * 0.25) * 0.5);
  }

  void main() {
    vec2 uv = vUv;
    float roll = sin((uv.y + uTime * 0.025) * 720.0) * 0.0003 * uCrt;
    vec4 source = texture2D(uSource, uv + vec2(roll, 0.0));
    vec4 feedback = texture2D(uFeedback, uv);
    vec4 combined = max(source, feedback * 0.72);
    float threshold = bayer4(gl_FragCoord.xy) * 0.055;
    combined.a = max(0.0, combined.a - threshold);
    float scan = 1.0 - (0.055 + 0.02 * uQuality) * uCrt * step(0.5, fract(gl_FragCoord.y * 0.5));
    float grain = (hash21(gl_FragCoord.xy + floor(uTime * 12.0)) - 0.5) * 0.025 * uCrt;
    combined.rgb = max(vec3(0.0), combined.rgb * scan + grain * combined.a);
    combined.rgb *= smoothstep(0.003, 0.025, combined.a);
    float warmSignal = smoothstep(0.015, 0.16, combined.r - combined.g);
    vec3 graphiteInk = vec3(0.025, 0.022, 0.025);
    vec3 frostInk = vec3(0.065, 0.06, 0.065);
    vec3 mauveInk = vec3(0.52, 0.31, 0.41);
    vec3 lightInk = mix(mix(graphiteInk, frostInk, 0.38), mauveInk, warmSignal);
    combined.rgb = mix(combined.rgb, lightInk, uLightTheme * step(0.002, combined.a));
    gl_FragColor = combined;
  }
`;

const root = document.documentElement;
const canvas = document.getElementById('gpu-stage') as HTMLCanvasElement | null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
const query = new URLSearchParams(location.search);
const forcedCanvas = query.get('renderer') === 'canvas';
const qualityOverride = query.get('quality');
const coarsePointer = matchMedia('(pointer: coarse)');
const specimenCaptures = [
  { kind: 'black-hole', seed: 3 },
  { kind: 'relay', seed: 7 },
  { kind: 'graph', seed: 11 },
  { kind: 'orbit', seed: 19 },
  { kind: 'galaxy', seed: 23 },
] as const;

let restoreAttempts = 0;
let lastRestoreAt = 0;
let runtime: GpuRuntime | null = null;
let threeModule: typeof import('./three-adapter') | null = null;

function chooseQuality(): QualityTier {
  if (reducedMotion.matches || saveData) return 'static';
  if (qualityOverride === 'high' || qualityOverride === 'low' || qualityOverride === 'static') return qualityOverride;
  if (coarsePointer.matches || innerWidth < 900 || (navigator.hardwareConcurrency || 8) <= 4) return 'low';
  return 'high';
}

function setRendererMode(mode: 'webgl' | 'canvas', quality = chooseQuality(), reason = 'ready') {
  root.dataset.renderer = mode;
  root.dataset.fxQuality = quality;
  root.dataset.fxReason = reason;
  window.dispatchEvent(new CustomEvent('andrew:renderer-change', { detail: { mode, quality, reason } }));
}

class GpuRuntime {
  private THREE: typeof import('./three-adapter');
  private renderer: WebGLRenderer;
  private camera: OrthographicCamera;
  private geometry: PlaneGeometry;
  private sourceScene: Scene;
  private feedbackScene: Scene;
  private compositeScene: Scene;
  private sourceMaterial: ShaderMaterial;
  private feedbackMaterial: ShaderMaterial;
  private compositeMaterial: ShaderMaterial;
  private particleField: EntityParticleField | null = null;
  private sourceTarget: WebGLRenderTarget;
  private feedbackRead: WebGLRenderTarget;
  private feedbackWrite: WebGLRenderTarget;
  private quality: QualityTier;
  private viewport = { width: 1, height: 1, dpr: 1 };
  private elapsed = 0;
  private lastTime = 0;
  private lastRenderedAt = 0;
  private cadenceStartedAt = 0;
  private cadenceFrames = 0;
  private slowActiveWindows = 0;
  private stableLowWindows = 0;
  private lastQualityChangeAt = performance.now();
  private wasIdle = false;
  private lastInteractionAt = performance.now();
  private resizeTimer = 0;
  private portalDirty = true;
  private specimenDirty = true;
  private staticRenderRequest = 0;
  private emergencePulse = 0;
  private previousSpatialMode: SpatialMode = 'SEALED';
  private previousEnabled = true;
  private glitch = 0;
  private glitchEndsAt = 0;
  private nextGlitchAt = 5.5;
  private stopped = true;
  private disposed = false;
  private portalElements: HTMLElement[];
  private specimenElements: Array<HTMLElement | null>;
  private onScroll = () => {
    this.portalDirty = true;
    this.specimenDirty = true;
    this.lastInteractionAt = performance.now();
    this.requestStaticRender();
  };
  private onResize = () => {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      const recommended = chooseQuality();
      if (recommended !== this.quality && (recommended === 'static' || (recommended === 'low' && this.quality === 'high'))) {
        this.setQuality(recommended, 'viewport-capability');
      } else {
        this.resize();
      }
      this.requestStaticRender();
    }, 180);
  };
  private onVisibility = () => { document.hidden ? this.stop() : this.start(); };
  private onPageHide = () => { this.stop(); };
  private onPageShow = () => { if (!document.hidden) this.start(); };
  private onEntityState = () => {
    this.clearFeedback();
    if (this.quality === 'static') this.renderFrame(0);
  };
  private onSpecimenState = () => {
    this.specimenDirty = true;
    this.requestStaticRender();
  };
  private onMotionChange = () => {
    this.setQuality(chooseQuality());
    this.start();
  };
  private onSessionOpen = () => {
    this.setQuality(chooseQuality(), 'session-open');
    this.start();
  };
  private themeObserver: MutationObserver;

  constructor(THREE: typeof import('./three-adapter'), stage: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.THREE = THREE;
    this.quality = chooseQuality();
    this.portalElements = [...document.querySelectorAll<HTMLElement>('.casefile-visual')].slice(0, 3);
    this.specimenElements = specimenCaptures.map(({ kind }) => {
      const specimen = document.querySelector<HTMLElement>(`[data-specimen="${kind}"]`);
      return specimen?.querySelector<HTMLElement>('[data-specimen-visual], .section-specimen__visual') || specimen;
    });

    this.renderer = new THREE.WebGLRenderer({
      canvas: stage,
      context,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: this.quality === 'high' ? 'high-performance' : 'default',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);

    const captures = specimenCaptures.map(() => new THREE.Vector4(-2, -2, 0, 0));
    const portals = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
    this.sourceMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: SOURCE_SHADER,
      transparent: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uEntity: { value: new THREE.Vector4(0.72, 0.5, 0, 0) },
        uEntityMeta: { value: new THREE.Vector4(1, 0, 0, 0) },
        uCaptures: { value: captures },
        uCaptureSeeds: { value: specimenCaptures.map(({ seed }) => seed) },
        uPortals: { value: portals },
        uPortalCount: { value: 0 },
        uGlitch: { value: 0 },
      },
    });

    this.feedbackMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FEEDBACK_SHADER,
      transparent: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCurrent: { value: null },
        uPrevious: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uDecay: { value: 0.92 },
        uGlitch: { value: 0 },
        uEmergencePulse: { value: 0 },
      },
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: COMPOSITE_SHADER,
      transparent: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSource: { value: null },
        uFeedback: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uCrt: { value: 1 },
        uQuality: { value: 1 },
        uLightTheme: { value: 0 },
      },
    });

    this.sourceScene = new THREE.Scene();
    this.feedbackScene = new THREE.Scene();
    this.compositeScene = new THREE.Scene();
    this.sourceScene.add(new THREE.Mesh(this.geometry, this.sourceMaterial));
    this.feedbackScene.add(new THREE.Mesh(this.geometry, this.feedbackMaterial));
    this.compositeScene.add(new THREE.Mesh(this.geometry, this.compositeMaterial));

    this.sourceTarget = this.makeTarget(1, 1);
    this.feedbackRead = this.makeTarget(1, 1);
    this.feedbackWrite = this.makeTarget(1, 1);
    this.createParticleField();
    this.themeObserver = new MutationObserver(() => {
      this.clearFeedback();
      this.requestStaticRender();
    });
  }

  private makeTarget(width: number, height: number): WebGLRenderTarget {
    return new this.THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      minFilter: this.THREE.LinearFilter,
      magFilter: this.THREE.LinearFilter,
      format: this.THREE.RGBAFormat,
      type: this.THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private createParticleField() {
    if (this.particleField) return;
    this.particleField = new EntityParticleField(
      this.THREE,
      this.renderer,
      entityRuntime.frame.quality,
      entityRuntime.frame.sessionSeed,
      entityRuntime.particlePoolId,
    );
    const initialTier = this.quality === 'static' ? 'static' : this.quality === 'low'
      ? (coarsePointer.matches ? 'mobile' : 'low')
      : entityRuntime.frame.quality;
    entityRuntime.setQuality(initialTier);
    const activeCount = this.particleField.setQuality(initialTier);
    entityRuntime.setActiveParticleCount(activeCount);
    root.dataset.entityParticles = String(activeCount);
    root.dataset.entityPool = entityRuntime.particlePoolId;
  }

  async initialise() {
    this.resize();
    const compile = this.renderer.compileAsync?.bind(this.renderer);
    if (compile) {
      await Promise.all([
        compile(this.sourceScene, this.camera),
        compile(this.feedbackScene, this.camera),
        compile(this.compositeScene, this.camera),
        ...(this.particleField ? [compile(this.particleField.scene, this.camera)] : []),
      ]);
    } else {
      this.renderer.compile(this.sourceScene, this.camera);
      this.renderer.compile(this.feedbackScene, this.camera);
      this.renderer.compile(this.compositeScene, this.camera);
      if (this.particleField) this.renderer.compile(this.particleField.scene, this.camera);
    }
    this.clearFeedback();
    this.renderFrame(0);
    setRendererMode('webgl', this.quality, this.quality === 'static' ? 'intro' : 'ready');
    addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('resize', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    addEventListener('pagehide', this.onPageHide);
    addEventListener('pageshow', this.onPageShow);
    addEventListener('andrew:entity-state', this.onEntityState);
    addEventListener('andrew:specimen-change', this.onSpecimenState);
    addEventListener('andrew:session-open', this.onSessionOpen);
    reducedMotion.addEventListener?.('change', this.onMotionChange);
    this.themeObserver.observe(root, { attributes: true, attributeFilter: ['data-crt', 'data-theme-resolved'] });
    this.start();
  }

  private resize() {
    if (this.disposed) return;
    const nextWidth = Math.max(1, innerWidth);
    const nextHeight = Math.max(1, innerHeight);
    const baseDpr = this.quality === 'high' ? Math.min(devicePixelRatio || 1, 1.5) : 1;
    const pixelBudgetDpr = Math.sqrt(2_000_000 / Math.max(1, nextWidth * nextHeight));
    const dpr = Math.min(baseDpr, pixelBudgetDpr);
    if (coarsePointer.matches && this.viewport.width === nextWidth && Math.abs(this.viewport.height - nextHeight) < 180) {
      this.viewport.height = nextHeight;
      this.portalDirty = true;
      this.specimenDirty = true;
      return;
    }
    this.viewport = { width: nextWidth, height: nextHeight, dpr };
    const renderScale = this.quality === 'high' ? 1 : this.quality === 'low' ? (coarsePointer.matches ? 0.62 : 0.75) : 0.55;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(
      Math.max(1, Math.round(this.viewport.width * renderScale)),
      Math.max(1, Math.round(this.viewport.height * renderScale)),
      false,
    );
    const drawingSize = new this.THREE.Vector2();
    this.renderer.getDrawingBufferSize(drawingSize);
    this.sourceTarget.setSize(Math.max(1, drawingSize.x), Math.max(1, drawingSize.y));
    const feedbackScale = this.quality === 'high' ? 0.5 : this.quality === 'low' ? 0.3 : 0.2;
    const feedbackWidth = Math.max(1, Math.round(drawingSize.x * feedbackScale));
    const feedbackHeight = Math.max(1, Math.round(drawingSize.y * feedbackScale));
    this.feedbackRead.setSize(feedbackWidth, feedbackHeight);
    this.feedbackWrite.setSize(feedbackWidth, feedbackHeight);
    (this.feedbackMaterial.uniforms.uTexel.value as Vector2).set(1 / feedbackWidth, 1 / feedbackHeight);
    (this.sourceMaterial.uniforms.uResolution.value as Vector2).set(drawingSize.x, drawingSize.y);
    (this.compositeMaterial.uniforms.uResolution.value as Vector2).set(drawingSize.x, drawingSize.y);
    this.particleField?.resize(drawingSize.x, drawingSize.y, this.viewport.width, this.viewport.height);
    this.feedbackMaterial.uniforms.uDecay.value = this.quality === 'high' ? 0.92 : this.quality === 'low' ? 0.84 : 0;
    this.compositeMaterial.uniforms.uQuality.value = this.quality === 'high' ? 1 : 0;
    root.dataset.fxQuality = this.quality;
    this.portalDirty = true;
    this.specimenDirty = true;
    this.clearFeedback();
  }

  private setQuality(quality: QualityTier, reason = 'adaptive') {
    if (quality === this.quality) return;
    this.quality = quality;
    this.lastQualityChangeAt = performance.now();
    this.slowActiveWindows = 0;
    this.stableLowWindows = 0;
    const particleTier = quality === 'static' ? 'static' : quality === 'low'
      ? (coarsePointer.matches ? 'mobile' : 'low')
      : entityRuntime.frame.quality === 'ultra' ? 'ultra' : 'high';
    entityRuntime.setQuality(particleTier);
    const activeCount = this.particleField?.setQuality(particleTier);
    if (activeCount) {
      entityRuntime.setActiveParticleCount(activeCount);
      root.dataset.entityParticles = String(activeCount);
    }
    this.resize();
    setRendererMode('webgl', this.quality, reason);
  }

  private clearFeedback() {
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.sourceTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.feedbackRead);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.feedbackWrite);
    this.renderer.clear();
    this.renderer.setRenderTarget(previous);
  }

  private requestStaticRender() {
    if (this.quality !== 'static' || this.disposed || this.staticRenderRequest) return;
    this.staticRenderRequest = requestAnimationFrame(() => {
      this.staticRenderRequest = 0;
      if (this.quality === 'static' && !this.disposed && !document.hidden) this.renderFrame(0);
    });
  }

  private updateSpecimens() {
    if (!this.specimenDirty) return;
    this.specimenDirty = false;
    const captures = this.sourceMaterial.uniforms.uCaptures.value as Vector4[];
    this.specimenElements.forEach((element, index) => {
      if (!element?.isConnected) {
        captures[index].set(-2, -2, 0, 0);
        return;
      }
      const rect = element.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < this.viewport.height && rect.right > 0 &&
        rect.left < this.viewport.width && rect.width > 0 && rect.height > 0;
      if (!visible) {
        captures[index].set(-2, -2, 0, 0);
        return;
      }
      captures[index].set(
        (rect.left + rect.width * 0.5) / this.viewport.width,
        1 - (rect.top + rect.height * 0.5) / this.viewport.height,
        rect.width * 0.5 / this.viewport.width,
        rect.height * 0.5 / this.viewport.height,
      );
    });
  }

  private updatePortals() {
    if (!this.portalDirty) return;
    this.portalDirty = false;
    const portals = this.sourceMaterial.uniforms.uPortals.value as Vector4[];
    let visibleCount = 0;
    this.portalElements.forEach((element, index) => {
      const rect = element.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < this.viewport.height && rect.width > 0 && rect.height > 0;
      if (!visible || (this.quality === 'low' && index === 2)) {
        portals[index].set(-2, -2, 0, 0);
        return;
      }
      portals[index].set(
        rect.left / this.viewport.width,
        1 - rect.bottom / this.viewport.height,
        rect.width / this.viewport.width,
        rect.height / this.viewport.height,
      );
      visibleCount = Math.max(visibleCount, index + 1);
    });
    this.sourceMaterial.uniforms.uPortalCount.value = visibleCount;
  }

  private updateUniforms(delta: number) {
    this.elapsed += Math.min(delta, 0.05);
    this.sourceMaterial.uniforms.uTime.value = this.elapsed;
    this.feedbackMaterial.uniforms.uTime.value = this.elapsed;
    this.compositeMaterial.uniforms.uTime.value = this.elapsed;
    const entity = entityRuntime.update(performance.now(), delta);
    if (entity) {
      if (entity.enabled !== this.previousEnabled) {
        this.previousEnabled = entity.enabled;
        this.emergencePulse = 0;
        this.glitch = 0;
        this.clearFeedback();
      }
      (this.sourceMaterial.uniforms.uEntity.value as Vector4).set(
        entity.anchor.x / this.viewport.width,
        1 - entity.anchor.y / this.viewport.height,
        entity.gazeOrientation.x,
        -entity.gazeOrientation.y,
      );
      (this.sourceMaterial.uniforms.uEntityMeta.value as Vector4).set(
        0,
        entity.released ? 1 : 0,
        entity.internal.entropy,
        entity.interactionEnergy,
      );
      if (entity.spatialMode !== this.previousSpatialMode) {
        this.emergencePulse = 1;
        this.previousSpatialMode = entity.spatialMode;
        this.glitch = 1;
        this.glitchEndsAt = this.elapsed + 0.22;
      }
      this.particleField?.update(
        entity,
        entityRuntime.getOccupancy(),
        delta,
        this.elapsed,
      );
    }

    this.emergencePulse = Math.max(0, this.emergencePulse - delta * 1.45);
    if (this.elapsed >= this.nextGlitchAt && this.glitch <= 0) {
      this.glitch = 1;
      const seededPhase = Math.abs(Math.sin(entity.sessionSeed * 0.000013 + this.elapsed * 0.71));
      const duration = 0.12 + seededPhase * 0.12;
      this.glitchEndsAt = this.elapsed + duration;
      this.nextGlitchAt = this.elapsed + 5 + Math.abs(Math.sin(entity.sessionSeed * 0.000031 + this.elapsed * 0.37)) * 4;
    }
    if (this.glitch > 0 && this.elapsed >= this.glitchEndsAt) this.glitch = 0;
    this.sourceMaterial.uniforms.uGlitch.value = this.glitch;
    this.feedbackMaterial.uniforms.uGlitch.value = this.glitch;
    this.feedbackMaterial.uniforms.uEmergencePulse.value = this.emergencePulse;
    const crt = root.dataset.crt === 'off' ? 0 : 1;
    this.compositeMaterial.uniforms.uCrt.value = crt;
    this.compositeMaterial.uniforms.uLightTheme.value = root.dataset.themeResolved === 'light' ? 1 : 0;
    this.updateSpecimens();
    this.updatePortals();
  }

  private renderFrame(delta: number) {
    if (this.disposed) return;
    this.updateUniforms(delta);

    this.renderer.setRenderTarget(this.sourceTarget);
    this.renderer.clear();
    this.renderer.render(this.sourceScene, this.camera);
    this.particleField?.render(this.sourceTarget, this.camera);

    if (this.quality !== 'static') {
      this.feedbackMaterial.uniforms.uCurrent.value = this.sourceTarget.texture;
      this.feedbackMaterial.uniforms.uPrevious.value = this.feedbackRead.texture;
      this.renderer.setRenderTarget(this.feedbackWrite);
      this.renderer.clear();
      this.renderer.render(this.feedbackScene, this.camera);
      [this.feedbackRead, this.feedbackWrite] = [this.feedbackWrite, this.feedbackRead];
    }

    this.compositeMaterial.uniforms.uSource.value = this.sourceTarget.texture;
    this.compositeMaterial.uniforms.uFeedback.value = this.feedbackRead.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.compositeScene, this.camera);
  }

  private tick = (time: number) => {
    if (this.stopped || this.disposed || document.hidden) return;
    const pointerLastAt = window.__ANDREW_VISUAL_STATE__?.pointer?.lastAt || 0;
    const idle = time - Math.max(this.lastInteractionAt, pointerLastAt) > 12000;
    const activeRate = this.quality === 'static' ? 8 : this.quality === 'low' ? (coarsePointer.matches ? 20 : 24) : 60;
    const requestedRate = this.quality === 'static' ? 8 : idle ? (this.quality === 'low' ? 10 : 20) : activeRate;
    if (idle !== this.wasIdle) {
      this.wasIdle = idle;
      this.cadenceStartedAt = time;
      this.cadenceFrames = 0;
      this.slowActiveWindows = 0;
      this.stableLowWindows = 0;
    }
    const interval = 1000 / requestedRate;
    if (this.lastRenderedAt && time - this.lastRenderedAt < interval - 0.5) return;
    const delta = this.lastTime ? (time - this.lastTime) / 1000 : 1 / 60;
    this.lastTime = time;
    this.lastRenderedAt = time;
    this.renderFrame(delta);

    if (!this.cadenceStartedAt) this.cadenceStartedAt = time;
    this.cadenceFrames += 1;
    const cadenceWindow = time - this.cadenceStartedAt;
    if (cadenceWindow >= 4000) {
      const fps = this.cadenceFrames / (cadenceWindow / 1000);
      this.cadenceStartedAt = time;
      this.cadenceFrames = 0;
      if (!idle && time - this.lastQualityChangeAt > 8000) {
        if (this.quality === 'high') {
          this.slowActiveWindows = fps < requestedRate * 0.72 ? this.slowActiveWindows + 1 : 0;
          if (this.slowActiveWindows >= 2) this.setQuality('low', 'adaptive-low');
        } else if (this.quality === 'low' && chooseQuality() === 'high') {
          this.stableLowWindows = fps >= requestedRate * 0.9 ? this.stableLowWindows + 1 : 0;
          if (this.stableLowWindows >= 6 && time - this.lastQualityChangeAt > 30000) {
            this.setQuality('high', 'adaptive-retry');
          }
        }
      }
    }
  };

  recoverContext() {
    if (this.disposed) return;
    this.resize();
    this.clearFeedback();
    this.renderFrame(0);
    setRendererMode('webgl', this.quality, 'context-restored');
    this.start();
  }

  start() {
    if (this.disposed) return;
    this.stopped = false;
    this.lastTime = 0;
    this.lastRenderedAt = 0;
    this.cadenceStartedAt = 0;
    this.cadenceFrames = 0;
    this.wasIdle = false;
    this.renderer.setAnimationLoop(this.tick);
  }

  stop() {
    this.stopped = true;
    this.renderer.setAnimationLoop(null);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    removeEventListener('scroll', this.onScroll);
    removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    removeEventListener('pagehide', this.onPageHide);
    removeEventListener('pageshow', this.onPageShow);
    removeEventListener('andrew:entity-state', this.onEntityState);
    removeEventListener('andrew:specimen-change', this.onSpecimenState);
    removeEventListener('andrew:session-open', this.onSessionOpen);
    reducedMotion.removeEventListener?.('change', this.onMotionChange);
    window.clearTimeout(this.resizeTimer);
    cancelAnimationFrame(this.staticRenderRequest);
    this.themeObserver.disconnect();
    this.sourceTarget.dispose();
    this.feedbackRead.dispose();
    this.feedbackWrite.dispose();
    this.sourceMaterial.dispose();
    this.feedbackMaterial.dispose();
    this.compositeMaterial.dispose();
    this.particleField?.dispose();
    this.particleField = null;
    this.geometry.dispose();
    this.renderer.dispose();
  }
}

async function initialiseGpu() {
  if (!canvas || forcedCanvas) {
    setRendererMode('canvas', chooseQuality(), forcedCanvas ? 'forced-canvas' : 'canvas-missing');
    return;
  }

  const context = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: chooseQuality() === 'high' ? 'high-performance' : 'default',
    failIfMajorPerformanceCaveat: true,
  });
  if (!context) {
    setRendererMode('canvas', chooseQuality(), 'webgl2-unavailable');
    return;
  }

  try {
    threeModule ||= await import('./three-adapter');
    runtime?.dispose();
    runtime = new GpuRuntime(threeModule, canvas, context);
    await runtime.initialise();
  } catch (error) {
    console.warn('[visual-runtime] WebGL initialisation failed; using Canvas fallback.', error);
    runtime?.dispose();
    runtime = null;
    setRendererMode('canvas', chooseQuality(), 'init-failed');
  }
}

const onContextLost = (event: Event) => {
  event.preventDefault();
  runtime?.stop();
  setRendererMode('canvas', chooseQuality(), 'context-lost');
  console.warn('[visual-runtime] WebGL context lost; waiting for browser restoration.');
};

const onContextRestored = () => {
  const now = performance.now();
  if (now - lastRestoreAt > 30000) restoreAttempts = 0;
  if (restoreAttempts >= 2) {
    setRendererMode('canvas', chooseQuality(), 'restore-limit');
    return;
  }
  restoreAttempts += 1;
  lastRestoreAt = now;
  window.setTimeout(() => {
    try {
      if (runtime) runtime.recoverContext();
      else void initialiseGpu();
    } catch (error) {
      console.warn('[visual-runtime] Context recovery failed; recreating renderer.', error);
      runtime?.dispose();
      runtime = null;
      void initialiseGpu();
    }
  }, 0);
};

canvas?.addEventListener('webglcontextlost', onContextLost);
canvas?.addEventListener('webglcontextrestored', onContextRestored);
function startInitialGpu() { void initialiseGpu(); }

const disposeGpuModule = () => {
  canvas?.removeEventListener('webglcontextlost', onContextLost);
  canvas?.removeEventListener('webglcontextrestored', onContextRestored);
  document.removeEventListener('DOMContentLoaded', startInitialGpu);
  runtime?.dispose();
  runtime = null;
};

window.__ANDREW_GPU_DISPOSE__ = disposeGpuModule;
import.meta.hot?.dispose(() => {
  if (window.__ANDREW_GPU_DISPOSE__ !== disposeGpuModule) return;
  disposeGpuModule();
  delete window.__ANDREW_GPU_DISPOSE__;
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startInitialGpu, { once: true });
} else {
  startInitialGpu();
}
