import type { DataTexture } from 'three';
import { ENTITY_GLYPHS } from './topology';

type ThreeAdapter = typeof import('../three-adapter');

export interface GlyphAtlas {
  texture: DataTexture;
  columns: number;
  rows: number;
  count: number;
  cellSize: number;
}

const CELL_SIZE = 32;
const COLUMNS = 16;
const DISTANCE_LIMIT = 9;
const SQRT_TWO = Math.SQRT2;

function distanceTransform(distance: Float32Array, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let value = distance[index];
      if (x > 0) value = Math.min(value, distance[index - 1] + 1);
      if (y > 0) value = Math.min(value, distance[index - width] + 1);
      if (x > 0 && y > 0) value = Math.min(value, distance[index - width - 1] + SQRT_TWO);
      if (x + 1 < width && y > 0) value = Math.min(value, distance[index - width + 1] + SQRT_TWO);
      distance[index] = value;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let value = distance[index];
      if (x + 1 < width) value = Math.min(value, distance[index + 1] + 1);
      if (y + 1 < height) value = Math.min(value, distance[index + width] + 1);
      if (x + 1 < width && y + 1 < height) value = Math.min(value, distance[index + width + 1] + SQRT_TWO);
      if (x > 0 && y + 1 < height) value = Math.min(value, distance[index + width - 1] + SQRT_TWO);
      distance[index] = value;
    }
  }
}

export function createGlyphAtlas(THREE: ThreeAdapter): GlyphAtlas {
  const rows = Math.ceil(ENTITY_GLYPHS.length / COLUMNS);
  const width = COLUMNS * CELL_SIZE;
  const height = rows * CELL_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('ENTITY_07 glyph atlas canvas is unavailable');

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 21px "Doto", "Courier New", monospace';
  ENTITY_GLYPHS.forEach((glyph, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    context.save();
    context.translate(column * CELL_SIZE + CELL_SIZE * 0.5, row * CELL_SIZE + CELL_SIZE * 0.51);
    const widthScale = /[MW@%#]/.test(glyph) ? 0.78 : 1;
    context.scale(widthScale, 1);
    context.fillText(glyph, 0, 0, CELL_SIZE - 7);
    context.restore();
  });

  const source = context.getImageData(0, 0, width, height).data;
  const inside = new Float32Array(width * height);
  const outside = new Float32Array(width * height);
  const infinity = width + height;
  for (let index = 0; index < inside.length; index += 1) {
    const occupied = source[index * 4 + 3] > 40;
    inside[index] = occupied ? 0 : infinity;
    outside[index] = occupied ? infinity : 0;
  }
  distanceTransform(inside, width, height);
  distanceTransform(outside, width, height);

  const atlasData = new Uint8Array(width * height * 4);
  for (let index = 0; index < inside.length; index += 1) {
    const signedDistance = outside[index] - inside[index];
    const value = Math.round(Math.max(0, Math.min(1, 0.5 + signedDistance / (DISTANCE_LIMIT * 2))) * 255);
    const offset = index * 4;
    atlasData[offset] = value;
    atlasData[offset + 1] = value;
    atlasData[offset + 2] = value;
    atlasData[offset + 3] = 255;
  }

  const texture = new THREE.DataTexture(atlasData, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, columns: COLUMNS, rows, count: ENTITY_GLYPHS.length, cellSize: CELL_SIZE };
}
