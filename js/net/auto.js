import {
  healthUrl,
  isHttpRelayUrl,
  normalizeHttpRelayUrl,
  normalizeRelayEndpoint,
} from "./protocol.js";

/**
 * Public room relay. The game itself is a static site (GitHub Pages / custom
 * domain); the relay is a WebSocket server on Vercel and clients connect to
 * it directly. The custom domain (a plain CNAME to the same deployment) is
 * kept as an alternate entry point.
 */
export const PUBLIC_WS_RELAY_DIRECT = "wss://mafiarbovercel.vercel.app/api/ws";
export const PUBLIC_WS_RELAY = "wss://relay.mafia.rb-o.ru/api/ws";
const PUBLIC_WS_RELAYS = [PUBLIC_WS_RELAY_DIRECT, PUBLIC_WS_RELAY];

/** Legacy HTTP-polling addresses, kept so old invite links stay recognisable. */
export const PUBLIC_HTTP_RELAY = "https://mafiarbovercel.vercel.app/api";
export const PUBLIC_HTTP_RELAY_CUSTOM = "https://relay.mafia.rb-o.ru/api";

/** A WS relay is recognised by its JSON health answer (`/ws` → `<base>/health`). */
async function probeWsEndpoint(endpoint, timeout = 1500) {
  const url = healthUrl(endpoint);
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data?.ok === true && data?.service === "mafia-relay" && data?.websocket !== false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function publicWsRelay() {
  for (const endpoint of PUBLIC_WS_RELAYS) {
    if (await probeWsEndpoint(endpoint)) return endpoint;
  }
  return PUBLIC_WS_RELAY_DIRECT;
}

/**
 * The same Node process can serve the app and the WebSocket relay. On a laptop
 * this is the "LAN host" mode: friends open http://<your-ip>:8080 and the
 * browser automatically talks to ws://<same-host>/ws.
 */
export function sameOriginRelay() {
  if (typeof location === "undefined") return "";
  if (!/^https?:$/.test(location.protocol) || !location.host) return "";
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}

/**
 * When the game itself is opened from the Vercel deployment, the relay lives
 * on the same origin under `/api/ws`.
 */
export function sameOriginApiRelay() {
  if (typeof location === "undefined") return "";
  if (!/^https?:$/.test(location.protocol) || !location.host) return "";
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/ws`;
}

/** Vercel (and any static host with an `/api` relay) answers under `/api`. */
export function sameOriginHttpRelay() {
  if (typeof location === "undefined") return "";
  if (!/^https?:$/.test(location.protocol) || !location.host) return "";
  return `${location.origin}/api`;
}

function wsHealthUrl() {
  if (typeof location === "undefined") return "/health";
  return new URL("/health", location.origin).toString();
}

function apiHealthUrl() {
  return `${sameOriginHttpRelay()}/health`;
}

/** A static host answers 404/HTML here, so a valid relay is recognised by JSON. */
async function probeWsOnce(timeout) {
  const relay = sameOriginRelay();
  if (!relay) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(wsHealthUrl(), {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data?.ok === true && data?.service === "mafia-relay" && data?.websocket !== false ? relay : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function probeApiOnce(timeout) {
  const relay = sameOriginApiRelay();
  if (!relay) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(apiHealthUrl(), {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data?.ok === true && data?.service === "mafia-relay" && data?.websocket !== false ? relay : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the current origin. The very first request after a service worker
 * installs can be dropped while it activates, so a miss is retried once.
 */
export async function probeSameOriginRelay({ timeout = 2000, attempts = 2 } = {}) {
  if (!sameOriginRelay()) return "";
  let last = "";
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    last = await probeWsOnce(timeout);
    if (last) return last;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return last;
}

export async function probeSameOriginApiRelay({ timeout = 2000, attempts = 2 } = {}) {
  if (!sameOriginApiRelay()) return "";
  let last = "";
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    last = await probeApiOnce(timeout);
    if (last) return last;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return last;
}

/**
 * Resolve the relay for a room mode.
 * - `lan` always means the WebSocket server that served this page;
 * - `online` prefers an explicit address (WS, or HTTP for a self-hosted
 *   polling relay), then a same-origin relay (`/ws` on Node, `/api/ws` on
 *   Vercel), then the public relay — a static site (GitHub Pages) has no
 *   relay of its own;
 * - `local` (ports/BroadcastChannel) never needs a relay.
 */
export async function resolveRelayForMode(mode, explicit = "", options = {}) {
  if (mode === "lan") return probeSameOriginRelay(options);
  if (mode !== "online") return "";
  if (isHttpRelayUrl(explicit)) return normalizeHttpRelayUrl(explicit);
  const clean = normalizeRelayEndpoint(explicit);
  if (clean) return clean;
  const wsRelay = await probeSameOriginRelay(options);
  if (wsRelay) return wsRelay;
  const apiRelay = await probeSameOriginApiRelay(options);
  if (apiRelay) return apiRelay;
  return publicWsRelay();
}
