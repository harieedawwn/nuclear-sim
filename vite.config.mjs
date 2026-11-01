import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: ['safari15', 'chrome100'], assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
  server: { host: true }
});
