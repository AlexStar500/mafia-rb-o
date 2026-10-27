import { normalizeRelayEndpoint } from "./protocol.js";

/**
 * The same Node process can serve the app and the relay. On a laptop this is
 * the "LAN host" mode: friends open http://<your-ip>:8080 and the browser
 * automatically talks to ws://<same-host>/ws.
 */
export function sameOriginRelay() {
  if (typeof location === "undefined") return "";
  if (!/^https?:$/.test(location.protocol) || !location.host) return "";
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}

function healthUrl() {
  if (typeof location === "undefined") return "/health";
  return new URL("/health", location.origin).toString();
}

/** A static host answers 404/HTML here, so a valid relay is recognised by JSON. */
async function probeOnce(timeout) {
  const relay = sameOriginRelay();
  if (!relay) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(healthUrl(), {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data?.ok === true && data?.service === "mafia-relay" ? relay : "";
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
    last = await probeOnce(timeout);
    if (last) return last;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return last;
}

/**
 * Resolve the relay for a room mode.
 * - `lan` always means "the server that served this page";
 * - `online` prefers an explicit address, then falls back to the same origin;
 * - `local` (ports/BroadcastChannel) never needs a relay.
 */
export async function resolveRelayForMode(mode, explicit = "", options = {}) {
  if (mode === "lan") return probeSameOriginRelay(options);
  if (mode !== "online") return "";
  const clean = normalizeRelayEndpoint(explicit);
  if (clean) return clean;
  return probeSameOriginRelay(options);
}
