/* МАФИЯ · Ночной город — offline shell.
 * Static-only cache. The relay (WebSocket) is never intercepted.
 * Bump VERSION together with js/app.js when shipping new assets.
 */
const VERSION = "2.0.17";
const CACHE = `mafia-v${VERSION}`;
const INDEX = new URL("./index.html", self.location.href).href;
const SCOPE = new URL("./", self.location.href).href;
const INDEX_PATH = new URL(INDEX).pathname;
const SCOPE_PATH = new URL(SCOPE).pathname.replace(/\/+$/, "") || "/";
const LINKABLE_ROUTES = new Set(["quick", "rooms", "create", "join", "roles", "rules", "settings"]);

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.png",
  "./css/base.css",
  "./css/components.css",
  "./css/game.css",
  "./css/lobby.css",
  "./css/menu.css",
  "./css/pages.css",
  "./css/responsive.css",
  "./css/tokens.css",
  "./js/app.js",
  "./js/main.js",
  "./js/audio/manager.js",
  "./js/core/assets.js",
  "./js/core/effects.js",
  "./js/core/events.js",
  "./js/core/format.js",
  "./js/core/random.js",
  "./js/core/security.js",
  "./js/core/storage.js",
  "./js/data/botPhrases.js",
  "./js/data/bots.js",
  "./js/data/quickChat.js",
  "./js/data/roles.js",
  "./js/game/bot.js",
  "./js/game/engine.js",
  "./js/net/auto.js",
  "./js/net/local.js",
  "./js/net/online.js",
  "./js/net/protocol.js",
  "./js/net/rooms.js",
  "./js/net/session.js",
  "./js/screens/create.js",
  "./js/screens/game.js",
  "./js/screens/join.js",
  "./js/screens/lobby.js",
  "./js/screens/menu.js",
  "./js/screens/quick.js",
  "./js/screens/roles.js",
  "./js/screens/rooms.js",
  "./js/screens/rules.js",
  "./js/screens/settings.js",
  "./js/ui/chat.js",
  "./js/ui/components.js",
  "./js/ui/dom.js",
  "./js/ui/icons.js",
  "./js/ui/modal.js",
  "./js/ui/roomForm.js",
  "./js/ui/router.js",
  "./js/ui/toast.js",
  "./assets/img/brand/icon-32.png",
  "./assets/img/brand/icon-64.png",
  "./assets/img/brand/icon-180.png",
  "./assets/img/brand/icon-192.png",
  "./assets/img/brand/icon-512.png",
  "./assets/img/roles/assassin.png",
  "./assets/img/roles/civilian.png",
  "./assets/img/roles/doctor.png",
  "./assets/img/roles/jester.png",
  "./assets/img/roles/mafia.png",
  "./assets/img/roles/sheriff.png",
  "./assets/img/bots/alice.png",
  "./assets/img/bots/chatgpt.png",
  "./assets/img/bots/claude.png",
  "./assets/img/bots/copilot.png",
  "./assets/img/bots/deepseek.png",
  "./assets/img/bots/falcon.png",
  "./assets/img/bots/gemini.png",
  "./assets/img/bots/gemma.png",
  "./assets/img/bots/gigachat.png",
  "./assets/img/bots/grok.png",
  "./assets/img/bots/kimi.png",
  "./assets/img/bots/llama.png",
  "./assets/img/bots/mistral.png",
  "./assets/img/bots/nova.png",
  "./assets/img/bots/orion.png",
  "./assets/img/bots/perplexity.png",
  "./assets/img/bots/phi.png",
  "./assets/img/bots/qwen.png",
  "./assets/img/bots/system.png",
  "./assets/img/bots/yi.png",
  "./assets/audio/day.mp3",
  "./assets/audio/day.ogg",
  "./assets/audio/night.mp3",
  "./assets/audio/night.ogg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((error) => {
        // A single missing optional asset must not brick the install.
        console.warn("[sw] precache incomplete", error?.message ?? error);
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("mafia-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations are handled before the relay exclusions: `/rooms` is both the
  // relay's JSON endpoint and the app's room-browser screen.
  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }

  // Relay endpoints and media range requests stay outside the cache.
  if (url.pathname.endsWith("/ws") || url.pathname.endsWith("/rooms") || url.pathname.endsWith("/health")) return;
  if (request.headers.has("range")) return;

  const destination = request.destination;
  if (destination === "image" || destination === "font" || destination === "audio" || destination === "video") {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});

async function navigationResponse(request) {
  const url = new URL(request.url);
  if (!isShellNavigation(url)) {
    // Bounce pretty routes before the network. A redirect followed inside
    // `fetch()` would keep the deep URL in the address bar and boot the app
    // with the wrong base, so the browser itself must perform this redirect.
    const target = deepLinkTarget(url);
    if (target) return Response.redirect(target, 302);
  }
  return networkFirstNavigation(request);
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    // GitHub Pages answers pretty client routes with 404.html. Let that page
    // bounce to the document root instead of serving index.html at a deep path,
    // where every relative asset would resolve under the wrong directory.
    if (response && response.status === 404) return response;
    if (!response || !response.ok) throw new Error(`HTTP ${response?.status ?? "network"}`);
    if (String(response.headers.get("content-type") || "").includes("text/html")) {
      try {
        if (isShellNavigation(new URL(response.url))) {
          const cache = await caches.open(CACHE);
          cache.put(INDEX, response.clone());
        }
      } catch {
        // Keep the network response even if its URL cannot be parsed.
      }
    }
    return response;
  } catch {
    const url = new URL(request.url);
    if (!isShellNavigation(url)) {
      return Response.redirect(deepLinkTarget(url) || SCOPE, 302);
    }
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(INDEX)) || (await cache.match(SCOPE));
    return cached || offlinePage();
  }
}

function isShellNavigation(url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return path === SCOPE_PATH || path === INDEX_PATH.replace(/\/+$/, "");
}

/** Offline equivalent of the 404 page: keep the intent, load the real shell. */
function deepLinkTarget(url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const underScope = SCOPE_PATH === "/" ? path.startsWith("/") : path.startsWith(`${SCOPE_PATH}/`);
  if (!underScope) return "";
  const app = SCOPE_PATH === "/" ? path : path.slice(SCOPE_PATH.length) || "/";
  if (app === "/" || app === "/index.html") return "";

  const room = app.match(/^\/room\/([^/]+)$/i);
  if (room) {
    let code = "";
    try {
      code = decodeURIComponent(room[1]).toUpperCase();
    } catch {
      code = "";
    }
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return "";
    const mode = url.searchParams.get("mode");
    // Solo/spectator sessions are deliberately not restorable after a reload.
    if (mode === "solo" || mode === "spectate") return SCOPE;
    const out = new URLSearchParams({ room: code });
    const relay = url.searchParams.get("relay");
    if (relay) out.set("relay", relay);
    if (mode === "local" || mode === "online" || mode === "lan") out.set("mode", mode);
    return new URL(`${SCOPE}?${out.toString()}`, self.location.href).href;
  }

  if (app === "/join") {
    const out = new URLSearchParams();
    const code = (url.searchParams.get("room") || url.searchParams.get("code") || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (/^[A-HJ-NP-Z2-9]{6}$/.test(code)) out.set("code", code);
    else out.set("route", "join");
    const relay = url.searchParams.get("relay");
    if (relay) out.set("relay", relay);
    const mode = url.searchParams.get("mode");
    if (mode === "local" || mode === "online" || mode === "lan") out.set("mode", mode);
    return new URL(`${SCOPE}?${out.toString()}`, self.location.href).href;
  }

  const route = app.slice(1);
  if (LINKABLE_ROUTES.has(route)) {
    return new URL(`${SCOPE}?route=${route}`, self.location.href).href;
  }

  // An unknown extensionless path is a real navigation, not a missing asset.
  // Keep it for the app's own 404 screen instead of dumping the user on menu.
  if (!hasFileExtension(app)) {
    return new URL(`${SCOPE}?notfound=${encodeURIComponent(path)}`, self.location.href).href;
  }
  return "";
}

function hasFileExtension(path) {
  const last = path.split("/").pop() || "";
  return /\.[a-z0-9]{1,8}$/i.test(last);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    // Keep the background refresh alive after the response leaves the handler.
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  return fresh || new Response("", { status: 504, statusText: "Offline" });
}

function offlinePage() {
  return new Response(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>МАФИЯ · офлайн</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05060a;color:#f3ecdd;font-family:Georgia,serif;text-align:center;padding:24px}main{max-width:420px;border:1px solid rgba(217,179,108,.25);border-radius:18px;padding:28px;background:#101522}h1{font-size:1.4rem;letter-spacing:.08em}p{color:#a9a89f;line-height:1.6}a{display:inline-block;margin-top:12px;padding:12px 22px;border:1px solid rgba(217,179,108,.4);border-radius:10px;background:#d9b36c;color:#090b12;font-weight:700;font-size:1rem;text-decoration:none}</style></head>
<body><main><h1>Город спит</h1><p>Нет соединения, а эта страница ещё не сохранена. Вернитесь на главную — оболочка игры доступна офлайн.</p><a href="${SCOPE}">На главную</a></main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
