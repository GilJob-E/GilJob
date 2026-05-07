/// <reference types="vite/client" />

// Injected by Vite `define` at build time — git short SHA of the working tree.
// Used in `useLiveSession.ts:4` build marker so DevTools log line uniquely
// identifies which commit served the bundle. Replaces the manual-bump pattern
// (e.g. `[live build] v11`) that survived a revert as stale.
declare const __BUILD_SHA__: string;
