import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// SpatialReal AvatarKit Vite plugin handles WASM file copy + content-type
// headers for both dev and production builds. Required since main interview
// path now defaults to the 3D avatar.
import { avatarkitVitePlugin } from '@spatialwalk/avatarkit/vite';

// Inject git short SHA at build time so the DevTools build marker uniquely
// identifies the bundle. Falls back to 'unknown' outside a git work tree.
let buildSha = 'unknown';
try {
  buildSha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
} catch {
  /* outside a git work tree (e.g. CI without checkout) */
}

export default defineConfig({
  plugins: [react(), avatarkitVitePlugin()],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  server: {
    port: 5173,
    proxy: {
      // ws: true forwards WebSocket upgrade requests (e.g. /api/live-ws) to
      // wrangler dev so the manual VAD bridge works end-to-end in vite dev.
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
