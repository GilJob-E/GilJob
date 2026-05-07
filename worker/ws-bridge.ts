/**
 * WebSocket bridge handler — Day 1 PM spike for B-option (Path B).
 *
 * Forwards frames bidirectionally between client and Gemini Live's
 * Unconstrained `BidiGenerateContent` endpoint. Server-side API key auth
 * keeps `GEMINI_API_KEY` out of the browser.
 *
 * AM research findings:
 * - Outbound WS via `fetch()` with Upgrade: websocket (NOT new WebSocket()),
 *   so we can pass `allowHalfOpen: true` for clean close-frame propagation.
 * - `compatibility_date = 2026-04-29` activates `websocket_standard_binary_type`,
 *   so binary frames arrive as Blob → must convert to ArrayBuffer before send.
 *
 * Spike scope: pass-through proxy. Client sends setup envelope, manual VAD
 * markers, audio frames; worker forwards as-is. No frame inspection or
 * transformation.
 */

const UPSTREAM_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export async function handleWsBridge(
  request: Request,
  apiKey: string,
): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  // Open outbound WS to Gemini Live with API key in query param.
  // Use `new WebSocket()` rather than `fetch({Upgrade: ...})` because
  // Miniflare (wrangler dev local) does not support fetch-based outbound
  // WS upgrades to wss:// targets — it returns 502 with "Fetch API cannot
  // load". `new WebSocket()` works in both Miniflare and production CF
  // runtime. Trade-off: no `allowHalfOpen` option, but simple proxy lifecycle
  // doesn't need it.
  const upstreamUrl = `${UPSTREAM_URL}?key=${encodeURIComponent(apiKey)}`;
  let upstream: WebSocket;
  try {
    upstream = new WebSocket(upstreamUrl);
  } catch (e) {
    console.error('[ws-bridge] outbound WebSocket() failed', e);
    return new Response(`Upstream connect failed: ${(e as Error).message}`, {
      status: 502,
    });
  }

  // Accept inbound client WS.
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();

  const toArrayBuffer = async (
    data: ArrayBuffer | Blob | string,
  ): Promise<ArrayBuffer | string> => {
    if (data instanceof Blob) return data.arrayBuffer();
    return data;
  };

  // Buffer client→upstream messages until upstream WS is OPEN. Without this,
  // the client's setup envelope (sent immediately on its onopen) gets dropped
  // because upstream is still in CONNECTING state — the server never receives
  // setup and never sends setupComplete, so the session hangs at "connecting".
  const pendingToUpstream: (ArrayBuffer | string)[] = [];
  let upstreamOpen = false;

  upstream.addEventListener('open', () => {
    upstreamOpen = true;
    for (const data of pendingToUpstream) {
      try {
        upstream.send(data);
      } catch (e) {
        console.warn('[ws-bridge] drain pending → upstream failed', e);
      }
    }
    pendingToUpstream.length = 0;
  });

  // Bridge: client → upstream (with pending buffer for pre-open frames)
  server.addEventListener('message', async evt => {
    let data: ArrayBuffer | string;
    try {
      data = await toArrayBuffer(evt.data);
    } catch (e) {
      console.warn('[ws-bridge] client→upstream toArrayBuffer failed', e);
      return;
    }
    if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
      try {
        upstream.send(data);
      } catch (e) {
        console.warn('[ws-bridge] client→upstream send failed', e);
      }
    } else {
      pendingToUpstream.push(data);
    }
  });

  // Bridge: upstream → client (no buffering needed — server.accept() means
  // client side is OPEN before we receive any upstream message)
  upstream.addEventListener('message', async evt => {
    if (server.readyState !== WebSocket.OPEN) return;
    try {
      const data = await toArrayBuffer(evt.data);
      server.send(data);
    } catch (e) {
      console.warn('[ws-bridge] upstream→client send failed', e);
    }
  });

  // Close propagation
  server.addEventListener('close', evt => {
    console.log('[ws-bridge] client closed', evt.code, evt.reason);
    if (upstream.readyState === WebSocket.OPEN) {
      try {
        upstream.close(evt.code, evt.reason);
      } catch {
        /* ignore */
      }
    }
  });
  upstream.addEventListener('close', evt => {
    console.log('[ws-bridge] upstream closed', evt.code, evt.reason);
    if (server.readyState === WebSocket.OPEN) {
      try {
        server.close(evt.code, evt.reason);
      } catch {
        /* ignore */
      }
    }
  });

  // Error propagation (close other side with generic codes)
  server.addEventListener('error', () => {
    console.error('[ws-bridge] client error');
    if (upstream.readyState === WebSocket.OPEN) {
      try {
        upstream.close(1011, 'client error');
      } catch {
        /* ignore */
      }
    }
  });
  upstream.addEventListener('error', () => {
    console.error('[ws-bridge] upstream error');
    if (server.readyState === WebSocket.OPEN) {
      try {
        server.close(1014, 'upstream error');
      } catch {
        /* ignore */
      }
    }
  });

  return new Response(null, { status: 101, webSocket: client });
}
