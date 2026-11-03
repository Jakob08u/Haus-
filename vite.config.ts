import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5174' },
  },
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
