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
import type { EntityForm, SpatialMode } from './entity/types';

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
  uniform vec4 uEvolution;
  uniform vec4 uCaptures[5];
  uniform float uCaptureSeeds[5];
  uniform vec4 uPortals[3];
  uniform float uPortalCount;
  uniform float uGlitch;
  uniform vec4 uSubstrate;
  uniform vec4 uPointer;

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

  mat2 rotate2d(float angle) {
    float cosine = cos(angle);
    float sine = sin(angle);
    return mat2(cosine, -sine, sine, cosine);
  }

  float recursiveSignalField(vec2 position, float time) {
    float energy = 0.0;
    float weight = 1.0;
    position *= rotate2d(0.18 * sin(time * 0.19));

    for (int iteration = 0; iteration < 6; iteration++) {
      float index = float(iteration);
      position = abs(position);
      position = position / clamp(dot(position, position), 0.12, 4.0) - vec2(0.79, 0.57);
      position *= rotate2d(0.48 + 0.08 * sin(time * 0.21 + index * 1.7));

      float radius = length(position);
      float shell = exp(-20.0 * abs(radius - (0.63 + 0.035 * sin(time * 0.34 + index))));
      float filaments = pow(
        0.5 + 0.5 * cos(10.0 * atan(position.y, position.x) + radius * 7.0 - time),
        7.0
      );
      energy += shell * (0.64 + 0.68 * filaments) / weight;
      weight *= 1.32;
    }

    return energy;
  }

  float ascensionVolume(vec2 position, float time) {
    float distanceFromCore = length(position);
    float angle = atan(position.y, abs(position.x) + 0.0001);
    vec2 folded = vec2(abs(position.x), position.y);
    float energy = 0.0;
    float weight = 1.0;

    for (int iteration = 0; iteration < 7; iteration++) {
      float index = float(iteration);
      folded = abs(folded);
      folded = folded / clamp(dot(folded, folded), 0.085, 4.2) - vec2(0.73, 0.54);
      folded *= rotate2d(0.42 + sin(time * 0.12 + index * 1.37) * 0.075);
      float radius = length(folded);
      float shell = exp(-19.0 * abs(radius - (0.58 + sin(time * 0.2 + index) * 0.028)));
      float filament = pow(0.5 + 0.5 * cos(
        atan(folded.y, folded.x) * 12.0 + radius * 8.5 - time * 0.46
      ), 9.0);
      energy += shell * (0.46 + filament * 0.82) / weight;
      weight *= 1.34;
    }

    float arches = pow(0.5 + 0.5 * cos(
      distanceFromCore * 34.0 - abs(angle) * 10.0 +
      sin(angle * 5.0 + time * 0.18) * 2.4
    ), 10.0);
    float ribs = pow(abs(cos(
      angle * 15.0 + distanceFromCore * 8.0 -
      sin(distanceFromCore * 7.0 - time * 0.23) * 2.0
    )), 18.0);
    float iris = exp(-8.0 * abs(distanceFromCore - (0.22 + sin(time * 0.26) * 0.014)));
    float coreVoid = smoothstep(0.075, 0.18, distanceFromCore);
    float envelope = 1.0 - smoothstep(0.52, 1.48, distanceFromCore);
    float volume = energy * 0.74 + arches * 0.42 + ribs * 0.24 + iris * 0.58;
    return tanh(volume * 1.2) * envelope * coreVoid;
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

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float valueNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    local = local * local * (3.0 - 2.0 * local);
    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  float fbm3(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    for (int octave = 0; octave < 3; octave++) {
      value += valueNoise(p) * amplitude;
      p = turn * p * 2.03 + vec2(17.17, 9.31);
      amplitude *= 0.5;
    }
    return value;
  }

  float topographicField(vec2 position, float time) {
    vec2 drift = vec2(time * 0.012, -time * 0.008);
    float warpA = fbm3(position * 0.58 + drift);
    float warpB = fbm3(position * 0.58 + vec2(8.7, 3.1) - drift);
    vec2 folded = position + (vec2(warpA, warpB) - 0.5) * 0.82;
    float terrain = fbm3(folded * 1.24 + vec2(0.0, time * 0.01));
    float majorDistance = abs(fract(terrain * 8.0 + position.y * 0.18) - 0.5);
    float fineDistance = abs(fract(terrain * 17.0 - position.x * 0.08) - 0.5);
    float major = 1.0 - smoothstep(0.025, 0.085, majorDistance);
    float fine = 1.0 - smoothstep(0.014, 0.052, fineDistance);
    vec2 markerCell = fract(position * 3.2) - 0.5;
    float marker = (1.0 - smoothstep(0.025, 0.1, length(markerCell)))
      * step(0.86, hash21(floor(position * 3.2)));
    return clamp(major * 0.82 + fine * 0.28 + marker * 0.48, 0.0, 1.0);
  }

  float gravityField(vec2 position, float time, vec2 attractor) {
    vec2 p = position - attractor * 0.18;
    p *= rotate2d(0.06 * sin(time * 0.14));
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float primary = pow(
      0.5 + 0.5 * cos(17.0 * log(radius + 0.14) - angle * 5.0 - time * 0.32),
      12.0
    );
    float counter = pow(
      0.5 + 0.5 * cos(27.0 * radius + angle * 7.0 + time * 0.23),
      18.0
    );
    float lens = 1.0 - smoothstep(
      0.018,
      0.065,
      abs(abs(p.y + sin(p.x * 3.2 + time * 0.12) * 0.035) - 0.17 / (radius + 0.24))
    );
    float photonRing = exp(-24.0 * abs(radius - (0.22 + sin(time * 0.18) * 0.012)));
    float envelope = (1.0 - smoothstep(0.3, 2.45, radius)) * smoothstep(0.07, 0.19, radius);
    return clamp(
      (primary * 0.68 + counter * 0.28 + lens * 0.42 + photonRing * 0.7) * envelope,
      0.0,
      1.0
    );
  }

  float neuralField(vec2 position, float time) {
    vec2 p = position * 2.32;
    vec2 cell = floor(p);
    vec2 local = fract(p) - 0.5;
    float nearest = 12.0;
    float secondNearest = 12.0;
    float identity = 0.0;

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 offset = vec2(float(x), float(y));
        vec2 random = hash22(cell + offset);
        vec2 node = offset + 0.34 * sin(time * 0.17 + random * 6.2831853) - local;
        float distanceSquared = dot(node, node);
        if (distanceSquared < nearest) {
          secondNearest = nearest;
          nearest = distanceSquared;
          identity = random.x;
        } else if (distanceSquared < secondNearest) {
          secondNearest = distanceSquared;
        }
      }
    }

    float edgeDistance = sqrt(secondNearest) - sqrt(nearest);
    float edge = 1.0 - smoothstep(0.025, 0.1, edgeDistance);
    float node = 1.0 - smoothstep(0.025, 0.11, sqrt(nearest));
    float pulse = pow(0.5 + 0.5 * sin(time * 0.7 - identity * 13.0), 7.0);
    float axonPulse = pow(0.5 + 0.5 * sin(time * 0.33 + cell.x * 1.7 - cell.y * 1.1), 11.0);
    return clamp(edge * (0.5 + axonPulse * 0.32) + node * (0.46 + pulse * 0.72), 0.0, 1.0);
  }

  float flowMemoryField(vec2 position, float time, float scrollVelocity) {
    float directionNoise = fbm3(position * 0.54 + vec2(time * 0.018, -time * 0.011));
    float angle = directionNoise * 6.2831853 + position.y * 0.36;
    vec2 direction = vec2(cos(angle), sin(angle));
    vec2 p = position + direction * (0.28 + abs(scrollVelocity) * 0.08);
    p += vec2(time * 0.012, -time * 0.018 - scrollVelocity * 0.08);
    float warp = fbm3(p * 0.82 + vec2(5.2, -3.7));
    float ribbon = pow(abs(sin(p.x * 7.4 + warp * 8.2 + p.y * 1.3)), 22.0);
    float counter = pow(abs(sin(p.y * 10.2 - warp * 5.4 - p.x * 0.8)), 30.0);
    vec2 moteCell = floor(p * 13.0);
    vec2 motePosition = fract(p * 13.0) - 0.5;
    float mote = (1.0 - smoothstep(0.025, 0.12, length(motePosition)))
      * step(0.92, hash21(moteCell + floor(time * 0.22)));
    return clamp(ribbon * 0.72 + counter * 0.24 + mote * 0.52, 0.0, 1.0);
  }

  float membraneField(vec2 position, float time) {
    vec2 p = position * 0.88;
    float warpA = fbm3(p * 0.78 + vec2(time * 0.012, -time * 0.01));
    float warpB = fbm3(p * 0.78 + vec2(4.4, -7.2) - vec2(time * 0.008, time * 0.014));
    p += (vec2(warpA, warpB) - 0.5) * 0.92;
    float activator = fbm3(p * 1.72 + vec2(time * 0.01, 0.0));
    float inhibitor = fbm3(p * 3.86 - vec2(0.0, time * 0.014));
    float reaction = activator - inhibitor * 0.72;
    float cellWall = 1.0 - smoothstep(0.022, 0.078, abs(reaction - 0.16));
    float secondaryWall = 1.0 - smoothstep(
      0.018,
      0.06,
      abs(fract((activator + inhibitor * 0.38) * 6.4) - 0.5)
    );
    float pores = pow(0.5 + 0.5 * cos(
      length(p) * 19.0 + atan(p.y, p.x) * 4.0 - time * 0.24
    ), 18.0);
    return clamp(cellWall * 0.76 + secondaryWall * 0.32 + pores * 0.2, 0.0, 1.0);
  }

  float substrateField(vec2 position, float phase, float time, float scrollVelocity, vec2 attractor) {
    if (phase < 1.0) {
      float blend = smoothstep(0.08, 0.92, phase);
      return mix(
        topographicField(position, time),
        gravityField(position, time, attractor),
        blend
      );
    }
    if (phase < 2.0) {
      float blend = smoothstep(0.08, 0.92, phase - 1.0);
      return mix(
        gravityField(position, time, attractor),
        neuralField(position, time),
        blend
      );
    }
    if (phase < 3.0) {
      float blend = smoothstep(0.08, 0.92, phase - 2.0);
      return mix(
        neuralField(position, time),
        flowMemoryField(position, time, scrollVelocity),
        blend
      );
    }
    if (phase < 4.0) {
      float blend = smoothstep(0.08, 0.92, phase - 3.0);
      return mix(
        flowMemoryField(position, time, scrollVelocity),
        membraneField(position, time),
        blend
      );
    }
    return membraneField(position, time);
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
    vec2 fieldPosition = vec2(local.x * 1.55, local.y);
    float fieldTime = uTime * 0.42 + seed * 0.31;
    float radius = length(fieldPosition);
    float angle = atan(fieldPosition.y, fieldPosition.x);
    float recursive = recursiveSignalField(
      vec2(abs(fieldPosition.x), fieldPosition.y) * 1.06,
      fieldTime
    );

    float rings = 0.5 + 0.5 * cos(
      31.0 * log(radius + 0.17)
      - 10.0 * angle
      - 1.35 * fieldTime
      + 2.6 * sin(3.0 * angle + fieldTime * 0.24)
    );
    rings = pow(rings, 8.0) * exp(-0.38 * radius);

    float counterRings = 0.5 + 0.5 * cos(
      26.0 * radius
      + 8.0 * angle
      + 0.82 * fieldTime
      + 2.0 * sin(5.0 * angle - fieldTime * 0.31)
    );
    counterRings = pow(counterRings, 11.0);

    float spokes = pow(
      abs(cos(angle * 12.0 + 2.4 * sin(radius * 5.0 - fieldTime * 0.46))),
      24.0
    );
    float iris = exp(-6.0 * abs(radius - (0.24 + 0.025 * sin(fieldTime * 0.6))));
    float core = exp(-7.5 * radius) * (0.55 + 0.45 * cos(angle * 8.0 + fieldTime));
    float outerFade = 1.0 - smoothstep(0.22, 1.65, radius);
    float value = (
      recursive * 0.54
      + rings * 0.46
      + counterRings * 0.22
      + spokes * (0.1 + 0.3 * (1.0 - smoothstep(0.2, 1.5, radius)))
      + iris * 0.38
      + core * 0.24
    ) * outerFade;

    return smoothstep(0.16, 0.93, value);
  }

  vec2 capturePlate(vec2 uv, vec2 center, vec2 size, float seed) {
    vec2 p = (uv - center) / max(size, vec2(0.0001));
    if (abs(p.x) > 1.04 || abs(p.y) > 1.04) return vec2(0.0);
    float entityDistance = length((center - uEntity.xy) * vec2(uResolution.x / uResolution.y, 1.0));
    float entityNear = uEntityMeta.y * (1.0 - smoothstep(
      0.035,
      0.2,
      entityDistance
    ));
    float ascensionNear = uEvolution.y * (1.0 - smoothstep(0.1, 0.72, entityDistance));
    entityNear = max(entityNear, ascensionNear);
    vec2 entityLocal = (uEntity.xy - center) / size;
    float wakeRadius = fract(uTime * 0.52 + seed * 0.037) * 1.42;
    float wake = lineMask(abs(length(p - entityLocal) - wakeRadius), 0.024) * entityNear;
    p.x += sin(p.y * 24.0 - uTime * 4.2) * entityNear * 0.045;
    float inside = step(abs(p.x), 1.0) * step(abs(p.y), 1.0);
    float tearRow = step(abs(p.y - sin(seed * 2.3) * 0.38), 0.07) * uGlitch;
    p.x += tearRow * (0.18 + hash21(vec2(seed, floor(uTime * 17.0))) * 0.22);
    float field = captureField(p, seed);
    if (ascensionNear > 0.001) {
      float infection = ascensionVolume(p * 0.86, uTime * 0.46 + seed * 0.17);
      field = max(field, infection * ascensionNear * 1.24);
    }
    float threshold = 0.18 + bayer4(gl_FragCoord.xy) * 0.64 - entityNear * 0.12 - ascensionNear * 0.16;
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

    if (uSubstrate.w > 0.001) {
      float aspect = uResolution.x / max(1.0, uResolution.y);
      vec2 position = (uv - 0.5) * 2.0;
      position.x *= aspect;
      position.y += uSubstrate.z * 0.42;

      vec2 entityPosition = (uEntity.xy - 0.5) * 2.0;
      entityPosition.x *= aspect;
      entityPosition.y += uSubstrate.z * 0.42;
      vec2 pointerPosition = (uPointer.xy - 0.5) * 2.0;
      pointerPosition.x *= aspect;
      pointerPosition.y += uSubstrate.z * 0.42;

      vec2 entityDelta = position - entityPosition;
      vec2 pointerDelta = position - pointerPosition;
      float entityReach = exp(-dot(entityDelta, entityDelta) * 1.55);
      float pointerReach = exp(-dot(pointerDelta, pointerDelta) * 1.9) * uPointer.z;
      vec2 entityCurl = vec2(-entityDelta.y, entityDelta.x)
        * entityReach
        * (0.045 + uEvolution.z * 0.1);
      vec2 pointerCurl = vec2(-pointerDelta.y, pointerDelta.x) * pointerReach * 0.055;
      vec2 warpedPosition = position + entityCurl + pointerCurl;

      float substrateTime = uTime * uPointer.w;
      float field = substrateField(
        warpedPosition,
        clamp(uSubstrate.x, 0.0, 4.0),
        substrateTime,
        uSubstrate.y,
        mix(entityPosition, pointerPosition, uPointer.z * 0.24)
      );
      float wake = (entityReach * (0.2 + uEntityMeta.y * 0.22) + pointerReach * 0.12)
        * (0.4 + field);
      float density = clamp(field * (0.82 + uEvolution.y * 0.24) + wake, 0.0, 1.0);
      float threshold = 0.31 + bayer4(gl_FragCoord.xy) * 0.62;
      float substrateInk = step(threshold, density) * uSubstrate.w;
      float accentInk = step(
        0.64 + bayer4(gl_FragCoord.yx + vec2(1.0, 3.0)) * 0.3,
        density * (0.72 + entityReach * 0.45 + uEvolution.y * 0.38)
      ) * uSubstrate.w;

      color += vec3(0.72, 0.73, 0.72) * substrateInk * 0.4;
      color += vec3(0.56, 0.31, 0.43) * accentInk * (0.22 + uEvolution.y * 0.12);
      alpha = max(alpha, substrateInk * (0.13 + uEvolution.y * 0.045));
      alpha = max(alpha, accentInk * (0.12 + uEvolution.y * 0.05));
    }

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

    if (uEvolution.y > 0.001) {
      float aspect = uResolution.x / max(1.0, uResolution.y);
      vec2 delta = uv - uEntity.xy;
      delta.x *= aspect;
      float fieldScale = max(0.14, max(uEntity.z * aspect, uEntity.w) * 0.7);
      vec2 fieldPosition = delta / fieldScale;
      float volume = ascensionVolume(fieldPosition, uTime);
      float threshold = 0.12 + bayer4(gl_FragCoord.xy) * 0.58;
      float signal = step(threshold, volume * uEvolution.y);
      float core = exp(-26.0 * dot(fieldPosition, fieldPosition)) * uEvolution.y;
      color += vec3(0.88, 0.88, 0.85) * signal * (0.34 + uEvolution.y * 0.34);
      color += vec3(0.62, 0.36, 0.48) * max(core, signal * uEvolution.y * 0.12);
      alpha = max(alpha, signal * (0.2 + uEvolution.y * 0.46));
      alpha = max(alpha, core * 0.48);
    }

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
const substratePhaseByMode: Record<string, number> = {
  contours: 0,
  gravity: 1,
  neural: 2,
  flow: 3,
  membrane: 4,
};
const substrateLabels = ['TOPOGRAPHIC', 'GRAVITY_WELL', 'NEURAL_LATTICE', 'FLOW_MEMORY', 'LIVING_MEMBRANE'] as const;

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
  private previousEntityForm: EntityForm = 'SIGNAL';
  private previousEnabled = true;
  private glitch = 0;
  private glitchEndsAt = 0;
  private nextGlitchAt = 5.5;
  private stopped = true;
  private disposed = false;
  private portalElements: HTMLElement[];
  private specimenElements: Array<HTMLElement | null>;
  private sectionElements: HTMLElement[];
  private substrateAnchors: Array<{ center: number; phase: number }> = [];
  private substratePhase = 0;
  private substrateScrollVelocity = 0;
  private substrateLastScrollY = scrollY;
  private substrateStatus = '';
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
  private onSubstrateState = () => {
    this.clearFeedback();
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
    this.sectionElements = [...document.querySelectorAll<HTMLElement>('[data-section]')].slice(0, 5);

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
        uEvolution: { value: new THREE.Vector4() },
        uCaptures: { value: captures },
        uCaptureSeeds: { value: specimenCaptures.map(({ seed }) => seed) },
        uPortals: { value: portals },
        uPortalCount: { value: 0 },
        uGlitch: { value: 0 },
        uSubstrate: { value: new THREE.Vector4(0, 0, 0, 0.8) },
        uPointer: { value: new THREE.Vector4(0.5, 0.5, 0, this.quality === 'static' ? 0 : 1) },
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
    addEventListener('andrew:substrate-change', this.onSubstrateState);
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
    this.refreshSubstrateAnchors();
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

  private refreshSubstrateAnchors() {
    this.substrateAnchors = this.sectionElements
      .filter((section) => section.isConnected)
      .map((section, index) => {
        const rect = section.getBoundingClientRect();
        return {
          center: scrollY + rect.top + rect.height * 0.5,
          phase: Math.min(index, substrateLabels.length - 1),
        };
      });
  }

  private substratePhaseForScroll() {
    if (!this.substrateAnchors.length) return 0;
    const focus = scrollY + this.viewport.height * 0.46;
    const first = this.substrateAnchors[0];
    if (focus <= first.center) return first.phase;

    for (let index = 1; index < this.substrateAnchors.length; index += 1) {
      const previous = this.substrateAnchors[index - 1];
      const next = this.substrateAnchors[index];
      if (focus > next.center) continue;
      const distance = Math.max(1, next.center - previous.center);
      const progress = Math.min(1, Math.max(0, (focus - previous.center) / distance));
      return previous.phase + (next.phase - previous.phase) * progress;
    }

    return this.substrateAnchors[this.substrateAnchors.length - 1].phase;
  }

  private updateSubstrate(delta: number) {
    const mode = root.dataset.substrate || 'auto';
    const targetPhase = mode === 'auto'
      ? this.substratePhaseForScroll()
      : substratePhaseByMode[mode] ?? this.substratePhaseForScroll();
    const smoothing = this.quality === 'static'
      ? 1
      : 1 - Math.exp(-Math.max(delta, 1 / 120) * 4.2);
    this.substratePhase += (targetPhase - this.substratePhase) * smoothing;

    const nextScrollY = scrollY;
    const scrollDelta = (nextScrollY - this.substrateLastScrollY) / Math.max(1, this.viewport.height);
    const rawVelocity = Math.max(-2, Math.min(2, scrollDelta / Math.max(delta, 1 / 60)));
    const velocitySmoothing = 1 - Math.exp(-Math.max(delta, 1 / 120) * 7);
    this.substrateScrollVelocity += (rawVelocity - this.substrateScrollVelocity) * velocitySmoothing;
    this.substrateLastScrollY = nextScrollY;

    const pointer = window.__ANDREW_VISUAL_STATE__?.pointer;
    const pointerX = Math.min(1, Math.max(0, (pointer?.x ?? this.viewport.width * 0.5) / this.viewport.width));
    const pointerY = 1 - Math.min(1, Math.max(0, (pointer?.y ?? this.viewport.height * 0.5) / this.viewport.height));
    const pointerActivity = pointer?.lastAt
      ? Math.exp(-(performance.now() - pointer.lastAt) / 2600)
      : 0;
    const motion = reducedMotion.matches || this.quality === 'static' ? 0 : 1;
    const strength = mode === 'off'
      ? 0
      : this.quality === 'high' ? 0.9 : this.quality === 'low' ? 0.76 : 0.62;

    (this.sourceMaterial.uniforms.uSubstrate.value as Vector4).set(
      this.substratePhase,
      this.substrateScrollVelocity,
      nextScrollY / Math.max(1, this.viewport.height),
      strength,
    );
    (this.sourceMaterial.uniforms.uPointer.value as Vector4).set(
      pointerX,
      pointerY,
      pointerActivity,
      motion,
    );

    const resolvedIndex = Math.max(0, Math.min(substrateLabels.length - 1, Math.round(this.substratePhase)));
    const nextStatus = mode === 'off' ? 'DORMANT' : substrateLabels[resolvedIndex];
    root.dataset.substratePhase = String(resolvedIndex);
    root.dataset.substrateResolved = mode === 'off' ? 'off' : Object.keys(substratePhaseByMode)[resolvedIndex];
    if (nextStatus !== this.substrateStatus) {
      this.substrateStatus = nextStatus;
      document.querySelectorAll<HTMLElement>('[data-substrate-status]').forEach((element) => {
        element.textContent = nextStatus;
      });
    }
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
        entity.entityWidth / this.viewport.width,
        entity.entityHeight / this.viewport.height,
      );
      (this.sourceMaterial.uniforms.uEntityMeta.value as Vector4).set(
        0,
        entity.released ? 1 : 0,
        entity.internal.entropy,
        entity.interactionEnergy,
      );
      (this.sourceMaterial.uniforms.uEvolution.value as Vector4).set(
        entity.reconstructionStrength,
        entity.ascensionStrength,
        entity.realityContact,
        entity.ascensionPhase,
      );
      if (entity.spatialMode !== this.previousSpatialMode || entity.entityForm !== this.previousEntityForm) {
        this.emergencePulse = 1;
        this.previousSpatialMode = entity.spatialMode;
        this.previousEntityForm = entity.entityForm;
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
    this.updateSubstrate(delta);
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
    removeEventListener('andrew:substrate-change', this.onSubstrateState);
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
