/**
 * MAFIA relay on Vercel — WebSocket only.
 *
 * Vercel Functions serve WebSocket connections natively (Fluid compute): the
 * function file exports a plain Node `http.Server`, and the `ws` library
 * upgrades connections on it. A connection stays pinned to one instance for
 * its lifetime, and one warm instance holds all rooms of a friendly game.
 *
 * The relay itself is the same `server/relay.mjs` used by `npm start` and the
 * standalone VPS build: it routes small JSON frames between a host and its
 * guests, lists public rooms over HTTP and never sees game roles.
 *
 * Endpoints (this function is mounted at `/api`, rewrites map `/api/*` here):
 *   WS  /api/ws      — game transport (create / join / resume / relay / …)
 *   GET /api/health  — service probe used by the client's relay discovery
 *   GET /api/rooms   — public room list for the room browser
 *
 * Limits on Vercel: every socket is closed when the function reaches its max
 * duration (300s on Hobby). The client reconnects and resumes its seat
 * automatically, and the relay keeps rooms alive for a grace window, so a
 * dropped socket is not a lost game. Under heavy multi-instance traffic rooms
 * can split across instances — that is the documented Vercel caveat; for a
 * busy public relay run `server/relay-standalone.mjs` on a Node host instead.
 */

import { createServer } from "node:http";
import { attachRelay } from "../server/relay.mjs";
import { PROTOCOL_VERSION } from "../js/net/protocol.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Requests arrive either directly (`/health`) or through the vercel.json
 * rewrite (`/api/health` → `/api?path=health`). Normalise both to the plain
 * paths the relay understands.
 */
function normalizedPath(req) {
  let url;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    return "/";
  }
  let path = url.pathname;
  if (path === "/api" || path === "/api/") {
    const inner = url.searchParams.get("path");
    path = inner ? `/${String(inner).replace(/^\/+/, "")}` : "/";
  } else if (path.startsWith("/api/")) {
    path = path.slice(4) || "/";
  }
  return path;
}

function sendJson(res, status, value) {
  res.statusCode = status;
  for (const [key, val] of Object.entries(CORS_HEADERS)) res.setHeader(key, val);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    for (const [key, val] of Object.entries(CORS_HEADERS)) res.setHeader(key, val);
    res.end();
    return;
  }

  const path = normalizedPath(req);

  if (path === "/health" || path === "/rooms") {
    req.url = path;
    if (relay.handleHttp(req, res)) return;
  }

  if (path === "/" || path === "/ws") {
    sendJson(res, 200, {
      ok: true,
      service: "mafia-relay",
      websocket: true,
      protocol: PROTOCOL_VERSION,
      hint: "WebSocket relay. Подключайтесь: wss://<этот-хост>/api/ws",
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

const relay = attachRelay({
  server,
  // Vercel rewrites `/api/ws` → `/api?path=ws`, so the upgrade may arrive
  // with any of these paths depending on the entry point.
  path: ["/ws", "/api", "/api/ws"],
  trustProxy: true,
});

export default server;
