import { defineConfig } from 'vite';

/**
 * The web demo: the viewer with the game inside the page. Relative paths, so the build works from any folder it is served from
 * (an Artifact's files, or `vite preview`).
 */
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true },
});
