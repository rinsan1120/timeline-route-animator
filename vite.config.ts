import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/timeline-route-animator/',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
});
