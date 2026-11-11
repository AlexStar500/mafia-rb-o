import { Emitter } from "../core/events.js";
import { textOf } from "../core/format.js";
import {
  RateLimiter,
  isValidAvatarId,
  isValidPlayerId,
  isValidRoomCode,
  normalizeHexColor,
  safeJsonParse,
  safeStringify,
  sanitizeNick,
} from "../core/security.js";
import {
  CLIENT_BURST,
  CLIENT_REFILL_PER_SEC,
  FRAME_TYPES,
  HEARTBEAT_MS,
  HOST_BURST,
  HOST_REFILL_PER_SEC,
  MAX_FRAME_CHARS,
  PENDING_FRAME_LIMIT,
  PROTOCOL_VERSION,
  STALE_MS,
  cleanRoomMeta,
  defaultRelayEndpoint,
  healthUrl,
  httpHealthUrl,
  httpRoomsUrl,
  isHttpRelayUrl,
  isObject,
  normalizeRelayEndpoint,
  payloadTooLarge,
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

/**
 * How long the adapter keeps trying to restore a dropped socket before giving
 * up. Vercel closes every connection at the function's max duration, so a
 * reconnect is a normal event, not a failure.
 */
const RECONNECT_BUDGET_MS = 90_000;
const OUTBOX_LIMIT = 120;
const QUEUEABLE_TYPES = new Set([
  FRAME_TYPES.RELAY,
  FRAME_TYPES.META,
  FRAME_TYPES.KICK,
  FRAME_TYPES.CLOSE,
]);

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
    this._resumeInfo = null;
    this._resumeWaiter = null;
    this._outbox = [];
    this._reconnecting = false;
    this._pending = [];
    this._sendBudget = this._makeBudget();
    this._throttleUntil = 0;
    this._drainTimer = null;
  }

  get mode() {
    return "online";
  }

  get online() {
    return true;
  }

  get reconnecting() {
    return this._reconnecting;
  }

  async _open() {
    if (!this.url) throw new Error("Relay не настроен. Укажите адрес в настройках.");
    await this._openSocket();
    this._heartbeat = setInterval(() => this._beat(), HEARTBEAT_MS);
    this._heartbeat.unref?.();
  }

  async _openSocket() {
    this.socket = await openSocket(this.url, this.timeout);
    // A fresh socket gets a fresh server-side budget; restart our own pacing
    // so a reconnect is not slowed down by the burst that preceded the drop.
    this._sendBudget = this._makeBudget();
    this._throttleUntil = 0;
    this.lastInbound = Date.now();
    this.socket.addEventListener("message", (event) => this._onRaw(event.data));
    this.socket.addEventListener("close", (event) => this._onSocketClose(event));
    this.socket.addEventListener("error", () => {
      // The close event carries the useful code; nothing to do here.
    });
  }

  _onSocketClose() {
    this.connected = false;
    if (this.closed) return;
    if (this._resumeWaiter) {
      const waiter = this._resumeWaiter;
      this._resumeWaiter = null;
      waiter.reject(new Error("Соединение оборвалось."));
    }
    void this._reconnectLoop();
  }

  /**
   * A dropped socket only ends the session when the relay is unreachable for
   * the whole budget or refuses the resume. Brief drops (deploys, the Vercel
   * max-duration cut, Wi-Fi blips) are restored transparently.
   */
  async _reconnectLoop() {
    if (this._reconnecting || this.closed) return;
    if (!this._resumeInfo) {
      this._shutdown("Соединение с relay потеряно.", { emit: true });
      return;
    }
    this._reconnecting = true;
    let delay = 700;
    const deadline = Date.now() + RECONNECT_BUDGET_MS;
    while (!this.closed) {
      try {
        await this._openSocket();
        await this._resumeSession();
        this._reconnecting = false;
        this.connected = true;
        this.lastInbound = Date.now();
        this._flushOutbox();
        this.emit("reconnected", {});
        return;
      } catch (error) {
        if (this.closed) break;
        if (error && error.terminal) {
          this._reconnecting = false;
          this._shutdown(error.message, { emit: true });
          return;
        }
        if (Date.now() > deadline) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(Math.round(delay * 1.7), 8_000);
      }
    }
    this._reconnecting = false;
    if (!this.closed) this._shutdown("Соединение с relay потеряно.", { emit: true });
  }

  _resumeSession() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._resumeWaiter = null;
        reject(new Error("Relay не подтвердил сессию."));
      }, this.timeout);
      this._resumeWaiter = {
        resolve: (frame) => {
          clearTimeout(timer);
          this._resumeWaiter = null;
          resolve(frame);
        },
        reject: (error) => {
          clearTimeout(timer);
          this._resumeWaiter = null;
          reject(error);
        },
      };
      if (!this._sendNow({ type: FRAME_TYPES.RESUME, ...this._resumeInfo })) {
        clearTimeout(timer);
        this._resumeWaiter = null;
        reject(new Error("Соединение оборвалось."));
      }
    });
  }

  _beat() {
    if (this.closed || this._reconnecting) return;
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
    if (this.closed) return false;
    if (this._reconnecting) {
      // Keep game frames in order and flush them after the resume lands.
      if (QUEUEABLE_TYPES.has(frame.type) && this._outbox.length < OUTBOX_LIMIT) {
        this._outbox.push(frame);
      }
      return true;
    }
    if (frame.type === FRAME_TYPES.PING) {
      // Liveness probes are never queued: skip them while paused or dry.
      if (Date.now() < this._throttleUntil) return true;
      if (!this._sendBudget.take(1).ok) return true;
      return this._sendNow(frame);
    }
    this._queue(frame);
    this._drain();
    return true;
  }

  /**
   * Outbound pacing. Frames past the token budget are parked in a bounded
   * FIFO queue and sent as the budget refills, so a burst of fast messages is
   * spaced out client-side instead of being dropped (or killing the session)
   * on the relay.
   */
  _makeBudget() {
    return new RateLimiter({ capacity: CLIENT_BURST, refillPerSec: CLIENT_REFILL_PER_SEC });
  }

  _queue(frame) {
    if (this._pending.length >= PENDING_FRAME_LIMIT) this._pending.shift();
    this._pending.push(frame);
  }

  _drain() {
    if (this.closed || this._reconnecting) return;
    if (this._drainTimer) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
    while (this._pending.length) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now < this._throttleUntil) {
        this._scheduleDrain(this._throttleUntil - now + 60);
        return;
      }
      const ticket = this._sendBudget.take(1);
      if (!ticket.ok) {
        this._scheduleDrain(Math.max(ticket.retryAfter, 60));
        return;
      }
      const frame = this._pending.shift();
      const sent = this._sendNow(frame);
      if (!sent && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) return;
      // A refused frame (e.g. oversized payload) is dropped with an error
      // event; the rest of the queue must keep flowing.
    }
  }

  _scheduleDrain(delay) {
    if (this._drainTimer || this.closed) return;
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      this._drain();
    }, Math.max(0, delay));
    this._drainTimer?.unref?.();
  }

  /** Transient relay backpressure: pause briefly, never drop the session. */
  _onThrottle(frame) {
    const hinted = Number(frame.retryAfterMs);
    const pauseMs = Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted, 10_000) : 1_000;
    this._throttleUntil = Math.max(this._throttleUntil, Date.now() + pauseMs + 100);
    this._scheduleDrain(pauseMs + 150);
  }

  _sendNow(frame) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    if (frame.type === FRAME_TYPES.RELAY && payloadTooLarge(frame.payload)) {
      // Mirror the relay's limit client-side: an oversized payload must be a
      // visible error, never a session-killing deny from the server.
      this.emit("error", new Error("Слишком большое сообщение."));
      return false;
    }
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

  _flushOutbox() {
    for (const frame of this._outbox.splice(0, this._outbox.length)) this._queue(frame);
    this._drain();
  }

  _onRaw(raw) {
    if (this.closed) return;
    if (typeof raw !== "string" || raw.length > MAX_FRAME_CHARS) return;
    const frame = safeJsonParse(raw);
    if (!isObject(frame) || typeof frame.type !== "string") return;
    this.lastInbound = Date.now();
    if (frame.type === FRAME_TYPES.THROTTLE) {
      this._onThrottle(frame);
      return;
    }
    if (this._resumeWaiter) {
      if (frame.type === FRAME_TYPES.WELCOME) {
        const accepted = this._acceptWelcome(frame);
        if (accepted === false) {
          const error = new Error("Сессия не найдена.");
          error.terminal = true;
          this._resumeWaiter.reject(error);
        } else {
          this._resumeWaiter.resolve(frame);
        }
        return;
      }
      if (frame.type === FRAME_TYPES.DENIED) {
        const error = new Error(textOf(frame.reason, "Комната закрыта."));
        error.terminal = true;
        this._resumeWaiter.reject(error);
        return;
      }
    }
    this._handleFrame(frame);
  }

  _shutdown(reason, { emit = true, notifyServer = false } = {}) {
    const wasClosed = this.closed;
    this.closed = true;
    this.connected = false;
    clearInterval(this._heartbeat);
    this._heartbeat = null;
    if (this._drainTimer) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
    this._pending = [];
    if (this._resumeWaiter) {
      const waiter = this._resumeWaiter;
      this._resumeWaiter = null;
      waiter.reject(new Error(textOf(reason, "Соединение закрыто.")));
    }
    try {
      if (notifyServer && this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "bye");
      else if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "bye");
    } catch {
      // ignore
    }
    if (emit && !wasClosed && !this._closedEmitted) {
      this._closedEmitted = true;
      this.emit("closed", { reason: textOf(reason, "Соединение закрыто.") });
    }
  }

  /** Store the resume token from a WELCOME frame. Subclasses override. */
  _saveResume() {}

  /** Apply a resumed WELCOME after a reconnect. Subclasses override. */
  _acceptWelcome() {}

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

  /** The host fans out ~one frame per peer per tick: it needs a wider budget. */
  _makeBudget() {
    return new RateLimiter({ capacity: HOST_BURST, refillPerSec: HOST_REFILL_PER_SEC });
  }

  _saveResume(frame) {
    if (typeof frame?.token !== "string" || !frame.token || !this.selfId) return;
    this._resumeInfo = { room: this.code, peerId: this.selfId, token: frame.token };
  }

  _acceptWelcome(frame) {
    if (frame.host !== true) return false;
    if (typeof frame.selfId === "string") this.selfId = frame.selfId;
    if (isValidRoomCode(frame.room)) this.code = frame.room;
    this._saveResume(frame);
    return true;
  }

  _handleFrame(frame) {
    switch (frame.type) {
      case FRAME_TYPES.WELCOME: {
        if (frame.host !== true) return;
        this.selfId = typeof frame.selfId === "string" ? frame.selfId : "";
        this.code = isValidRoomCode(frame.room) ? frame.room : this.requestedCode;
        this._saveResume(frame);
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
        this._shutdown(textOf(frame.reason, "Комната закрыта."), { emit: true });
        break;
      }
      case FRAME_TYPES.DENIED: {
        const reason = textOf(frame.reason, "Вход отклонён.");
        this.emit("denied", { reason });
        this._shutdown(reason, { emit: false });
        break;
      }
      case FRAME_TYPES.ERROR: {
        const reason = textOf(frame.reason, "Ошибка relay.");
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
    // The goodbye must leave before the socket is torn down; the send pacing
    // could still be holding it in the queue.
    this._sendNow({ type: FRAME_TYPES.CLOSE, reason: String(reason).slice(0, 120) });
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

  _saveResume(frame) {
    if (typeof frame?.token !== "string" || !frame.token || !this.selfId) return;
    this._resumeInfo = { room: this.code, peerId: this.selfId, token: frame.token };
  }

  _acceptWelcome(frame) {
    if (frame.host === true) return false;
    if (typeof frame.selfId === "string") this.selfId = frame.selfId;
    if (typeof frame.hostId === "string") this.hostId = frame.hostId;
    if (isValidRoomCode(frame.room)) this.code = frame.room;
    this._welcome = frame;
    this._saveResume(frame);
    return true;
  }

  _handleFrame(frame) {
    switch (frame.type) {
      case FRAME_TYPES.WELCOME: {
        if (frame.host === true) return;
        this.selfId = typeof frame.selfId === "string" ? frame.selfId : "";
        this.hostId = typeof frame.hostId === "string" ? frame.hostId : "";
        this.code = isValidRoomCode(frame.room) ? frame.room : this.code;
        this._saveResume(frame);
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
        this._shutdown(textOf(frame.reason, "Комната закрыта."), { emit: true });
        break;
      }
      case FRAME_TYPES.DENIED: {
        const reason = textOf(frame.reason, "Вход отклонён.");
        this._shutdown(reason, { emit: true });
        break;
      }
      case FRAME_TYPES.ERROR: {
        const reason = textOf(frame.reason, "Ошибка relay.");
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
  const url = isHttpRelayUrl(relayUrl) ? httpRoomsUrl(relayUrl) : roomsUrl(relayUrl);
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
  const url = isHttpRelayUrl(relayUrl) ? httpHealthUrl(relayUrl) : healthUrl(relayUrl);
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
