import {
  isHttpRelayUrl,
  normalizeHttpRelayUrl,
  normalizeRelayEndpoint,
} from "./protocol.js";

/**
 * Public room relay. The game itself is a static site (GitHub Pages / custom
 * domain); Vercel only hosts this small HTTP relay for online rooms.
 *
 * `PUBLIC_HTTP_RELAY_CUSTOM` is the recommended public address: it can be
 * proxied through Cloudflare, so it stays reachable on networks that block
 * the raw `*.vercel.app` edge IPs. `PUBLIC_HTTP_RELAY` is the direct fallback.
 */
export const PUBLIC_HTTP_RELAY = "https://mafiarbovercel.vercel.app/api";
export const PUBLIC_HTTP_RELAY_CUSTOM = "https://relay.mafia.rb-o.ru/api";

async function probeHttpBase(base, timeout = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data?.ok === true && data?.service === "mafia-relay" && data?.http === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function publicHttpRelay() {
  for (const base of [PUBLIC_HTTP_RELAY_CUSTOM, PUBLIC_HTTP_RELAY]) {
    if (await probeHttpBase(base)) return base;
  }
  return PUBLIC_HTTP_RELAY;
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

/** Vercel (and any static host with an `/api` relay) uses HTTP polling. */
export function sameOriginHttpRelay() {
  if (typeof location === "undefined") return "";
  if (!/^https?:$/.test(location.protocol) || !location.host) return "";
  return `${location.origin}/api`;
}

function wsHealthUrl() {
  if (typeof location === "undefined") return "/health";
  return new URL("/health", location.origin).toString();
}

function httpHealthUrl() {
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

async function probeHttpOnce(timeout) {
  const relay = sameOriginHttpRelay();
  if (!relay) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(httpHealthUrl(), {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data?.ok === true && data?.service === "mafia-relay" && data?.http === true ? relay : "";
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

export async function probeSameOriginHttpRelay({ timeout = 2000, attempts = 2 } = {}) {
  if (!sameOriginHttpRelay()) return "";
  let last = "";
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    last = await probeHttpOnce(timeout);
    if (last) return last;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return last;
}

/**
 * Resolve the relay for a room mode.
 * - `lan` always means the WebSocket server that served this page;
 * - `online` prefers an explicit address (HTTP or WS), then a same-origin
 *   HTTP relay (`/api`), then a same-origin WebSocket relay (`/ws`), then the
 *   public Vercel relay — a static site (GitHub Pages) has no `/api` of its own;
 * - `local` (ports/BroadcastChannel) never needs a relay.
 */
export async function resolveRelayForMode(mode, explicit = "", options = {}) {
  if (mode === "lan") return probeSameOriginRelay(options);
  if (mode !== "online") return "";
  if (isHttpRelayUrl(explicit)) return normalizeHttpRelayUrl(explicit);
  const clean = normalizeRelayEndpoint(explicit);
  if (clean) return clean;
  const httpRelay = await probeSameOriginHttpRelay(options);
  if (httpRelay) return httpRelay;
  const wsRelay = await probeSameOriginRelay(options);
  if (wsRelay) return wsRelay;
  return publicHttpRelay();
}
