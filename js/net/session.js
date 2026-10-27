import { Emitter } from "../core/events.js";
import {
  RateLimiter,
  createId,
  createRoomCode,
  isValidPlayerId,
  normalizeHexColor,
  sanitizeNick,
} from "../core/security.js";
import { pickBot } from "../data/bots.js";
import { normalizeRoomConfig } from "../data/roles.js";
import { BotRuntime } from "../game/bot.js";
import { GameEngine, PHASE } from "../game/engine.js";
import { createLocalHost, joinLocalRoom, LOCAL_ROOM_LABELS } from "./local.js";
import { OnlineGuestAdapter, OnlineHostAdapter } from "./online.js";

const BOT_ACTION_KINDS = new Set(["chat", "ready", "night", "vote", "sync", "spectate-speed", "spectate-pause"]);
const NIGHT_ACTIONS = new Set(["kill", "heal", "check", "contract"]);
const CHAT_CHANNELS = new Set(["public", "mafia", "dead"]);

export function normalizeSelf(input = {}) {
  const name = sanitizeNick(input.name) || "Игрок";
  return {
    id: isValidPlayerId(input.id) ? input.id : createId("p"),
    name,
    avatar: typeof input.avatar === "string" && /^[a-z0-9-]{2,24}$/.test(input.avatar) ? input.avatar : null,
    color: normalizeHexColor(input.color),
  };
}

/** Virtual clock. Speeding it up also speeds up phases and bot thinking. */
export class GameClock {
  constructor(start = Date.now(), speed = 1) {
    this.value = Number(start) || Date.now();
    this.speed = [0.5, 1, 2, 4].includes(Number(speed)) ? Number(speed) : 1;
    this.paused = false;
    this._lastReal = Date.now();
    this._speedBeforePause = this.speed;
  }

  now() {
    return this.value;
  }

  advance(realNow = Date.now()) {
    const dt = Math.max(0, realNow - this._lastReal);
    this._lastReal = realNow;
    if (!this.paused && dt) {
      this.value += dt * this.speed;
      return true;
    }
    return false;
  }

  jump(ms) {
    this.value += Math.max(0, Number(ms) || 0);
  }

  setSpeed(speed) {
    const value = [0.5, 1, 2, 4].includes(Number(speed)) ? Number(speed) : 1;
    this.speed = value;
    this._speedBeforePause = value;
  }

  setPaused(paused) {
    const next = paused === true;
    if (next === this.paused) return;
    if (next) {
      this._speedBeforePause = this.speed;
    } else {
      this.speed = this._speedBeforePause;
      this._lastReal = Date.now();
    }
    this.paused = next;
  }
}

function visibleChat(engine, viewerId, limit = 120) {
  const viewer = viewerId ? engine.getPlayer(viewerId) : null;
  const spectator = !viewer;
  return engine.chat
    .filter((message) => engine._canSeeChat(message, viewer, spectator))
    .slice(-limit);
}

function phaseStatus(engine) {
  if (engine.phase === PHASE.LOBBY) return "lobby";
  if (engine.phase === PHASE.ENDED) return "ended";
  return "playing";
}

export class BaseSession extends Emitter {
  constructor({ mode, roomCode, self, online = false }) {
    super();
    this.mode = mode;
    this.roomCode = roomCode;
    this.self = self;
    this.selfId = self?.id ?? null;
    this.online = online;
    this.isHost = false;
    this.closed = false;
    this._closedEmitted = false;
    this._subscriptions = [];
  }

  get view() {
    return null;
  }

  estimatedNow() {
    return Date.now();
  }

  get isSpectator() {
    return false;
  }

  leave() {
    this.close("Вы покинули комнату.");
  }

  close() {
    this.closed = true;
  }

  _emitClosed(reason) {
    if (this._closedEmitted) return;
    this._closedEmitted = true;
    this.closed = true;
    this.emit("closed", { reason: String(reason ?? "Комната закрыта.") });
  }

  _track(unsubscribe) {
    if (typeof unsubscribe === "function") this._subscriptions.push(unsubscribe);
  }

  _cleanup() {
    for (const off of this._subscriptions.splice(0)) {
      try {
        off();
      } catch {
        // ignore
      }
    }
  }
}

export class HostSession extends BaseSession {
  constructor({
    roomCode,
    self,
    config = {},
    adapter = null,
    mode = "solo",
    spectatorOnly = false,
    botFill = 0,
    autoStart = false,
    speed = 1,
    rng = Math.random,
    now = Date.now,
  }) {
    super({ mode, roomCode, self, online: Boolean(adapter?.online) });
    this.isHost = true;
    this.adapter = adapter;
    this.spectatorOnly = spectatorOnly === true;
    this.autoStart = autoStart === true;
    this.clock = new GameClock(now(), speed);
    this._realStart = now();
    this._lastSync = 0;
    this._lastMeta = 0;
    this._lastBroadcastChat = 0;
    this._chatEpoch = 0;
    this.peers = new Map();
    this._tickTimer = null;
    this._dirty = false;

    this.engine = new GameEngine({
      roomCode,
      config: normalizeRoomConfig(config),
      hostId: self.id,
      now: () => this.clock.now(),
      rng,
    });

    if (!this.spectatorOnly) {
      this.engine.addPlayer({
        id: self.id,
        name: self.name,
        avatar: self.avatar,
        color: self.color,
        ready: true,
      });
    }

    const botTarget = Number(botFill) || 0;
    let target = 0;
    if (this.spectatorOnly) target = this.engine.config.maxPlayers;
    else if (botTarget > 0) target = Math.max(this.engine.config.minStart, botTarget);
    target = Math.max(0, Math.min(this.engine.config.maxPlayers, target));
    if (target > this.engine.players.length) {
      this.engine.fillBots(target, (used) => pickBot(used));
    }

    this.botRuntime = new BotRuntime({
      engine: this.engine,
      level: this.engine.config.botChat,
      rng,
    });

    this.viewerId = this.spectatorOnly ? null : self.id;

    this._track(
      this.engine.on("state", () => {
        this._dirty = true;
        this.emit("view");
      }),
    );
    this._track(
      this.engine.on("chat", () => {
        this._dirty = true;
        this.emit("view");
      }),
    );
    this._track(this.engine.on("phase", () => this.emit("view")));
    this._track(
      this.engine.on("ended", (winner) => {
        this._refreshMeta();
        this._broadcast({ force: true });
        this.emit("ended", winner);
        this.emit("view");
      }),
    );
    this._track(
      this.engine.on("started", () => {
        this._chatEpoch += 1;
        for (const peer of this.peers.values()) {
          peer.chatCursor = 0;
          peer.version = -1;
          peer.phaseSerial = -1;
        }
        this._refreshMeta();
        this._broadcast({ force: true });
        this.emit("started");
        this.emit("view");
      }),
    );

    this._attachAdapter();
    this._refreshMeta();
    this._startLoop();

    if (this.autoStart) {
      queueMicrotask(() => {
        if (this.closed) return;
        this.start();
      });
    }
  }

  get onlineLabel() {
    if (this.mode === "online") return "Онлайн";
    if (this.mode === "lan") return "По IP";
    if (this.mode === "local") return LOCAL_ROOM_LABELS.label;
    return "Тренировка";
  }

  get isSpectator() {
    return this.spectatorOnly;
  }

  get spectatorCount() {
    let count = 0;
    for (const peer of this.peers.values()) if (peer.spectator) count += 1;
    return count;
  }

  get view() {
    const view = this.engine.getView(this.viewerId);
    return this._decorate(view);
  }

  estimatedNow() {
    return this.clock.now();
  }

  _decorate(view) {
    view.session = {
      mode: this.mode,
      online: this.online,
      roomCode: this.roomCode,
      hostName: this.self.name,
      spectators: this.spectatorCount,
      speed: this.clock.speed,
      paused: this.clock.paused,
      spectatorOnly: this.spectatorOnly,
      allowSpectators: this.engine.config.allowSpectators,
      chatEpoch: this._chatEpoch,
      syncAt: Date.now(),
    };
    return view;
  }

  _attachAdapter() {
    const adapter = this.adapter;
    if (!adapter) return;
    this._track(adapter.on("join", ({ peer }) => this._onPeerJoin(peer)));
    this._track(adapter.on("message", ({ from, payload }) => this._onPeerMessage(from, payload)));
    this._track(adapter.on("leave", ({ peerId }) => this._onPeerLeave(peerId)));
    this._track(adapter.on("closed", ({ reason }) => this._onAdapterClosed(reason)));
    this._track(
      adapter.on("error", (error) => {
        this.emit("notice", { tone: "danger", text: error?.message ?? "Ошибка сети." });
      }),
    );
  }

  _startLoop() {
    this._tickTimer = setInterval(() => this._tick(), 100);
    this._tickTimer.unref?.();
  }

  _tick() {
    if (this.closed) return;
    try {
      this.clock.advance(Date.now());
      this.engine.tick(this.clock.now());
      if (!this.clock.paused) {
        this.botRuntime.tick(this.clock.now());
      }
      const real = Date.now();
      if (this._dirty || real - this._lastSync > 2600) {
        this._dirty = false;
        this._lastSync = real;
        this._broadcast({ force: false });
      }
      if (real - this._lastMeta > 6000) {
        this._refreshMeta();
      }
    } catch (error) {
      console.error("[host] tick", error);
    }
  }

  // -----------------------------------------------------------------------
  // Wire output
  // -----------------------------------------------------------------------

  _welcomePayload(peer) {
    const viewerId = peer.playerId ?? null;
    const view = this._viewFor(peer);
    const chat = visibleChat(this.engine, viewerId, 140);
    return {
      type: "welcome",
      protocol: 2,
      selfId: peer.id,
      playerId: peer.playerId,
      spectator: peer.spectator,
      roomCode: this.roomCode,
      hostId: this.self.id,
      hostName: this.self.name,
      view,
      chat,
      chatEpoch: this._chatEpoch,
      speed: this.clock.speed,
      paused: this.clock.paused,
    };
  }

  _viewFor(peer) {
    const viewerId = peer.playerId ?? null;
    const view = this.engine.getView(viewerId, { withChat: false });
    view.session = {
      mode: this.mode,
      online: this.online,
      roomCode: this.roomCode,
      hostName: this.self.name,
      spectators: this.spectatorCount,
      speed: this.clock.speed,
      paused: this.clock.paused,
      spectatorOnly: this.spectatorOnly,
      allowSpectators: this.engine.config.allowSpectators,
      chatEpoch: this._chatEpoch,
      syncAt: Date.now(),
    };
    return view;
  }

  _sendWelcome(peer) {
    if (!this.adapter || !this.adapter.send) return false;
    const payload = this._welcomePayload(peer);
    const ok = this.adapter.send(peer.id, payload);
    peer.version = payload.view.version;
    peer.phaseSerial = payload.view.phaseSerial;
    peer.chatCursor = payload.chat.at(-1)?.seq ?? 0;
    return ok;
  }

  _peerState(peer, force = false) {
    if (!this.adapter || !this.adapter.send) return;
    const view = this._viewFor(peer);
    if (force || view.version !== peer.version || view.phaseSerial !== peer.phaseSerial) {
      const ok = this.adapter.send(peer.id, {
        type: "state",
        roomCode: this.roomCode,
        protocol: 2,
        view,
        chatSeq: this.engine.chatSeq,
        chatEpoch: this._chatEpoch,
        speed: this.clock.speed,
        paused: this.clock.paused,
      });
      if (ok) {
        peer.version = view.version;
        peer.phaseSerial = view.phaseSerial;
      }
    }
    const messages = this.engine.chat.filter(
      (message) => message.seq > peer.chatCursor && this.engine.canSeeChat(message, peer.playerId ?? null),
    );
    if (messages.length) {
      const ok = this.adapter.send(peer.id, {
        type: "chat",
        messages,
        chatSeq: this.engine.chatSeq,
        chatEpoch: this._chatEpoch,
      });
      if (ok) peer.chatCursor = messages.at(-1).seq;
    }
  }

  _broadcast({ force = false } = {}) {
    if (!this.adapter || !this.peers.size) return;
    for (const peer of this.peers.values()) {
      try {
        this._peerState(peer, force);
      } catch (error) {
        console.error("[host] peer update", error);
      }
    }
  }

  _notice(peerId, text, tone = "warn") {
    if (!this.adapter?.send) return;
    this.adapter.send(peerId, { type: "notice", tone, text: String(text).slice(0, 180) });
  }

  _refreshMeta() {
    if (!this.adapter?.updateMeta) return;
    this._lastMeta = Date.now();
    const lobby = this.engine.getPublicLobby();
    this.adapter.updateMeta({
      ...lobby,
      code: this.roomCode,
      hostId: this.self.id,
      hostName: this.self.name,
      name: this.engine.config.name,
      status: phaseStatus(this.engine),
      public: this.engine.config.public,
      quick: this.engine.config.quick,
      spectatorOnly: this.spectatorOnly,
      lan: this.mode === "lan",
      updatedAt: Date.now(),
    });
  }

  // -----------------------------------------------------------------------
  // Peer lifecycle
  // -----------------------------------------------------------------------

  _onPeerJoin(rawPeer) {
    if (this.closed || !this.adapter) return;
    if (!rawPeer || !isValidPlayerId(rawPeer.id)) return;
    if (this.peers.has(rawPeer.id)) return;

    const peer = {
      id: rawPeer.id,
      name: sanitizeNick(rawPeer.name) || "Гость",
      avatar: rawPeer.avatar ?? null,
      color: normalizeHexColor(rawPeer.color),
      spectate: rawPeer.spectate === true,
      playerId: null,
      spectator: false,
      version: -1,
      phaseSerial: -1,
      chatCursor: 0,
      limiter: new RateLimiter({ capacity: 12, refillPerSec: 5 }),
    };

    if (peer.spectate) {
      if (!this.engine.config.allowSpectators && !this.spectatorOnly) {
        this.adapter.deny(peer.id, "Наблюдатели в этой комнате запрещены.");
        return;
      }
      peer.spectator = true;
    } else if (this.spectatorOnly) {
      peer.spectator = true;
    } else if (this.engine.phase !== PHASE.LOBBY) {
      if (!this.engine.config.allowSpectators) {
        this.adapter.deny(peer.id, "Игра уже началась.");
        return;
      }
      peer.spectator = true;
    } else if (this.engine.players.length >= this.engine.config.maxPlayers) {
      if (!this.engine.config.allowSpectators) {
        this.adapter.deny(peer.id, "Комната заполнена.");
        return;
      }
      peer.spectator = true;
    }

    if (!peer.spectator) {
      const result = this.engine.addPlayer({
        id: peer.id,
        name: peer.name,
        avatar: peer.avatar,
        color: peer.color,
        ready: false,
      });
      if (result.ok) {
        peer.playerId = peer.id;
        this.engine.playerMap.get(peer.id).ready = false;
      } else if (this.engine.config.allowSpectators) {
        peer.spectator = true;
      } else {
        this.adapter.deny(peer.id, result.error ?? "Не удалось войти.");
        return;
      }
    }

    this.peers.set(peer.id, peer);
    this._sendWelcome(peer);
    this._broadcast({ force: true });
    this._refreshMeta();
    this.emit("peers", { count: this.peers.size });
    this.emit("view");
  }

  _onPeerLeave(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    if (peer.playerId) {
      this.engine.removePlayer(peer.playerId);
    }
    this._broadcast({ force: true });
    this._refreshMeta();
    this.emit("peers", { count: this.peers.size });
    this.emit("view");
  }

  _onPeerMessage(peerId, payload) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (!payload || payload.type !== "action" || typeof payload.kind !== "string") return;
    if (!BOT_ACTION_KINDS.has(payload.kind)) return;
    const limited = peer.limiter.take(1);
    if (!limited.ok) {
      this._notice(peerId, "Слишком много действий. Подождите.", "warn");
      return;
    }

    const playerId = peer.playerId;
    switch (payload.kind) {
      case "sync": {
        this._sendWelcome(peer);
        this._peerState(peer, true);
        return;
      }
      case "chat": {
        if (!playerId) {
          this._notice(peerId, "Наблюдатели не могут писать в чат.", "warn");
          return;
        }
        const channel = CHAT_CHANNELS.has(payload.channel) ? payload.channel : "public";
        const result = this.engine.addChat(playerId, typeof payload.text === "string" ? payload.text : "", {
          quickId: typeof payload.quickId === "string" ? payload.quickId : null,
          channel,
          targetId: typeof payload.targetId === "string" ? payload.targetId : null,
        });
        if (!result.ok) this._notice(peerId, result.error ?? "Сообщение не отправлено.", "warn");
        return;
      }
      case "ready": {
        if (!playerId) return;
        this.engine.setReady(playerId, payload.ready === true);
        this._broadcast({ force: true });
        return;
      }
      case "night": {
        if (!playerId || typeof payload.action !== "string" || !NIGHT_ACTIONS.has(payload.action)) return;
        const result = this.engine.setNightAction(playerId, payload.action, payload.targetId ?? null);
        if (!result.ok) this._notice(peerId, result.error ?? "Действие недоступно.", "warn");
        return;
      }
      case "vote": {
        if (!playerId) return;
        const result = this.engine.castVote(playerId, payload.targetId ?? "skip");
        if (!result.ok) this._notice(peerId, result.error ?? "Голос не учтён.", "warn");
        return;
      }
      case "spectate-speed": {
        if (this.spectatorOnly) {
          this.setSpeed(Number(payload.speed) || 1);
        }
        return;
      }
      case "spectate-pause": {
        if (this.spectatorOnly) {
          this.setPaused(payload.paused === true);
        }
        return;
      }
      default:
        return;
    }
  }

  _onAdapterClosed(reason) {
    if (this.closed) return;
    this.close(reason, { notify: false });
  }

  // -----------------------------------------------------------------------
  // Host actions (local UI)
  // -----------------------------------------------------------------------

  setReady(ready) {
    if (!this.viewerId) return { ok: false, error: "Наблюдатели не готовятся." };
    return this.engine.setReady(this.viewerId, ready === true);
  }

  updateConfig(patch) {
    const result = this.engine.updateConfig(this.self.id, patch);
    if (result.ok) {
      this._refreshMeta();
      this._broadcast({ force: true });
      this.emit("view");
    }
    return result;
  }

  start() {
    const result = this.engine.start();
    if (result.ok) {
      this.botRuntime.sync();
      this._refreshMeta();
      this._broadcast({ force: true });
      this.emit("view");
    }
    return result;
  }

  fillBots(count) {
    const add = Math.max(1, Math.round(Number(count) || 1));
    const target = Math.min(this.engine.config.maxPlayers, this.engine.players.length + add);
    const added = this.engine.fillBots(target, (used) => pickBot(used));
    this.botRuntime.sync();
    this._broadcast({ force: true });
    this._refreshMeta();
    this.emit("view");
    return { ok: true, added };
  }

  fillToMin() {
    const missing = Math.max(0, this.engine.config.minStart - this.engine.players.length);
    return this.fillBots(missing || 1);
  }

  removeBots() {
    const bots = this.engine.players.filter((player) => player.isBot);
    for (const bot of bots) this.engine.kickPlayer(this.self.id, bot.id);
    this.botRuntime.sync();
    this._broadcast({ force: true });
    this._refreshMeta();
    this.emit("view");
    return { ok: true, removed: bots.length };
  }

  kick(playerId) {
    if (typeof playerId !== "string") return { ok: false, error: "Игрок не найден." };
    const peer = this.peers.get(playerId);
    const result = this.engine.kickPlayer(this.self.id, playerId);
    if (!result.ok) return result;
    if (peer) {
      this.peers.delete(playerId);
      if (this.adapter?.kick) this.adapter.kick(playerId, "Вас исключили из комнаты.");
    }
    this._broadcast({ force: true });
    this._refreshMeta();
    this.emit("view");
    return { ok: true };
  }

  sendChat({ text = "", quickId = null, targetId = null, channel = "public" } = {}) {
    if (!this.viewerId) return { ok: false, error: "Наблюдатели не пишут в чат." };
    return this.engine.addChat(this.viewerId, text, {
      quickId: typeof quickId === "string" ? quickId : null,
      targetId: typeof targetId === "string" ? targetId : null,
      channel,
    });
  }

  sendQuickChat(quickId, { targetId = null, channel = "public" } = {}) {
    return this.sendChat({ quickId, targetId, channel });
  }

  nightAction(action, targetId) {
    if (!this.viewerId) return { ok: false, error: "Наблюдатели не действуют." };
    return this.engine.setNightAction(this.viewerId, action, targetId);
  }

  vote(targetId) {
    if (!this.viewerId) return { ok: false, error: "Наблюдатели не голосуют." };
    return this.engine.castVote(this.viewerId, targetId ?? "skip");
  }

  setSpeed(speed) {
    this.clock.setSpeed(speed);
    this._broadcast({ force: true });
    this.emit("view");
  }

  setPaused(paused) {
    this.clock.setPaused(paused);
    this._broadcast({ force: true });
    this.emit("view");
  }

  rematch() {
    if (this.engine.phase !== PHASE.ENDED) return { ok: false, error: "Игра ещё идёт." };
    this.botRuntime.dispose();
    this.engine.resetToLobby();
    this.botRuntime = new BotRuntime({
      engine: this.engine,
      level: this.engine.config.botChat,
    });
    this._chatEpoch += 1;
    for (const peer of this.peers.values()) {
      peer.version = -1;
      peer.phaseSerial = -1;
      peer.chatCursor = 0;
    }
    this._refreshMeta();
    this._broadcast({ force: true });
    this.emit("view");
    this.emit("rematch");
    return { ok: true };
  }

  close(reason = "Комната закрыта.", { notify = true } = {}) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._tickTimer);
    this._tickTimer = null;
    this._cleanup();
    try {
      this.botRuntime.dispose();
    } catch {
      // ignore
    }
    try {
      this.engine.destroy();
    } catch {
      // ignore
    }
    const adapter = this.adapter;
    this.adapter = null;
    if (adapter) {
      try {
        // Peers should not see the host's local "you left" wording.
        adapter.close(this.isHost ? "Хост закрыл комнату." : reason);
      } catch {
        // ignore
      }
    }
    this.peers.clear();
    if (notify) this._emitClosed(reason);
  }

  dispose() {
    this.close("Комната закрыта.");
  }
}

export class GuestSession extends BaseSession {
  constructor({ adapter, self, welcome = null, mode = "local" }) {
    super({ mode, roomCode: welcome?.roomCode ?? adapter?.code ?? "", self, online: adapter?.online === true });
    this.adapter = adapter;
    this.isHost = false;
    this.selfId = welcome?.selfId ?? adapter?.selfId ?? self.id;
    this.playerId = welcome?.playerId ?? null;
    this.spectator = welcome?.spectator === true || welcome?.playerId == null;
    this.hostId = welcome?.hostId ?? adapter?.hostId ?? null;
    this.hostName = welcome?.hostName ?? "";
    this.viewData = null;
    this.chat = [];
    this.speed = Number(welcome?.speed) || 1;
    this.paused = welcome?.paused === true;
    this.chatEpoch = Number(welcome?.chatEpoch) || 0;
    this._hostNow = Date.now();
    this._syncAt = Date.now();
    this._welcomeResolve = null;
    this._welcomePromise = new Promise((resolve) => {
      this._welcomeResolve = resolve;
    });
    this.lastError = null;

    this._track(adapter.on("message", ({ payload }) => this._onPayload(payload)));
    this._track(
      adapter.on("closed", ({ reason }) => {
        if (this.closed) return;
        this.closed = true;
        this._cleanup();
        this._emitClosed(reason);
      }),
    );

    if (welcome) this._applyWelcome(welcome);
    else queueMicrotask(() => this._requestSync());
  }

  get onlineLabel() {
    if (this.mode === "online") return "Онлайн";
    if (this.mode === "lan") return "По IP";
    return LOCAL_ROOM_LABELS.label;
  }

  get isSpectator() {
    return this.spectator === true;
  }

  get view() {
    if (!this.viewData) return null;
    return { ...this.viewData, chat: this.chat };
  }

  estimatedNow() {
    if (this.paused) return this._hostNow;
    return this._hostNow + (Date.now() - this._syncAt) * this.speed;
  }

  _requestSync() {
    if (this.closed) return;
    this.adapter.send({ type: "action", kind: "sync" });
  }

  async waitForWelcome(timeout = 6000) {
    if (this.viewData) return this.viewData;
    let timer;
    try {
      return await Promise.race([
        this._welcomePromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Хост не ответил.")), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  _applyWelcome(payload) {
    if (!payload || payload.type !== "welcome" || !payload.view) return false;
    this.viewData = payload.view;
    this.spectator = payload.spectator === true || payload.playerId == null;
    this.playerId = payload.playerId ?? null;
    this.selfId = payload.selfId ?? this.selfId;
    this.hostId = payload.hostId ?? this.hostId;
    this.hostName = payload.hostName ?? this.hostName;
    this.roomCode = payload.roomCode ?? this.roomCode;
    this.speed = Number(payload.speed) || this.speed || 1;
    this.paused = payload.paused === true;
    this.chatEpoch = Number(payload.chatEpoch) || 0;
    this._hostNow = Number(payload.view.now) || Date.now();
    this._syncAt = Date.now();
    const messages = Array.isArray(payload.chat) ? payload.chat : [];
    this.chat = this._mergeChat(messages);
    this._welcomeResolve?.(this.viewData);
    this.emit("view", this.view);
    return true;
  }

  _mergeChat(messages) {
    const bySeq = new Map(this.chat.map((message) => [message.seq, message]));
    for (const message of messages) {
      if (message && typeof message.seq === "number") bySeq.set(message.seq, message);
    }
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-200);
  }

  _onPayload(payload) {
    if (this.closed || !payload || typeof payload !== "object") return;
    switch (payload.type) {
      case "welcome":
        this._applyWelcome(payload);
        return;
      case "state": {
        if (!payload.view) return;
        const epoch = Number(payload.chatEpoch) || 0;
        if (epoch !== this.chatEpoch) {
          this.chatEpoch = epoch;
          this.chat = [];
        }
        this.viewData = payload.view;
        this.speed = Number(payload.speed) || this.speed || 1;
        this.paused = payload.paused === true;
        this._hostNow = Number(payload.view.now) || this._hostNow;
        this._syncAt = Date.now();
        this.emit("view", this.view);
        return;
      }
      case "chat": {
        if (!Array.isArray(payload.messages) || !payload.messages.length) return;
        const epoch = Number(payload.chatEpoch);
        if (Number.isFinite(epoch) && epoch !== this.chatEpoch) {
          this.chatEpoch = epoch;
          this.chat = [];
        }
        this.chat = this._mergeChat(payload.messages);
        this.emit("view", this.view);
        return;
      }
      case "notice": {
        this.emit("notice", {
          tone: ["danger", "warn", "info", "town"].includes(payload.tone) ? payload.tone : "info",
          text: String(payload.text ?? "").slice(0, 180),
        });
        return;
      }
      case "kicked": {
        this.close(String(payload.reason ?? "Вас исключили из комнаты."));
        return;
      }
      case "closed": {
        this.close(String(payload.reason ?? "Комната закрыта."));
        return;
      }
      case "pong":
      case "ping":
        return;
      default:
        return;
    }
  }

  _sendAction(kind, data = {}) {
    if (this.closed) return false;
    return this.adapter.send({ type: "action", kind, ...data });
  }

  setReady(ready) {
    this._sendAction("ready", { ready: ready === true });
    return { ok: true };
  }

  sendChat({ text = "", quickId = null, targetId = null, channel = "public" } = {}) {
    if (this.spectator) return { ok: false, error: "Наблюдатели не пишут в чат." };
    this._sendAction("chat", {
      text: typeof text === "string" ? text.slice(0, 160) : "",
      quickId: typeof quickId === "string" ? quickId : null,
      targetId: typeof targetId === "string" ? targetId : null,
      channel: CHAT_CHANNELS.has(channel) ? channel : "public",
    });
    return { ok: true };
  }

  sendQuickChat(quickId, { targetId = null, channel = "public" } = {}) {
    return this.sendChat({ quickId, targetId, channel });
  }

  nightAction(action, targetId) {
    if (!NIGHT_ACTIONS.has(action)) return { ok: false, error: "Неизвестное действие." };
    this._sendAction("night", { action, targetId: targetId ?? null });
    return { ok: true };
  }

  vote(targetId) {
    this._sendAction("vote", { targetId: targetId ?? "skip" });
    return { ok: true };
  }

  setSpeed(speed) {
    if (!this.spectator) return { ok: false, error: "Только наблюдатели меняют темп." };
    this._sendAction("spectate-speed", { speed });
    return { ok: true };
  }

  setPaused(paused) {
    if (!this.spectator) return { ok: false, error: "Только наблюдатели ставят паузу." };
    this._sendAction("spectate-pause", { paused: paused === true });
    return { ok: true };
  }

  close(reason = "Вы покинули комнату.") {
    if (this.closed) return;
    this.closed = true;
    this._cleanup();
    try {
      this.adapter.close(reason);
    } catch {
      // ignore
    }
    this._emitClosed(reason);
  }
}

// -------------------------------------------------------------------------
// Factories
// -------------------------------------------------------------------------

function roomConfig(config = {}, botFill = 0) {
  return normalizeRoomConfig({ ...config, maxPlayers: config.maxPlayers ?? (botFill || 8) });
}

export async function openRoom({
  mode = "solo",
  relayUrl = "",
  code = "",
  self = {},
  config = {},
  botFill = 0,
  spectatorOnly = false,
  autoStart = false,
  speed = 1,
  rng,
  adapter: injectedAdapter = null,
} = {}) {
  const profile = normalizeSelf(self);
  const roomCode = String(code || createRoomCode()).toUpperCase();
  const cleanConfig = roomConfig(config, botFill);
  let adapter = injectedAdapter;

  if (!adapter && (mode === "online" || mode === "lan")) {
    adapter = new OnlineHostAdapter({
      url: relayUrl,
      code: roomCode,
      hostName: profile.name,
      meta: {
        ...cleanConfig,
        hostName: profile.name,
        public: cleanConfig.public,
        lan: mode === "lan",
      },
    });
    const welcome = await adapter.connect();
    const session = new HostSession({
      roomCode: welcome.code,
      self: profile,
      config: cleanConfig,
      adapter,
      mode,
      spectatorOnly,
      botFill,
      autoStart,
      speed,
      rng,
    });
    return session;
  }

  if (!adapter && mode === "local") {
    adapter = createLocalHost({
      code: roomCode,
      hostId: profile.id,
      hostName: profile.name,
      meta: { ...cleanConfig, hostName: profile.name, code: roomCode },
    });
  }

  return new HostSession({
    roomCode,
    self: profile,
    config: cleanConfig,
    adapter,
    mode: adapter ? "local" : "solo",
    spectatorOnly,
    botFill,
    autoStart,
    speed,
    rng,
  });
}

export async function joinRoom({
  mode = "local",
  relayUrl = "",
  code = "",
  self = {},
  spectate = false,
} = {}) {
  const profile = normalizeSelf(self);
  if (mode === "online" || mode === "lan") {
    const adapter = new OnlineGuestAdapter({
      url: relayUrl,
      code,
      name: profile.name,
      avatar: profile.avatar,
      color: profile.color,
      spectate,
    });
    await adapter.connect();
    const session = new GuestSession({ adapter, self: profile, mode });
    await session.waitForWelcome(7000);
    return session;
  }

  const { adapter, welcome } = await joinLocalRoom({
    code,
    selfId: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    color: profile.color,
    spectate,
  });
  const session = new GuestSession({ adapter, self: profile, welcome, mode: "local" });
  session._requestSync();
  return session;
}

export function createSoloSession(options = {}) {
  return openRoom({
    ...options,
    mode: "solo",
    adapter: null,
    botFill: options.botFill ?? options.config?.maxPlayers ?? 8,
  });
}

export function createSpectatorSession(options = {}) {
  return openRoom({
    ...options,
    mode: "solo",
    adapter: null,
    spectatorOnly: true,
    autoStart: options.autoStart !== false,
    botFill: options.botFill ?? options.config?.maxPlayers ?? 10,
  });
}
