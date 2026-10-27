/**
 * Standalone relay for a VPS / Raspberry Pi / free Node host.
 *
 *   npm run relay
 *   RELAY_PORT=8787 RELAY_ALLOWED_ORIGINS=https://you.github.io npm run relay
 *
 * GitHub Pages serves the static client; this process only routes tiny JSON
 * frames and lists public rooms. It never receives roles or private chats.
 */

import { createServer } from "node:http";
import { attachRelay } from "./relay.mjs";

const PORT = Number(process.env.RELAY_PORT || process.env.PORT) || 8787;
const HOST = process.env.RELAY_HOST || "0.0.0.0";
const origins = process.env.RELAY_ALLOWED_ORIGINS || "";

const server = createServer((req, res) => {
  if (relay.handleHttp(req, res)) return;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        service: "mafia-relay",
        ok: true,
        websocket: "/ws",
        rooms: "/rooms",
        health: "/health",
        hint: "Укажите этот адрес в настройках игры: wss://ваш-хост/ws",
      }),
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

const relay = attachRelay({
  server,
  path: "/ws",
  allowedOrigins: origins,
  trustProxy: process.env.TRUST_PROXY === "1",
});

server.listen(PORT, HOST, () => {
  console.log(`[relay] listening on ${HOST}:${PORT}`);
  console.log(`[relay] websocket ws://${HOST}:${PORT}/ws`);
  console.log(`[relay] allowed origins: ${origins || "any (set RELAY_ALLOWED_ORIGINS in production)"}`);
});

function shutdown() {
  console.log("[relay] shutting down…");
  relay.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
