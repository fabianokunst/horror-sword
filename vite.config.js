import { defineConfig } from 'vite';

// Relative base: the build works from any subpath (GitHub Pages serves it at /horror-sword/),
// from a local static server, or opened from a zip, without hard-coding the repo name.
export default defineConfig({
  base: './',
});
