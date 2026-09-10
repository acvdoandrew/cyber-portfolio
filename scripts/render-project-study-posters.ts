import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { PixelField, STUDY_WIDTH, STUDY_HEIGHT, STUDY_IDS, drawStudy } from '../src/scripts/project-studies/scenes';
import { writeDither } from '../src/scripts/project-studies/dither';

await mkdir('public/assets/dither/studies', { recursive: true });
for (const id of STUDY_IDS) {
  const field = new PixelField();
  const pixels = new Uint8ClampedArray(STUDY_WIDTH * STUDY_HEIGHT * 4);
  drawStudy(field, id, 8);
  writeDither(field.values, pixels, [255, 255, 255]);
  const path = `public/assets/dither/studies/${id}.png`;
  await sharp(Buffer.from(pixels.buffer), {
    raw: { width: STUDY_WIDTH, height: STUDY_HEIGHT, channels: 4 },
  }).png().toFile(path);
  console.log(path);
}
