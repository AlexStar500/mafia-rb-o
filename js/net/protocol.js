/**
 * Shared wire protocol for the optional Node relay and the browser client.
 *
 * Everything here is deliberately small and dependency-free so the same file
 * can be imported by `server/relay.mjs` (Node) and by the game (browser).
 */

import {
  isValidAvatarId,
  isValidRoomCode,
  normalizeHexColor,
  safeJsonParse,
  safeStringify,
  sanitizeNick,
} from "../core/security.js";

export const PROTOCOL_VERSION = 2;

/** Characters, not bytes. The relay also caps raw WebSocket frames in bytes. */
export const MAX_FRAME_CHARS = 48_000;
export const MAX_PAYLOAD_CHARS = 30_000;
export const MAX_ROOM_MEMBERS = 30;
export const MAX_ROOMS = 500;
export const MAX_ROOM_NAME = 32;
export const ROOM_TTL_MS = 30_000;
export const ROOM_STALE_MS = 90_000;
export const HEARTBEAT_MS = 12_000;
export const STALE_MS = 34_000;
export const MAX_ACTIONS_PER_SEC = 6;
export const MAX_IP_CONNECTIONS = 24;

export const FRAME_TYPES = Object.freeze({
  CREATE: "create",
  JOIN: "join",
  WELCOME: "welcome",
  PEER_JOIN: "peer-join",
  PEER_LEAVE: "peer-leave",
  RELAY: "relay",
  META: "meta",
  KICK: "kick",
  CLOSE: "close",
  CLOSED: "closed",
  DENIED: "denied",
  PING: "ping",
  PONG: "pong",
  LIST: "list",
  ROOMS: "rooms",
  ERROR: "error",
});

/** Generate relay-side ids that satisfy the client's isValidPlayerId(). */
export function relayId(prefix = "p") {
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function cleanPeer(input = {}) {
  return {
    id: typeof input.id === "string" && input.id.length >= 6 && input.id.length <= 40 ? input.id : "",
    name: sanitizeNick(input.name) || "Гость",
    avatar: isValidAvatarId(input.avatar) && input.avatar ? input.avatar : null,
    color: normalizeHexColor(input.color),
    spectate: input.spectate === true,
  };
}

function safeInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function cleanRoomMeta(input = {}) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const status = ["lobby", "playing", "ended"].includes(src.status) ? src.status : "lobby";
  return {
    code: isValidRoomCode(src.code) ? src.code : "",
    name: String(src.name ?? "Ночной город").replace(/[<>]/g, "").slice(0, MAX_ROOM_NAME) || "Ночной город",
    hostId: typeof src.hostId === "string" ? src.hostId.slice(0, 40) : "",
    hostName: sanitizeNick(src.hostName) || "",
    players: safeInt(src.players, 0, 20, 0),
    humans: safeInt(src.humans, 0, 20, 0),
    bots: safeInt(src.bots, 0, 20, 0),
    maxPlayers: safeInt(src.maxPlayers, 4, 20, 8),
    minStart: safeInt(src.minStart, 4, 20, 4),
    status,
    public: src.public !== false,
    quick: src.quick === true,
    spectatorOnly: src.spectatorOnly === true,
    source: "online",
    updatedAt: Number(src.updatedAt) || Date.now(),
  };
}

export function frameTooLarge(text) {
  return typeof text !== "string" || text.length > MAX_FRAME_CHARS;
}

export function payloadTooLarge(payload) {
  const text = safeStringify(payload, MAX_PAYLOAD_CHARS);
  return text === null;
}

export function parseFrame(text) {
  return safeJsonParse(text, null);
}

export function isOpenSocket(socket) {
  return Boolean(socket) && socket.readyState === 1;
}

/**
 * Turn a user-supplied ws(s):// endpoint into a canonical URL.
 * A bare host gets `/ws`; an explicit path is preserved.
 */
export function normalizeRelayEndpoint(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim().slice(0, 300);
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (!["ws:", "wss:"].includes(url.protocol)) return "";
  if (url.username || url.password) return "";
  if (typeof location !== "undefined" && location.protocol === "https:" && url.protocol !== "wss:") return "";
  if (!url.pathname || url.pathname === "/") url.pathname = "/ws";
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function defaultRelayEndpoint() {
  if (typeof location === "undefined" || !location.host) return "";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

/** `wss://host/ws` -> `https://host`, `wss://host/foo/ws` -> `https://host/foo` */
export function relayHttpBase(relayUrl) {
  const normalized = normalizeRelayEndpoint(relayUrl);
  if (!normalized) return "";
  const url = new URL(normalized);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/ws\/?$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function roomsUrl(relayUrl) {
  const base = relayHttpBase(relayUrl);
  return base ? `${base}/rooms` : "";
}

export function healthUrl(relayUrl) {
  const base = relayHttpBase(relayUrl);
  return base ? `${base}/health` : "";
}

/** Shareable link. The relay is carried in the query so another device can join. */
export function roomShareUrl(code, relayUrl, { origin, pathname } = {}) {
  const baseOrigin =
    origin ??
    (typeof location !== "undefined" ? location.origin + location.pathname : "index.html");
  const url = new URL(baseOrigin);
  url.searchParams.set("room", code);
  if (relayUrl) url.searchParams.set("relay", relayUrl);
  url.hash = "";
  return url.toString();
}

/** A minimal, bounded frame guard used by both client and relay. */
export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
