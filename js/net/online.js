import { Emitter } from "../core/events.js";
import {
  isValidAvatarId,
  isValidPlayerId,
  isValidRoomCode,
  normalizeHexColor,
  safeJsonParse,
  safeStringify,
  sanitizeNick,
} from "../core/security.js";
import {
  FRAME_TYPES,
  HEARTBEAT_MS,
  MAX_FRAME_CHARS,
  PROTOCOL_VERSION,
  STALE_MS,
  cleanRoomMeta,
  defaultRelayEndpoint,
  healthUrl,
  isObject,
  normalizeRelayEndpoint,
  roomsUrl,
} from "./protocol.js";

function openSocket(url, timeout = 7000) {
  return new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      reject(new Error("Неверный адрес relay."));
      return;
    }
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // ignore
      }
      reject(new Error("Relay не отвечает. Проверьте адрес и сеть."));
    }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    function onOpen() {
      cleanup();
      resolve(socket);
    }
    function onError() {
      cleanup();
      reject(new Error("Не удалось подключиться к relay."));
    }
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
  });
}

function socketReason(event, fallback) {
  if (event?.reason) return String(event.reason).slice(0, 160);
  if (event?.code === 1000 || event?.code === 1001) return fallback;
  if (event?.code === 1006) return "Соединение с relay потеряно.";
  return fallback;
}

/** Common socket plumbing: bounded frames, heartbeat, single closed event. */
class ChannelAdapter extends Emitter {
  constructor({ url, timeout = 7000 }) {
    super();
    this.url = normalizeRelayEndpoint(url) || defaultRelayEndpoint();
    this.timeout = timeout;
    this.socket = null;
    this.closed = false;
    this.connected = false;
    this.lastInbound = Date.now();
    this._closedEmitted = false;
    this._heartbeat = null;
  }

  get mode() {
    return "online";
  }

  get online() {
    return true;
  }

  async _open() {
    if (!this.url) throw new Error("Relay не настроен. Укажите адрес в настройках.");
    this.socket = await openSocket(this.url, this.timeout);
    this.lastInbound = Date.now();
    this.socket.addEventListener("message", (event) => this._onRaw(event.data));
    this.socket.addEventListener("close", (event) => {
      this.connected = false;
      this._shutdown(socketReason(event, "Соединение закрыто."), { emit: !this.closed });
    });
    this.socket.addEventListener("error", () => {
      // The close event carries the useful code; nothing to do here.
    });
    this._heartbeat = setInterval(() => this._beat(), HEARTBEAT_MS);
    this._heartbeat.unref?.();
  }

  _beat() {
    if (this.closed) return;
    if (Date.now() - this.lastInbound > STALE_MS) {
      // Browsers throttle timers in hidden tabs, so a missing inbound frame is
      // not proof of a dead socket there. The close event handles real drops.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      this._shutdown("Relay не отвечает.", { emit: true });
      return;
    }
    this._send({ type: FRAME_TYPES.PING, at: Date.now() });
  }

  _send(frame) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const text = safeStringify({ v: PROTOCOL_VERSION, ...frame }, MAX_FRAME_CHARS);
    if (!text) {
      this.emit("error", new Error("Слишком большое сообщение."));
      return false;
    }
    try {
      this.socket.send(text);
      return true;
    } catch {
      return false;
    }
  }

  _onRaw(raw) {
    if (this.closed) return;
    if (typeof raw !== "string" || raw.length > MAX_FRAME_CHARS) return;
    const frame = safeJsonParse(raw);
    if (!isObject(frame) || typeof frame.type !== "string") return;
    this.lastInbound = Date.now();
    this._handleFrame(frame);
  }

  _shutdown(reason, { emit = true, notifyServer = false } = {}) {
    const wasClosed = this.closed;
    this.closed = true;
    this.connected = false;
    clearInterval(this._heartbeat);
    this._heartbeat = null;
    try {
      if (notifyServer && this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "bye");
      else if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "bye");
    } catch {
      // ignore
    }
    if (emit && !wasClosed && !this._closedEmitted) {
      this._closedEmitted = true;
      this.emit("closed", { reason: String(reason || "Соединение закрыто.") });
    }
  }

  _handleFrame() {}
}

export class OnlineHostAdapter extends ChannelAdapter {
  constructor({ url, code, hostName, meta = {}, timeout = 7000 }) {
    super({ url, timeout });
    this.requestedCode = isValidRoomCode(code) ? code : "";
    this.code = this.requestedCode;
    this.hostName = sanitizeNick(hostName) || "Хост";
    this.meta = meta;
    this.selfId = null;
    this.peers = new Set();
    this._connectResolve = null;
    this._connectReject = null;
  }

  async connect() {
    await this._open();
    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;
      const timer = setTimeout(() => {
        if (!this.connected) {
          this._shutdown("Relay не подтвердил комнату.", { emit: false });
          reject(new Error("Relay не подтвердил комнату."));
        }
      }, this.timeout);
      this._connectTimer = timer;
      const ok = this._send({
        type: FRAME_TYPES.CREATE,
        room: this.requestedCode || undefined,
        hostName: this.hostName,
        meta: cleanRoomMeta({ ...this.meta, name: this.meta?.name, public: this.meta?.public !== false }),
      });
      if (!ok) {
        clearTimeout(timer);
        reject(new Error("Не удалось отправить запрос комнаты."));
      }
    });
  }

  _handleFrame(frame) {
    switch (frame.type) {
      case FRAME_TYPES.WELCOME: {
        if (frame.host !== true) return;
        this.selfId = typeof frame.selfId === "string" ? frame.selfId : "";
        this.code = isValidRoomCode(frame.room) ? frame.room : this.requestedCode;
        this.connected = true;
        clearTimeout(this._connectTimer);
        this._connectResolve?.({ selfId: this.selfId, code: this.code, meta: frame.meta ?? null });
        this._connectResolve = null;
        this._connectReject = null;
        break;
      }
      case FRAME_TYPES.PEER_JOIN: {
        if (!isObject(frame.peer) || !isValidPlayerId(frame.peer.id)) return;
        const peer = {
          id: frame.peer.id,
          name: sanitizeNick(frame.peer.name) || "Гость",
          avatar: isValidAvatarId(frame.peer.avatar) ? frame.peer.avatar : null,
          color: normalizeHexColor(frame.peer.color),
          spectate: frame.peer.spectate === true,
        };
        this.peers.add(peer.id);
        this.emit("join", { peer });
        break;
      }
      case FRAME_TYPES.PEER_LEAVE: {
        if (typeof frame.peerId !== "string") return;
        this.peers.delete(frame.peerId);
        this.emit("leave", { peerId: frame.peerId });
        break;
      }
      case FRAME_TYPES.RELAY: {
        if (!isObject(frame.payload) || !isValidPlayerId(frame.from)) return;
        this.emit("message", { from: frame.from, payload: frame.payload });
        break;
      }
      case FRAME_TYPES.CLOSED: {
        this._shutdown(String(frame.reason ?? "Комната закрыта."), { emit: true });
        break;
      }
      case FRAME_TYPES.DENIED: {
        const reason = String(frame.reason ?? "Вход отклонён.");
        this.emit("denied", { reason });
        this._shutdown(reason, { emit: false });
        break;
      }
      case FRAME_TYPES.ERROR: {
        const reason = String(frame.reason ?? "Ошибка relay.");
        if (!this.connected) {
          clearTimeout(this._connectTimer);
          this._connectReject?.(new Error(reason));
          this._connectResolve = null;
          this._connectReject = null;
          this._shutdown(reason, { emit: false });
        } else {
          this.emit("error", new Error(reason));
        }
        break;
      }
      default:
        break;
    }
  }

  updateMeta(meta) {
    if (this.closed) return false;
    return this._send({
      type: FRAME_TYPES.META,
      meta: cleanRoomMeta({
        ...meta,
        code: this.code,
        hostId: this.selfId,
        hostName: this.hostName,
      }),
    });
  }

  send(peerId, payload) {
    if (this.closed || !this.connected) return false;
    if (!isValidPlayerId(peerId) || !isObject(payload)) return false;
    return this._send({ type: FRAME_TYPES.RELAY, to: peerId, payload });
  }

  broadcast(payload) {
    if (this.closed || !this.connected || !isObject(payload)) return false;
    return this._send({ type: FRAME_TYPES.RELAY, to: "*", payload });
  }

  kick(peerId, reason = "Вас исключили из комнаты.") {
    if (this.closed || !isValidPlayerId(peerId)) return false;
    this.peers.delete(peerId);
    return this._send({ type: FRAME_TYPES.KICK, to: peerId, reason: String(reason).slice(0, 120) });
  }

  deny(peerId, reason = "Комната недоступна.") {
    return this.kick(peerId, reason);
  }

  close(reason = "Хост закрыл комнату.") {
    if (this.closed) return;
    this._send({ type: FRAME_TYPES.CLOSE, reason: String(reason).slice(0, 120) });
    this._shutdown(reason, { emit: true });
  }
}

export class OnlineGuestAdapter extends ChannelAdapter {
  constructor({ url, code, name, avatar = null, color = "#d9b36c", spectate = false, timeout = 7000 }) {
    super({ url, timeout });
    this.code = isValidRoomCode(code) ? code : "";
    this.name = sanitizeNick(name) || "Гость";
    this.avatar = isValidAvatarId(avatar) ? avatar : null;
    this.color = normalizeHexColor(color);
    this.spectate = spectate === true;
    this.selfId = null;
    this.hostId = null;
    this._welcome = null;
  }

  async connect() {
    if (!this.code) throw new Error("Введите код комнаты.");
    await this._open();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.connected) {
          this._shutdown("Комната не ответила.", { emit: false });
          reject(new Error("Комната не ответила. Проверьте код и relay."));
        }
      }, this.timeout);
      this._connectTimer = timer;
      this._connectResolve = resolve;
      this._connectReject = reject;
      const ok = this._send({
        type: FRAME_TYPES.JOIN,
        room: this.code,
        name: this.name,
        avatar: this.avatar,
        color: this.color,
        spectate: this.spectate,
      });
      if (!ok) {
        clearTimeout(timer);
        reject(new Error("Не удалось отправить запрос."));
      }
    });
  }

  _handleFrame(frame) {
    switch (frame.type) {
      case FRAME_TYPES.WELCOME: {
        if (frame.host === true) return;
        this.selfId = typeof frame.selfId === "string" ? frame.selfId : "";
        this.hostId = typeof frame.hostId === "string" ? frame.hostId : "";
        this.code = isValidRoomCode(frame.room) ? frame.room : this.code;
        this.connected = true;
        this._welcome = frame;
        clearTimeout(this._connectTimer);
        this._connectResolve?.({
          selfId: this.selfId,
          hostId: this.hostId,
          code: this.code,
          spectate: frame.spectate === true,
          meta: frame.meta ?? null,
        });
        this._connectResolve = null;
        this._connectReject = null;
        break;
      }
      case FRAME_TYPES.RELAY: {
        if (!isObject(frame.payload)) return;
        if (this.hostId && frame.from !== this.hostId) return;
        this.emit("message", { from: frame.from, payload: frame.payload });
        break;
      }
      case FRAME_TYPES.CLOSED: {
        this._shutdown(String(frame.reason ?? "Комната закрыта."), { emit: true });
        break;
      }
      case FRAME_TYPES.DENIED: {
        const reason = String(frame.reason ?? "Вход отклонён.");
        this._shutdown(reason, { emit: true });
        break;
      }
      case FRAME_TYPES.ERROR: {
        const reason = String(frame.reason ?? "Ошибка relay.");
        if (!this.connected) {
          clearTimeout(this._connectTimer);
          this._connectReject?.(new Error(reason));
          this._connectResolve = null;
          this._connectReject = null;
          this._shutdown(reason, { emit: false });
        }
        break;
      }
      default:
        break;
    }
  }

  send(payload) {
    if (this.closed || !this.connected || !this.hostId) return false;
    if (!isObject(payload)) return false;
    return this._send({ type: FRAME_TYPES.RELAY, to: this.hostId, payload });
  }

  close(reason = "Вы покинули комнату.") {
    if (this.closed) return;
    this._shutdown(reason, { emit: true });
  }
}

export async function fetchOnlineRooms(relayUrl, { timeout = 4000 } = {}) {
  const url = roomsUrl(relayUrl);
  if (!url) throw new Error("Relay не настроен.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Relay ответил ${response.status}.`);
    const data = await response.json();
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
    return rooms
      .map((room) => cleanRoomMeta({ ...room, source: "online" }))
      .filter((room) => room.code && room.public)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Relay не ответил вовремя.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkRelay(relayUrl) {
  const url = healthUrl(relayUrl);
  if (!url) return { ok: false, error: "Relay не настроен." };
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error("Relay недоступен.");
    return {
      ok: true,
      latency: Math.round(performance.now() - started),
      rooms: Number(data.rooms) || 0,
      uptime: Number(data.uptime) || 0,
      protocol: Number(data.protocol) || 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === "AbortError" ? "Relay не ответил вовремя." : String(error?.message ?? "Ошибка relay."),
    };
  } finally {
    clearTimeout(timer);
  }
}

export { normalizeRelayEndpoint };
