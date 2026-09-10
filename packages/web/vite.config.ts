import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 開発中は shared のビルドを待たずソースを直接参照する
      '@ws/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5178',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
