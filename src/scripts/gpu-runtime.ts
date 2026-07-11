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

type QualityTier = 'high' | 'low' | 'static';

interface EntityVisualState {
  x: number;
  y: number;
  width: number;
  height: number;
  gazeX: number;
  gazeY: number;
  elapsed: number;
  scatter: number;
  impact: number;
  enabled: boolean;
  released: boolean;
  static: boolean;
  status: string;
}

interface SharedVisualState {
  revision: number;
  pointer: { x: number; y: number; lastAt: number };
  entity: EntityVisualState | null;
}

declare global {
  interface Window {
    __ANDREW_VISUAL_STATE__?: SharedVisualState;
  }
}

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
  uniform vec2 uPointer;
  uniform vec4 uEntity;
  uniform vec2 uEntitySize;
  uniform vec4 uEntityMeta;
  uniform vec4 uPortals[3];
  uniform float uPortalCount;
  uniform float uGlitch;
  uniform float uReleasePulse;

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

  vec4 watcher(vec2 uv) {
    if (uEntityMeta.x < 0.5) return vec4(0.0);
    vec2 size = max(uEntitySize, vec2(0.02));
    vec2 p = (uv - uEntity.xy) / (size * 0.5);

    vec2 pointerDelta = uv - uPointer;
    float pointerDistance = length(pointerDelta * vec2(uResolution.x / uResolution.y, 1.0));
    float pointerPush = smoothstep(0.15, 0.0, pointerDistance);
    p += normalize(pointerDelta + vec2(0.0001)) * pointerPush * 0.16;

    float disruption = clamp(uEntityMeta.z + uEntityMeta.w + uReleasePulse, 0.0, 1.0);
    float rowNoise = hash21(vec2(floor((p.y + 1.0) * 30.0), floor(uTime * 17.0)));
    p.x += (rowNoise - 0.5) * disruption * 0.32;

    float blinkClock = mod(uTime + 0.31, 4.9);
    float blink = blinkClock > 4.52 && blinkClock < 4.72
      ? clamp(abs(blinkClock - 4.62) / 0.1, 0.06, 1.0)
      : 1.0;
    float eyeCurve = (0.205 + sin(uTime * 1.8) * 0.012) *
      sqrt(max(0.0, 1.0 - pow(abs(p.x) / 0.8, 1.72)));
    float upper = lineMask(abs(p.y - (0.02 - eyeCurve * blink)), 0.026);
    float lower = lineMask(abs(p.y - (0.02 + eyeCurve * blink)), 0.026);
    float lidEcho = lineMask(abs(p.y - (0.02 - eyeCurve * blink - 0.045)), 0.012) +
      lineMask(abs(p.y - (0.02 + eyeCurve * blink + 0.045)), 0.012);
    lidEcho *= step(abs(p.x), 0.72) * step(0.38, blink);

    vec2 irisCenter = vec2(uEntity.z * 0.105, 0.02 + uEntity.w * 0.075);
    vec2 irisVector = (p - irisCenter) / vec2(0.19, 0.2);
    float irisDistance = length(irisVector);
    float iris = lineMask(abs(irisDistance - 1.0), 0.075) +
      lineMask(abs(irisDistance - 0.69), 0.035);
    float irisSpokes = step(0.44, irisDistance) * step(irisDistance, 0.94) *
      step(0.86, abs(sin(atan(irisVector.y, irisVector.x) * 11.0 + uTime * 0.45)));
    float irisMicro = step(0.52, irisDistance) * step(irisDistance, 0.96) *
      step(0.9, abs(sin(atan(irisVector.y, irisVector.x) * 23.0 - uTime * 0.18)));
    float pupil = 1.0 - smoothstep(0.82, 1.0, length((p - irisCenter) / vec2(0.074, 0.128)));
    float glint = 1.0 - smoothstep(0.015, 0.032, length(p - irisCenter + vec2(0.032, 0.045)));
    float insideEye = step(abs(p.x), 0.79) * step(abs(p.y - 0.02), max(0.0, eyeCurve * blink - 0.012));
    float scleraGrain = insideEye * step(1.05, irisDistance) *
      step(0.72, hash21(floor((p + 1.0) * vec2(64.0, 52.0)) + floor(uTime * 9.0)));
    float scleraBands = insideEye * step(1.02, irisDistance) *
      step(0.92, abs(sin(p.x * 38.0 + p.y * 17.0 + uTime * 0.34)));

    float wingLift = sin(uTime * 1.05 + 0.7) * 0.065;
    float body = 0.0;
    body = max(body, lineMask(sdSegment(p, vec2(0.0, -0.31), vec2(sin(uTime * 0.63) * 0.026, -0.96)), 0.025));
    body = max(body, lineMask(sdSegment(p, vec2(-0.04, -0.72), vec2(-0.48, -0.43)), 0.022));
    body = max(body, lineMask(sdSegment(p, vec2(0.04, -0.72), vec2(0.48, -0.43)), 0.022));
    body = max(body, lineMask(sdSegment(p, vec2(-0.08, -0.9), vec2(-0.2, -0.68)), 0.016));
    body = max(body, lineMask(sdSegment(p, vec2(0.08, -0.9), vec2(0.2, -0.68)), 0.016));
    body = max(body, lineMask(sdSegment(p, vec2(-0.74, -0.04), vec2(-0.98, -0.23 - wingLift)), 0.025));
    body = max(body, lineMask(sdSegment(p, vec2(-0.72, 0.02), vec2(-0.99, 0.2 + wingLift)), 0.025));
    body = max(body, lineMask(sdSegment(p, vec2(-0.6, -0.22), vec2(-0.88, -0.43 - wingLift)), 0.018));
    body = max(body, lineMask(sdSegment(p, vec2(-0.6, 0.22), vec2(-0.87, 0.42 + wingLift)), 0.018));
    body = max(body, lineMask(sdSegment(p, vec2(0.74, -0.04), vec2(0.98, -0.23 - wingLift)), 0.025));
    body = max(body, lineMask(sdSegment(p, vec2(0.72, 0.02), vec2(0.99, 0.2 + wingLift)), 0.025));
    body = max(body, lineMask(sdSegment(p, vec2(0.6, -0.22), vec2(0.88, -0.43 - wingLift)), 0.018));
    body = max(body, lineMask(sdSegment(p, vec2(0.6, 0.22), vec2(0.87, 0.42 + wingLift)), 0.018));
    body = max(body, lineMask(sdSegment(p, vec2(-0.52, 0.29), vec2(0.0, 0.96)), 0.025));
    body = max(body, lineMask(sdSegment(p, vec2(0.52, 0.29), vec2(0.0, 0.96)), 0.025));
    body = max(body, lineMask(sdSegment(p, vec2(0.0, 0.38), vec2(0.0, 0.91)), 0.018));
    float halo = lineMask(abs(length(p / vec2(0.94, 0.6)) - 1.0), 0.018);
    halo *= step(0.28, hash21(floor((p + 1.0) * 44.0) + floor(uTime * 4.0)));
    body = max(body, halo);
    float innerOrbit = lineMask(abs(length(p / vec2(0.68, 0.43)) - 1.0), 0.012);
    float orbitAngle = atan(p.y / 0.6, p.x / 0.94);
    float orbitTicks = step(0.955, abs(sin(orbitAngle * 16.0 + uTime * 0.09))) *
      step(0.79, length(p / vec2(0.94, 0.6))) * step(length(p / vec2(0.94, 0.6)), 1.08);
    body = max(body, innerOrbit * 0.68);
    body = max(body, orbitTicks * 0.72);

    float grain = step(0.82, hash21(floor((p + 1.0) * 38.0) + floor(uTime * 8.0)));
    float outerRegion = step(0.55, abs(p.x)) * step(abs(p.x), 0.99) * step(abs(p.y), 0.45);
    body = max(body, grain * outerRegion * 0.8);

    float crawl = hash21(floor((p + 1.0) * vec2(72.0, 58.0)) + floor(uTime * 8.0));
    float fineCrawl = hash21(floor((p + 1.0) * vec2(118.0, 86.0)) + floor(uTime * 11.0));
    float crownSpan = 0.055 + clamp((p.y + 0.98) / 0.69, 0.0, 1.0) * 0.54;
    float crownFill = step(-0.98, p.y) * step(p.y, -0.29) * step(abs(p.x), crownSpan);
    crownFill *= 0.22 + step(0.36, abs(sin(p.x * 31.0 + p.y * 19.0 - uTime * 0.28))) * 0.43 + crawl * 0.28;
    float wingFill = exp(-pow((abs(p.x) - 0.7) / 0.27, 2.0) * 2.3) *
      exp(-pow((p.y + abs(p.x) * 0.09) / 0.37, 2.0) * 2.7);
    wingFill *= 0.3 + step(0.48, abs(sin(abs(p.x) * 37.0 + p.y * 23.0 + uTime * 0.34))) * 0.4 + crawl * 0.24;
    float lowerSpan = max(0.0, 0.49 * (1.0 - (p.y - 0.26) / 0.75));
    float lowerFill = step(0.26, p.y) * step(p.y, 0.98) * step(abs(p.x), lowerSpan);
    lowerFill *= 0.2 + step(0.53, abs(sin(p.x * 27.0 - p.y * 21.0 + uTime * 0.2))) * 0.42 + fineCrawl * 0.27;
    float faceVeil = exp(-dot(p / vec2(0.77, 0.39), p / vec2(0.77, 0.39)) * 1.7) * 0.24;

    float threshold = 0.14 + bayer4(gl_FragCoord.xy) * 0.76;
    float bodyField = clamp(body * 0.94 + crownFill + wingFill + lowerFill + faceVeil + outerRegion * grain * 0.22, 0.0, 1.0);
    float eyeField = clamp((upper + lower + lidEcho) * step(abs(p.x), 0.82) * 0.95 + insideEye * 0.18 + scleraBands * 0.32, 0.0, 1.0);
    float irisField = clamp(iris * 0.92 + irisSpokes * 0.8 + irisMicro * 0.58 + glint + (1.0 - smoothstep(0.3, 1.0, irisDistance)) * 0.26, 0.0, 1.0);
    float scleraField = clamp(scleraGrain * 0.68 + scleraBands * 0.46 + insideEye * smoothstep(0.92, 1.28, irisDistance) * 0.28, 0.0, 1.0);

    float pupilVoid = step(0.92, pupil);
    float eyeMask = step(threshold - 0.08, eyeField) * (1.0 - pupilVoid);
    float irisMask = step(threshold - 0.16, irisField) * (1.0 - pupilVoid);
    float scleraMask = step(threshold, scleraField) * (1.0 - pupilVoid);
    float bodyMask = step(threshold, bodyField);
    float materialStrength = max(bodyField, max(eyeField, max(irisField, scleraField)));
    float materialGate = step(0.27, materialStrength);
    eyeMask *= materialGate;
    irisMask *= materialGate;
    scleraMask *= materialGate;
    bodyMask *= materialGate;

    float scanGap = step(0.94, sin((p.y + uTime * 0.075) * 82.0)) *
      step(0.42, hash21(vec2(floor(p.y * 52.0), floor(uTime * 7.0))));
    float damagedRow = step(0.91, hash21(vec2(floor((p.y + 1.0) * 49.0), floor(uTime * 5.0)))) * 0.46;
    float signalHold = 1.0 - max(scanGap * 0.88, damagedRow);
    bodyMask *= signalHold;
    eyeMask *= 1.0 - scanGap * 0.48;
    irisMask *= 1.0 - scanGap * 0.3;
    scleraMask *= signalHold;

    vec3 bone = vec3(0.9, 0.88, 0.84);
    vec3 frost = vec3(0.73, 0.79, 0.78);
    vec3 signal = mix(bone, vec3(0.7, 0.48, 0.58), disruption * 0.62);
    vec3 color = bone * bodyMask * 0.72 + signal * eyeMask * 0.92 + frost * irisMask + bone * scleraMask * 0.44;
    float alpha = max(bodyMask * 0.74, max(eyeMask * 0.94, max(irisMask, scleraMask * 0.5)));
    alpha *= 1.0 - pupilVoid * 0.92;
    return vec4(color, alpha);
  }

  float captureField(vec2 local, float seed) {
    float t = uTime * 0.28 + seed;
    float radius = length(local / vec2(0.72, 0.86));
    float orbit = lineMask(abs(radius - 0.72), 0.025);
    float spine = lineMask(abs(local.x + sin(local.y * 5.0 + t) * 0.05), 0.026);
    float wings = exp(-pow((abs(local.x) - 0.48 - sin(t) * 0.07) / 0.28, 2.0) * 4.0) *
      exp(-pow((local.y + abs(local.x) * 0.24) / 0.16, 2.0) * 3.0);
    float feather = step(0.88, abs(sin(local.x * 31.0 + local.y * 13.0 - t))) * wings;
    float bloom = exp(-dot(local - vec2(sin(t) * 0.18, cos(t * 0.7) * 0.16),
      local - vec2(sin(t) * 0.18, cos(t * 0.7) * 0.16)) * 7.0);
    float tail = lineMask(abs(local.x + sin(local.y * 9.0 + t) * 0.04), 0.018) * step(-0.05, local.y);
    float filament = lineMask(abs(sin(local.x * 9.0 + local.y * 7.0 + t)), 0.07) * step(radius, 0.9);
    float noise = hash21(floor((local + 1.0) * 45.0) + floor(uTime * 7.0 + seed));
    return clamp(orbit * step(0.3, noise) + spine * 0.56 + wings * 0.76 + feather * 0.42 +
      bloom * 0.32 + tail * 0.38 + filament * 0.2 + step(0.88, noise) * 0.32, 0.0, 1.0);
  }

  float capturePlate(vec2 uv, vec2 center, vec2 size, float seed) {
    vec2 p = (uv - center) / size;
    float inside = step(abs(p.x), 1.0) * step(abs(p.y), 1.0);
    float tearRow = step(abs(p.y - sin(seed * 2.3) * 0.38), 0.07) * uGlitch;
    p.x += tearRow * (0.18 + hash21(vec2(seed, floor(uTime * 17.0))) * 0.22);
    float field = captureField(p, seed);
    float threshold = 0.18 + bayer4(gl_FragCoord.xy) * 0.64;
    float sideCorners = lineMask(abs(abs(p.x) - 0.94), 0.012) * step(0.69, abs(p.y));
    float topCorners = lineMask(abs(abs(p.y) - 0.94), 0.012) * step(0.69, abs(p.x));
    float frame = clamp(sideCorners + topCorners, 0.0, 1.0);
    float scanBreak = step(0.91, sin((p.y + uTime * 0.08) * 74.0)) * step(0.72, hash21(floor(p * 40.0) + seed));
    return inside * max(step(threshold, field), max(frame * 0.85, scanBreak * 0.35));
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

    float capture = 0.0;
    capture = max(capture, capturePlate(uv, vec2(0.015, 0.79), vec2(0.15, 0.13), 3.0));
    capture = max(capture, capturePlate(uv, vec2(0.985, 0.58), vec2(0.13, 0.23), 7.0));
    capture = max(capture, capturePlate(uv, vec2(0.1, 0.23), vec2(0.16, 0.12), 11.0));
    capture = max(capture, capturePlate(uv, vec2(0.88, 0.13), vec2(0.12, 0.09), 19.0));
    color += vec3(0.84, 0.83, 0.81) * capture * 0.42;
    alpha = max(alpha, capture * 0.36);

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

    vec4 entity = vec4(0.0);
    vec2 entityDistance = abs(uv - uEntity.xy);
    vec2 entityBounds = max(uEntitySize * 0.6, vec2(0.001));
    if (entityDistance.x <= entityBounds.x && entityDistance.y <= entityBounds.y) {
      entity = watcher(uv);
      float entityPresence = step(0.2, entity.a);
      entity *= entityPresence;
    }
    color = max(color, entity.rgb);
    alpha = max(alpha, entity.a);

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
  uniform float uReleasePulse;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    float rowNoise = hash21(vec2(floor(uv.y * 80.0), floor(uTime * 13.0)));
    float tear = step(0.82, rowNoise) * (uGlitch + uReleasePulse);
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
    gl_FragColor = combined;
  }
`;

const root = document.documentElement;
const canvas = document.getElementById('gpu-stage') as HTMLCanvasElement | null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
const forcedCanvas = new URLSearchParams(location.search).get('renderer') === 'canvas';

let restoreAttempts = 0;
let runtime: GpuRuntime | null = null;
let threeModule: typeof import('./three-adapter') | null = null;

function chooseQuality(): QualityTier {
  if (reducedMotion.matches || saveData) return 'static';
  if (innerWidth < 800 || (navigator.hardwareConcurrency || 8) <= 4) return 'low';
  return 'high';
}

function setRendererMode(mode: 'webgl' | 'canvas', quality = chooseQuality()) {
  root.dataset.renderer = mode;
  root.dataset.fxQuality = quality;
  window.dispatchEvent(new CustomEvent('andrew:renderer-change', { detail: { mode, quality } }));
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
  private sourceTarget: WebGLRenderTarget;
  private feedbackRead: WebGLRenderTarget;
  private feedbackWrite: WebGLRenderTarget;
  private quality: QualityTier;
  private viewport = { width: 1, height: 1, dpr: 1 };
  private elapsed = 0;
  private lastTime = 0;
  private lastRenderedAt = 0;
  private renderSamples = 0;
  private renderCost = 0;
  private cadenceStartedAt = 0;
  private cadenceFrames = 0;
  private slowLowWindows = 0;
  private portalDirty = true;
  private releasePulse = 0;
  private previousReleased = false;
  private previousEnabled = true;
  private glitch = 0;
  private glitchEndsAt = 0;
  private nextGlitchAt = 5.5;
  private stopped = true;
  private disposed = false;
  private portalElements: HTMLElement[];
  private onScroll = () => { this.portalDirty = true; };
  private onResize = () => { this.resize(); };
  private onVisibility = () => { document.hidden ? this.stop() : this.start(); };
  private onEntityState = () => {
    if (this.quality === 'static') this.renderFrame(0);
  };
  private onMotionChange = () => {
    this.setQuality(chooseQuality());
    this.start();
  };
  private themeObserver: MutationObserver;

  constructor(THREE: typeof import('./three-adapter'), stage: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.THREE = THREE;
    this.quality = chooseQuality();
    this.portalElements = [...document.querySelectorAll<HTMLElement>('.casefile-visual')].slice(0, 3);

    this.renderer = new THREE.WebGLRenderer({
      canvas: stage,
      context,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);

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
        uPointer: { value: new THREE.Vector2(0.5, 0.5) },
        uEntity: { value: new THREE.Vector4(0.72, 0.5, 0, 0) },
        uEntitySize: { value: new THREE.Vector2(0.28, 0.3) },
        uEntityMeta: { value: new THREE.Vector4(1, 0, 0, 0) },
        uPortals: { value: portals },
        uPortalCount: { value: 0 },
        uGlitch: { value: 0 },
        uReleasePulse: { value: 0 },
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
        uReleasePulse: { value: 0 },
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
    this.themeObserver = new MutationObserver(() => {
      if (this.quality === 'static') this.renderFrame(0);
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

  async initialise() {
    this.resize();
    const compile = this.renderer.compileAsync?.bind(this.renderer);
    if (compile) {
      await Promise.all([
        compile(this.sourceScene, this.camera),
        compile(this.feedbackScene, this.camera),
        compile(this.compositeScene, this.camera),
      ]);
    } else {
      this.renderer.compile(this.sourceScene, this.camera);
      this.renderer.compile(this.feedbackScene, this.camera);
      this.renderer.compile(this.compositeScene, this.camera);
    }
    this.clearFeedback();
    this.renderFrame(0);
    setRendererMode('webgl', this.quality);
    addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('resize', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    addEventListener('andrew:entity-state', this.onEntityState);
    reducedMotion.addEventListener?.('change', this.onMotionChange);
    this.themeObserver.observe(root, { attributes: true, attributeFilter: ['data-crt'] });
    this.start();
  }

  private resize() {
    if (this.disposed) return;
    this.quality = chooseQuality();
    const dpr = this.quality === 'high' ? Math.min(devicePixelRatio || 1, 1.5) : 1;
    this.viewport = { width: Math.max(1, innerWidth), height: Math.max(1, innerHeight), dpr };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.viewport.width, this.viewport.height, false);
    const drawingSize = new this.THREE.Vector2();
    this.renderer.getDrawingBufferSize(drawingSize);
    this.sourceTarget.setSize(Math.max(1, drawingSize.x), Math.max(1, drawingSize.y));
    const feedbackScale = this.quality === 'low' ? 0.35 : 0.5;
    const feedbackWidth = Math.max(1, Math.round(drawingSize.x * feedbackScale));
    const feedbackHeight = Math.max(1, Math.round(drawingSize.y * feedbackScale));
    this.feedbackRead.setSize(feedbackWidth, feedbackHeight);
    this.feedbackWrite.setSize(feedbackWidth, feedbackHeight);
    (this.feedbackMaterial.uniforms.uTexel.value as Vector2).set(1 / feedbackWidth, 1 / feedbackHeight);
    (this.sourceMaterial.uniforms.uResolution.value as Vector2).set(drawingSize.x, drawingSize.y);
    (this.compositeMaterial.uniforms.uResolution.value as Vector2).set(drawingSize.x, drawingSize.y);
    this.feedbackMaterial.uniforms.uDecay.value = this.quality === 'high' ? 0.92 : this.quality === 'low' ? 0.84 : 0;
    this.compositeMaterial.uniforms.uQuality.value = this.quality === 'high' ? 1 : 0;
    root.dataset.fxQuality = this.quality;
    this.portalDirty = true;
    this.clearFeedback();
  }

  private setQuality(quality: QualityTier) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.resize();
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
    const shared = window.__ANDREW_VISUAL_STATE__;
    const pointer = shared?.pointer;
    const pointerX = pointer && Number.isFinite(pointer.x) ? pointer.x / this.viewport.width : 0.5;
    const pointerY = pointer && Number.isFinite(pointer.y) ? 1 - pointer.y / this.viewport.height : 0.5;
    (this.sourceMaterial.uniforms.uPointer.value as Vector2).set(pointerX, pointerY);

    const entity = shared?.entity;
    if (entity) {
      if (entity.enabled !== this.previousEnabled) {
        this.previousEnabled = entity.enabled;
        this.releasePulse = 0;
        this.glitch = 0;
        this.clearFeedback();
      }
      const containedScale = entity.released ? 1 : 1.16;
      (this.sourceMaterial.uniforms.uEntity.value as Vector4).set(
        entity.x / this.viewport.width,
        1 - entity.y / this.viewport.height,
        entity.gazeX,
        -entity.gazeY,
      );
      (this.sourceMaterial.uniforms.uEntitySize.value as Vector2).set(
        entity.width * containedScale / this.viewport.width,
        entity.height * containedScale / this.viewport.height,
      );
      (this.sourceMaterial.uniforms.uEntityMeta.value as Vector4).set(
        entity.enabled ? 1 : 0,
        entity.released ? 1 : 0,
        entity.scatter,
        entity.impact,
      );
      if (entity.released !== this.previousReleased) {
        this.releasePulse = 1;
        this.previousReleased = entity.released;
        this.glitch = 1;
        this.glitchEndsAt = this.elapsed + 0.22;
      }
    }

    this.releasePulse = Math.max(0, this.releasePulse - delta * 1.45);
    if (this.elapsed >= this.nextGlitchAt && this.glitch <= 0) {
      this.glitch = 1;
      const duration = 0.12 + Math.random() * 0.12;
      this.glitchEndsAt = this.elapsed + duration;
      this.nextGlitchAt = this.elapsed + 5 + Math.random() * 4;
    }
    if (this.glitch > 0 && this.elapsed >= this.glitchEndsAt) this.glitch = 0;
    this.sourceMaterial.uniforms.uGlitch.value = this.glitch;
    this.feedbackMaterial.uniforms.uGlitch.value = this.glitch;
    this.sourceMaterial.uniforms.uReleasePulse.value = this.releasePulse;
    this.feedbackMaterial.uniforms.uReleasePulse.value = this.releasePulse;
    const crt = root.dataset.crt === 'off' ? 0 : 1;
    this.compositeMaterial.uniforms.uCrt.value = crt;
    this.updatePortals();
  }

  private renderFrame(delta: number) {
    if (this.disposed) return;
    const startedAt = performance.now();
    this.updateUniforms(delta);

    this.renderer.setRenderTarget(this.sourceTarget);
    this.renderer.clear();
    this.renderer.render(this.sourceScene, this.camera);

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

    if (this.quality === 'high') {
      this.renderSamples += 1;
      this.renderCost += performance.now() - startedAt;
      if (this.renderSamples >= 120) {
        const average = this.renderCost / this.renderSamples;
        this.renderSamples = 0;
        this.renderCost = 0;
        if (average > 12) this.setQuality('low');
      }
    }
  }

  private tick = (time: number) => {
    if (this.stopped || this.disposed || document.hidden) return;
    const interval = this.quality === 'low' ? 1000 / 30 : 1000 / 60;
    if (this.lastRenderedAt && time - this.lastRenderedAt < interval) return;
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
      if (this.quality === 'high' && fps < 45) {
        this.setQuality('low');
      } else if (this.quality === 'low' && fps < 22) {
        this.slowLowWindows += 1;
        if (this.slowLowWindows >= 2) {
          this.stop();
          setTimeout(() => {
            if (runtime !== this) return;
            this.dispose();
            runtime = null;
            setRendererMode('canvas');
          }, 0);
        }
      } else {
        this.slowLowWindows = 0;
      }
    }
  };

  start() {
    if (this.disposed) return;
    this.stopped = false;
    this.lastTime = 0;
    this.lastRenderedAt = 0;
    this.cadenceStartedAt = 0;
    this.cadenceFrames = 0;
    if (this.quality === 'static') {
      this.renderer.setAnimationLoop(null);
      this.renderFrame(0);
    } else {
      this.renderer.setAnimationLoop(this.tick);
    }
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
    removeEventListener('andrew:entity-state', this.onEntityState);
    reducedMotion.removeEventListener?.('change', this.onMotionChange);
    this.themeObserver.disconnect();
    this.sourceTarget.dispose();
    this.feedbackRead.dispose();
    this.feedbackWrite.dispose();
    this.sourceMaterial.dispose();
    this.feedbackMaterial.dispose();
    this.compositeMaterial.dispose();
    this.geometry.dispose();
    this.renderer.dispose();
  }
}

async function initialiseGpu() {
  if (!canvas || forcedCanvas) {
    setRendererMode('canvas');
    return;
  }

  const context = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true,
  });
  if (!context) {
    setRendererMode('canvas');
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
    setRendererMode('canvas');
  }
}

canvas?.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  runtime?.stop();
  setRendererMode('canvas');
});

canvas?.addEventListener('webglcontextrestored', () => {
  if (restoreAttempts >= 1) return;
  restoreAttempts += 1;
  runtime?.dispose();
  runtime = null;
  void initialiseGpu();
});

void initialiseGpu();
