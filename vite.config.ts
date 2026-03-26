import { defineConfig } from 'vite';

export default defineConfig({
  base: '/shooter-claude-gpt-gemini/',
  build: {
    outDir: 'docs',
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
});
