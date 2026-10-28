import { Emitter } from "../core/events.js";
import { textOf } from "../core/format.js";
import { createId, isValidAvatarId, isValidPlayerId, normalizeHexColor, safeJsonParse, safeStringify, sanitizeNick, isValidRoomCode } from "../core/security.js";
import { loadRoomRegistry, saveRoomRegistry } from "../core/storage.js";
import { ROLES } from "../data/roles.js";

const CHANNEL_PREFIX = "mafia.v2.room.";
const MESSAGE_VERSION = 2;
const MAX_MESSAGE = 32_768;
const ROOM_TTL = 25_000;
const HEARTBEAT = 3500;

function channelName(code) {
  return `${CHANNEL_PREFIX}${code}`;
}

function cleanMeta(meta) {
  return {
    code: typeof meta.code === "string" ? meta.code : "",
    name: String(meta.name ?? "Ночной город").slice(0, 32),
    hostId: String(meta.hostId ?? "").slice(0, 40),
    hostName: String(meta.hostName ?? "").slice(0, 16),
    players: Math.max(0, Math.min(20, Number(meta.players) || 0)),
    humans: Math.max(0, Math.min(20, Number(meta.humans) || 0)),
    bots: Math.max(0, Math.min(20, Number(meta.bots) || 0)),
    maxPlayers: Math.max(4, Math.min(20, Number(meta.maxPlayers) || 8)),
    minStart: Math.max(4, Math.min(20, Number(meta.minStart) || 4)),
    status: ["lobby", "playing", "ended"].includes(meta.status) ? meta.status : "lobby",
    public: meta.public !== false,
    quick: meta.quick === true,
    source: "local",
    updatedAt: Date.now(),
  };
}

export function listLocalRooms() {
  const now = Date.now();
  const rooms = loadRoomRegistry();
  const fresh = rooms.filter((room) => room && now - (Number(room.updatedAt) || 0) < ROOM_TTL);
  if (fresh.length !== rooms.length) {
    const kept = new Map(fresh.map((room) => [room.code, room]));
    saveRoomRegistry([...kept.values()]);
  }
  return fresh
    .map((room) => cleanMeta(room))
    .filter((room) => room.public && isValidRoomCode(room.code))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function upsertRoom(meta) {
  const rooms = listLocalRooms().filter((room) => room.code !== meta.code);
  rooms.unshift(meta);
  saveRoomRegistry(rooms.slice(0, 30));
}

export function removeLocalRoom(code) {
  const rooms = loadRoomRegistry().filter((room) => room.code !== code);
  saveRoomRegistry(rooms);
}

function pruneRooms() {
  listLocalRooms();
}

/**
 * Host side of a same-browser room. Works on GitHub Pages with no server:
 * every tab of the same browser profile shares a BroadcastChannel.
 */
export class LocalHostAdapter extends Emitter {
  constructor({ code, hostId, hostName, meta = {} }) {
    super();
    this.code = code;
    this.hostId = hostId;
    this.hostName = hostName;
    this.closed = false;
    this.peers = new Set();
    this.meta = cleanMeta({ ...meta, code, hostId, hostName });
    this.channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName(code)) : null;
    this._onMessage = (event) => this.handleRaw(event.data);
    this._onStorage = () => {};
    if (this.channel) this.channel.addEventListener("message", this._onMessage);
    window.addEventListener("storage", this._onStorage);
    pruneRooms();
    upsertRoom(this.meta);
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT);
    this.beat();
  }

  get online() {
    return false;
  }

  get mode() {
    return "local";
  }

  beat() {
    if (this.closed) return;
    this.meta.updatedAt = Date.now();
    upsertRoom(this.meta);
    this.post({ kind: "host-heartbeat", from: this.hostId });
  }

  updateMeta(meta) {
    this.meta = cleanMeta({ ...this.meta, ...meta, code: this.code, hostId: this.hostId, hostName: this.hostName });
    upsertRoom(this.meta);
  }

  addPeer(peerId) {
    this.peers.add(peerId);
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
  }

  send(peerId, payload) {
    if (this.closed) return false;
    const text = safeStringify(payload, MAX_MESSAGE);
    if (!text) return false;
    this.post({ kind: "relay", from: this.hostId, to: peerId, payload });
    return true;
  }

  broadcast(payload) {
    if (this.closed) return false;
    this.post({ kind: "relay", from: this.hostId, to: "*", payload });
    return true;
  }

  deny(peerId, reason = "Комната недоступна.") {
    this.send(peerId, { type: "denied", reason: textOf(reason, "Вход отклонён.").slice(0, 120) });
    this.removePeer(peerId);
  }

  kick(peerId, reason = "Вас исключили из комнаты.") {
    this.send(peerId, { type: "kicked", reason: textOf(reason, "Вас исключили из комнаты.").slice(0, 120) });
    this.removePeer(peerId);
  }

  handleRaw(raw) {
    if (this.closed || !raw) return;
    const data = typeof raw === "string" ? safeJsonParse(raw) : raw;
    if (!data || data.v !== MESSAGE_VERSION || data.room !== this.code) return;
    if (data.from === this.hostId) return;
    if (data.kind === "join") {
      if (!isValidPlayerId(data.from)) return;
      const name = sanitizeNick(data.name);
      if (!name) return;
      this.emit("join", {
        peer: {
          id: data.from,
          name,
          avatar: isValidAvatarId(data.avatar) ? data.avatar : null,
          color: normalizeHexColor(data.color),
          spectate: data.spectate === true,
        },
      });
      return;
    }
    if (data.kind === "relay") {
      if (!isValidPlayerId(data.from)) return;
      if (!data.payload || typeof data.payload !== "object") return;
      this.emit("message", { from: data.from, payload: data.payload });
      return;
    }
    if (data.kind === "leave") {
      if (isValidPlayerId(data.from)) this.emit("leave", { peerId: data.from });
      return;
    }
    if (data.kind === "ping" && isValidPlayerId(data.from)) {
      this.post({ kind: "pong", from: this.hostId, to: data.from, at: data.at });
    }
  }

  post(data) {
    if (!this.channel) return;
    const text = safeStringify({ v: MESSAGE_VERSION, room: this.code, ...data }, MAX_MESSAGE);
    if (!text) return;
    try {
      this.channel.postMessage(text);
    } catch {
      // channel closed
    }
  }

  close(reason = "Хост закрыл комнату.") {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.post({ kind: "closed", from: this.hostId, reason });
    removeLocalRoom(this.code);
    try {
      this.channel?.removeEventListener("message", this._onMessage);
      this.channel?.close();
    } catch {
      // ignore
    }
    window.removeEventListener("storage", this._onStorage);
    this.emit("closed");
  }
}

export function createLocalHost({ code, hostId, hostName, meta }) {
  return new LocalHostAdapter({ code, hostId, hostName, meta });
}

/**
 * Guest side of a same-browser room. Joining is asynchronous: it waits for the
 * host's welcome frame before the session is considered connected.
 */
export class LocalGuestAdapter extends Emitter {
  constructor({ code, selfId, name, avatar = null, color = "#d9b36c", spectate = false, timeout = 4000 }) {
    super();
    this.code = code;
    this.selfId = selfId;
    this.name = name;
    this.avatar = avatar;
    this.color = color;
    this.spectate = spectate === true;
    this.timeout = timeout;
    this.hostId = null;
    this.closed = false;
    this.connected = false;
    this.lastHostAt = Date.now();
    this.channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName(code)) : null;
    this._onMessage = (event) => this.handleRaw(event.data);
    if (this.channel) this.channel.addEventListener("message", this._onMessage);
    this.heartbeat = setInterval(() => this.beat(), 4000);
  }

  get online() {
    return false;
  }

  get mode() {
    return "local";
  }

  connect() {
    if (!this.channel) {
      return Promise.reject(new Error("Браузер не поддерживает порты (BroadcastChannel)."));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.close("Хост не найден.");
        reject(new Error("Хост не найден. Открой комнату в другой вкладке или создай свою."));
      }, this.timeout);

      const onMessage = ({ payload } = {}) => {
        this.lastHostAt = Date.now();
        if (settled) return;
        if (payload?.type === "denied") {
          settled = true;
          clearTimeout(timer);
          this.close(textOf(payload.reason, "Вход отклонён."));
          reject(new Error(textOf(payload.reason, "Вход отклонён.")));
          return;
        }
        if (payload?.type === "welcome") {
          settled = true;
          clearTimeout(timer);
          this.hostId = payload.hostId;
          this.connected = true;
          resolve(payload);
        }
      };
      this.on("message", onMessage);
      this._joinTimer = timer;
      this.post(this.hostId ?? "*", {
        kind: "join",
        from: this.selfId,
        name: this.name,
        avatar: this.avatar,
        color: this.color,
        spectate: this.spectate,
      });
    });
  }

  send(payload) {
    if (this.closed || !this.hostId) return false;
    const text = safeStringify(payload, MAX_MESSAGE);
    if (!text) return false;
    this.post(this.hostId, { kind: "relay", from: this.selfId, to: this.hostId, payload });
    return true;
  }

  post(to, data) {
    if (!this.channel) return;
    const text = safeStringify({ v: MESSAGE_VERSION, room: this.code, to, ...data }, MAX_MESSAGE);
    if (!text) return;
    try {
      this.channel.postMessage(text);
    } catch {
      // ignore
    }
  }

  handleRaw(raw) {
    if (this.closed || !raw) return;
    const data = typeof raw === "string" ? safeJsonParse(raw) : raw;
    if (!data || data.v !== MESSAGE_VERSION || data.room !== this.code) return;
    if (data.kind === "closed") {
      if (!data.from || data.from === this.hostId || this.hostId === null) {
        this.close(textOf(data.reason, "Комната закрыта."));
      }
      return;
    }
    if (data.kind === "pong") {
      this.lastHostAt = Date.now();
      return;
    }
    if (data.kind === "host-heartbeat") {
      this.lastHostAt = Date.now();
      if (!this.hostId && data.from) this.hostId = data.from;
      return;
    }
    if (data.kind === "relay") {
      if (!data.from) return;
      if (this.hostId && data.from !== this.hostId) return;
      if (data.to && data.to !== this.selfId && data.to !== "*") return;
      if (!data.payload || typeof data.payload !== "object") return;
      this.lastHostAt = Date.now();
      if (!this.hostId) this.hostId = data.from;
      this.emit("message", { from: data.from, payload: data.payload });
    }
  }

  beat() {
    if (this.closed) return;
    if (Date.now() - this.lastHostAt > 15_000 && this.connected) {
      this.emit("closed", { reason: "Связь с хостом потеряна." });
      this.close("Связь с хостом потеряна.");
      return;
    }
    this.post(this.hostId ?? "*", { kind: "ping", from: this.selfId, at: Date.now() });
  }

  close(reason = "Вы покинули комнату.") {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this._joinTimer);
    if (this.hostId) this.post(this.hostId, { kind: "leave", from: this.selfId });
    try {
      this.channel?.removeEventListener("message", this._onMessage);
      this.channel?.close();
    } catch {
      // ignore
    }
    this.emit("closed", { reason });
  }
}

export async function joinLocalRoom(options) {
  const adapter = new LocalGuestAdapter(options);
  const welcome = await adapter.connect();
  return { adapter, welcome };
}

export function createLocalId() {
  return createId("p");
}

export const LOCAL_ROOM_LABELS = Object.freeze({
  source: "local",
  label: "Порты",
  hint: "Комнаты в соседних вкладках этого браузера",
});
