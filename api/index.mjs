/**
 * HTTP relay for Vercel (no WebSocket).
 *
 * The static game and this function live in the same project, so the client
 * talks to `/api/...` on its own origin. Rooms are intentionally tiny: the
 * relay only moves opaque JSON frames between the host and its guests, lists
 * public rooms and never runs game rules.
 *
 * Routes (all under /api):
 *   GET  /health
 *   GET  /rooms
 *   POST /rooms
 *   POST /rooms/:code/join
 *   GET  /rooms/:code/events?peerId=&token=&since=
 *   POST /rooms/:code/events
 *   POST /rooms/:code/meta
 *   POST /rooms/:code/kick
 *   POST /rooms/:code/close
 *   POST /rooms/:code/leave
 *
 * State lives in the function instance. Fluid compute reuses a warm instance
 * for low-traffic projects, which is enough for friendly games. For a busy
 * public relay, swap `rooms` for Redis/Upstash behind the same helpers.
 */

import {
  createRoomCode,
  isValidAvatarId,
  isValidPlayerId,
  isValidRoomCode,
  normalizeHexColor,
  sanitizeNick,
} from "../js/core/security.js";

const PROTOCOL_VERSION = 2;
const MAX_ROOMS = 500;
const MAX_PEERS = 30;
const MAX_BODY_CHARS = 200_000;
const MAX_PAYLOAD_CHARS = 30_000;
const MAX_EVENTS = 240;
const ROOM_CLOSED_TTL = 60_000;
const HOST_TTL = 180_000;
const PEER_TTL = 150_000;
const STARTED_AT = Date.now();

/** @type {Map<string, any>} */
const rooms = new Map();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  for (const [key, val] of Object.entries(CORS_HEADERS)) res.setHeader(key, val);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

function relayId(prefix) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function cleanMeta(input = {}) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const status = ["lobby", "playing", "ended"].includes(src.status) ? src.status : "lobby";
  return {
    code: isValidRoomCode(src.code) ? src.code : "",
    name: String(src.name ?? "Ночной город").replace(/[<>]/g, "").slice(0, 32) || "Ночной город",
    hostId: typeof src.hostId === "string" ? src.hostId.slice(0, 40) : "",
    hostName: sanitizeNick(src.hostName) || "",
    players: clampInt(src.players, 0, 30, 0),
    humans: clampInt(src.humans, 0, 30, 0),
    bots: clampInt(src.bots, 0, 25, 0),
    maxPlayers: clampInt(src.maxPlayers, 4, 25, 8),
    minStart: clampInt(src.minStart, 4, 25, 4),
    status,
    public: src.public !== false,
    quick: src.quick === true,
    spectatorOnly: src.spectatorOnly === true,
    lan: false,
    source: "online",
    updatedAt: Date.now(),
  };
}

function cleanPeer(peer) {
  const id = isValidPlayerId(peer?.id) ? peer.id : "";
  return {
    id,
    name: sanitizeNick(peer?.name) || "Гость",
    avatar: isValidAvatarId(peer?.avatar) && peer.avatar ? peer.avatar : null,
    color: normalizeHexColor(peer?.color),
    spectate: peer?.spectate === true,
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  return new Promise((resolve) => {
    let raw = "";
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    req.setEncoding?.("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_CHARS) {
        req.destroy?.();
        finish(null);
      }
    });
    req.on("end", () => {
      if (!raw) return finish({});
      try {
        const value = JSON.parse(raw);
        finish(value && typeof value === "object" && !Array.isArray(value) ? value : null);
      } catch {
        finish(null);
      }
    });
    req.on("error", () => finish(null));
  });
}

function queueFor(room, id) {
  let queue = room.queues.get(id);
  if (!queue) {
    queue = { seq: 0, items: [] };
    room.queues.set(id, queue);
  }
  return queue;
}

function pushEvent(room, recipientId, event) {
  const queue = queueFor(room, recipientId);
  queue.seq += 1;
  queue.items.push({ seq: queue.seq, ...event });
  if (queue.items.length > MAX_EVENTS) queue.items.splice(0, queue.items.length - MAX_EVENTS);
}

function publicPeer(peer) {
  return {
    id: peer.id,
    name: peer.name,
    avatar: peer.avatar,
    color: peer.color,
    spectate: peer.spectate,
  };
}

function listRooms() {
  const now = Date.now();
  return [...rooms.values()]
    .filter((room) => room.meta.public && !room.closed && now - room.updatedAt < 6 * 60 * 60 * 1000)
    .map((room) => ({
      ...room.meta,
      code: room.code,
      hostId: room.hostId,
      hostName: room.hostName,
      players: Math.max(room.meta.players, room.peers.size + 1),
      humans: Math.max(room.meta.humans, room.peers.size + 1),
      updatedAt: room.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function closeRoom(room, reason) {
  if (room.closed) return;
  room.closed = true;
  room.closedAt = Date.now();
  room.closeReason = String(reason ?? "Комната закрыта.").slice(0, 140);
  room.updatedAt = room.closedAt;
  for (const peer of room.peers.values()) {
    pushEvent(room, peer.id, { type: "closed", reason: room.closeReason });
  }
}

function removePeer(room, peerId, reason = "Игрок вышел.") {
  const peer = room.peers.get(peerId);
  if (!peer) return;
  room.peers.delete(peerId);
  room.updatedAt = Date.now();
  if (!room.closed) pushEvent(room, room.hostId, { type: "peer-leave", peerId });
  // Keep the guest's queue for a moment so a final `denied`/`closed`
  // event can still be delivered.
  if (reason === "kicked") peer.kickedAt = Date.now();
}

function prune() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.closed) {
      if (now - room.closedAt > ROOM_CLOSED_TTL) rooms.delete(room.code);
      continue;
    }
    if (now - room.hostSeen > HOST_TTL) {
      closeRoom(room, "Хост отключился.");
      continue;
    }
    for (const peer of [...room.peers.values()]) {
      if (peer.kickedAt) {
        if (now - peer.kickedAt > ROOM_CLOSED_TTL) room.peers.delete(peer.id);
        continue;
      }
      if (now - peer.lastSeen > PEER_TTL) removePeer(room, peer.id);
    }
  }
}

function auth(room, peerId, token) {
  if (!room || typeof peerId !== "string" || typeof token !== "string") return "";
  if (peerId === room.hostId) return room.hostToken === token ? "host" : "";
  const peer = room.peers.get(peerId);
  return peer && peer.token === token ? "guest" : "";
}

function roomOr404(res, code) {
  const room = rooms.get(code);
  if (!room) {
    sendJson(res, 404, { ok: false, error: "Комната не найдена." });
    return null;
  }
  return room;
}

function isHttpBase(value) {
  return /^https?:\/\//i.test(String(value ?? ""));
}

async function handleCreate(req, res) {
  if (rooms.size >= MAX_ROOMS) {
    sendJson(res, 503, { ok: false, error: "Relay переполнен. Попробуйте позже." });
    return;
  }
  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, error: "Некорректный запрос." });
    return;
  }
  const requested = String(body.code ?? "").toUpperCase();
  let code = "";
  if (requested) {
    if (!isValidRoomCode(requested)) {
      sendJson(res, 400, { ok: false, error: "Неверный код комнаты." });
      return;
    }
    if (rooms.has(requested)) {
      sendJson(res, 409, { ok: false, error: "Комната с таким кодом уже есть." });
      return;
    }
    code = requested;
  } else {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = createRoomCode();
      if (!rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      sendJson(res, 503, { ok: false, error: "Не удалось создать код комнаты." });
      return;
    }
  }

  const hostId = relayId("h");
  const hostToken = relayId("t");
  const hostName = sanitizeNick(body.hostName) || "Хост";
  const now = Date.now();
  const room = {
    code,
    hostId,
    hostToken,
    hostName,
    hostSeen: now,
    meta: cleanMeta({ ...(body.meta ?? {}), code, hostId, hostName }),
    peers: new Map(),
    queues: new Map(),
    createdAt: now,
    updatedAt: now,
    closed: false,
    closedAt: 0,
    closeReason: "",
  };
  queueFor(room, hostId);
  rooms.set(code, room);
  sendJson(res, 200, { ok: true, code, hostId, token: hostToken, meta: room.meta });
}

async function handleJoin(req, res, code, room) {
  if (room.closed) {
    sendJson(res, 410, { ok: false, error: "Комната закрыта." });
    return;
  }
  if (room.peers.size >= MAX_PEERS) {
    sendJson(res, 403, { ok: false, error: "Комната заполнена." });
    return;
  }
  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, error: "Некорректный запрос." });
    return;
  }
  const peer = {
    id: relayId("p"),
    token: relayId("t"),
    name: sanitizeNick(body.name) || "Гость",
    avatar: isValidAvatarId(body.avatar) && body.avatar ? body.avatar : null,
    color: normalizeHexColor(body.color),
    spectate: body.spectate === true,
    lastSeen: Date.now(),
    kickedAt: 0,
  };
  room.peers.set(peer.id, peer);
  room.updatedAt = Date.now();
  queueFor(room, peer.id);
  pushEvent(room, room.hostId, { type: "peer-join", peer: publicPeer(peer) });
  sendJson(res, 200, {
    ok: true,
    peerId: peer.id,
    token: peer.token,
    hostId: room.hostId,
    code: room.code,
    spectate: peer.spectate,
    meta: room.meta,
  });
}

async function handlePostEvent(req, res, room) {
  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, error: "Некорректный запрос." });
    return;
  }
  const role = auth(room, body.peerId, body.token);
  if (!role) {
    sendJson(res, 403, { ok: false, error: "Нет доступа к комнате." });
    return;
  }
  const payload = body.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    sendJson(res, 400, { ok: false, error: "Некорректный payload." });
    return;
  }
  let encoded = "";
  try {
    encoded = JSON.stringify(payload);
  } catch {
    sendJson(res, 400, { ok: false, error: "Payload не сериализуется." });
    return;
  }
  if (encoded.length > MAX_PAYLOAD_CHARS) {
    sendJson(res, 413, { ok: false, error: "Слишком большое сообщение." });
    return;
  }

  const now = Date.now();
  if (role === "host") {
    room.hostSeen = now;
    room.updatedAt = now;
    const to = String(body.to ?? "");
    if (to === "*") {
      for (const peer of room.peers.values()) {
        if (peer.kickedAt) continue;
        pushEvent(room, peer.id, { type: "relay", from: room.hostId, payload });
      }
    } else if (room.peers.has(to)) {
      pushEvent(room, to, { type: "relay", from: room.hostId, payload });
    }
  } else {
    const peer = room.peers.get(body.peerId);
    if (!peer) {
      sendJson(res, 410, { ok: false, error: "Вы больше не в комнате." });
      return;
    }
    peer.lastSeen = now;
    room.updatedAt = now;
    pushEvent(room, room.hostId, { type: "relay", from: peer.id, payload });
  }
  sendJson(res, 200, { ok: true });
}

function handleGetEvents(req, res, url, room) {
  const peerId = url.searchParams.get("peerId") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const role = auth(room, peerId, token);
  if (!role) {
    sendJson(res, 403, { ok: false, error: "Нет доступа к комнате." });
    return;
  }
  if (role === "host") room.hostSeen = Date.now();
  else {
    const peer = room.peers.get(peerId);
    if (peer) peer.lastSeen = Date.now();
  }
  const since = clampInt(url.searchParams.get("since"), 0, Number.MAX_SAFE_INTEGER, 0);
  const queue = queueFor(room, peerId);
  const events = queue.items.filter((event) => event.seq > since);
  sendJson(res, 200, { ok: true, events, cursor: queue.seq });
}

async function handleMeta(req, res, room) {
  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, error: "Некорректный запрос." });
    return;
  }
  if (auth(room, body.peerId, body.token) !== "host") {
    sendJson(res, 403, { ok: false, error: "Только хост меняет комнату." });
    return;
  }
  room.meta = cleanMeta({
    ...room.meta,
    ...(body.meta ?? {}),
    code: room.code,
    hostId: room.hostId,
    hostName: room.hostName,
  });
  room.hostSeen = Date.now();
  room.updatedAt = room.hostSeen;
  room.meta.updatedAt = room.updatedAt;
  sendJson(res, 200, { ok: true, meta: room.meta });
}

async function handleKick(req, res, room) {
  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, error: "Некорректный запрос." });
    return;
  }
  if (auth(room, body.peerId, body.token) !== "host") {
    sendJson(res, 403, { ok: false, error: "Только хост исключает игроков." });
    return;
  }
  const targetId = String(body.targetId ?? "");
  const peer = room.peers.get(targetId);
  if (!peer) {
    sendJson(res, 200, { ok: true });
    return;
  }
  const reason = String(body.reason ?? "Вас исключили из комнаты.").slice(0, 140);
  pushEvent(room, targetId, { type: "denied", reason });
  peer.kickedAt = Date.now();
  peer.lastSeen = Date.now();
  room.updatedAt = peer.kickedAt;
  sendJson(res, 200, { ok: true });
}

async function handleClose(req, res, room) {
  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, error: "Некорректный запрос." });
    return;
  }
  if (auth(room, body.peerId, body.token) !== "host") {
    sendJson(res, 403, { ok: false, error: "Только хост закрывает комнату." });
    return;
  }
  closeRoom(room, body.reason ?? "Хост закрыл комнату.");
  sendJson(res, 200, { ok: true });
}

async function handleLeave(req, res, room) {
  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, error: "Некорректный запрос." });
    return;
  }
  const role = auth(room, body.peerId, body.token);
  if (role === "guest") removePeer(room, body.peerId);
  sendJson(res, 200, { ok: true });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    for (const [key, val] of Object.entries(CORS_HEADERS)) res.setHeader(key, val);
    res.end();
    return;
  }

  prune();

  const url = new URL(req.url ?? "/", "http://localhost");
  const rawPath = Array.isArray(req.query?.path)
    ? req.query.path.join("/")
    : typeof req.query?.path === "string"
      ? req.query.path
      : url.pathname.replace(/^\/api\/?/, "");
  const parts = rawPath.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (parts.length === 0) {
    sendJson(res, 200, {
      ok: true,
      service: "mafia-relay",
      http: true,
      protocol: PROTOCOL_VERSION,
      websocket: false,
      hint: "HTTP relay. Клиент обращается к /api/health, /api/rooms и /api/rooms/:code/events.",
    });
    return;
  }

  if (parts[0] === "health" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: "mafia-relay",
      http: true,
      protocol: PROTOCOL_VERSION,
      rooms: rooms.size,
      uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    });
    return;
  }

  if (parts[0] === "rooms" && parts.length === 1) {
    if (method === "GET") {
      sendJson(res, 200, { rooms: listRooms() });
      return;
    }
    if (method === "POST") {
      await handleCreate(req, res);
      return;
    }
    sendJson(res, 405, { ok: false, error: "Метод не поддерживается." });
    return;
  }

  if (parts[0] !== "rooms" || parts.length < 2) {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  const code = String(parts[1]).toUpperCase();
  if (!isValidRoomCode(code)) {
    sendJson(res, 400, { ok: false, error: "Неверный код комнаты." });
    return;
  }
  const room = roomOr404(res, code);
  if (!room) return;
  const action = parts[2] ?? "";

  if (action === "join" && method === "POST") {
    await handleJoin(req, res, code, room);
    return;
  }
  if (action === "events" && method === "GET") {
    handleGetEvents(req, res, url, room);
    return;
  }
  if (action === "events" && method === "POST") {
    await handlePostEvent(req, res, room);
    return;
  }
  if (action === "meta" && method === "POST") {
    await handleMeta(req, res, room);
    return;
  }
  if (action === "kick" && method === "POST") {
    await handleKick(req, res, room);
    return;
  }
  if (action === "close" && method === "POST") {
    await handleClose(req, res, room);
    return;
  }
  if (action === "leave" && method === "POST") {
    await handleLeave(req, res, room);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

export { rooms as __rooms, isHttpBase };
