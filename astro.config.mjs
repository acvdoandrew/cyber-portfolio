import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.aceandrew.com',
  compressHTML: true,
  vite: {
    build: {
      // Three.js is emitted as a lazy GPU-only chunk (~501 KiB minified).
      chunkSizeWarningLimit: 550,
    },
  },
});
