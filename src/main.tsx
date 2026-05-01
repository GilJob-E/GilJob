import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './components.css';

// feat/spatialreal-spike: dev-only ?spike=1 gate.
// `import.meta.env.DEV` is replaced at build time — in production the ternary
// evaluates to `null` constant, so Rollup's tree-shaking elides the dynamic
// `import('./components/SpikeAvatarTest')` entirely. Combined with vite.config's
// `rollupOptions.external` for production, the SDK + spike chunk are guaranteed
// absent from dist/ (verified via 3-tier AC-5 grep + filename find).
const SpikeAvatarTest = import.meta.env.DEV
  ? lazy(() => import('./components/SpikeAvatarTest'))
  : null;

const isSpike =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('spike') === '1';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isSpike && SpikeAvatarTest ? (
      <Suspense fallback={null}>
        <SpikeAvatarTest />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
