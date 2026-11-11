/**
 * Optional MAFIA relay.
 *
 * The relay is deliberately dumb: it routes small JSON frames between a host
 * and its guests, keeps a list of public rooms and never sees game roles.
 * All game authority stays on the host — the relay cannot leak hidden roles
 * because it never receives them.
 */

import { WebSocketServer } from "ws";
import {
  FRAME_TYPES,
  MAX_IP_CONNECTIONS,
  MAX_PAYLOAD_CHARS,
  MAX_ROOM_MEMBERS,
  MAX_ROOMS,
  PROTOCOL_VERSION,
  RELAY_BURST,
  RELAY_REFILL_PER_SEC,
  ROOM_STALE_MS,
  cleanRoomMeta,
  cleanPeer,
  frameTooLarge,
  isObject,
  normalizeRelayEndpoint,
  payloadTooLarge,
  parseFrame,
  relayId,
} from "../js/net/protocol.js";
import { createRoomCode, isValidRoomCode, safeJsonParse, safeStringify } from "../js/core/security.js";

const OPEN = 1;
const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 1008;
const CLOSE_TOO_LARGE = 1009;
const CLOSE_INTERNAL = 1011;
const CLOSE_KICKED = 4001;

const DEFAULT_PATH = "/ws";
const PRUNE_EVERY = 15_000;
/**
 * Serverless edges (Vercel) close every socket when the function hits its
 * max duration, and any network hiccup drops sockets too. Instead of killing
 * the room on the first close frame, the relay keeps the seat warm for a
 * grace window and waits for a `resume` frame from the same peer.
 */
const HOST_GRACE_MS = 45_000;
const GUEST_GRACE_MS = 45_000;

function nowMs() {
  return Date.now();
}

function normalizeOrigins(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenBucket(capacity, refillPerSec) {
  return {
    tokens: capacity,
    capacity,
    refillPerSec,
    last: nowMs(),
  };
}

function takeToken(bucket, cost = 1) {
  const now = nowMs();
  const elapsed = Math.max(0, now - bucket.last) / 1000;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerSec);
  bucket.last = now;
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return true;
  }
  return false;
}

function send(socket, payload) {
  if (!socket || socket.readyState !== OPEN) return false;
  const text = safeStringify(payload, MAX_PAYLOAD_CHARS + 8_000);
  if (!text) return false;
  try {
    socket.send(text);
    return true;
  } catch {
    return false;
  }
}

function deny(socket, reason) {
  send(socket, { type: FRAME_TYPES.DENIED, reason: String(reason).slice(0, 160) });
}

export class Relay {
  constructor({
    server,
    path = DEFAULT_PATH,
    allowedOrigins = [],
    maxRooms = MAX_ROOMS,
    trustProxy = false,
    logger = console,
    hostGraceMs = HOST_GRACE_MS,
    guestGraceMs = GUEST_GRACE_MS,
    now = nowMs,
  } = {}) {
    if (!server) throw new Error("Relay requires an HTTP server");
    this.server = server;
    const paths = Array.isArray(path) ? path : [path];
    this.paths = new Set(paths.map((item) => (String(item).startsWith("/") ? String(item) : `/${item}`)));
    this.allowedOrigins = normalizeOrigins(allowedOrigins);
    this.maxRooms = Math.max(4, Math.min(MAX_ROOMS, Number(maxRooms) || MAX_ROOMS));
    this.trustProxy = trustProxy === true;
    this.logger = logger;
    this.hostGraceMs = Math.max(1_000, Number(hostGraceMs) || HOST_GRACE_MS);
    this.guestGraceMs = Math.max(1_000, Number(guestGraceMs) || GUEST_GRACE_MS);
    this.now = now;
    this.rooms = new Map();
    this.ipSockets = new Map();
    this.ipRooms = new Map();
    this.startedAt = nowMs();
    this.closed = false;

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 64 * 1024,
      perMessageDeflate: false,
      clientTracking: true,
    });

    this._onUpgrade = (request, socket, head) => this._handleUpgrade(request, socket, head);
    server.on("upgrade", this._onUpgrade);
    this.wss.on("connection", (socket, request) => this._onConnection(socket, request));

    this.pruneTimer = setInterval(() => this._prune(), PRUNE_EVERY);
    this.pruneTimer.unref?.();
  }

  // -----------------------------------------------------------------------
  // HTTP
  // -----------------------------------------------------------------------

  /** Returns true when this request was answered by the relay. */
  handleHttp(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://relay.local");
    } catch {
      return false;
    }
    if (!["/rooms", "/health"].includes(url.pathname)) return false;

    // The dev server serves the game on the same origin as the relay. A browser
    // opening the `/rooms` screen must get the app shell, while the client's
    // fetch (Accept: */*, Sec-Fetch-Mode: cors) still gets the JSON room list.
    const accept = String(req.headers.accept || "");
    const isDocument = req.headers["sec-fetch-mode"] === "navigate" || accept.includes("text/html");
    if (url.pathname === "/rooms" && isDocument) return false;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return true;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
      res.end("Method Not Allowed");
      return true;
    }

    const body =
      url.pathname === "/health"
        ? {
            ok: true,
            service: "mafia-relay",
            websocket: true,
            protocol: PROTOCOL_VERSION,
            rooms: this.rooms.size,
            players: [...this.rooms.values()].reduce((sum, room) => sum + room.members.size, 0),
            uptime: Math.round((nowMs() - this.startedAt) / 1000),
            now: nowMs(),
          }
        : { rooms: this.listRooms(), now: nowMs() };

    const text = JSON.stringify(body);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    if (req.method === "HEAD") res.end();
    else res.end(text);
    return true;
  }

  listRooms() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (!room.meta.public) continue;
      if (!this._hostAlive(room)) continue;
      out.push({
        ...room.meta,
        code: room.code,
        source: "online",
        updatedAt: room.updatedAt,
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // -----------------------------------------------------------------------
  // WebSocket lifecycle
  // -----------------------------------------------------------------------

  _handleUpgrade(request, socket, head) {
    let pathname = "";
    try {
      pathname = new URL(request.url, "http://relay.local").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (!this.paths.has(pathname)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!this._originAllowed(request.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws, request);
    });
  }

  _originAllowed(origin) {
    if (!this.allowedOrigins.length) return true;
    if (!origin) return false;
    return this.allowedOrigins.includes("*") || this.allowedOrigins.includes(origin);
  }

  _clientIp(request) {
    if (this.trustProxy) {
      const forwarded = request.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
    }
    return request.socket.remoteAddress ?? "unknown";
  }

  _onConnection(socket, request) {
    if (this.closed) {
      socket.close(CLOSE_INTERNAL, "Relay closed");
      return;
    }
    const ip = this._clientIp(request);
    const count = (this.ipSockets.get(ip) ?? 0) + 1;
    this.ipSockets.set(ip, count);
    if (count > MAX_IP_CONNECTIONS) {
      this._decIp(ip);
      deny(socket, "Слишком много подключений с этого адреса.");
      socket.close(CLOSE_POLICY, "Too many connections");
      return;
    }

    socket.client = {
      id: null,
      roomCode: null,
      role: null,
      ip,
      alive: true,
      lastAt: nowMs(),
      bucket: tokenBucket(RELAY_BURST, RELAY_REFILL_PER_SEC),
    };

    socket.on("pong", () => {
      if (socket.client) socket.client.alive = true;
    });

    socket.on("message", (data, isBinary) => {
      this._onMessage(socket, data, isBinary);
    });

    socket.on("close", () => {
      this._onDisconnect(socket);
    });

    socket.on("error", () => {
      try {
        socket.terminate();
      } catch {
        // ignore
      }
    });
  }

  _onDisconnect(socket) {
    const client = socket.client;
    if (!client) return;
    this._decIp(client.ip);
    const room = client.roomCode ? this.rooms.get(client.roomCode) : null;
    socket.client = null;
    if (!room) return;
    // The seat stays warm for a grace window: a dropped socket (Vercel max
    // duration, network blip) is not a leave until the peer fails to resume.
    if (client.role === "host") {
      if (room.hostSocket !== socket) return; // already replaced by a resume
      room.hostSocket = null;
      room.hostGoneAt = nowMs();
      room.updatedAt = nowMs();
      return;
    }
    const member = room.members.get(client.id);
    if (!member || member.socket !== socket) return; // already replaced
    member.socket = null;
    member.goneAt = nowMs();
    room.updatedAt = nowMs();
  }

  _decIp(ip) {
    const count = (this.ipSockets.get(ip) ?? 1) - 1;
    if (count <= 0) this.ipSockets.delete(ip);
    else this.ipSockets.set(ip, count);
  }

  _onMessage(socket, data, isBinary) {
    const client = socket.client;
    if (!client) return;
    client.lastAt = nowMs();
    if (socket.readyState !== OPEN) return;
    if (isBinary) {
      socket.close(CLOSE_POLICY, "Binary frames are not allowed");
      return;
    }
    const text = typeof data === "string" ? data : data.toString("utf8");
    if (frameTooLarge(text)) {
      socket.close(CLOSE_TOO_LARGE, "Frame too large");
      return;
    }
    if (!takeToken(client.bucket)) {
      // Backpressure, not a policy violation. A deny would end the client's
      // whole session, so a burst of fast messages must never be fatal: ask
      // the client to pause briefly instead.
      const deficit = Math.max(1 - client.bucket.tokens, 1 / client.bucket.refillPerSec);
      const retryAfterMs = Math.min(
        10_000,
        Math.max(250, Math.ceil((deficit / client.bucket.refillPerSec) * 1000)),
      );
      send(socket, {
        type: FRAME_TYPES.THROTTLE,
        reason: "Слишком много запросов. Подождите секунду.",
        retryAfterMs,
      });
      return;
    }
    const frame = parseFrame(text);
    if (!isObject(frame) || typeof frame.type !== "string") return;

    const room = client.roomCode ? this.rooms.get(client.roomCode) : null;
    if (room) room.updatedAt = nowMs();

    switch (frame.type) {
      case FRAME_TYPES.CREATE:
        this._handleCreate(socket, frame);
        break;
      case FRAME_TYPES.JOIN:
        this._handleJoin(socket, frame);
        break;
      case FRAME_TYPES.RESUME:
        this._handleResume(socket, frame);
        break;
      case FRAME_TYPES.RELAY:
        this._handleRelay(socket, room, frame);
        break;
      case FRAME_TYPES.META:
        this._handleMeta(socket, room, frame);
        break;
      case FRAME_TYPES.KICK:
        this._handleKick(socket, room, frame);
        break;
      case FRAME_TYPES.CLOSE:
        this._handleClose(socket, room, frame);
        break;
      case FRAME_TYPES.PING:
        send(socket, { type: FRAME_TYPES.PONG, at: Number(frame.at) || nowMs(), now: nowMs() });
        break;
      case FRAME_TYPES.LIST:
        send(socket, { type: FRAME_TYPES.ROOMS, rooms: this.listRooms(), now: nowMs() });
        break;
      default:
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Frame handlers
  // -----------------------------------------------------------------------

  _handleCreate(socket, frame) {
    const client = socket.client;
    if (!client || client.roomCode) {
      deny(socket, "Вы уже в комнате.");
      return;
    }
    if (this.rooms.size >= this.maxRooms) {
      deny(socket, "Сервер переполнен. Попробуйте позже.");
      return;
    }
    const roomsByIp = this.ipRooms.get(client.ip) ?? 0;
    if (roomsByIp >= 3) {
      deny(socket, "Слишком много комнат с этого адреса.");
      return;
    }

    let code = isValidRoomCode(frame.room) ? frame.room : "";
    if (!code) {
      for (let i = 0; i < 20; i += 1) {
        const candidate = createRoomCode();
        if (!this.rooms.has(candidate)) {
          code = candidate;
          break;
        }
      }
    }
    if (!code || this.rooms.has(code)) {
      send(socket, { type: FRAME_TYPES.ERROR, code: "room-taken", reason: "Код комнаты занят." });
      return;
    }

    const hostId = relayId("h");
    const hostToken = relayId("t");
    const meta = cleanRoomMeta({
      ...(isObject(frame.meta) ? frame.meta : {}),
      code,
      hostName: frame.hostName ?? frame.meta?.hostName,
      hostId,
      updatedAt: nowMs(),
    });

    const room = {
      code,
      hostId,
      hostToken,
      hostIp: client.ip,
      hostSocket: socket,
      hostGoneAt: 0,
      hostName: meta.hostName,
      meta,
      members: new Map(),
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    this.rooms.set(code, room);
    this.ipRooms.set(client.ip, roomsByIp + 1);
    client.id = hostId;
    client.roomCode = code;
    client.role = "host";

    send(socket, {
      type: FRAME_TYPES.WELCOME,
      protocol: PROTOCOL_VERSION,
      selfId: hostId,
      room: code,
      host: true,
      hostId,
      token: hostToken,
      meta: room.meta,
      now: nowMs(),
    });
    this.logger?.info?.(`[relay] room ${code} opened by ${client.ip}`);
  }

  _handleJoin(socket, frame) {
    const client = socket.client;
    if (!client || client.roomCode) {
      deny(socket, "Вы уже в комнате.");
      return;
    }
    const code = typeof frame.room === "string" ? frame.room.toUpperCase() : "";
    const room = isValidRoomCode(code) ? this.rooms.get(code) : null;
    if (!room) {
      deny(socket, "Комната не найдена.");
      return;
    }
    if (!this._hostAlive(room)) {
      // A detached host gets a grace window to resume; don't kill the room.
      if (!room.hostGoneAt) this._closeRoom(room, "Хост отключился.");
      deny(
        socket,
        room.hostGoneAt ? "Хост переподключается. Попробуйте через пару секунд." : "Комната закрыта.",
      );
      return;
    }
    if (room.members.size + 1 >= MAX_ROOM_MEMBERS) {
      deny(socket, "Комната заполнена.");
      return;
    }
    const peer = cleanPeer({
      id: relayId("p"),
      name: frame.name,
      avatar: frame.avatar,
      color: frame.color,
      spectate: frame.spectate === true,
    });

    room.members.set(peer.id, {
      id: peer.id,
      socket,
      token: relayId("t"),
      info: peer,
      joinedAt: nowMs(),
      goneAt: 0,
    });
    const member = room.members.get(peer.id);
    room.updatedAt = nowMs();
    client.id = peer.id;
    client.roomCode = room.code;
    client.role = "guest";

    send(socket, {
      type: FRAME_TYPES.WELCOME,
      protocol: PROTOCOL_VERSION,
      selfId: peer.id,
      room: room.code,
      host: false,
      hostId: room.hostId,
      spectate: peer.spectate,
      token: member.token,
      meta: room.meta,
      now: nowMs(),
    });
    send(room.hostSocket, {
      type: FRAME_TYPES.PEER_JOIN,
      peer: {
        id: peer.id,
        name: peer.name,
        avatar: peer.avatar,
        color: peer.color,
        spectate: peer.spectate,
      },
      room: room.code,
    });
    this.logger?.info?.(`[relay] ${peer.name} joined ${room.code}`);
  }

  /**
   * Rebind a dropped peer to a fresh socket. The client proves ownership with
   * the token it received in the original WELCOME, so a room code alone is
   * not enough to hijack a seat.
   */
  _handleResume(socket, frame) {
    const client = socket.client;
    if (!client || client.roomCode) {
      deny(socket, "Вы уже в комнате.");
      return;
    }
    const code = typeof frame.room === "string" ? frame.room.toUpperCase() : "";
    const room = isValidRoomCode(code) ? this.rooms.get(code) : null;
    if (!room) {
      deny(socket, "Комната не найдена.");
      return;
    }
    const peerId = typeof frame.peerId === "string" ? frame.peerId : "";
    const token = typeof frame.token === "string" ? frame.token : "";

    if (peerId === room.hostId) {
      if (!token || token !== room.hostToken) {
        deny(socket, "Сессия не найдена.");
        return;
      }
      const previous = room.hostSocket;
      room.hostSocket = socket;
      room.hostGoneAt = 0;
      room.updatedAt = nowMs();
      client.id = room.hostId;
      client.roomCode = room.code;
      client.role = "host";
      if (previous && previous !== socket) {
        try {
          previous.close(CLOSE_NORMAL, "Replaced");
        } catch {
          // ignore
        }
      }
      send(socket, {
        type: FRAME_TYPES.WELCOME,
        protocol: PROTOCOL_VERSION,
        selfId: room.hostId,
        room: room.code,
        host: true,
        hostId: room.hostId,
        token: room.hostToken,
        meta: room.meta,
        resumed: true,
        now: nowMs(),
      });
      this.logger?.info?.(`[relay] host resumed ${room.code}`);
      return;
    }

    const member = room.members.get(peerId);
    if (!member || !token || token !== member.token) {
      deny(socket, "Сессия не найдена.");
      return;
    }
    const previous = member.socket;
    member.socket = socket;
    member.goneAt = 0;
    room.updatedAt = nowMs();
    client.id = member.id;
    client.roomCode = room.code;
    client.role = "guest";
    if (previous && previous !== socket) {
      try {
        previous.close(CLOSE_NORMAL, "Replaced");
      } catch {
        // ignore
      }
    }
    send(socket, {
      type: FRAME_TYPES.WELCOME,
      protocol: PROTOCOL_VERSION,
      selfId: member.id,
      room: room.code,
      host: false,
      hostId: room.hostId,
      spectate: member.info.spectate,
      token: member.token,
      meta: room.meta,
      resumed: true,
      now: nowMs(),
    });
    this.logger?.info?.(`[relay] ${member.info.name} resumed ${room.code}`);
  }

  _handleRelay(socket, room, frame) {
    const client = socket.client;
    if (!client || !room) {
      deny(socket, "Сначала войдите в комнату.");
      return;
    }
    if (!isObject(frame.payload) || payloadTooLarge(frame.payload)) {
      deny(socket, "Слишком большое сообщение.");
      return;
    }
    const to = typeof frame.to === "string" ? frame.to : "";
    if (!to) return;

    if (client.role === "guest") {
      if (to !== room.hostId) {
        deny(socket, "Гости могут писать только хосту.");
        return;
      }
      send(room.hostSocket, {
        type: FRAME_TYPES.RELAY,
        from: client.id,
        to,
        room: room.code,
        payload: frame.payload,
      });
      return;
    }

    if (client.role === "host") {
      if (to === "*") {
        for (const member of room.members.values()) {
          send(member.socket, {
            type: FRAME_TYPES.RELAY,
            from: room.hostId,
            to: "*",
            room: room.code,
            payload: frame.payload,
          });
        }
        return;
      }
      const member = room.members.get(to);
      if (!member) return;
      send(member.socket, {
        type: FRAME_TYPES.RELAY,
        from: room.hostId,
        to,
        room: room.code,
        payload: frame.payload,
      });
    }
  }

  _handleMeta(socket, room, frame) {
    const client = socket.client;
    if (!client || !room || client.role !== "host") {
      deny(socket, "Только хост обновляет комнату.");
      return;
    }
    const meta = cleanRoomMeta({
      ...(isObject(frame.meta) ? frame.meta : {}),
      code: room.code,
      hostId: room.hostId,
      hostName: room.hostName,
      updatedAt: nowMs(),
    });
    room.meta = meta;
    room.updatedAt = nowMs();
  }

  _handleKick(socket, room, frame) {
    const client = socket.client;
    if (!client || !room || client.role !== "host") {
      deny(socket, "Только хост может исключать.");
      return;
    }
    const targetId = typeof frame.to === "string" ? frame.to : "";
    const member = room.members.get(targetId);
    if (!member) return;
    const reason = String(frame.reason ?? "Вас исключили из комнаты.").slice(0, 120);
    send(member.socket, { type: FRAME_TYPES.DENIED, reason });
    try {
      member.socket?.close(CLOSE_KICKED, reason.slice(0, 100));
    } catch {
      // ignore
    }
    member.socket = null;
    room.members.delete(targetId);
    send(room.hostSocket, { type: FRAME_TYPES.PEER_LEAVE, peerId: targetId, room: room.code });
  }

  _handleClose(socket, room, frame) {
    const client = socket.client;
    if (!client || !room || client.role !== "host") return;
    this._closeRoom(room, String(frame.reason ?? "Хост закрыл комнату.").slice(0, 120), {
      includeHost: false,
    });
    try {
      socket.close(CLOSE_NORMAL, "Room closed");
    } catch {
      // ignore
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  _hostAlive(room) {
    return room?.hostSocket?.readyState === OPEN;
  }

  _closeRoom(room, reason, { includeHost = false } = {}) {
    if (!room || !this.rooms.has(room.code)) return;
    this.rooms.delete(room.code);
    const ip = room.hostIp ?? room.hostSocket?.client?.ip;
    if (ip) {
      const count = (this.ipRooms.get(ip) ?? 1) - 1;
      if (count <= 0) this.ipRooms.delete(ip);
      else this.ipRooms.set(ip, count);
    }
    if (room.hostSocket) room.hostSocket.client = null;
    for (const member of room.members.values()) {
      send(member.socket, { type: FRAME_TYPES.CLOSED, reason });
      try {
        member.socket?.close(CLOSE_NORMAL, "Room closed");
      } catch {
        // ignore
      }
    }
    room.members.clear();
    if (includeHost) {
      try {
        room.hostSocket?.close(CLOSE_NORMAL, "Room closed");
      } catch {
        // ignore
      }
    }
  }

  _prune() {
    const now = nowMs();
    for (const [code, room] of [...this.rooms]) {
      if (room.hostSocket && room.hostSocket.readyState !== OPEN) {
        // The close event may not have fired yet; treat it as detached.
        room.hostSocket = null;
        room.hostGoneAt = room.hostGoneAt || now;
      }
      if (!room.hostSocket) {
        if (!room.hostGoneAt) room.hostGoneAt = now;
        if (now - room.hostGoneAt > this.hostGraceMs) {
          this._closeRoom(room, "Хост отключился.");
          continue;
        }
      } else if (now - room.updatedAt > ROOM_STALE_MS) {
        this._closeRoom(room, "Комната закрыта из-за неактивности.");
        continue;
      }
      for (const member of [...room.members.values()]) {
        if (member.socket && member.socket.readyState !== OPEN) {
          member.socket = null;
          member.goneAt = member.goneAt || now;
        }
        if (!member.socket) {
          if (!member.goneAt) member.goneAt = now;
          if (now - member.goneAt > this.guestGraceMs) {
            room.members.delete(member.id);
            send(room.hostSocket, { type: FRAME_TYPES.PEER_LEAVE, peerId: member.id, room: code });
          }
        }
      }
      room.updatedAt = now;
    }

    for (const socket of this.wss.clients) {
      const client = socket.client;
      if (!client) continue;
      if (!client.alive) {
        socket.terminate();
        continue;
      }
      client.alive = false;
      try {
        socket.ping();
      } catch {
        // ignore
      }
      // An application-level ping keeps the browser-side idle check fresh even
      // when a background tab throttles its own timers.
      send(socket, { type: FRAME_TYPES.PING, now });
    }
  }

  stats() {
    return {
      rooms: this.rooms.size,
      players: [...this.rooms.values()].reduce((sum, room) => sum + room.members.size, 0),
      uptime: Math.round((nowMs() - this.startedAt) / 1000),
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pruneTimer);
    for (const room of [...this.rooms.values()]) {
      this._closeRoom(room, "Сервер выключается.");
    }
    this.server.off("upgrade", this._onUpgrade);
    for (const socket of this.wss.clients) {
      try {
        socket.close(1001, "Server shutting down");
      } catch {
        // ignore
      }
    }
    this.wss.close();
  }
}

export function attachRelay(options) {
  return new Relay(options);
}

export { normalizeRelayEndpoint, safeJsonParse };
