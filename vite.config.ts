import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// SpatialReal AvatarKit Vite plugin handles WASM file copy + content-type
// headers for both dev and production builds. Required since main interview
// path now defaults to the 3D avatar.
import { avatarkitVitePlugin } from '@spatialwalk/avatarkit/vite';

export default defineConfig({
  plugins: [react(), avatarkitVitePlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
