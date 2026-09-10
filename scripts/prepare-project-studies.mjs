import fs from 'node:fs/promises';
import sharp from 'sharp';
const ids = ['ares', 'edge', 'physics', 'inference'];
await fs.mkdir('public/assets/projects', { recursive: true });
for (const id of ids) {
  const source = `artwork-source/project-studies/${id}-study.png`;
  for (const width of [768, 1536]) {
    const suffix = width === 768 ? '-768' : '';
    const destination = `public/assets/projects/${id}-study${suffix}.webp`;
    await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 83, effort: 6 })
      .toFile(destination);
    const stat = await fs.stat(destination);
    process.stdout.write(`${destination} ${stat.size} bytes\n`);
  }
}
