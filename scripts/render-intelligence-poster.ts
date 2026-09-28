import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { ByteField } from '../src/scripts/entity/bytes';
import { ENTITY_CELL, ENTITY_HEIGHT, ENTITY_RIM, ENTITY_WIDTH, FormBuilder } from '../src/scripts/entity/forms';

// The settled body, as the byte renderer draws it: the still before the runtime arrives.
const builder = new FormBuilder();
const bytes = new ByteField({
  width: ENTITY_WIDTH,
  height: ENTITY_HEIGHT,
  cell: ENTITY_CELL,
  ingress: { y: ENTITY_RIM + 2, left: ENTITY_WIDTH * 0.07, right: ENTITY_WIDTH * 0.93 },
});
bytes.setTarget(builder.build({ form: 'anatomy', time: 8, attention: 0, pointer: [0, -0.16] }));
bytes.settle();
const white = [255, 255, 255] as const;
const pixels = new Uint8ClampedArray(ENTITY_WIDTH * ENTITY_HEIGHT * 4);
bytes.render(pixels, { settled: white, flight: white, discard: white });
await mkdir('public/assets/dither', { recursive: true });
await sharp(Buffer.from(pixels.buffer), {
  raw: { width: ENTITY_WIDTH, height: ENTITY_HEIGHT, channels: 4 },
}).png({ palette: true }).toFile('public/assets/dither/entity-bytes.png');
console.log('public/assets/dither/entity-bytes.png');
