import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: { output: { manualChunks: { three: ['three'], scene: ['@react-three/fiber', '@react-three/drei'], validation: ['zod'] } } },
  },
});
