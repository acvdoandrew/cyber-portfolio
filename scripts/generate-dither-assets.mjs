#!/usr/bin/env node

/**
 * Generate the portfolio's project-preview artwork.
 *
 * Deterministic code-native diagrams and preserved original illustration
 * sources share one ordered 4x4 Bayer pass. The result is a set of
 * transparent/opaque ink masks that CSS can recolor for every site palette.
 *
 * This script prefers Sharp when it is already available. The dependency-free
 * PNG encoder is intentionally retained as a fallback; running this script never
 * requires installing or declaring another package.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const WIDTH = 960;
const HEIGHT = 640;
const ENTITY_WIDTH = 800;
const ENTITY_HEIGHT = 1000;
const POSTER_WIDTH = 640;
const POSTER_HEIGHT = 480;
const STATIC_TIME_SECONDS = 8;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIRECTORY = join(ROOT, 'public', 'assets', 'dither');
const ENTITY_SOURCE = join(
  ROOT,
  'artwork-source',
  'entity-08-solar-ghost-cartographer.png',
);
const PROJECT_ILLUSTRATION_DIRECTORY = join(
  ROOT,
  'artwork-source',
  'project-illustrations',
);
const SOCIAL_CARD_SOURCE = join(
  ROOT,
  'artwork-source',
  'og-social-card-framed-source.png',
);
const SOCIAL_CARD_OUTPUT = join(ROOT, 'public', 'og.png');

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const mix = (start, end, amount) => start + (end - start) * amount;

const smoothstep = (edge0, edge1, value) => {
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
};

const distanceToSegment = (x, y, startX, startY, endX, endY) => {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(x - startX, y - startY);
  const amount = clamp(
    ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
  );
  return Math.hypot(
    x - (startX + deltaX * amount),
    y - (startY + deltaY * amount),
  );
};

const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

class Field {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Float32Array(width * height);
  }

  composite(index, intensity, blend = 'max') {
    const next = clamp(intensity);
    if (next <= 0) return;
    if (blend === 'screen') {
      const current = this.pixels[index];
      this.pixels[index] = 1 - (1 - current) * (1 - next);
      return;
    }
    this.pixels[index] = Math.max(this.pixels[index], next);
  }

  sample(callback, blend = 'max') {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.composite(y * this.width + x, callback(x, y), blend);
      }
    }
  }

  paintBounds(minX, minY, maxX, maxY, callback, blend = 'max') {
    const left = Math.max(0, Math.floor(minX));
    const top = Math.max(0, Math.floor(minY));
    const right = Math.min(this.width - 1, Math.ceil(maxX));
    const bottom = Math.min(this.height - 1, Math.ceil(maxY));

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        this.composite(y * this.width + x, callback(x, y), blend);
      }
    }
  }

  line(startX, startY, endX, endY, width = 1, intensity = 1, feather = 1) {
    const padding = width + feather + 1;
    this.paintBounds(
      Math.min(startX, endX) - padding,
      Math.min(startY, endY) - padding,
      Math.max(startX, endX) + padding,
      Math.max(startY, endY) + padding,
      (x, y) => {
        const distance = distanceToSegment(
          x + 0.5,
          y + 0.5,
          startX,
          startY,
          endX,
          endY,
        );
        return (
          intensity *
          (1 - smoothstep(width, Math.max(width + feather, width + 0.001), distance))
        );
      },
    );
  }

  dashedLine(
    startX,
    startY,
    endX,
    endY,
    width = 1,
    intensity = 1,
    dashLength = 8,
    gapLength = 7,
  ) {
    const length = Math.hypot(endX - startX, endY - startY);
    if (length === 0) return;
    const deltaX = (endX - startX) / length;
    const deltaY = (endY - startY) / length;
    const period = dashLength + gapLength;
    for (let distance = 0; distance < length; distance += period) {
      const dashEnd = Math.min(length, distance + dashLength);
      this.line(
        startX + deltaX * distance,
        startY + deltaY * distance,
        startX + deltaX * dashEnd,
        startY + deltaY * dashEnd,
        width,
        intensity,
        0.75,
      );
    }
  }

  polyline(points, width = 1, intensity = 1, feather = 1) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      this.line(
        previous.x,
        previous.y,
        current.x,
        current.y,
        width,
        intensity,
        feather,
      );
    }
  }

  disc(centerX, centerY, radius, intensity = 1, feather = 1, blend = 'max') {
    const padding = radius + feather + 1;
    this.paintBounds(
      centerX - padding,
      centerY - padding,
      centerX + padding,
      centerY + padding,
      (x, y) => {
        const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
        return (
          intensity *
          (1 - smoothstep(radius, Math.max(radius + feather, radius + 0.001), distance))
        );
      },
      blend,
    );
  }

  ring(centerX, centerY, radius, width = 1, intensity = 1, feather = 1) {
    const padding = radius + width + feather + 1;
    this.paintBounds(
      centerX - padding,
      centerY - padding,
      centerX + padding,
      centerY + padding,
      (x, y) => {
        const distance = Math.abs(
          Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY) - radius,
        );
        return (
          intensity *
          (1 - smoothstep(width, Math.max(width + feather, width + 0.001), distance))
        );
      },
    );
  }

  rectangle(x, y, width, height, intensity = 1, feather = 0) {
    this.paintBounds(
      x - feather,
      y - feather,
      x + width + feather,
      y + height + feather,
      (sampleX, sampleY) => {
        const outsideX = Math.max(x - (sampleX + 0.5), 0, sampleX + 0.5 - (x + width));
        const outsideY = Math.max(y - (sampleY + 0.5), 0, sampleY + 0.5 - (y + height));
        const outside = Math.hypot(outsideX, outsideY);
        return intensity * (1 - smoothstep(0, Math.max(feather, 0.001), outside));
      },
    );
  }

  rectangleOutline(x, y, width, height, strokeWidth = 1, intensity = 1) {
    this.line(x, y, x + width, y, strokeWidth, intensity, 0.5);
    this.line(x + width, y, x + width, y + height, strokeWidth, intensity, 0.5);
    this.line(x + width, y + height, x, y + height, strokeWidth, intensity, 0.5);
    this.line(x, y + height, x, y, strokeWidth, intensity, 0.5);
  }

  cross(x, y, radius = 5, intensity = 1) {
    this.line(x - radius, y, x + radius, y, 1, intensity, 0.5);
    this.line(x, y - radius, x, y + radius, 1, intensity, 0.5);
  }
}

const drawReferenceGrid = (field, inset = 48) => {
  for (let x = inset; x <= field.width - inset; x += 64) {
    field.dashedLine(x, inset, x, field.height - inset, 0.6, 0.12, 2, 10);
  }
  for (let y = inset; y <= field.height - inset; y += 64) {
    field.dashedLine(inset, y, field.width - inset, y, 0.6, 0.12, 2, 10);
  }
  field.rectangleOutline(
    inset,
    inset,
    field.width - inset * 2,
    field.height - inset * 2,
    0.75,
    0.24,
  );
  field.line(inset, inset + 18, inset, inset, 1, 0.8, 0.4);
  field.line(inset, inset, inset + 18, inset, 1, 0.8, 0.4);
  field.line(
    field.width - inset - 18,
    field.height - inset,
    field.width - inset,
    field.height - inset,
    1,
    0.8,
    0.4,
  );
  field.line(
    field.width - inset,
    field.height - inset - 18,
    field.width - inset,
    field.height - inset,
    1,
    0.8,
    0.4,
  );
};

const drawAresFrontier = () => {
  const field = new Field(WIDTH, HEIGHT);
  const random = mulberry32(0xa2e52026);
  const centerX = WIDTH * 0.51;
  const centerY = HEIGHT * 0.51;

  drawReferenceGrid(field);

  // Topographic bands describe the known territory and its unstable edge.
  field.sample((x, y) => {
    const deltaX = x - centerX;
    const deltaY = y - centerY;
    const angle = Math.atan2(deltaY, deltaX);
    const radius = Math.hypot(deltaX * 0.92, deltaY * 1.08);
    const distortion =
      17 * Math.sin(angle * 3 + 0.7) +
      9 * Math.sin(angle * 7 - 0.4) +
      4 * Math.cos(angle * 13);
    let ink = 0;
    for (const contour of [82, 132, 186, 244]) {
      const distance = Math.abs(radius + distortion - contour);
      ink = Math.max(ink, 0.5 * (1 - smoothstep(1, 5, distance)));
    }

    const frontier = 278 + 28 * Math.sin(angle * 5 + 0.4) + 13 * Math.cos(angle * 9);
    const frontierDistance = Math.abs(radius - frontier);
    ink = Math.max(ink, 0.8 * (1 - smoothstep(1, 7, frontierDistance)));

    if (radius < 268 + distortion && radius > 68) {
      const grain =
        0.5 +
        0.25 * Math.sin(x * 0.061 + y * 0.037) +
        0.25 * Math.sin(y * 0.083 - x * 0.029);
      ink = Math.max(ink, grain > 0.73 ? 0.15 : 0);
    }
    return ink;
  });

  const nodes = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < 31; index += 1) {
    const amount = (index + 1) / 32;
    const angle = index * goldenAngle + (random() - 0.5) * 0.22;
    const radius = 34 + Math.sqrt(amount) * 246 + (random() - 0.5) * 24;
    nodes.push({
      x: centerX + Math.cos(angle) * radius * 1.1,
      y: centerY + Math.sin(angle) * radius * 0.82,
      tier: index % 5,
    });
  }

  // Each settlement joins its nearest earlier settlements, yielding a stable
  // frontier topology without a runtime graph dependency.
  nodes.forEach((node, index) => {
    const candidates = nodes
      .slice(0, index)
      .map((candidate, candidateIndex) => ({
        candidate,
        candidateIndex,
        distance: Math.hypot(candidate.x - node.x, candidate.y - node.y),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance || left.candidateIndex - right.candidateIndex,
      )
      .slice(0, index > 8 && index % 3 === 0 ? 2 : 1);

    candidates.forEach(({ candidate, distance }) => {
      if (distance > 176) return;
      field.line(node.x, node.y, candidate.x, candidate.y, 5, 0.13, 5);
      field.line(node.x, node.y, candidate.x, candidate.y, 1.2, 0.88, 0.7);
    });
  });

  nodes.forEach((node) => {
    field.ring(node.x, node.y, 7 + (node.tier % 3) * 2, 1.2, 0.94, 0.6);
    field.disc(node.x, node.y, node.tier === 0 ? 3.5 : 2.2, 1, 0.5);
    if (node.tier === 0) field.cross(node.x, node.y, 13, 0.72);
  });

  field.ring(centerX, centerY, 24, 2, 1, 0.5);
  field.ring(centerX, centerY, 40, 1, 0.64, 0.8);
  field.disc(centerX, centerY, 6, 1, 0.5);
  field.cross(centerX, centerY, 54, 0.78);

  // Survey rays extending into the unresolved perimeter.
  for (const angle of [-2.55, -1.5, -0.42, 0.58, 1.46, 2.72]) {
    const startRadius = 265;
    const endRadius = 330;
    field.dashedLine(
      centerX + Math.cos(angle) * startRadius,
      centerY + Math.sin(angle) * startRadius * 0.82,
      centerX + Math.cos(angle) * endRadius,
      centerY + Math.sin(angle) * endRadius * 0.82,
      1,
      0.75,
      5,
      6,
    );
  }

  return field;
};

const drawEdgeNetwork = () => {
  const field = new Field(WIDTH, HEIGHT);
  drawReferenceGrid(field);

  const processors = [
    { x: 154, y: 156, width: 122, height: 84 },
    { x: 154, y: 394, width: 122, height: 84 },
    { x: 419, y: 252, width: 150, height: 136, core: true },
    { x: 694, y: 120, width: 116, height: 78 },
    { x: 704, y: 281, width: 116, height: 78 },
    { x: 686, y: 442, width: 116, height: 78 },
  ];

  // Soft bandwidth envelopes become ordered-dot regions after thresholding.
  const paths = [
    [{ x: 276, y: 198 }, { x: 350, y: 198 }, { x: 350, y: 286 }, { x: 419, y: 286 }],
    [{ x: 276, y: 436 }, { x: 350, y: 436 }, { x: 350, y: 354 }, { x: 419, y: 354 }],
    [{ x: 569, y: 285 }, { x: 634, y: 285 }, { x: 634, y: 159 }, { x: 694, y: 159 }],
    [{ x: 569, y: 320 }, { x: 704, y: 320 }],
    [{ x: 569, y: 354 }, { x: 625, y: 354 }, { x: 625, y: 481 }, { x: 686, y: 481 }],
  ];

  paths.forEach((points, index) => {
    field.polyline(points, 13, 0.18, 7);
    field.polyline(points, 1.5, index === 2 ? 1 : 0.86, 0.6);
  });

  processors.forEach((processor, index) => {
    field.rectangleOutline(
      processor.x,
      processor.y,
      processor.width,
      processor.height,
      processor.core ? 2 : 1.25,
      0.95,
    );
    field.rectangleOutline(
      processor.x + 9,
      processor.y + 9,
      processor.width - 18,
      processor.height - 18,
      0.75,
      0.46,
    );

    const rows = processor.core ? 5 : 3;
    for (let row = 0; row < rows; row += 1) {
      const rowY =
        processor.y + 20 + (row * (processor.height - 40)) / Math.max(1, rows - 1);
      field.line(
        processor.x + 20,
        rowY,
        processor.x + processor.width - 28,
        rowY,
        1,
        row % 2 === 0 ? 0.9 : 0.48,
        0.5,
      );
      field.disc(
        processor.x + processor.width - 17,
        rowY,
        row === index % rows ? 3 : 1.8,
        row === index % rows ? 1 : 0.5,
        0.4,
      );
    }
  });

  const packetLocations = [
    [319, 198],
    [350, 253],
    [350, 397],
    [390, 354],
    [611, 285],
    [634, 220],
    [655, 320],
    [625, 411],
  ];
  packetLocations.forEach(([x, y], index) => {
    field.rectangle(x - 5, y - 5, 10, 10, index % 3 === 0 ? 1 : 0.74, 0.5);
    field.ring(x, y, 10, 0.7, 0.28, 0.6);
  });

  // Circuit traces and I/O contacts frame the network.
  for (let index = 0; index < 11; index += 1) {
    const y = 112 + index * 42;
    const length = 20 + (index % 4) * 11;
    field.line(78, y, 78 + length, y, 1, index % 2 ? 0.48 : 0.78, 0.5);
    field.disc(72, y, 2, 0.9, 0.4);
    field.line(
      WIDTH - 78 - length,
      y,
      WIDTH - 78,
      y,
      1,
      index % 2 ? 0.78 : 0.48,
      0.5,
    );
    field.disc(WIDTH - 72, y, 2, 0.9, 0.4);
  }

  field.ring(WIDTH / 2, HEIGHT / 2, 224, 0.8, 0.22, 0.8);
  field.ring(WIDTH / 2, HEIGHT / 2, 248, 0.8, 0.12, 0.8);
  field.cross(WIDTH / 2, HEIGHT / 2, 18, 0.7);

  return field;
};

const drawPhysicsParticles = () => {
  const field = new Field(WIDTH, HEIGHT);
  const random = mulberry32(0xf15c5206);
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;

  drawReferenceGrid(field);

  // Analytic potential wells provide a sparse dithered field behind particles.
  field.sample((x, y) => {
    const leftDistance = Math.hypot(x - (centerX - 142), y - centerY);
    const rightDistance = Math.hypot(x - (centerX + 142), y - centerY);
    const saddle = Math.abs(leftDistance - rightDistance);
    const shell =
      0.2 *
      (1 - smoothstep(0, 5, Math.abs(leftDistance + rightDistance - 430)));
    const bisector = 0.13 * (1 - smoothstep(0, 12, saddle));
    return Math.max(shell, bisector);
  });

  const wells = [
    { x: centerX - 142, y: centerY, spin: 1 },
    { x: centerX + 142, y: centerY, spin: -1 },
  ];

  for (let index = 0; index < 280; index += 1) {
    const well = wells[index % 2];
    const radialBias = Math.pow(random(), 0.62);
    const radius = 26 + radialBias * 238;
    const angle = random() * Math.PI * 2 + radius * 0.015 * well.spin;
    const coupling = Math.exp(-Math.abs(radius - 142) / 96);
    const positionX =
      well.x +
      Math.cos(angle) * radius +
      (centerX - well.x) * coupling * 0.27 +
      Math.sin(angle * 3) * 8;
    const positionY =
      well.y +
      Math.sin(angle) * radius * 0.69 +
      Math.cos(angle * 2) * 9;

    const trailAngle = angle - well.spin * (0.045 + 0.08 * (1 - radialBias));
    const trailX =
      well.x +
      Math.cos(trailAngle) * (radius + 3) +
      (centerX - well.x) * coupling * 0.27;
    const trailY = well.y + Math.sin(trailAngle) * (radius + 3) * 0.69;
    const particleRadius = index % 19 === 0 ? 4 : index % 7 === 0 ? 2.4 : 1.35;
    const particleInk = index % 5 === 0 ? 1 : 0.72;

    field.line(trailX, trailY, positionX, positionY, 0.8, 0.42, 0.5);
    field.disc(positionX, positionY, particleRadius, particleInk, 0.5);
    if (index % 31 === 0) {
      field.ring(positionX, positionY, particleRadius + 7, 0.8, 0.42, 0.6);
    }
  }

  wells.forEach((well) => {
    field.disc(well.x, well.y, 9, 1, 1);
    field.ring(well.x, well.y, 20, 1.3, 0.9, 0.6);
    field.ring(well.x, well.y, 42, 0.8, 0.38, 0.8);
    field.cross(well.x, well.y, 56, 0.54);
  });

  // The collision bridge carries particles between the two potential wells.
  const bridge = [];
  for (let index = 0; index <= 18; index += 1) {
    const amount = index / 18;
    bridge.push({
      x: mix(wells[0].x, wells[1].x, amount),
      y: centerY + Math.sin(amount * Math.PI * 4) * (8 + 12 * Math.sin(amount * Math.PI)),
    });
  }
  field.polyline(bridge, 7, 0.2, 5);
  field.polyline(bridge, 1.1, 0.95, 0.5);
  bridge
    .filter((_, index) => index % 3 === 0)
    .forEach((point, index) => field.disc(point.x, point.y, index % 2 ? 2 : 3, 1, 0.4));

  // Sparse vector probes indicate flow direction.
  for (let y = 126; y <= 514; y += 64) {
    for (let x = 116; x <= 844; x += 72) {
      const deltaX = x - centerX;
      const deltaY = y - centerY;
      const angle = Math.atan2(deltaY, deltaX) + Math.PI / 2;
      const length = 7;
      field.line(
        x - Math.cos(angle) * length,
        y - Math.sin(angle) * length,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
        0.7,
        0.28,
        0.5,
      );
    }
  }

  return field;
};

const drawInferenceLatency = () => {
  const field = new Field(WIDTH, HEIGHT);
  const random = mulberry32(0x1afe2026);
  drawReferenceGrid(field);

  const startX = 102;
  const endX = 864;
  const laneYs = [122, 184, 246, 308, 370];

  laneYs.forEach((y, laneIndex) => {
    field.dashedLine(startX, y, endX, y, 0.7, 0.3, 3, 9);
    field.line(startX - 18, y, startX, y, 1, 0.82, 0.5);

    const tokenCount = 5 + laneIndex;
    let cursor = startX + 18 + laneIndex * 7;
    for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
      const tokenWidth = 28 + Math.floor(random() * 24);
      const accepted = tokenIndex < tokenCount - 1 - (laneIndex % 2);
      const intensity = accepted ? 0.96 : 0.28;
      field.rectangleOutline(cursor, y - 12, tokenWidth, 24, 1, intensity);
      if (accepted) {
        field.rectangle(cursor + 5, y - 7, tokenWidth - 10, 3, 0.6, 0.5);
        field.disc(cursor + tokenWidth - 7, y + 6, 1.7, 0.88, 0.3);
      } else {
        field.line(cursor + 4, y - 8, cursor + tokenWidth - 4, y + 8, 0.8, 0.45, 0.5);
        field.line(cursor + tokenWidth - 4, y - 8, cursor + 4, y + 8, 0.8, 0.45, 0.5);
      }
      cursor += tokenWidth + 13 + Math.floor(random() * 7);
      if (cursor > endX - 46) break;
    }
  });

  // Speculation branches connect accepted prefixes to parallel candidate lanes.
  const branches = [
    [{ x: 252, y: 122 }, { x: 278, y: 153 }, { x: 334, y: 184 }],
    [{ x: 402, y: 184 }, { x: 430, y: 215 }, { x: 492, y: 246 }],
    [{ x: 520, y: 246 }, { x: 558, y: 277 }, { x: 610, y: 308 }],
    [{ x: 644, y: 308 }, { x: 682, y: 339 }, { x: 728, y: 370 }],
  ];
  branches.forEach((points, index) => {
    field.polyline(points, 5, 0.14, 4);
    field.polyline(points, 1, index % 2 ? 0.7 : 0.95, 0.5);
    const midpoint = points[1];
    field.disc(midpoint.x, midpoint.y, 3, 1, 0.5);
  });

  // Bottom trace: stepped latency with a low-density area fill.
  const graphTop = 438;
  const graphBottom = 538;
  const graphLeft = 106;
  const graphRight = 856;
  field.line(graphLeft, graphBottom, graphRight, graphBottom, 1.2, 0.75, 0.5);
  field.line(graphLeft, graphTop, graphLeft, graphBottom, 1.2, 0.75, 0.5);

  const trace = [{ x: graphLeft, y: graphBottom - 12 }];
  let traceX = graphLeft;
  let traceY = graphBottom - 12;
  for (let index = 0; index < 26; index += 1) {
    traceX += 22 + Math.floor(random() * 11);
    if (traceX > graphRight) traceX = graphRight;
    const spike = index === 7 || index === 16 || index === 22;
    traceY = spike
      ? graphTop + 9 + Math.floor(random() * 20)
      : graphBottom - 12 - Math.floor(random() * 34);
    trace.push({ x: traceX, y: trace[index].y }, { x: traceX, y: traceY });
    if (traceX === graphRight) break;
  }

  field.polyline(trace, 7, 0.16, 5);
  field.polyline(trace, 1.3, 0.98, 0.5);
  trace
    .filter((_, index) => index % 4 === 1)
    .forEach((point) => field.disc(point.x, point.y, 2.2, 0.9, 0.4));

  field.paintBounds(graphLeft, graphTop, graphRight, graphBottom, (x, y) => {
    let ceiling = graphBottom;
    for (let index = 1; index < trace.length; index += 1) {
      const previous = trace[index - 1];
      const current = trace[index];
      if (x >= previous.x && x <= current.x) {
        ceiling =
          previous.x === current.x
            ? Math.min(previous.y, current.y)
            : mix(
                previous.y,
                current.y,
                (x - previous.x) / Math.max(1, current.x - previous.x),
              );
        break;
      }
    }
    if (y < ceiling || y > graphBottom) return 0;
    const depth = (y - ceiling) / Math.max(1, graphBottom - ceiling);
    return 0.2 * (1 - depth * 0.7);
  });

  for (let index = 0; index <= 10; index += 1) {
    const x = mix(graphLeft, graphRight, index / 10);
    field.line(x, graphBottom, x, graphBottom + 7, 0.8, 0.62, 0.4);
  }

  return field;
};

const drawRecursiveFieldPoster = () => {
  const field = new Field(POSTER_WIDTH, POSTER_HEIGHT);
  const minimumDimension = Math.min(POSTER_WIDTH, POSTER_HEIGHT);
  const time = STATIC_TIME_SECONDS;

  field.sample((x, y) => {
    // WebGL's fragment origin is bottom-left; translating it explicitly keeps
    // the static fallback aligned with the live shader rather than mirroring it.
    const fragmentX = x + 0.5;
    const fragmentY = POSTER_HEIGHT - y - 0.5;
    const uvX = (2 * fragmentX - POSTER_WIDTH) / minimumDimension;
    const uvY = (2 * fragmentY - POSTER_HEIGHT) / minimumDimension;
    const radius = Math.hypot(uvX, uvY);
    const angle = Math.atan2(uvY, uvX);

    let positionX = Math.abs(uvX) * 1.06;
    let positionY = uvY * 1.06;
    const baseRotation = 0.18 * Math.sin(time * 0.19);
    const baseCosine = Math.cos(baseRotation);
    const baseSine = Math.sin(baseRotation);
    const baseX = positionX * baseCosine - positionY * baseSine;
    const baseY = positionX * baseSine + positionY * baseCosine;
    positionX = baseX;
    positionY = baseY;

    let recursive = 0;
    let weight = 1;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      positionX = Math.abs(positionX);
      positionY = Math.abs(positionY);
      const denominator = clamp(
        positionX * positionX + positionY * positionY,
        0.12,
        4,
      );
      positionX = positionX / denominator - 0.79;
      positionY = positionY / denominator - 0.57;

      const rotation =
        0.48 + 0.08 * Math.sin(time * 0.21 + iteration * 1.7);
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const rotatedX = positionX * cosine - positionY * sine;
      const rotatedY = positionX * sine + positionY * cosine;
      positionX = rotatedX;
      positionY = rotatedY;

      const recursiveRadius = Math.hypot(positionX, positionY);
      const shell = Math.exp(
        -20 *
          Math.abs(
            recursiveRadius -
              (0.63 + 0.035 * Math.sin(time * 0.34 + iteration)),
          ),
      );
      const filamentBase =
        0.5 +
        0.5 *
          Math.cos(
            10 * Math.atan2(positionY, positionX) +
              recursiveRadius * 7 -
              time,
          );
      const filaments = filamentBase ** 7;
      recursive += (shell * (0.64 + 0.68 * filaments)) / weight;
      weight *= 1.32;
    }

    const ringsBase =
      0.5 +
      0.5 *
        Math.cos(
          31 * Math.log(radius + 0.17) -
            10 * angle -
            1.35 * time +
            2.6 * Math.sin(3 * angle + time * 0.24),
        );
    const rings = ringsBase ** 8 * Math.exp(-0.38 * radius);

    const oppositeRingsBase =
      0.5 +
      0.5 *
        Math.cos(
          26 * radius +
            8 * angle +
            0.82 * time +
            2 * Math.sin(5 * angle - time * 0.31),
        );
    const oppositeRings = oppositeRingsBase ** 11;
    const spokes =
      Math.abs(
        Math.cos(
          angle * 12 + 2.4 * Math.sin(radius * 5 - time * 0.46),
        ),
      ) ** 24;
    const iris = Math.exp(
      -6 * Math.abs(radius - (0.24 + 0.025 * Math.sin(time * 0.6))),
    );
    const center =
      Math.exp(-7.5 * radius) *
      (0.55 + 0.45 * Math.cos(angle * 8 + time));
    const outerFade = smoothstep(1.65, 0.22, radius);

    let value =
      recursive * 0.54 +
      rings * 0.46 +
      oppositeRings * 0.22 +
      spokes * (0.1 + 0.3 * smoothstep(1.5, 0.2, radius)) +
      iris * 0.38 +
      center * 0.24;
    value *= outerFade;
    value += 0.055 * Math.sin(fragmentY * 0.37 + time * 2);
    return smoothstep(0.16, 0.93, value);
  });

  return field;
};

const drawEntityCartographer = async (sharp) => {
  if (!sharp) {
    throw new Error(
      'Sharp is required to decode artwork-source/entity-08-solar-ghost-cartographer.png',
    );
  }

  const { data, info } = await sharp(ENTITY_SOURCE)
    .resize({
      width: ENTITY_WIDTH,
      height: ENTITY_HEIGHT,
      fit: 'contain',
      position: 'centre',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      kernel: 'lanczos3',
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (
    info.width !== ENTITY_WIDTH ||
    info.height !== ENTITY_HEIGHT ||
    info.channels !== 3
  ) {
    throw new Error(
      `Unexpected entity decode: ${info.width}x${info.height} with ${info.channels} channels`,
    );
  }

  const field = new Field(info.width, info.height);
  for (let pixelIndex = 0; pixelIndex < field.pixels.length; pixelIndex += 1) {
    const sourceOffset = pixelIndex * info.channels;
    const red = data[sourceOffset];
    const green = data[sourceOffset + 1];
    const blue = data[sourceOffset + 2];
    const luminance =
      (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    const darkness = 1 - luminance;
    const blueContrast = Math.max(
      0,
      (blue - red) / 170,
      (blue - green) / 150,
    );

    // The original is blue ink on warm paper. Combining chroma and luminance
    // cleanly drops the paper while retaining its finest antialiased traces.
    const ink = blueContrast * 0.82 + darkness * 0.25;
    field.pixels[pixelIndex] = smoothstep(0.025, 0.86, ink);
  }
  return field;
};

const drawProjectEngraving = async (sharp, sourceFilename) => {
  if (!sharp) {
    throw new Error(
      `Sharp is required to decode artwork-source/project-illustrations/${sourceFilename}`,
    );
  }

  const sourcePath = join(PROJECT_ILLUSTRATION_DIRECTORY, sourceFilename);
  const { data, info } = await sharp(sourcePath)
    .resize({
      width: WIDTH,
      height: HEIGHT,
      fit: 'cover',
      position: 'centre',
      kernel: 'lanczos3',
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== WIDTH || info.height !== HEIGHT || info.channels !== 3) {
    throw new Error(
      `Unexpected project illustration decode: ${info.width}x${info.height} with ${info.channels} channels`,
    );
  }

  const field = new Field(info.width, info.height);
  for (let pixelIndex = 0; pixelIndex < field.pixels.length; pixelIndex += 1) {
    const sourceOffset = pixelIndex * info.channels;
    const red = data[sourceOffset];
    const green = data[sourceOffset + 1];
    const blue = data[sourceOffset + 2];
    const luminance =
      (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    const darkness = 1 - luminance;

    // Remove nearly white paper, then preserve both fine engraving lines and
    // broad midtones for the shared ordered-dot pass.
    field.pixels[pixelIndex] =
      darkness < 0.028
        ? 0
        : clamp(
            smoothstep(0.024, 0.9, darkness) * 0.84 +
              smoothstep(0.16, 0.72, darkness) * 0.18,
          );
  }
  return field;
};

const toBinaryMask = (
  field,
  { thresholdScale = 1, thresholdOffset = 0, flipBayerY = false } = {},
) => {
  const rgba = Buffer.alloc(field.width * field.height * 4, 255);
  let opaquePixels = 0;

  for (let y = 0; y < field.height; y += 1) {
    for (let x = 0; x < field.width; x += 1) {
      const pixelIndex = y * field.width + x;
      const bayerY = flipBayerY ? field.height - y - 1 : y;
      const threshold =
        ((BAYER_4X4[bayerY % 4][x % 4] + 0.5) / 16) * thresholdScale +
        thresholdOffset;
      const opaque = field.pixels[pixelIndex] >= threshold;
      rgba[pixelIndex * 4 + 3] = opaque ? 255 : 0;
      if (opaque) opaquePixels += 1;
    }
  }

  return { rgba, opaquePixels };
};

let crcTable;

const makeCrcTable = () => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
};

const crc32 = (buffer) => {
  if (!crcTable) crcTable = makeCrcTable();
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length);
  const checksumBuffer = Buffer.alloc(4);
  checksumBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([lengthBuffer, typeBuffer, data, checksumBuffer]);
};

const encodePngWithoutDependencies = (rgba, width, height) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolor with alpha
  header[10] = 0; // deflate compression
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const outputOffset = y * (stride + 1);
    scanlines[outputOffset] = 0;
    rgba.copy(scanlines, outputOffset + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const resolveEncoder = async () => {
  try {
    const { default: sharp } = await import('sharp');
    return {
      name: 'sharp',
      sharp,
      write: async (rgba, width, height, outputPath) => {
        await sharp(rgba, {
          raw: { width, height, channels: 4 },
        })
          .png({
            adaptiveFiltering: false,
            compressionLevel: 9,
            effort: 10,
            palette: false,
          })
          .toFile(outputPath);
      },
    };
  } catch {
    return {
      name: 'node:zlib fallback',
      sharp: null,
      write: async (rgba, width, height, outputPath) => {
        await writeFile(outputPath, encodePngWithoutDependencies(rgba, width, height));
      },
    };
  }
};

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const encoder = await resolveEncoder();
const artwork = [
  { filename: 'ares-frontier.png', draw: drawAresFrontier },
  { filename: 'edge-network.png', draw: drawEdgeNetwork },
  { filename: 'physics-particles.png', draw: drawPhysicsParticles },
  { filename: 'inference-latency.png', draw: drawInferenceLatency },
  {
    filename: 'ares-frontier-engraving.png',
    draw: () =>
      drawProjectEngraving(encoder.sharp, 'ares-frontier-engraving-source.png'),
    mask: { thresholdScale: 0.94, thresholdOffset: 0.015 },
  },
  {
    filename: 'edge-node-engraving.png',
    draw: () =>
      drawProjectEngraving(encoder.sharp, 'edge-node-engraving-source.png'),
    mask: { thresholdScale: 0.94, thresholdOffset: 0.015 },
  },
  {
    filename: 'physics-engine-engraving.png',
    draw: () =>
      drawProjectEngraving(
        encoder.sharp,
        'physics-engine-engraving-source.png',
      ),
    mask: { thresholdScale: 0.94, thresholdOffset: 0.015 },
  },
  {
    filename: 'inference-proxy-engraving.png',
    draw: () =>
      drawProjectEngraving(
        encoder.sharp,
        'inference-proxy-engraving-source.png',
      ),
    mask: { thresholdScale: 0.94, thresholdOffset: 0.015 },
  },
  {
    filename: 'ares-validation-plate.png',
    draw: () =>
      drawProjectEngraving(encoder.sharp, 'ares-system-plate-source.png'),
    mask: { thresholdScale: 0.94, thresholdOffset: 0.015 },
  },
  {
    filename: 'edge-lease-control-plate.png',
    draw: () =>
      drawProjectEngraving(
        encoder.sharp,
        'edge-control-plane-plate-source.png',
      ),
    mask: { thresholdScale: 0.94, thresholdOffset: 0.015 },
  },
  {
    filename: 'physics-verlet-plate.png',
    draw: () =>
      drawProjectEngraving(encoder.sharp, 'physics-solver-plate-source.png'),
    mask: { thresholdScale: 0.94, thresholdOffset: 0.015 },
  },
  {
    filename: 'inference-routing-plate.png',
    draw: () =>
      drawProjectEngraving(
        encoder.sharp,
        'inference-measurement-plate-source.png',
      ),
    mask: { thresholdScale: 0.94, thresholdOffset: 0.015 },
  },
  {
    filename: 'entity-08-solar-ghost-cartographer.png',
    draw: () => drawEntityCartographer(encoder.sharp),
  },
  {
    filename: 'recursive-field-poster.png',
    draw: drawRecursiveFieldPoster,
    mask: {
      thresholdScale: 0.86,
      thresholdOffset: 0.07,
      flipBayerY: true,
    },
  },
];
const results = [];

for (const { filename, draw, mask } of artwork) {
  const field = await draw();
  const { rgba, opaquePixels } = toBinaryMask(field, mask);
  const outputPath = join(OUTPUT_DIRECTORY, filename);
  await encoder.write(rgba, field.width, field.height, outputPath);
  const file = await readFile(outputPath);
  results.push({
    file: `public/assets/dither/${filename}`,
    width: field.width,
    height: field.height,
    bytes: file.length,
    opaquePixels,
    coverage: `${((opaquePixels / (field.width * field.height)) * 100).toFixed(2)}%`,
    sha256: createHash('sha256').update(file).digest('hex'),
  });
}

if (!encoder.sharp) {
  throw new Error(
    'Sharp is required to resize artwork-source/og-social-card-framed-source.png',
  );
}

await encoder.sharp(SOCIAL_CARD_SOURCE)
  .resize({
    width: 1200,
    height: 630,
    fit: 'cover',
    position: 'centre',
    kernel: 'lanczos3',
  })
  .png({
    adaptiveFiltering: true,
    compressionLevel: 9,
    effort: 10,
    palette: true,
    colours: 96,
    dither: 0.25,
  })
  .toFile(SOCIAL_CARD_OUTPUT);

const socialCard = await readFile(SOCIAL_CARD_OUTPUT);

console.log(
  JSON.stringify(
    {
      encoder: encoder.name,
      assets: results,
      socialCard: {
        file: 'public/og.png',
        width: 1200,
        height: 630,
        bytes: socialCard.length,
        sha256: createHash('sha256').update(socialCard).digest('hex'),
      },
    },
    null,
    2,
  ),
);
