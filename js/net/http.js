/**
 * HTTP relay adapters for Vercel / any static host with an `/api` relay.
 *
 * The wire shape mirrors the WebSocket adapters in `online.js`: the host
 * sends personalized payloads to guests, guests send actions to the host.
 * Polling is deliberately short (about 1.5 requests/sec) so the relay stays
 * stateless per request and does not need long-lived connections.
 */

import { Emitter } from "../core/events.js";
import { textOf } from "../core/format.js";
import { isValidPlayerId, sanitizeNick } from "../core/security.js";
import { cleanPeer, isHttpRelayUrl, normalizeHttpRelayUrl } from "./protocol.js";

const POLL_MS = 650;
const RETRY_MS = 1200;
const MAX_FAILS = 20;
const REQUEST_TIMEOUT = 7000;

function endpoint(base, path) {
  return `${base.replace(/\/+$/, "")}${path}`;
}

async function fetchJson(url, { method = "GET", body = null, timeout = REQUEST_TIMEOUT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(textOf(data?.error, `Relay ответил ${response.status}.`));
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Relay не ответил вовремя.");
      timeoutError.status = 0;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

class HttpAdapter extends Emitter {
  constructor({ url, timeout = REQUEST_TIMEOUT }) {
    super();
    this.base = normalizeHttpRelayUrl(url);
    this.timeout = timeout;
    this.selfId = null;
    this.token = "";
    this.code = "";
    this.connected = false;
    this.closed = false;
    this.cursor = 0;
    this._pollTimer = null;
    this._polling = false;
    this._fails = 0;
    this._closedEmitted = false;
    this._onVisible = null;
    this._outbox = [];
    this._flushing = false;
  }

  get mode() {
    return "online";
  }

  get online() {
    return true;
  }

  _watchVisibility() {
    if (typeof document === "undefined" || this._onVisible) return;
    this._onVisible = () => {
      if (!this.closed && document.visibilityState === "visible") this._schedule(0);
    };
    document.addEventListener("visibilitychange", this._onVisible);
  }

  _unwatchVisibility() {
    if (typeof document === "undefined" || !this._onVisible) return;
    document.removeEventListener("visibilitychange", this._onVisible);
    this._onVisible = null;
  }

  _schedule(delay = POLL_MS) {
    if (this.closed) return;
    clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(() => this._poll(), Math.max(0, delay));
    this._pollTimer.unref?.();
  }

  async _poll() {
    if (this.closed) return;
    if (this._polling) {
      this._schedule(200);
      return;
    }
    this._polling = true;
    try {
      const url = endpoint(
        this.base,
        `/rooms/${this.code}/events?peerId=${encodeURIComponent(this.selfId)}&token=${encodeURIComponent(
          this.token,
        )}&since=${this.cursor}`,
      );
      const data = await fetchJson(url, { timeout: this.timeout });
      if (!data?.ok) throw new Error(textOf(data?.error, "Relay не ответил."));
      this._fails = 0;
      const events = Array.isArray(data.events) ? data.events : [];
      for (const event of events) {
        if (typeof event?.seq === "number" && event.seq > this.cursor) this.cursor = event.seq;
        this._handleEvent(event);
        if (this.closed) break;
      }
      if (!this.closed && typeof data.cursor === "number" && data.cursor > this.cursor) {
        this.cursor = data.cursor;
      }
    } catch (error) {
      this._fails += 1;
      const status = Number(error?.status);
      if (status === 403 || status === 404 || status === 410) {
        this._shutdown(String(error?.message || "Комната закрыта."));
        return;
      }
      if (this._fails >= MAX_FAILS) {
        this._shutdown("Relay не отвечает.");
        return;
      }
    } finally {
      this._polling = false;
      if (!this.closed) this._schedule(this._fails ? RETRY_MS : POLL_MS);
    }
  }

  _shutdown(reason, { emit = true } = {}) {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    clearTimeout(this._pollTimer);
    this._pollTimer = null;
    this._outbox.length = 0;
    this._unwatchVisibility();
    if (emit && !this._closedEmitted) {
      this._closedEmitted = true;
      this.emit("closed", { reason: textOf(reason, "Соединение закрыто.") });
    }
  }

  async _post(path, body) {
    if (this.closed) return false;
    try {
      const data = await fetchJson(endpoint(this.base, path), {
        method: "POST",
        body,
        timeout: this.timeout,
      });
      return data?.ok !== false;
    } catch (error) {
      if (Number(error?.status) === 410) this._shutdown("Комната закрыта.");
      return false;
    }
  }

  /**
   * Frames are queued and posted one at a time. Parallel `fetch` calls finish
   * in an arbitrary order, so a game that sends "state" and then "chat" could
   * otherwise be seen reversed; a single queue also keeps a burst of clicks
   * from opening dozens of sockets.
   */
  _enqueue(path, body) {
    if (this.closed) return;
    this._outbox.push({ path, body });
    void this._flush();
  }

  async _flush() {
    if (this._flushing) return;
    this._flushing = true;
    try {
      while (!this.closed && this._outbox.length) {
        const frame = this._outbox.shift();
        await this._post(frame.path, frame.body);
      }
    } finally {
      this._flushing = false;
    }
  }

  _handleEvent() {}
}

export class HttpHostAdapter extends HttpAdapter {
  constructor({ url, code, hostName, meta = {}, timeout = REQUEST_TIMEOUT }) {
    super({ url, timeout });
    this.requestedCode = typeof code === "string" ? code.toUpperCase() : "";
    this.code = this.requestedCode;
    this.hostName = sanitizeNick(hostName) || "Хост";
    this.meta = meta;
    this.peers = new Set();
  }

  async connect() {
    if (!this.base) throw new Error("Relay не настроен. Укажите https:// адрес.");
    const data = await fetchJson(endpoint(this.base, "/rooms"), {
      method: "POST",
      body: {
        code: this.requestedCode || undefined,
        hostName: this.hostName,
        meta: this.meta,
      },
      timeout: this.timeout,
    });
    if (!data?.ok || !data.code || !data.hostId || !data.token) {
      throw new Error(textOf(data?.error, "Relay не подтвердил комнату."));
    }
    this.code = data.code;
    this.selfId = data.hostId;
    this.token = data.token;
    this.meta = data.meta ?? this.meta;
    this.connected = true;
    this._watchVisibility();
    this._schedule(0);
    return { selfId: this.selfId, code: this.code, meta: this.meta };
  }

  _handleEvent(event) {
    switch (event?.type) {
      case "relay": {
        if (!isValidPlayerId(event.from) || !event.payload || typeof event.payload !== "object") return;
        this.emit("message", { from: event.from, payload: event.payload });
        return;
      }
      case "peer-join": {
        const peer = cleanPeer(event.peer);
        if (!peer.id) return;
        this.peers.add(peer.id);
        this.emit("join", { peer });
        return;
      }
      case "peer-leave": {
        if (typeof event.peerId !== "string") return;
        this.peers.delete(event.peerId);
        this.emit("leave", { peerId: event.peerId });
        return;
      }
      case "closed": {
        this._shutdown(textOf(event.reason, "Комната закрыта."));
        return;
      }
      default:
        return;
    }
  }

  send(peerId, payload) {
    if (!this.connected || !isValidPlayerId(peerId)) return false;
    if (!payload || typeof payload !== "object") return false;
    this._enqueue(`/rooms/${this.code}/events`, {
      peerId: this.selfId,
      token: this.token,
      to: peerId,
      payload,
    });
    return true;
  }

  broadcast(payload) {
    if (!this.connected) return false;
    if (!payload || typeof payload !== "object") return false;
    this._enqueue(`/rooms/${this.code}/events`, {
      peerId: this.selfId,
      token: this.token,
      to: "*",
      payload,
    });
    return true;
  }

  updateMeta(meta) {
    if (!this.connected) return false;
    this._enqueue(`/rooms/${this.code}/meta`, {
      peerId: this.selfId,
      token: this.token,
      meta,
    });
    return true;
  }

  kick(peerId, reason = "Вас исключили из комнаты.") {
    if (!this.connected || !isValidPlayerId(peerId)) return false;
    this.peers.delete(peerId);
    this._enqueue(`/rooms/${this.code}/kick`, {
      peerId: this.selfId,
      token: this.token,
      targetId: peerId,
      reason: String(reason).slice(0, 140),
    });
    return true;
  }

  deny(peerId, reason = "Комната недоступна.") {
    return this.kick(peerId, reason);
  }

  close(reason = "Хост закрыл комнату.") {
    if (this.closed) return;
    this._enqueue(`/rooms/${this.code}/close`, {
      peerId: this.selfId,
      token: this.token,
      reason: String(reason).slice(0, 140),
    });
    this._shutdown(reason, { emit: false });
  }
}

export class HttpGuestAdapter extends HttpAdapter {
  constructor({ url, code, name, avatar = null, color = "#d9b36c", spectate = false, timeout = REQUEST_TIMEOUT }) {
    super({ url, timeout });
    this.code = String(code ?? "").toUpperCase();
    this.name = sanitizeNick(name) || "Гость";
    this.avatar = avatar;
    this.color = color;
    this.spectate = spectate === true;
    this.hostId = null;
  }

  async connect() {
    if (!this.base) throw new Error("Relay не настроен. Укажите https:// адрес.");
    if (!this.code) throw new Error("Введите код комнаты.");
    const data = await fetchJson(endpoint(this.base, `/rooms/${this.code}/join`), {
      method: "POST",
      body: {
        name: this.name,
        avatar: this.avatar,
        color: this.color,
        spectate: this.spectate,
      },
      timeout: this.timeout,
    });
    if (!data?.ok || !data.peerId || !data.hostId || !data.token) {
      throw new Error(textOf(data?.error, "Комната не ответила."));
    }
    this.selfId = data.peerId;
    this.hostId = data.hostId;
    this.token = data.token;
    this.code = data.code ?? this.code;
    this.spectate = data.spectate === true;
    this.connected = true;
    this._watchVisibility();
    this._schedule(0);
    return {
      selfId: this.selfId,
      hostId: this.hostId,
      code: this.code,
      spectate: this.spectate,
      meta: data.meta ?? null,
    };
  }

  _handleEvent(event) {
    switch (event?.type) {
      case "relay": {
        if (!isValidPlayerId(event.from) || !event.payload || typeof event.payload !== "object") return;
        if (this.hostId && event.from !== this.hostId) return;
        this.emit("message", { from: event.from, payload: event.payload });
        return;
      }
      case "closed": {
        this._shutdown(textOf(event.reason, "Комната закрыта."));
        return;
      }
      case "denied": {
        this._shutdown(textOf(event.reason, "Вход отклонён."));
        return;
      }
      default:
        return;
    }
  }

  send(payload) {
    if (!this.connected) return false;
    if (!payload || typeof payload !== "object") return false;
    this._enqueue(`/rooms/${this.code}/events`, {
      peerId: this.selfId,
      token: this.token,
      payload,
    });
    return true;
  }

  close(reason = "Вы покинули комнату.") {
    if (this.closed) return;
    this._enqueue(`/rooms/${this.code}/leave`, {
      peerId: this.selfId,
      token: this.token,
    });
    this._shutdown(reason, { emit: false });
  }
}

export { isHttpRelayUrl };
