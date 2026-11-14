import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from https://<user>.github.io/soba/
export default defineConfig({
  base: '/soba/',
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
