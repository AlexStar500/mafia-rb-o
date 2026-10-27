/**
 * Local development server: static files + WebSocket relay on one port.
 *
 *   npm start            http://localhost:8080
 *   PORT=3000 npm start
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { attachRelay } from "./relay.mjs";
import { deepLinkRootRedirect } from "../js/ui/router.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "DENY",
};

const NOT_FOUND = resolve(ROOT, "404.html");
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; media-src 'self'; connect-src 'self' ws: wss:; " +
  "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; upgrade-insecure-requests";
const NOT_FOUND_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'";

function cacheHeader(pathname) {
  if (
    pathname === "/" ||
    pathname.endsWith(".html") ||
    pathname === "/sw.js" ||
    pathname.endsWith(".webmanifest") ||
    /\.(?:js|mjs|css)$/i.test(pathname)
  ) {
    return "no-cache";
  }
  if (/\.(png|jpg|jpeg|webp|svg|ico|ogg|mp3|wav|woff2)$/i.test(pathname)) {
    return "public, max-age=86400";
  }
  return "public, max-age=300";
}

async function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  let target = resolve(ROOT, `.${decoded}`);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  let info;
  try {
    info = await stat(target);
  } catch {
    return null;
  }
  if (info.isDirectory()) {
    target = resolve(target, "index.html");
    try {
      info = await stat(target);
    } catch {
      return null;
    }
  }
  if (!info.isFile()) return null;
  return { path: target, size: info.size, mtime: info.mtime };
}

function sendFile(req, res, file, pathname, { status = 200 } = {}) {
  const ext = extname(file.path).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": type,
    "Cache-Control": cacheHeader(pathname),
    "Accept-Ranges": "bytes",
  };
  if (ext === ".html") {
    headers["Content-Security-Policy"] = file.path === NOT_FOUND ? NOT_FOUND_CSP : APP_CSP;
  }

  const range = req.headers.range;
  if (status === 200 && range && /^bytes=\d*-\d*$/.test(range)) {
    const [startRaw, endRaw] = range.replace("bytes=", "").split("-");
    let start = startRaw ? Number(startRaw) : 0;
    let end = endRaw ? Number(endRaw) : file.size - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= file.size) end = file.size - 1;
    if (start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${file.size}`, ...SECURITY_HEADERS });
      res.end();
      return;
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
    headers["Content-Length"] = String(end - start + 1);
    res.writeHead(206, headers);
    if (req.method === "HEAD") return res.end();
    createReadStream(file.path, { start, end }).pipe(res);
    return;
  }

  headers["Content-Length"] = String(file.size);
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(file.path).pipe(res);
}

async function handle(req, res) {
  if (!req.url) {
    res.writeHead(400, SECURITY_HEADERS);
    res.end("Bad Request");
    return;
  }
  if (!["GET", "HEAD"].includes(req.method ?? "")) {
    res.writeHead(405, { ...SECURITY_HEADERS, Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    res.writeHead(400, SECURITY_HEADERS);
    res.end("Bad Request");
    return;
  }
  const pathname = url.pathname;

  if (relay.handleHttp(req, res)) return;

  const file = await resolveFile(pathname === "/" ? "/index.html" : pathname);
  if (file) {
    sendFile(req, res, file, pathname);
    return;
  }

  // Static hosting has no SPA fallback: sending index.html at /join or
  // /room/ABC would resolve every relative asset under the deep directory.
  // Bounce to the root marker instead, exactly like 404.html on GitHub Pages.
  const bounce = deepLinkRootRedirect(pathname, url.search);
  if (bounce) {
    res.writeHead(302, {
      ...SECURITY_HEADERS,
      Location: bounce,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  // Unknown extensionless paths get the same redirect page as production.
  // Never answer a missing module or image with HTML.
  if (!extname(pathname)) {
    try {
      const info = await stat(NOT_FOUND);
      sendFile(req, res, { path: NOT_FOUND, size: info.size, mtime: info.mtime }, "/404.html", {
        status: 404,
      });
      return;
    } catch {
      // fall through
    }
  }

  res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 — not found");
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("[dev]", error);
    if (!res.headersSent) res.writeHead(500, SECURITY_HEADERS);
    res.end("500 — internal error");
  });
});

const relay = attachRelay({
  server,
  path: "/ws",
  allowedOrigins: process.env.RELAY_ALLOWED_ORIGINS || "",
  trustProxy: process.env.TRUST_PROXY === "1",
});

function lanAddresses() {
  const result = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) result.push(address.address);
    }
  }
  return result;
}

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  const lan = HOST === "0.0.0.0" ? lanAddresses() : [];
  console.log(`\n  МАФИЯ · Ночной город`);
  console.log(`  Игра:     http://${shown}:${PORT}/`);
  console.log(`  Relay:    ws://${shown}:${PORT}/ws`);
  console.log(`  Комнаты:  http://${shown}:${PORT}/rooms`);
  for (const ip of lan) console.log(`  По IP:    http://${ip}:${PORT}/`);
  if (lan.length) console.log(`  Друзья:   заходят по этому адресу — как в CS2`);
  console.log(`  Извне:    пробросьте порт ${PORT} на роутере или поднимите Cloudflare Tunnel\n`);
  console.log(`  Стоп:     Ctrl+C\n`);
});

function shutdown() {
  console.log("\n[dev] остановка…");
  relay.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
