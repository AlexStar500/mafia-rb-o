/**
 * MAFIA · Ночной город — Cloudflare Worker + Durable Objects relay.
 *
 * Each room is a single Durable Object: strong consistency, no lost updates,
 * and it scales to many rooms because rooms are isolated from one another.
 * A small KV namespace keeps the public room index (the browse list), which is
 * low-frequency and cheap.
 *
 * Bindings:
 *   - MAFIA_DO    (Durable Object namespace)  — room state
 *   - MAFIA_ROOMS (KV namespace)              — public room index
 *
 * Routes (client talks to /api/*):
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
 */

const PROTOCOL_VERSION = 2;
const MAX_PEERS = 30;
const MAX_EVENTS = 240;
const ROOM_CLOSED_TTL = 60_000;
const HOST_TTL = 180_000;
const PEER_TTL = 150_000;
const HEARTBEAT_SAVE_MS = 60_000;
const INDEX_TTL = 6 * 60 * 60; // seconds — public rooms stay listed for 6h

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function relayId(prefix) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function isValidRoomCode(value) {
  return typeof value === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(value);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeHexColor(value, fallback = "#d9b36c") {
  if (typeof value !== "string") return fallback;
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : fallback;
}

function isValidAvatarId(value) {
  return value === null || (typeof value === "string" && /^[a-z0-9-]{2,24}$/.test(value));
}

const PROFANITY_RE =
  /(?<![\p{L}])(ху[йеё]|хуя|хуйн|пизд|бля[дт]|ебан|ебат|ебал|ебуч|заеб|наеб|уеб|мраз|сука|сучк|долбо|пидор|пидар|гандон|мудак|мудил|шлюх|говн)(?![\p{L}])/giu;
function sanitizeNick(input) {
  let raw = String(input ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N} _.\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  if (!raw) return "";
  if (PROFANITY_RE.test(raw)) return "";
  return raw;
}

function textOf(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message || fallback;
  if (typeof value === "object") {
    for (const key of ["message", "error", "reason", "text", "title", "detail"]) {
      const nested = value[key];
      if (typeof nested === "string" && nested.trim()) return nested;
      if (nested != null && typeof nested !== "object") return String(nested);
    }
  }
  return fallback;
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

function publicPeer(peer) {
  return { id: peer.id, name: peer.name, avatar: peer.avatar, color: peer.color, spectate: peer.spectate };
}

async function readJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function queueFor(room, id) {
  let queue = room.queues[id];
  if (!queue) {
    queue = { seq: 0, items: [] };
    room.queues[id] = queue;
  }
  return queue;
}

function pushEvent(room, recipientId, event) {
  const queue = queueFor(room, recipientId);
  queue.seq += 1;
  queue.items.push({ seq: queue.seq, ...event });
  if (queue.items.length > MAX_EVENTS) queue.items.splice(0, queue.items.length - MAX_EVENTS);
}

function auth(room, peerId, token) {
  if (!room || typeof peerId !== "string" || typeof token !== "string") return "";
  if (peerId === room.hostId) return room.hostToken === token ? "host" : "";
  const peer = room.peers[peerId];
  return peer && peer.token === token ? "guest" : "";
}

function closeRoom(room, reason) {
  if (room.closed) return;
  room.closed = true;
  room.closedAt = Date.now();
  room.closeReason = textOf(reason, "Комната закрыта.").slice(0, 140);
  room.updatedAt = room.closedAt;
  for (const id of Object.keys(room.peers)) pushEvent(room, id, { type: "closed", reason: room.closeReason });
}

function removePeer(room, peerId, reason = "Игрок вышел.") {
  const peer = room.peers[peerId];
  if (!peer) return;
  delete room.peers[peerId];
  room.updatedAt = Date.now();
  if (!room.closed) pushEvent(room, room.hostId, { type: "peer-leave", peerId });
  if (reason === "kicked") peer.kickedAt = Date.now();
}

function pruneRoom(room, now = Date.now()) {
  if (room.closed) return now - room.closedAt > ROOM_CLOSED_TTL;
  if (now - room.hostSeen > HOST_TTL) {
    closeRoom(room, "Хост отключился.");
    return false;
  }
  for (const peer of Object.values(room.peers)) {
    if (peer.kickedAt) {
      if (now - peer.kickedAt > ROOM_CLOSED_TTL) delete room.peers[peer.id];
      continue;
    }
    if (now - peer.lastSeen > PEER_TTL) removePeer(room, peer.id);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Durable Object: one per room.
// ---------------------------------------------------------------------------

export class RoomObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.state = null;
  }

  async _load() {
    if (this.state) return this.state;
    const raw = await this.ctx.storage.get("room");
    if (raw) {
      try {
        this.state = JSON.parse(raw);
      } catch {
        this.state = null;
      }
    }
    if (!this.state) {
      this.state = {
        code: "",
        hostId: "",
        hostToken: "",
        hostName: "",
        hostSeen: 0,
        meta: null,
        peers: {},
        queues: {},
        createdAt: 0,
        updatedAt: 0,
        heartbeatAt: 0,
        closed: false,
        closedAt: 0,
        closeReason: "",
      };
    }
    return this.state;
  }

  async _save() {
    if (!this.state) return;
    await this.ctx.storage.put("room", JSON.stringify(this.state));
  }

  async _index() {
    const room = this.state;
    if (!room.meta) return;
    if (room.closed) {
      await this.env.MAFIA_ROOMS.delete(`index:${room.code}`);
      return;
    }
    await this.env.MAFIA_ROOMS.put(`index:${room.code}`, JSON.stringify({
      code: room.code,
      hostId: room.hostId,
      hostName: room.hostName,
      meta: room.meta,
      players: Math.max(room.meta.players, Object.keys(room.peers).length + 1),
      updatedAt: room.updatedAt,
    }), { expirationTtl: INDEX_TTL });
  }

  async handleInit(body) {
    if (this.state.hostId) return json(409, { ok: false, error: "Комната с таким кодом уже есть." });
    const now = Date.now();
    this.state.code = String(body.code ?? "").toUpperCase();
    this.state.hostId = relayId("h");
    this.state.hostToken = relayId("t");
    this.state.hostName = sanitizeNick(body.hostName) || "Хост";
    this.state.hostSeen = now;
    this.state.createdAt = now;
    this.state.updatedAt = now;
    this.state.heartbeatAt = now;
    this.state.meta = cleanMeta({ ...(body.meta ?? {}), code: this.state.code, hostId: this.state.hostId, hostName: this.state.hostName });
    this.state.peers = {};
    this.state.queues = { [this.state.hostId]: { seq: 0, items: [] } };
    await this._save();
    await this._index();
    return json(200, { ok: true, code: this.state.code, hostId: this.state.hostId, token: this.state.hostToken, meta: this.state.meta });
  }

  async handleJoin(body) {
    const room = this.state;
    if (!room.hostId) return json(404, { ok: false, error: "Комната не найдена." });
    if (room.closed) return json(410, { ok: false, error: "Комната закрыта." });
    if (Object.keys(room.peers).length >= MAX_PEERS) return json(403, { ok: false, error: "Комната заполнена." });
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
    room.peers[peer.id] = peer;
    room.updatedAt = Date.now();
    queueFor(room, peer.id);
    pushEvent(room, room.hostId, { type: "peer-join", peer: publicPeer(peer) });
    await this._save();
    await this._index();
    return json(200, {
      ok: true,
      peerId: peer.id,
      token: peer.token,
      hostId: room.hostId,
      code: room.code,
      spectate: peer.spectate,
      meta: room.meta,
    });
  }

  async handlePostEvent(body) {
    const room = this.state;
    const role = auth(room, body.peerId, body.token);
    if (!role) return json(403, { ok: false, error: "Нет доступа к комнате." });
    const payload = body.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json(400, { ok: false, error: "Некорректный payload." });
    let encoded = "";
    try {
      encoded = JSON.stringify(payload);
    } catch {
      return json(400, { ok: false, error: "Payload не сериализуется." });
    }
    if (encoded.length > 30_000) return json(413, { ok: false, error: "Слишком большое сообщение." });
    const now = Date.now();
    if (role === "host") {
      room.hostSeen = now;
      room.updatedAt = now;
      const to = String(body.to ?? "");
      if (to === "*") {
        for (const peer of Object.values(room.peers)) {
          if (peer.kickedAt) continue;
          pushEvent(room, peer.id, { type: "relay", from: room.hostId, payload });
        }
      } else if (room.peers[to]) {
        pushEvent(room, to, { type: "relay", from: room.hostId, payload });
      }
    } else {
      const peer = room.peers[body.peerId];
      if (!peer) return json(410, { ok: false, error: "Вы больше не в комнате." });
      peer.lastSeen = now;
      room.updatedAt = now;
      pushEvent(room, room.hostId, { type: "relay", from: peer.id, payload });
    }
    await this._save();
    return json(200, { ok: true });
  }

  async handleGetEvents(peerId, token, since) {
    const room = this.state;
    const role = auth(room, peerId, token);
    if (!role) return json(403, { ok: false, error: "Нет доступа к комнате." });
    const now = Date.now();
    if (role === "host") room.hostSeen = now;
    else {
      const peer = room.peers[peerId];
      if (peer) peer.lastSeen = now;
    }
    const queue = queueFor(room, peerId);
    const events = queue.items.filter((event) => event.seq > since);
    if (now - room.heartbeatAt > HEARTBEAT_SAVE_MS) {
      room.heartbeatAt = now;
      await this._save();
    }
    return json(200, { ok: true, events, cursor: queue.seq });
  }

  async handleMeta(body) {
    const room = this.state;
    if (auth(room, body.peerId, body.token) !== "host") return json(403, { ok: false, error: "Только хост меняет комнату." });
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
    await this._save();
    await this._index();
    return json(200, { ok: true, meta: room.meta });
  }

  async handleKick(body) {
    const room = this.state;
    if (auth(room, body.peerId, body.token) !== "host") return json(403, { ok: false, error: "Только хост исключает игроков." });
    const targetId = String(body.targetId ?? "");
    const peer = room.peers[targetId];
    if (!peer) return json(200, { ok: true });
    const reason = String(body.reason ?? "Вас исключили из комнаты.").slice(0, 140);
    pushEvent(room, targetId, { type: "denied", reason });
    peer.kickedAt = Date.now();
    peer.lastSeen = Date.now();
    room.updatedAt = peer.kickedAt;
    await this._save();
    await this._index();
    return json(200, { ok: true });
  }

  async handleClose(body) {
    const room = this.state;
    if (auth(room, body.peerId, body.token) !== "host") return json(403, { ok: false, error: "Только хост закрывает комнату." });
    closeRoom(room, body.reason ?? "Хост закрыл комнату.");
    await this._save();
    await this._index();
    return json(200, { ok: true });
  }

  async handleLeave(body) {
    const room = this.state;
    const role = auth(room, body.peerId, body.token);
    if (role === "guest") removePeer(room, body.peerId);
    await this._save();
    await this._index();
    return json(200, { ok: true });
  }

  async fetch(request) {
    const room = await this._load();
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const action = parts[parts.length - 1] ?? "";
    const method = request.method;

    if (action === "init" && method === "POST") {
      const body = await readJson(request);
      if (!body) return json(400, { ok: false, error: "Некорректный запрос." });
      return this.handleInit(body);
    }
    if (!room.hostId) return json(404, { ok: false, error: "Комната не найдена." });

    if (pruneRoom(room) && room.closed) {
      await this.ctx.storage.delete("room");
    }

    if (action === "join" && method === "POST") {
      const body = await readJson(request);
      if (!body) return json(400, { ok: false, error: "Некорректный запрос." });
      return this.handleJoin(body);
    }
    if (action === "events" && method === "GET") {
      return this.handleGetEvents(
        url.searchParams.get("peerId") ?? "",
        url.searchParams.get("token") ?? "",
        clampInt(url.searchParams.get("since"), 0, Number.MAX_SAFE_INTEGER, 0),
      );
    }
    if (action === "events" && method === "POST") {
      const body = await readJson(request);
      if (!body) return json(400, { ok: false, error: "Некорректный запрос." });
      return this.handlePostEvent(body);
    }
    if (action === "meta" && method === "POST") {
      const body = await readJson(request);
      if (!body) return json(400, { ok: false, error: "Некорректный запрос." });
      return this.handleMeta(body);
    }
    if (action === "kick" && method === "POST") {
      const body = await readJson(request);
      if (!body) return json(400, { ok: false, error: "Некорректный запрос." });
      return this.handleKick(body);
    }
    if (action === "close" && method === "POST") {
      const body = await readJson(request);
      if (!body) return json(400, { ok: false, error: "Некорректный запрос." });
      return this.handleClose(body);
    }
    if (action === "leave" && method === "POST") {
      const body = await readJson(request);
      if (!body) return json(400, { ok: false, error: "Некорректный запрос." });
      return this.handleLeave(body);
    }

    return json(404, { ok: false, error: "Not found" });
  }
}

// ---------------------------------------------------------------------------
// Worker: routes to the DO, keeps the public index and the create/list flows.
// ---------------------------------------------------------------------------

async function listRooms(env) {
  const list = await env.MAFIA_ROOMS.list({ prefix: "index:" });
  const now = Date.now();
  const rooms = [];
  for (const key of list.keys) {
    const raw = await env.MAFIA_ROOMS.get(key.name);
    if (!raw) continue;
    try {
      const entry = JSON.parse(raw);
      if (entry.meta && entry.meta.public && now - (entry.updatedAt || 0) < 6 * 60 * 60 * 1000) rooms.push(entry);
    } catch {
      // skip broken index entry
    }
  }
  return rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function codeIsTaken(env, code) {
  const raw = await env.MAFIA_ROOMS.get(`index:${code}`);
  if (!raw) return false;
  try {
    const entry = JSON.parse(raw);
    return entry.code === code;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "") || "/";
    const parts = path === "/" ? [] : path.split("/").filter(Boolean);
    const method = request.method;

    if (parts.length === 0 || (parts[0] === "health" && method === "GET")) {
      return json(200, {
        ok: true,
        service: "mafia-relay",
        http: true,
        protocol: PROTOCOL_VERSION,
        rooms: 0,
        uptime: 0,
      });
    }

    if (parts[0] === "rooms" && parts.length === 1) {
      if (method === "GET") return json(200, { rooms: await listRooms(env) });
      if (method === "POST") {
        const body = await readJson(request);
        if (!body) return json(400, { ok: false, error: "Некорректный запрос." });

        // Resolve or generate a code.
        const requested = String(body.code ?? "").toUpperCase();
        let code = "";
        if (requested) {
          if (!isValidRoomCode(requested)) return json(400, { ok: false, error: "Неверный код комнаты." });
          if (await codeIsTaken(env, requested)) return json(409, { ok: false, error: "Комната с таким кодом уже есть." });
          code = requested;
        } else {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const candidate = createRoomCode();
            if (!(await codeIsTaken(env, candidate))) {
              code = candidate;
              break;
            }
          }
          if (!code) return json(503, { ok: false, error: "Не удалось создать код комнаты." });
        }

        const id = env.MAFIA_DO.idFromName(code);
        const stub = env.MAFIA_DO.get(id);
        const initUrl = new URL(request.url);
        initUrl.pathname = `${initUrl.pathname.replace(/\/+$/, "")}/${code}/init`;
        const init = new Request(initUrl.toString(), { method: "POST", body: JSON.stringify({ code, hostName: body.hostName, meta: body.meta }) });
        return stub.fetch(init);
      }
      return json(405, { ok: false, error: "Метод не поддерживается." });
    }

    if (parts[0] === "rooms" && parts.length >= 2) {
      const code = String(parts[1]).toUpperCase();
      if (!isValidRoomCode(code)) return json(400, { ok: false, error: "Неверный код комнаты." });
      const id = env.MAFIA_DO.idFromName(code);
      const stub = env.MAFIA_DO.get(id);
      return stub.fetch(request);
    }

    return json(404, { ok: false, error: "Not found" });
  },
};
