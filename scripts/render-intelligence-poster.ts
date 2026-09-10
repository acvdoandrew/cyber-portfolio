import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { PixelField } from '../src/scripts/project-studies/scenes';
import { writeDither } from '../src/scripts/project-studies/dither';
import { drawIntelligence, INTELLIGENCE_WIDTH, INTELLIGENCE_HEIGHT, TERMINAL_ENTITY_WIDTH, TERMINAL_ENTITY_HEIGHT } from '../src/scripts/intelligence-geometry';

const field = new PixelField(INTELLIGENCE_WIDTH, INTELLIGENCE_HEIGHT);
const output = new Uint8ClampedArray(field.values.length * 4);
drawIntelligence(field, 8);
writeDither(field.values, output, [255, 255, 255], INTELLIGENCE_WIDTH, INTELLIGENCE_HEIGHT);
await mkdir('public/assets/dither', { recursive: true });
await sharp(Buffer.from(output.buffer), {
  raw: { width: INTELLIGENCE_WIDTH, height: INTELLIGENCE_HEIGHT, channels: 4 },
}).png().toFile('public/assets/dither/intelligence-pixels.png');
console.log('public/assets/dither/intelligence-pixels.png');

const terminal = new PixelField(TERMINAL_ENTITY_WIDTH, TERMINAL_ENTITY_HEIGHT);
const terminalPixels = new Uint8ClampedArray(terminal.values.length * 4);
drawIntelligence(terminal, 8, 0.7, [0, -0.2], 'terminal');
writeDither(terminal.values, terminalPixels, [255, 255, 255], terminal.width, terminal.height);
await sharp(Buffer.from(terminalPixels.buffer), {
  raw: { width: terminal.width, height: terminal.height, channels: 4 },
}).png().toFile('public/assets/dither/intelligence-terminal.png');
console.log('public/assets/dither/intelligence-terminal.png');
