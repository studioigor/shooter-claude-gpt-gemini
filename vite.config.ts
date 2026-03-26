import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BUILD_TARGET === 'electron' ? './' : '/shooter-claude-gpt-gemini/',
  build: {
    outDir: 'docs',
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
});
