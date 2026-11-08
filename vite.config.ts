import { defineConfig } from 'vite';
import { pixiCspBuildGuard } from './scripts/pixi-csp-build-guard';

export default defineConfig({
  base: './',
  plugins: [pixiCspBuildGuard()],
  resolve: {
    dedupe: ['pixi.js'],
  },
  optimizeDeps: {
    include: ['pixi.js', 'pixi.js/unsafe-eval'],
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
  },
});
