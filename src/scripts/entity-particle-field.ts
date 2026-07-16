import type {
  DataTexture,
  InstancedBufferGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { GPUComputationRenderer, Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { ENTITY_CONFIG } from './entity/config';
import { createGlyphAtlas, type GlyphAtlas } from './entity/glyph-atlas';
import { mix } from './entity/random';
import { progressiveParticleIndex } from './entity/sampling';
import { createFacelessHumanoidTopology } from './entity/topology';
import type { EntityRuntimeFrame, OccupancySnapshot, QualityTier, SpecimenKind } from './entity/types';

type ThreeAdapter = typeof import('./three-adapter');

const POSITION_SHADER = /* glsl */ `
  uniform float uDelta;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 positionSample = texture2D(texturePosition, uv);
    vec3 velocity = texture2D(textureVelocity, uv).xyz;
    positionSample.xyz += velocity * uDelta;
    positionSample.xy = clamp(positionSample.xy, vec2(-5.5), vec2(5.5));
    positionSample.z = clamp(positionSample.z, -1.4, 1.4);
    positionSample.w = mod(positionSample.w + uDelta, 4096.0);
    gl_FragColor = positionSample;
  }
`;

const VELOCITY_SHADER = /* glsl */ `
  precision highp float;
  uniform sampler2D uTarget;
  uniform sampler2D uListeningTarget;
  uniform sampler2D uProperties;
  uniform sampler2D uOccupancy;
  uniform vec2 uOccupancySize;
  uniform vec4 uEntity;
  uniform vec4 uContainmentRect;
  uniform vec4 uBehavior;
  uniform vec4 uState;
  uniform vec4 uGazeHead;
  uniform vec4 uPostureA;
  uniform vec4 uPostureB;
  uniform vec4 uDynamics;
  uniform vec4 uScroll;
  uniform vec4 uReach;
  uniform vec4 uEpisode;
  uniform vec4 uPointerField;
  uniform vec4 uPointerMotion;
  uniform vec4 uSpecimen;
  uniform vec2 uSpecimenDirection;
  uniform float uTime;
  uniform float uDelta;
  uniform float uFormBlend;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float simplexNoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
      i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m *= m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  vec2 rotateAround(vec2 point, vec2 pivot, float angle) {
    float cosine = cos(angle);
    float sine = sin(angle);
    vec2 local = point - pivot;
    return pivot + vec2(local.x * cosine - local.y * sine, local.x * sine + local.y * cosine);
  }

  float regionEquals(float region, float value) {
    return 1.0 - step(0.45, abs(region - value));
  }

  float specimenEquals(float value) {
    return 1.0 - step(0.45, abs(uSpecimen.x - value));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 positionSample = texture2D(texturePosition, uv);
    vec4 velocitySample = texture2D(textureVelocity, uv);
    vec4 targetSample = texture2D(uTarget, uv);
    vec4 listeningSample = texture2D(uListeningTarget, uv);
    vec4 properties = texture2D(uProperties, uv);
    vec3 positionValue = positionSample.xyz;
    vec3 velocityValue = velocitySample.xyz;
    float formBlend = smoothstep(0.0, 1.0, uFormBlend);
    vec3 target = mix(listeningSample.xyz, targetSample.xyz, formBlend);
    float region = floor(targetSample.w + 0.5);
    float baseBinding = properties.x;
    float inertia = properties.y;
    float responseDelay = properties.z;
    float curiosity = properties.w;
    float cohesion = clamp(uBehavior.x, 0.0, 1.0);
    float entropy = clamp(uBehavior.y, 0.0, 1.0);
    float formCoherence = clamp(uBehavior.z, 0.0, 1.0);
    float boundRatio = clamp(uBehavior.w, 0.0, 1.0);
    float spatialMode = uState.y;
    float transition = uState.z;
    float reducedMotion = uState.w;
    float attentionStrength = clamp(uEpisode.x, 0.0, 1.0);
    float inspectionStrength = clamp(uEpisode.y, 0.0, 1.0);
    float directionalBias = clamp(uEpisode.z, -1.0, 1.0);
    float specimenStrength = clamp(uSpecimen.y, 0.0, 1.0);

    float cranialCore = regionEquals(region, 0.0);
    float cranialEdge = regionEquals(region, 1.0);
    float lowerHead = regionEquals(region, 2.0);
    float head = cranialCore + cranialEdge + lowerHead;
    float neck = regionEquals(region, 3.0);
    float leftTrap = regionEquals(region, 4.0);
    float rightTrap = regionEquals(region, 5.0);
    float traps = leftTrap + rightTrap;
    float leftShoulder = regionEquals(region, 6.0);
    float rightShoulder = regionEquals(region, 7.0);
    float shoulders = leftShoulder + rightShoulder;
    float upperTorso = regionEquals(region, 8.0);
    float lowerTorso = regionEquals(region, 9.0);
    float plume = regionEquals(region, 10.0);
    float freeField = regionEquals(region, 11.0);
    float support = neck + traps + upperTorso;
    float body = head + support + shoulders + lowerTorso;

    // Attention is communicated by the whole blank cranial surface, followed by
    // delayed support and torso deformation. No localized feature targets exist.
    float surfaceResponse = (0.42 + (1.0 - responseDelay) * 0.58) * head;
    target.xy = mix(target.xy, rotateAround(target.xy, vec2(0.0, -0.08), uPostureA.x * 0.095), head);
    target.x += head * uGazeHead.z * (0.31 + target.z * 0.28);
    target.y += head * uGazeHead.w * 0.19;
    target.x += surfaceResponse * uGazeHead.x * (0.052 + attentionStrength * 0.034);
    target.y += surfaceResponse * uGazeHead.y * (0.036 + attentionStrength * 0.024);
    float facingSide = smoothstep(-0.36, 0.36, target.x * directionalBias);
    float surfaceBias = head * attentionStrength * directionalBias * (0.018 + (1.0 - responseDelay) * 0.026);
    target.x += surfaceBias * mix(0.52, 1.0, facingSide);
    target.y -= head * attentionStrength * inspectionStrength * facingSide * 0.012;
    target.x += (neck * 0.72 + traps * 0.48 + shoulders * 0.18 + upperTorso * 0.18) * uGazeHead.z * 0.105;
    target.y += (neck * 0.64 + traps * 0.38 + shoulders * 0.14 + upperTorso * 0.14) * uGazeHead.w * 0.082;
    target.x += body * uPostureA.y * (head * 0.064 + support * 0.028);
    target.x += (leftTrap + leftShoulder - rightTrap - rightShoulder) * uPostureB.x * 0.022;
    target.y += (leftShoulder - rightShoulder) * uPostureB.x * 0.018;
    target.x *= 1.0 + (traps + shoulders + upperTorso) * (uPostureA.z - 0.5) * 0.028;
    target.y += (shoulders + upperTorso) * (uPostureA.w - 0.18) * 0.018;
    target.xy += head * (0.004 + uPostureB.y * 0.012) *
      simplexNoise(vec3(target.xy * 2.2, uTime * 0.16 + responseDelay * 3.0)) * vec2(1.0, 0.75);

    // Each portfolio specimen produces a different monochrome reorganization.
    // Membership is stable per particle, so the response reads as intent rather
    // than a full-body filter or a colored notification effect.
    float specimenClock = mix(uTime, uSpecimen.z * 6.2831853, reducedMotion);
    vec2 specimenDirection = length(uSpecimenDirection) > 0.001
      ? normalize(uSpecimenDirection)
      : vec2(directionalBias == 0.0 ? 1.0 : directionalBias, 0.0);
    vec2 specimenNormal = vec2(-specimenDirection.y, specimenDirection.x);
    float blackHoleCoupling = specimenEquals(1.0) * specimenStrength;
    float galaxyCoupling = specimenEquals(2.0) * specimenStrength;
    float relayCoupling = specimenEquals(3.0) * specimenStrength;
    float graphCoupling = specimenEquals(4.0) * specimenStrength;
    float orbitCoupling = specimenEquals(5.0) * specimenStrength;
    float specimenBinding = 0.0;

    float looseStructure = clamp(cranialEdge * 0.45 + shoulders * 0.72 + plume + freeField, 0.0, 1.0);
    float nearSide = smoothstep(-0.34, 0.52, dot(target.xy, specimenDirection));
    float accretionMember = step(0.66, curiosity) * looseStructure * nearSide;
    if (blackHoleCoupling > 0.001 && accretionMember > 0.0) {
      float arc = sin(curiosity * 31.0 + specimenClock * 1.55 + dot(target.xy, specimenNormal) * 8.0);
      target.xy += specimenDirection * blackHoleCoupling * accretionMember * (0.08 + curiosity * 0.13);
      target.xy += specimenNormal * blackHoleCoupling * accretionMember * arc * 0.075;
      target.xy -= specimenDirection * dot(target.xy, specimenDirection) * blackHoleCoupling * (1.0 - nearSide) * 0.12;
      specimenBinding = max(specimenBinding, blackHoleCoupling * accretionMember * 0.7);
    }

    float galaxyMember = step(0.7, curiosity) * looseStructure;
    if (galaxyCoupling > 0.001 && galaxyMember > 0.0) {
      float spin = curiosity > 0.85 ? -1.0 : 1.0;
      float galaxyAngle = properties.w * 18.849556 + specimenClock * spin * mix(0.24, 0.48, curiosity);
      float galaxyRadius = mix(0.34, 0.78, fract(curiosity * 7.31));
      vec2 galaxyOrbit = vec2(cos(galaxyAngle) * galaxyRadius, sin(galaxyAngle) * galaxyRadius * 0.43) + vec2(0.0, -0.2);
      galaxyOrbit += specimenDirection * sin(galaxyAngle * 0.5) * 0.07;
      target.xy = mix(target.xy, galaxyOrbit, galaxyCoupling * galaxyMember * 0.68);
      specimenBinding = max(specimenBinding, galaxyCoupling * galaxyMember * 0.68);
    }

    float relayMember = step(0.38, curiosity) * clamp(body + plume, 0.0, 1.0);
    if (relayCoupling > 0.001 && relayMember > 0.0) {
      float relayColumn = floor((target.x + 0.9) * 8.0 + 0.5) / 8.0 - 0.9;
      float relaySignal = sin((target.y + specimenClock * 0.28) * 25.0 + floor(curiosity * 8.0));
      target.x = mix(target.x, relayColumn, relayCoupling * relayMember * 0.46);
      target.y -= relayCoupling * relayMember * max(0.0, relaySignal) * (plume * 0.08 + 0.018);
      specimenBinding = max(specimenBinding, relayCoupling * relayMember * 0.64);
    }

    float graphMember = step(0.3, curiosity) * clamp(head + support + shoulders + upperTorso, 0.0, 1.0);
    if (graphCoupling > 0.001 && graphMember > 0.0) {
      float graphLevel = floor((target.y + 0.86) * 8.0 + 0.5) / 8.0 - 0.86;
      float branch = (fract(curiosity * 9.73) > 0.5 ? 1.0 : -1.0) *
        (0.11 + floor(fract(curiosity * 5.17) * 3.0) * 0.11);
      vec2 graphTarget = vec2(branch * smoothstep(-0.7, 0.72, graphLevel), graphLevel);
      float propagation = 0.55 + 0.45 * sin(specimenClock * 1.7 - graphLevel * 12.0 + curiosity * 4.0);
      target.xy = mix(target.xy, graphTarget, graphCoupling * graphMember * (0.34 + propagation * 0.2));
      specimenBinding = max(specimenBinding, graphCoupling * graphMember * 0.78);
    }

    float orbitMember = step(0.82, curiosity) * clamp(cranialEdge + shoulders * 0.7 + plume + freeField, 0.0, 1.0);
    if (orbitCoupling > 0.001 && orbitMember > 0.0) {
      float orbitBand = step(0.91, curiosity);
      float orbitAngle = properties.w * 12.566371 + specimenClock * mix(0.18, -0.24, orbitBand);
      float orbitRadius = mix(0.4, 0.66, orbitBand);
      vec2 lockedOrbit = vec2(cos(orbitAngle) * orbitRadius, sin(orbitAngle) * mix(0.15, 0.25, orbitBand));
      lockedOrbit.y += mix(-0.31, 0.06, orbitBand);
      target.xy = mix(target.xy, lockedOrbit, orbitCoupling * orbitMember * 0.76);
      specimenBinding = max(specimenBinding, orbitCoupling * orbitMember * 0.8);
    }

    float relocation = 1.0 - step(0.5, abs(spatialMode - 1.0));
    relocation = max(relocation, 1.0 - step(0.5, abs(spatialMode - 3.0)));
    float fragmentPressure = max(1.0 - formCoherence, relocation * sin(transition * 3.14159265));
    float bindingGate = smoothstep(1.0 - boundRatio - 0.18, 1.0 - boundRatio + 0.18, baseBinding);
    float structuralSupport = head * 0.24 + neck * 0.48 + traps * 0.38 + upperTorso * 0.32;
    float preserved = structuralSupport * mix(0.2, 0.62, cohesion);
    float reforming = max(regionEquals(uPostureB.z, 6.0), relocation * smoothstep(0.48, 0.9, transition));
    float broadSilhouette = clamp(neck + traps + shoulders + upperTorso + lowerTorso * 0.5, 0.0, 1.0);
    float landmarkDelay = cranialCore * 0.28 + cranialEdge * 0.12;
    float reformOrder = mix(1.0, mix(0.7, 1.18, broadSilhouette) - landmarkDelay, reforming);
    float effectiveBinding = max(preserved, baseBinding * bindingGate * formCoherence * reformOrder);
    effectiveBinding = max(effectiveBinding, specimenBinding);
    effectiveBinding *= mix(1.0, 0.5, relocation);

    float detach = (1.0 - effectiveBinding) * (0.36 + fragmentPressure * 0.88);
    float phase = uTime * (0.075 + curiosity * 0.055) + properties.w * 31.7;
    vec2 tangent = normalize(vec2(-target.y + 0.12, target.x + 0.0001));
    target.xy += tangent * simplexNoise(vec3(target.xy * 1.7, phase)) * detach * 0.2;
    target.y -= detach * (plume * 0.14 + freeField * 0.1 + fragmentPressure * (0.04 + curiosity * 0.16));
    target.x += detach * simplexNoise(vec3(target.y * 2.1, phase, properties.w * 8.0)) * 0.18;

    float reachDirection = uReach.x < 0.0 ? -1.0 : 1.0;
    float reachSide = step(0.025, target.x * reachDirection);
    float reachSource = clamp(shoulders + upperTorso, 0.0, 1.0) * reachSide;
    float tendrilMember = step(mix(0.989, 0.978, inspectionStrength), curiosity) * reachSource;
    float reach = tendrilMember * uReach.z * (1.0 - reducedMotion);
    if (reach > 0.001) {
      float t = clamp((curiosity - 0.92) / 0.08, 0.0, 1.0);
      float side = uReach.x < 0.0 ? -1.0 : 1.0;
      vec2 origin = vec2(side * (0.46 + fract(properties.w * 17.3) * 0.2), 0.18 + (fract(properties.w * 41.1) - 0.5) * 0.24);
      vec2 control = mix(origin, uReach.xy, 0.48);
      vec2 deltaToReach = uReach.xy - origin;
      control += normalize(vec2(-deltaToReach.y, deltaToReach.x) + vec2(0.0001)) *
        (fract(properties.w * 73.7) - 0.5) * 0.42;
      float inverse = 1.0 - t;
      vec2 curve = inverse * inverse * origin + 2.0 * inverse * t * control + t * t * uReach.xy;
      curve += normalize(vec2(-deltaToReach.y, deltaToReach.x) + vec2(0.0001)) * sin(t * 15.0 + phase) * 0.035;
      target.xy = mix(target.xy, curve, reach);
      effectiveBinding = max(effectiveBinding, reach * 0.74);
    }

    vec3 center = vec3(0.0);
    vec3 alignment = vec3(0.0);
    vec3 separation = vec3(0.0);
    float neighborCount = 0.0;
    vec2 texel = 1.0 / resolution.xy;
    vec2 offsets[8];
    offsets[0] = vec2(-1.0, -1.0); offsets[1] = vec2(0.0, -1.0);
    offsets[2] = vec2(1.0, -1.0); offsets[3] = vec2(-1.0, 0.0);
    offsets[4] = vec2(1.0, 0.0); offsets[5] = vec2(-1.0, 1.0);
    offsets[6] = vec2(0.0, 1.0); offsets[7] = vec2(1.0, 1.0);
    for (int index = 0; index < 8; index++) {
      vec2 neighborUv = clamp(uv + offsets[index] * texel, texel * 0.5, vec2(1.0) - texel * 0.5);
      vec3 neighborPosition = texture2D(texturePosition, neighborUv).xyz;
      vec3 difference = neighborPosition - positionValue;
      float distanceSquared = max(dot(difference, difference), 0.000001);
      if (distanceSquared < 0.045) {
        center += neighborPosition;
        alignment += texture2D(textureVelocity, neighborUv).xyz;
        separation -= difference * smoothstep(0.014, 0.0, distanceSquared) / distanceSquared;
        neighborCount += 1.0;
      }
    }

    float response = 0.34 + (1.0 - responseDelay) * 0.66;
    float targetStrength = (0.55 + effectiveBinding * 7.2) * response;
    vec3 force = (target - positionValue) * targetStrength;
    if (neighborCount > 0.0) {
      center /= neighborCount;
      alignment /= neighborCount;
      force += (center - positionValue) * cohesion * effectiveBinding * 0.72;
      force += (alignment - velocityValue) * cohesion * 0.19;
      force += separation * 0.00028;
    }

    // A pointer crossing is treated as a local field intrusion rather than a
    // whole-body hover state. The core resists, loose glyphs shear into the
    // pointer wake, and the ordinary target attraction reforms the surface.
    vec2 pointerDelta = positionValue.xy - uPointerField.xy;
    float pointerDistance = length(pointerDelta / vec2(0.92, 1.04));
    float pointerContact = uPointerField.z * (1.0 - smoothstep(0.05, 0.78, pointerDistance));
    if (pointerContact > 0.001) {
      vec2 pointerAway = normalize(pointerDelta + vec2(0.0001));
      float pointerSpeed = clamp(uPointerField.w, 0.0, 1.0);
      vec2 pointerDirection = length(uPointerMotion.xy) > 0.01
        ? normalize(uPointerMotion.xy)
        : normalize(vec2(-pointerDelta.y, pointerDelta.x) + vec2(0.0001));
      float compliance = mix(0.38, 1.0, 1.0 - effectiveBinding) * (1.0 - cranialCore * 0.42);
      float striation = sin((positionValue.y - uPointerField.y) * 43.0 + properties.w * 8.0 + uTime * 7.2);
      float wake = pointerContact * compliance;
      force.xy += pointerAway * wake * (3.4 + pointerSpeed * 2.5);
      force.xy += pointerDirection * wake * (0.8 + pointerSpeed * 1.9);
      force.x += striation * wake * (0.72 + pointerSpeed * 1.15);
      force.y += sin((positionValue.x - uPointerField.x) * 21.0 - uTime * 4.0) * wake * 0.26;
    }

    float noiseAmount = (0.012 + entropy * 0.15 + fragmentPressure * 0.19) * mix(1.0, 0.12, reducedMotion);
    vec3 noisePoint = vec3(positionValue.xy * 0.9, uTime * 0.095 + properties.w * 19.0);
    force.x += simplexNoise(noisePoint) * noiseAmount;
    force.y += simplexNoise(noisePoint.yzx + vec3(19.1, 7.7, 31.3)) * noiseAmount;
    force.z += simplexNoise(noisePoint.zxy + vec3(3.3, 41.7, 11.9)) * noiseAmount * 0.26;
    force.y -= (plume + freeField * 0.45) * (0.012 + entropy * 0.045);

    float scrollVelocity = clamp(uScroll.x, -1.0, 1.0);
    float scrollAcceleration = clamp(abs(uScroll.y), 0.0, 1.0);
    float scrollEnergy = uScroll.z * (1.0 - reducedMotion);
    float verticalPosition = target.y * 0.5 + 0.5;
    float originDelay = abs(verticalPosition - uScroll.w) * 2.2;
    float regionalDelay = responseDelay * 2.4 + originDelay + lowerTorso * 0.8 + shoulders * 0.34;
    float wave = sin(target.y * 7.4 - uTime * 4.2 + regionalDelay) * scrollEnergy;
    float coreResistance = 1.0 - cranialCore * 0.84 - neck * 0.34;
    float plumeCompression = plume * scrollAcceleration * scrollEnergy;
    force.y += plumeCompression * (0.08 - positionValue.y * 0.08);
    force.x += wave * 0.13 * (0.3 + (1.0 - effectiveBinding)) * coreResistance;
    force.y -= wave * scrollVelocity * 0.036 * (0.42 + coreResistance * 0.58);
    force.x += (leftShoulder - rightShoulder) * scrollAcceleration * scrollEnergy * 0.018;

    vec2 screenUv = uEntity.xy + positionValue.xy * uEntity.zw * 0.5;
    vec2 occupancyTexel = 1.0 / max(uOccupancySize, vec2(1.0));
    float occupied = texture2D(uOccupancy, clamp(screenUv, 0.0, 1.0)).r;
    if (occupied > 0.01) {
      float left = texture2D(uOccupancy, clamp(screenUv - vec2(occupancyTexel.x, 0.0), 0.0, 1.0)).r;
      float right = texture2D(uOccupancy, clamp(screenUv + vec2(occupancyTexel.x, 0.0), 0.0, 1.0)).r;
      float top = texture2D(uOccupancy, clamp(screenUv - vec2(0.0, occupancyTexel.y), 0.0, 1.0)).r;
      float bottom = texture2D(uOccupancy, clamp(screenUv + vec2(0.0, occupancyTexel.y), 0.0, 1.0)).r;
      vec2 gradient = vec2(right - left, bottom - top);
      vec2 away = length(gradient) > 0.001 ? -normalize(gradient) : normalize(uEntity.xy - screenUv + vec2(0.0001));
      force.xy += away / max(uEntity.zw, vec2(0.001)) * occupied * (0.055 + (1.0 - effectiveBinding) * 0.13);
    }

    float containmentStrength = uState.x;
    if (containmentStrength > 0.001) {
      vec2 clampedScreen = clamp(screenUv, uContainmentRect.xy, uContainmentRect.zw);
      vec2 outsideDelta = clampedScreen - screenUv;
      float outsideDistance = length(outsideDelta);
      if (outsideDistance > 0.00001) {
        force.xy += outsideDelta / max(uEntity.zw, vec2(0.001)) * containmentStrength * (5.0 + outsideDistance * 70.0);
      } else {
        vec2 edgeDistance = min(screenUv - uContainmentRect.xy, uContainmentRect.zw - screenUv);
        float boundary = 1.0 - smoothstep(0.0, 0.022, min(edgeDistance.x, edgeDistance.y));
        vec2 fromCenter = normalize(screenUv - (uContainmentRect.xy + uContainmentRect.zw) * 0.5 + vec2(0.0001));
        force.xy -= fromCenter * boundary * containmentStrength * (0.035 + curiosity * 0.04);
      }
    }

    velocityValue += force * min(uDelta, 0.05);
    float retention = pow(mix(0.83, 0.992, inertia), uDelta * 60.0) * exp(-uDelta * effectiveBinding * 0.48);
    velocityValue *= retention;
    float speed = length(velocityValue);
    float maxSpeed = mix(0.24, 0.92, entropy + fragmentPressure * 0.45) * mix(1.0, 0.18, reducedMotion);
    if (speed > maxSpeed) velocityValue *= maxSpeed / speed;
    gl_FragColor = vec4(velocityValue, velocitySample.w);
  }
`;

const PARTICLE_VERTEX_SHADER = /* glsl */ `
  precision highp float;
  attribute vec2 aCorner;
  attribute vec2 aReference;
  uniform sampler2D uPosition;
  uniform sampler2D uProperties;
  uniform sampler2D uTarget;
  uniform sampler2D uAppearance;
  uniform vec4 uEntity;
  uniform vec4 uAnchorPath;
  uniform vec4 uContainmentRect;
  uniform vec4 uSpatial;
  uniform vec2 uViewport;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uEntropy;
  uniform float uThemeAlpha;
  uniform float uStructureAlpha;
  uniform float uDensityAlpha;
  uniform float uFormBlend;
  uniform vec4 uVisualWeights;
  uniform vec4 uEpisodeVisual;
  uniform float uSpecimenStrength;
  varying vec2 vCorner;
  varying vec2 vScreenUv;
  varying vec4 vAppearance;
  varying float vAlpha;
  varying float vSeed;
  varying float vRegion;
  varying float vHighlight;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec2 curvedAnchor(vec2 from, vec2 target, float amount, float seed, float curve) {
    vec2 delta = target - from;
    vec2 normal = normalize(vec2(-delta.y, delta.x) + vec2(0.000001));
    vec2 control = mix(from, target, 0.46) + normal * curve * (0.34 + seed * 0.66);
    float inverse = 1.0 - amount;
    return inverse * inverse * from + 2.0 * inverse * amount * control + amount * amount * target;
  }

  void main() {
    vec4 positionSample = texture2D(uPosition, aReference);
    vec4 properties = texture2D(uProperties, aReference);
    vec4 targetSample = texture2D(uTarget, aReference);
    vec4 appearance = texture2D(uAppearance, aReference);
    float region = floor(targetSample.w + 0.5);
    float seed = hash21(aReference * 8192.0 + properties.w * 71.0);
    float cranialCore = 1.0 - step(0.45, abs(region - 0.0));
    float cranialEdge = 1.0 - step(0.45, abs(region - 1.0));
    float lowerHead = 1.0 - step(0.45, abs(region - 2.0));
    float neck = 1.0 - step(0.45, abs(region - 3.0));
    float traps = (1.0 - step(0.45, abs(region - 4.0))) + (1.0 - step(0.45, abs(region - 5.0)));
    float shoulders = (1.0 - step(0.45, abs(region - 6.0))) + (1.0 - step(0.45, abs(region - 7.0)));
    float upperTorso = 1.0 - step(0.45, abs(region - 8.0));
    float lowerTorso = 1.0 - step(0.45, abs(region - 9.0));
    float distributed = cranialEdge * (0.38 + seed * 0.24) + lowerHead * 0.18 +
      traps * (0.24 + seed * 0.2) + shoulders * (0.2 + seed * 0.18) + upperTorso * 0.12;
    float highlight = clamp(distributed * step(0.34, seed), 0.0, 0.62);
    float structure = clamp(cranialEdge + lowerHead * 0.4 + neck * 0.35 + traps * 0.75 + shoulders * 0.62 + upperTorso * 0.25, 0.0, 1.0);
    float peripheral = step(9.5, region);
    float spatialMode = uSpatial.x;
    float progress = uSpatial.y;
    float moving = 1.0 - step(0.5, abs(spatialMode - 1.0));
    moving = max(moving, 1.0 - step(0.5, abs(spatialMode - 3.0)));
    moving = max(moving, 1.0 - step(0.5, abs(spatialMode - 4.0)));
    float relocating = 1.0 - step(0.5, abs(spatialMode - 3.0));
    float broadSilhouette = clamp(neck + traps + shoulders + upperTorso + lowerTorso * 0.5, 0.0, 1.0);
    float outerFirst = mix(-0.14, 0.16, properties.x) + properties.z * 0.08;
    float reformFinish = mix(0.98, 0.82, properties.x) - broadSilhouette * 0.08 + cranialCore * 0.055;
    float particleProgress = smoothstep(outerFirst, max(outerFirst + 0.2, reformFinish), progress);
    float residual = step(seed, 0.018) * (1.0 - smoothstep(0.78, 1.0, progress));
    particleProgress *= 1.0 - residual;
    vec2 center = uEntity.xy;
    if (moving > 0.5) {
      center = curvedAnchor(uAnchorPath.xy, uAnchorPath.zw, particleProgress, seed, uSpatial.z * (seed - 0.5));
    }
    vec2 local = positionSample.xy;
    if (moving > 0.5) {
      float flow = sin(particleProgress * 3.14159265) * (1.0 - properties.x * 0.62);
      local.x += sin(properties.w * 83.0 + particleProgress * 8.0) * flow * 0.18;
      local.y -= flow * (0.12 + seed * 0.28);
    }
    if (spatialMode > 4.5) {
      local += normalize(local + vec2(0.0001)) * progress * (0.2 + seed * 0.9);
    }
    vec2 screenUv = center + local * uEntity.zw * 0.5;
    vec2 clip = vec2(screenUv.x * 2.0 - 1.0, 1.0 - screenUv.y * 2.0);
    float directionalSurface = clamp(0.5 + positionSample.x * uEpisodeVisual.z * 1.7, 0.0, 1.0) *
      clamp(cranialCore + cranialEdge + lowerHead, 0.0, 1.0);
    float pointSize = (0.94 + appearance.w * 1.58) * uPixelRatio;
    pointSize *= 1.0 + directionalSurface * uEpisodeVisual.x * 0.08 + cranialEdge * uEpisodeVisual.y * 0.05;
    pointSize *= 0.88 + (1.0 - abs(positionSample.z)) * 0.28 + uEntropy * properties.w * 0.16;
    clip += aCorner * pointSize * 2.0 / max(uViewport, vec2(1.0));
    gl_Position = vec4(clip, positionSample.z * 0.04, 1.0);
    vCorner = aCorner;
    vScreenUv = screenUv;
    vAppearance = appearance;
    vSeed = seed;
    vRegion = region;
    vHighlight = highlight;
    float structureGain = mix(1.0, uStructureAlpha / max(0.001, uThemeAlpha), structure * 0.28);
    float fieldFade = mix(1.0, 0.34, peripheral);
    fieldFade *= 1.0 + peripheral * uSpecimenStrength * 0.82;
    float hierarchy = 1.0 + cranialEdge * uVisualWeights.x + (neck + traps) * uVisualWeights.y;
    hierarchy *= 1.0 + uEpisodeVisual.x * 0.04 + uEpisodeVisual.y * 0.08 +
      directionalSurface * uEpisodeVisual.x * 0.09 + cranialEdge * uEpisodeVisual.y * 0.05;
    float presenceGain = 1.12 + cranialCore * 0.18 + cranialEdge * 0.14 + (neck + traps) * 0.08 + upperTorso * 0.04;
    float lowerDepth = smoothstep(0.36, 0.86, targetSample.y);
    float torsoFade = mix(1.0, uVisualWeights.z, lowerTorso * lowerDepth);
    float listeningBody = mix(0.74, 1.0, uFormBlend * uFormBlend);
    hierarchy *= mix(1.0, listeningBody, step(region, 9.5));
    float relocationFade = mix(1.0, mix(0.48, 0.68, peripheral), relocating * sin(progress * 3.14159265));
    float disabledFade = spatialMode > 4.5 ? 1.0 - smoothstep(0.08, 1.0, progress) : 1.0;
    vAlpha = uThemeAlpha * uDensityAlpha * appearance.y * structureGain * fieldFade * hierarchy * presenceGain * torsoFade * relocationFade * disabledFade;
  }
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform sampler2D uGlyphAtlas;
  uniform vec3 uGlyphGrid;
  uniform vec4 uContainmentRect;
  uniform float uContainmentStrength;
  uniform float uContainmentSoftness;
  uniform float uTime;
  uniform float uThinking;
  uniform float uLightTheme;
  uniform float uExposure;
  varying vec2 vCorner;
  varying vec2 vScreenUv;
  varying vec4 vAppearance;
  varying float vAlpha;
  varying float vSeed;
  varying float vRegion;
  varying float vHighlight;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    float glyphIndex = floor(vAppearance.x * max(1.0, uGlyphGrid.z - 1.0) + 0.5);
    float mutationClock = floor(uTime * max(0.025, vAppearance.z) * mix(0.25, 1.0, uThinking));
    float mutate = step(0.82, hash21(vec2(glyphIndex + vSeed * 19.0, mutationClock + 7.3))) * uThinking;
    glyphIndex = mod(glyphIndex + mutate * (1.0 + floor(vSeed * 13.0)), uGlyphGrid.z);
    float column = mod(glyphIndex, uGlyphGrid.x);
    float row = floor(glyphIndex / uGlyphGrid.x);
    vec2 local = vCorner * 0.5 + 0.5;
    vec2 atlasUv = vec2((column + local.x) / uGlyphGrid.x, (row + 1.0 - local.y) / uGlyphGrid.y);
    float distanceValue = texture2D(uGlyphAtlas, atlasUv).r;
    float glyph = smoothstep(0.43, 0.57, distanceValue);
    float softTrace = smoothstep(0.31, 0.5, distanceValue) * 0.16;

    vec2 edgeDistance = min(vScreenUv - uContainmentRect.xy, uContainmentRect.zw - vScreenUv);
    float inside = smoothstep(-uContainmentSoftness, uContainmentSoftness, min(edgeDistance.x, edgeDistance.y));
    float released = 1.0 - uContainmentStrength;
    float weakBoundary = smoothstep(vSeed - 0.09, vSeed + 0.09, released);
    float mask = mix(1.0, max(inside, weakBoundary), smoothstep(0.0, 0.08, uContainmentStrength));

    float grain = 0.94 + hash21(gl_FragCoord.xy + floor(uTime * 4.0 + vSeed * 9.0)) * 0.06;
    float alpha = (glyph + softTrace) * vAlpha * grain * mask;
    if (alpha < 0.004) discard;
    vec3 darkBase = vec3(0.72, 0.73, 0.72);
    vec3 darkStructure = vec3(0.87, 0.88, 0.87);
    vec3 lightBase = vec3(0.12, 0.115, 0.12);
    vec3 lightStructure = vec3(0.06, 0.058, 0.062);
    vec3 color = mix(mix(darkBase, darkStructure, vHighlight * vAppearance.y), mix(lightBase, lightStructure, vHighlight * 0.62), uLightTheme);
    color *= uExposure;
    gl_FragColor = vec4(color, alpha);
  }
`;

const SPATIAL_INDEX: Record<EntityRuntimeFrame['spatialMode'], number> = {
  SEALED: 0,
  RELEASING: 1,
  FREE: 2,
  RELOCATING: 3,
  RETURNING: 4,
  HIDDEN: 5,
};

const COGNITIVE_INDEX: Record<EntityRuntimeFrame['cognitiveState'], number> = {
  DORMANT: 0,
  OBSERVING: 1,
  CURIOUS: 2,
  INSPECTING: 3,
  THINKING: 4,
  FRAGMENTING: 5,
  REFORMING: 6,
};

const SPECIMEN_INDEX: Record<SpecimenKind, number> = {
  'black-hole': 1,
  galaxy: 2,
  relay: 3,
  graph: 4,
  orbit: 5,
};

function particleCountForTier(tier: QualityTier): number {
  const size = ENTITY_CONFIG.particles.textureSize[tier];
  return size * size;
}

export class EntityParticleField {
  readonly scene: Scene;
  readonly count: number;
  readonly poolId: string;
  private renderer: WebGLRenderer;
  private gpuCompute: GPUComputationRenderer;
  private positionVariable: Variable;
  private velocityVariable: Variable;
  private targetTexture: DataTexture;
  private listeningTargetTexture: DataTexture;
  private propertiesTexture: DataTexture;
  private appearanceTexture: DataTexture;
  private occupancyTexture: DataTexture;
  private glyphAtlas: GlyphAtlas;
  private geometry: InstancedBufferGeometry;
  private material: ShaderMaterial;
  private mesh: Mesh;
  private size: number;
  private viewport = { width: 1, height: 1, bufferWidth: 1, bufferHeight: 1 };
  private hasComputed = false;
  private visible = true;
  private occupancyRevision = -1;
  private activeCount: number;

  constructor(
    THREE: ThreeAdapter,
    renderer: WebGLRenderer,
    maximumTier: QualityTier,
    sessionSeed: number,
    poolId: string,
  ) {
    this.renderer = renderer;
    this.size = ENTITY_CONFIG.particles.textureSize[maximumTier];
    this.count = this.size * this.size;
    this.activeCount = this.count;
    this.poolId = poolId;
    this.gpuCompute = new THREE.GPUComputationRenderer(this.size, this.size, renderer);
    const positionTexture = this.gpuCompute.createTexture();
    const velocityTexture = this.gpuCompute.createTexture();
    this.targetTexture = this.gpuCompute.createTexture();
    this.listeningTargetTexture = this.gpuCompute.createTexture();
    this.propertiesTexture = this.gpuCompute.createTexture();
    this.appearanceTexture = this.gpuCompute.createTexture();
    this.populateTextures(sessionSeed, positionTexture, velocityTexture);

    const occupancyData = new Uint8Array(ENTITY_CONFIG.occupancy.columns * ENTITY_CONFIG.occupancy.rows * 4);
    this.occupancyTexture = new THREE.DataTexture(
      occupancyData,
      ENTITY_CONFIG.occupancy.columns,
      ENTITY_CONFIG.occupancy.rows,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.occupancyTexture.minFilter = THREE.LinearFilter;
    this.occupancyTexture.magFilter = THREE.LinearFilter;
    this.occupancyTexture.needsUpdate = true;
    this.glyphAtlas = createGlyphAtlas(THREE);

    this.positionVariable = this.gpuCompute.addVariable('texturePosition', POSITION_SHADER, positionTexture);
    this.velocityVariable = this.gpuCompute.addVariable('textureVelocity', VELOCITY_SHADER, velocityTexture);
    this.gpuCompute.setVariableDependencies(this.positionVariable, [this.positionVariable, this.velocityVariable]);
    this.gpuCompute.setVariableDependencies(this.velocityVariable, [this.positionVariable, this.velocityVariable]);
    this.positionVariable.material.uniforms.uDelta = { value: 1 / 60 };
    Object.assign(this.velocityVariable.material.uniforms, {
      uTarget: { value: this.targetTexture },
      uListeningTarget: { value: this.listeningTargetTexture },
      uProperties: { value: this.propertiesTexture },
      uOccupancy: { value: this.occupancyTexture },
      uOccupancySize: { value: new THREE.Vector2(ENTITY_CONFIG.occupancy.columns, ENTITY_CONFIG.occupancy.rows) },
      uEntity: { value: new THREE.Vector4(0.5, 0.5, 0.25, 0.35) },
      uContainmentRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uBehavior: { value: new THREE.Vector4(0.7, 0.2, 0.7, 0.65) },
      uState: { value: new THREE.Vector4(1, 0, 0, 0) },
      uGazeHead: { value: new THREE.Vector4() },
      uPostureA: { value: new THREE.Vector4() },
      uPostureB: { value: new THREE.Vector4() },
      uDynamics: { value: new THREE.Vector4() },
      uScroll: { value: new THREE.Vector4() },
      uReach: { value: new THREE.Vector4() },
      uEpisode: { value: new THREE.Vector4() },
      uPointerField: { value: new THREE.Vector4(4, 4, 0, 0) },
      uPointerMotion: { value: new THREE.Vector4() },
      uSpecimen: { value: new THREE.Vector4() },
      uSpecimenDirection: { value: new THREE.Vector2(1, 0) },
      uTime: { value: 0 },
      uDelta: { value: 1 / 60 },
      uFormBlend: { value: ENTITY_CONFIG.body.stateFormBlend.DORMANT },
    });
    const error = this.gpuCompute.init();
    if (error) throw new Error(`ENTITY_07 GPU computation unavailable: ${error}`);

    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 1, -1, 1, 1, -1, 1,
    ]), 2));
    const references = new Float32Array(this.count * 2);
    for (let index = 0; index < this.count; index += 1) {
      const particleIndex = progressiveParticleIndex(index, this.count, sessionSeed);
      references[index * 2] = (particleIndex % this.size + 0.5) / this.size;
      references[index * 2 + 1] = (Math.floor(particleIndex / this.size) + 0.5) / this.size;
    }
    this.geometry.setAttribute('aReference', new THREE.InstancedBufferAttribute(references, 2));
    this.geometry.instanceCount = this.activeCount;
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPosition: { value: this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture },
        uProperties: { value: this.propertiesTexture },
        uTarget: { value: this.targetTexture },
        uAppearance: { value: this.appearanceTexture },
        uGlyphAtlas: { value: this.glyphAtlas.texture },
        uGlyphGrid: { value: new THREE.Vector3(this.glyphAtlas.columns, this.glyphAtlas.rows, this.glyphAtlas.count) },
        uEntity: { value: new THREE.Vector4(0.5, 0.5, 0.25, 0.35) },
        uAnchorPath: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
        uContainmentRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uSpatial: { value: new THREE.Vector4() },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uTime: { value: 0 },
        uEntropy: { value: 0 },
        uThemeAlpha: { value: ENTITY_CONFIG.theme.dark.alpha },
        uStructureAlpha: { value: ENTITY_CONFIG.theme.dark.structureAlpha },
        uDensityAlpha: { value: ENTITY_CONFIG.particles.densityAlpha[maximumTier] },
        uFormBlend: { value: ENTITY_CONFIG.body.stateFormBlend.DORMANT },
        uVisualWeights: { value: new THREE.Vector4(
          ENTITY_CONFIG.body.edgeHighlightGain,
          ENTITY_CONFIG.body.supportHighlightGain,
          ENTITY_CONFIG.body.torsoDissolve,
          0,
        ) },
        uEpisodeVisual: { value: new THREE.Vector4() },
        uSpecimenStrength: { value: 0 },
        uContainmentStrength: { value: 1 },
        uContainmentSoftness: { value: 0.02 },
        uThinking: { value: 0 },
        uLightTheme: { value: 0 },
        uExposure: { value: ENTITY_CONFIG.theme.dark.exposure },
      },
    });
    this.scene = new THREE.Scene();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  private populateTextures(sessionSeed: number, position: DataTexture, velocity: DataTexture): void {
    const topology = createFacelessHumanoidTopology(this.count, sessionSeed);
    const positionData = position.image.data as Float32Array;
    const velocityData = velocity.image.data as Float32Array;
    const targetData = this.targetTexture.image.data as Float32Array;
    const listeningTargetData = this.listeningTargetTexture.image.data as Float32Array;
    const propertyData = this.propertiesTexture.image.data as Float32Array;
    const appearanceData = this.appearanceTexture.image.data as Float32Array;
    targetData.set(topology.targets);
    listeningTargetData.set(topology.listeningTargets);
    propertyData.set(topology.properties);
    appearanceData.set(topology.appearance);
    for (let index = 0; index < this.count; index += 1) {
      const offset = index * 4;
      const seed = topology.properties[offset + 3];
      const phase = seed * Math.PI * 2;
      const initialBlend = ENTITY_CONFIG.body.stateFormBlend.DORMANT;
      positionData[offset] = mix(topology.listeningTargets[offset], topology.targets[offset], initialBlend) + Math.cos(phase * 3.1) * 0.018;
      positionData[offset + 1] = mix(topology.listeningTargets[offset + 1], topology.targets[offset + 1], initialBlend) + Math.sin(phase * 2.7) * 0.018;
      positionData[offset + 2] = mix(topology.listeningTargets[offset + 2], topology.targets[offset + 2], initialBlend) + Math.sin(phase * 5.3) * 0.012;
      positionData[offset + 3] = seed * 31;
      velocityData[offset] = Math.cos(phase) * 0.004;
      velocityData[offset + 1] = Math.sin(phase) * 0.004;
      velocityData[offset + 2] = Math.sin(phase * 1.7) * 0.002;
      velocityData[offset + 3] = topology.properties[offset + 2];
    }
    position.needsUpdate = true;
    velocity.needsUpdate = true;
    this.targetTexture.needsUpdate = true;
    this.listeningTargetTexture.needsUpdate = true;
    this.propertiesTexture.needsUpdate = true;
    this.appearanceTexture.needsUpdate = true;
  }

  setQuality(tier: QualityTier): number {
    this.activeCount = Math.max(1, Math.min(this.count, particleCountForTier(tier)));
    this.geometry.instanceCount = this.activeCount;
    return this.activeCount;
  }

  resize(bufferWidth: number, bufferHeight: number, cssWidth: number, cssHeight: number): void {
    this.viewport = {
      width: Math.max(1, cssWidth),
      height: Math.max(1, cssHeight),
      bufferWidth: Math.max(1, bufferWidth),
      bufferHeight: Math.max(1, bufferHeight),
    };
    (this.material.uniforms.uViewport.value as Vector2).set(this.viewport.bufferWidth, this.viewport.bufferHeight);
    // Low-quality rendering is intentionally undersampled. Keep glyph quads at
    // least one render pixel so upscaling cannot erase the particle hierarchy.
    this.material.uniforms.uPixelRatio.value = Math.max(1, this.viewport.bufferWidth / this.viewport.width);
  }

  private updateOccupancy(snapshot: OccupancySnapshot): void {
    if (snapshot.revision === this.occupancyRevision) return;
    this.occupancyRevision = snapshot.revision;
    const data = this.occupancyTexture.image.data as Uint8Array;
    for (let index = 0; index < snapshot.grid.length; index += 1) {
      const value = snapshot.grid[index];
      const offset = index * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
    this.occupancyTexture.needsUpdate = true;
  }

  update(frame: EntityRuntimeFrame, occupancy: OccupancySnapshot, delta: number, elapsed: number): void {
    this.visible = frame.visible;
    if (!frame.visible) return;
    this.updateOccupancy(occupancy);
    const width = this.viewport.width;
    const height = this.viewport.height;
    const entity = this.material.uniforms.uEntity.value as Vector4;
    entity.set(frame.anchor.x / width, frame.anchor.y / height, frame.entityWidth / width, frame.entityHeight / height);
    const containment = this.material.uniforms.uContainmentRect.value as Vector4;
    containment.set(
      frame.containmentRect.left / width,
      frame.containmentRect.top / height,
      frame.containmentRect.right / width,
      frame.containmentRect.bottom / height,
    );
    const spatialIndex = SPATIAL_INDEX[frame.spatialMode];
    const dt = frame.simulationPaused || frame.reducedMotion ? Math.min(delta, 1 / 30) * (frame.reducedMotion ? 0.2 : 0) : Math.min(Math.max(delta, 1 / 240), 1 / 20);
    this.positionVariable.material.uniforms.uDelta.value = dt;
    this.velocityVariable.material.uniforms.uTime.value = elapsed;
    this.velocityVariable.material.uniforms.uDelta.value = dt;
    const cognitiveFormBlend = ENTITY_CONFIG.body.stateFormBlend[frame.cognitiveState];
    const formBlend = Math.max(0, Math.min(1,
      cognitiveFormBlend * (1 - frame.internal.entropy * 0.14),
    ));
    this.velocityVariable.material.uniforms.uFormBlend.value = frame.reducedMotion
      ? Math.max(0.55, formBlend)
      : formBlend;
    (this.velocityVariable.material.uniforms.uEntity.value as Vector4).copy(entity);
    (this.velocityVariable.material.uniforms.uContainmentRect.value as Vector4).copy(containment);
    (this.velocityVariable.material.uniforms.uBehavior.value as Vector4).set(
      frame.internal.cohesion,
      frame.internal.entropy,
      frame.formCoherence,
      frame.boundRatio,
    );
    (this.velocityVariable.material.uniforms.uState.value as Vector4).set(
      frame.containmentStrength,
      spatialIndex,
      frame.transitionProgress,
      frame.reducedMotion ? 1 : 0,
    );
    (this.velocityVariable.material.uniforms.uGazeHead.value as Vector4).set(
      frame.gazeOrientation.x,
      frame.gazeOrientation.y,
      frame.headOrientation.x,
      frame.headOrientation.y,
    );
    (this.velocityVariable.material.uniforms.uPostureA.value as Vector4).set(
      frame.posture.headTilt,
      frame.posture.lean,
      frame.posture.breath,
      frame.posture.shoulderSettle,
    );
    (this.velocityVariable.material.uniforms.uPostureB.value as Vector4).set(
      frame.posture.shoulderCounter,
      frame.posture.surfaceFlow,
      COGNITIVE_INDEX[frame.cognitiveState],
      0,
    );
    (this.velocityVariable.material.uniforms.uDynamics.value as Vector4).set(
      frame.posture.breath,
      frame.posture.shoulderSettle,
      frame.interactionEnergy,
      frame.internal.arousal,
    );
    (this.velocityVariable.material.uniforms.uScroll.value as Vector4).set(
      Math.max(-1, Math.min(1, frame.scrollVelocity / 1200)),
      Math.max(-1, Math.min(1, frame.scrollAcceleration / 5200)),
      frame.scrollEnergy,
      frame.scrollOrigin,
    );
    const reachLocalX = (frame.reachPosition.x - frame.anchor.x) / Math.max(1, frame.entityWidth * 0.5);
    const reachLocalY = (frame.reachPosition.y - frame.anchor.y) / Math.max(1, frame.entityHeight * 0.5);
    (this.velocityVariable.material.uniforms.uReach.value as Vector4).set(
      reachLocalX,
      reachLocalY,
      frame.reachStrength,
      frame.interactionEnergy,
    );
    (this.velocityVariable.material.uniforms.uEpisode.value as Vector4).set(
      frame.attentionStrength,
      frame.inspectionStrength,
      frame.directionalBias,
      frame.episodeCommitment,
    );
    const pointerLocalX = (frame.pointerPosition.x - frame.anchor.x) / Math.max(1, frame.entityWidth * 0.5);
    const pointerLocalY = (frame.pointerPosition.y - frame.anchor.y) / Math.max(1, frame.entityHeight * 0.5);
    const pointerSpeed = Math.min(1, Math.hypot(frame.pointerVelocity.x, frame.pointerVelocity.y) / 1500);
    (this.velocityVariable.material.uniforms.uPointerField.value as Vector4).set(
      pointerLocalX,
      pointerLocalY,
      frame.pointerIntrusion,
      pointerSpeed,
    );
    (this.velocityVariable.material.uniforms.uPointerMotion.value as Vector4).set(
      Math.max(-1, Math.min(1, frame.pointerVelocity.x / 1200)),
      Math.max(-1, Math.min(1, frame.pointerVelocity.y / 1200)),
      frame.pointerProximity,
      0,
    );
    (this.velocityVariable.material.uniforms.uSpecimen.value as Vector4).set(
      frame.specimen.kind ? SPECIMEN_INDEX[frame.specimen.kind] : 0,
      frame.specimen.strength,
      frame.specimen.phase,
      frame.specimen.distance,
    );
    (this.velocityVariable.material.uniforms.uSpecimenDirection.value as Vector2).set(
      frame.specimen.direction.x,
      frame.specimen.direction.y,
    );
    if (dt > 0 || !this.hasComputed) {
      this.gpuCompute.compute();
      this.hasComputed = true;
    }

    this.material.uniforms.uPosition.value = this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
    (this.material.uniforms.uEntity.value as Vector4).copy(entity);
    (this.material.uniforms.uAnchorPath.value as Vector4).set(
      frame.anchorFrom.x / width,
      frame.anchorFrom.y / height,
      frame.anchorTarget.x / width,
      frame.anchorTarget.y / height,
    );
    (this.material.uniforms.uContainmentRect.value as Vector4).copy(containment);
    (this.material.uniforms.uSpatial.value as Vector4).set(
      spatialIndex,
      frame.transitionProgress,
      frame.relocationCurve,
      frame.visible ? 1 : 0,
    );
    const theme = ENTITY_CONFIG.theme[frame.theme];
    this.material.uniforms.uTime.value = elapsed;
    this.material.uniforms.uEntropy.value = frame.internal.entropy;
    this.material.uniforms.uFormBlend.value = frame.reducedMotion ? Math.max(0.55, formBlend) : formBlend;
    this.material.uniforms.uThemeAlpha.value = theme.alpha;
    this.material.uniforms.uStructureAlpha.value = theme.structureAlpha;
    this.material.uniforms.uDensityAlpha.value = ENTITY_CONFIG.particles.densityAlpha[frame.quality];
    (this.material.uniforms.uEpisodeVisual.value as Vector4).set(
      frame.attentionStrength,
      frame.inspectionStrength,
      frame.directionalBias,
      frame.episodeCommitment,
    );
    this.material.uniforms.uSpecimenStrength.value = frame.specimen.strength;
    this.material.uniforms.uContainmentStrength.value = frame.containmentStrength;
    this.material.uniforms.uContainmentSoftness.value = ENTITY_CONFIG.containment.boundarySoftnessPx / Math.min(width, height);
    this.material.uniforms.uThinking.value = ['THINKING', 'FRAGMENTING', 'REFORMING'].includes(frame.cognitiveState)
      ? 1
      : frame.cognitiveState === 'CURIOUS' ? 0.35 : 0.08;
    this.material.uniforms.uLightTheme.value = frame.theme === 'light' ? 1 : 0;
    this.material.uniforms.uExposure.value = theme.exposure;
  }

  render(target: WebGLRenderTarget, camera: OrthographicCamera): void {
    if (!this.visible) return;
    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    this.renderer.autoClear = previousAutoClear;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.targetTexture.dispose();
    this.listeningTargetTexture.dispose();
    this.propertiesTexture.dispose();
    this.appearanceTexture.dispose();
    this.occupancyTexture.dispose();
    this.glyphAtlas.texture.dispose();
    this.gpuCompute.dispose();
  }
}
