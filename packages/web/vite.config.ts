import { defineConfig } from 'vite';

/**
 * The web demo: the viewer with the game inside the page. Relative paths, so the build works from any folder it is served from
 * (an Artifact's files, or `vite preview`). Every file at the top of `dist/`, beside the page: an Artifact runs the game's script
 * inline in the page, where it finds the worker and Lua's WebAssembly relative to the page itself.
 */
export default defineConfig({
  base: './',
  build: { assetsDir: '' },
  worker: { format: 'es' },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true },
});
