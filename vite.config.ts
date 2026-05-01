import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'fs';
// Spike-only (feat/spatialreal-spike). Plugin is gated below to dev mode only,
// so production builds never invoke its WASM-copy logic. SDK itself is also
// marked external for production to keep it out of the bundle.
import { avatarkitVitePlugin } from '@spatialwalk/avatarkit/vite';

// Spike-only DX shim: read `.dev.vars` (wrangler's secrets file) at dev start
// and inject any non-secret VITE_*/SPATIALREAL_* keys into `import.meta.env`,
// so the user only maintains one .dev.vars file (no separate .env.local).
// Secrets matching `_API_KEY$` / `_SECRET` / `_TOKEN` are intentionally NOT
// re-exposed to the client. Session tokens are explicitly allow-listed.
function loadDevVarsForClient(): Record<string, string> {
  const path = '.dev.vars';
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  const ALIAS_TO_VITE = new Set(['SPATIALREAL_APP_ID', 'SPATIALREAL_AVATAR_ID']);
  const ALLOW_VITE = (key: string) =>
    key.startsWith('VITE_') && !/_API_KEY$/.test(key) && !/_SECRET$/.test(key);

  const text = readFileSync(path, 'utf8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (ALLOW_VITE(key)) {
      out[`import.meta.env.${key}`] = JSON.stringify(val);
    } else if (ALIAS_TO_VITE.has(key)) {
      out[`import.meta.env.VITE_${key}`] = JSON.stringify(val);
    }
  }
  return out;
}

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  return {
    plugins: [react(), ...(isDev ? [avatarkitVitePlugin()] : [])],
    define: isDev ? loadDevVarsForClient() : undefined,
    server: {
      port: 5173,
      proxy: {
        // feat/spatialreal-spike: redirect /api/* to production worker so the
        // user only needs `npm run dev` (no separate `npm run wrangler:dev`).
        // Production worker already has GEMINI_API_KEY via `wrangler secret put`
        // and returns real ephemeral tokens (demo:false, verified 2026-05-01).
        // Restore to 'http://localhost:8787' before main merge if reverting.
        '/api': {
          target: 'https://giljob-e.bjacaun.workers.dev',
          changeOrigin: true,
          secure: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: isDev
        ? undefined
        : {
            // Belt + braces: even if a transitive import sneaks through, this
            // forces Rollup to leave SpatialReal symbols unresolved in production
            // bundles. Combined with the dev-only ternary lazy() in main.tsx,
            // the SDK is guaranteed absent from dist/ on `npm run build`.
            external: [/^@spatialwalk\/avatarkit/, '@spatialwalk/avatarkit'],
          },
    },
  };
});
