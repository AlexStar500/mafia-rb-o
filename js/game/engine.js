import { Emitter } from "../core/events.js";
import { pickOne, randomInt, shuffle } from "../core/random.js";
import { clampInt, isValidPlayerId, sanitizeChat, sanitizeNick } from "../core/security.js";
import { getQuickMessage } from "../data/quickChat.js";
import {
  ROLES,
  TEAMS,
  computeRoleSetup,
  normalizeRoomConfig,
} from "../data/roles.js";

export const PHASE = Object.freeze({
  LOBBY: "lobby",
  NIGHT: "night",
  DAWN: "dawn",
  DISCUSSION: "discussion",
  VOTING: "voting",
  VERDICT: "verdict",
  LAST_WORDS: "lastWords",
  ENDED: "ended",
});

const PHASE_DURATIONS = Object.freeze({
  dawn: 6,
  verdict: 6,
  lastWords: 14,
});

const PUBLIC_CHAT_PHASES = new Set([
  PHASE.LOBBY,
  PHASE.DISCUSSION,
  PHASE.VOTING,
  PHASE.VERDICT,
  PHASE.ENDED,
]);

const VOTE_MIN = 2;

// Human chat is throttled as a burst, not capped for the whole phase: a normal
// conversation should never run into a wall, but a paste-spam burst should.
const CHAT_WINDOW_MS = 10_000;
const CHAT_WINDOW_MAX = 6;
const CHAT_MIN_GAP_MS = 700;
const CHAT_QUICK_GAP_MS = 950;

function teamOfRole(roleId) {
  return ROLES[roleId]?.team ?? "town";
}

function cleanName(value, fallback = "Игрок") {
  return sanitizeNick(value) || fallback;
}

function uniqueName(base, players) {
  const names = new Set(players.map((player) => player.name.toLowerCase()));
  let name = base;
  let suffix = 2;
  while (names.has(name.toLowerCase())) {
    name = `${base} ${suffix}`;
    suffix += 1;
    if (suffix > 99) break;
  }
  return name;
}

export class GameEngine {
  constructor({
    roomCode = "SOLO",
    config = {},
    hostId = null,
    now = Date.now,
    rng = Math.random,
    spectatorXray = true,
  } = {}) {
    this.roomCode = String(roomCode);
    this.config = normalizeRoomConfig(config);
    this.hostId = hostId;
    this.clock = typeof now === "function" ? now : () => Number(now) || Date.now();
    this.rng = typeof rng === "function" ? rng : Math.random;
    this.spectatorXray = spectatorXray !== false;

    this.phase = PHASE.LOBBY;
    this.phaseSerial = 0;
    this.phaseStartedAt = this.clock();
    this.phaseEndsAt = 0;
    this.phaseDurationMs = 0;
    this.day = 0;
    this.createdAt = this.clock();
    this.startedAt = 0;
    this.endedAt = 0;
    this.version = 0;

    this.players = [];
    this.playerMap = new Map();
    this.spectators = new Set();
    this.setup = null;
    this.winner = null;
    this.voteResult = null;
    this.lastNight = null;
    this.lastWordsPlayerId = null;
    this.lastWordsSpoken = false;
    this.night = null;
    this.votes = new Map();
    this.chat = [];
    this.chatSeq = 0;
    this.log = [];
    this.logSeq = 0;
    this._allVotedAt = 0;
    this._started = false;

    this.events = new Emitter();
    this.on = this.events.on.bind(this.events);
    this.off = this.events.off.bind(this.events);
  }

  // -----------------------------------------------------------------------
  // Lobby
  // -----------------------------------------------------------------------

  get playerCount() {
    return this.players.length;
  }

  get alivePlayers() {
    return this.players.filter((player) => player.alive);
  }

  get isStarted() {
    return this._started && this.phase !== PHASE.ENDED;
  }

  isHost(playerId) {
    return playerId === this.hostId;
  }

  getPlayer(playerId) {
    return this.playerMap.get(playerId) ?? null;
  }

  addPlayer(input = {}) {
    const now = this.clock();
    if (this.players.length >= this.config.maxPlayers) {
      return { ok: false, error: "Комната заполнена." };
    }
    const rawId = input.id;
    const id = isValidPlayerId(rawId) ? rawId : `p_${Math.random().toString(36).slice(2, 12)}`;
    if (this.playerMap.has(id)) return { ok: false, error: "Игрок уже в комнате." };

    const isBot = input.isBot === true;
    const baseName = isBot ? String(input.name ?? "Бот").slice(0, 16) : cleanName(input.name);
    const player = {
      id,
      name: uniqueName(baseName, this.players),
      avatar: typeof input.avatar === "string" && /^[a-z0-9-]{2,24}$/.test(input.avatar) ? input.avatar : null,
      color: typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : "#d9b36c",
      isBot,
      botId: isBot && typeof input.botId === "string" ? input.botId : null,
      isHost: this.hostId ? this.hostId === id : this.players.length === 0,
      seat: 0,
      alive: true,
      connected: input.connected !== false,
      ready: isBot || input.ready === true,
      muted: false,
      joinedAt: now,
      roleId: null,
      team: null,
      death: null,
      notes: [],
      investigations: [],
      lastHealTarget: null,
      selfHeals: 0,
      contractUsed: false,
      stats: {
        votesCast: 0,
        votesReceived: 0,
        correctVotes: 0,
        messages: 0,
        nightActions: 0,
      },
      _lastChatAt: 0,
      _recentChats: [],
    };
    if (!this.hostId) this.hostId = id;
    player.isHost = this.hostId === id;

    const usedSeats = new Set(this.players.map((p) => p.seat));
    for (let seat = 0; seat < this.config.maxPlayers; seat += 1) {
      if (!usedSeats.has(seat)) {
        player.seat = seat;
        break;
      }
    }
    this.players.push(player);
    this.playerMap.set(id, player);
    this.players.sort((a, b) => a.seat - b.seat);
    if (!this._started) {
      this._addLog("join", `${player.name} входит в комнату.`, { tone: "muted", playerId: id });
    }
    this._changed("join");
    return { ok: true, player };
  }

  addBot(botId = null, bot = null) {
    if (this.players.length >= this.config.maxPlayers) {
      return { ok: false, error: "Комната заполнена." };
    }
    const id = `bot_${(botId || bot?.id || "guest").replace(/[^a-z0-9-]/gi, "").slice(0, 12)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    return this.addPlayer({
      id,
      name: bot?.name ?? "Бот",
      avatar: botId ?? bot?.id ?? null,
      color: bot?.color ?? "#8a8f9f",
      isBot: true,
      botId: botId ?? bot?.id ?? null,
      ready: true,
    });
  }

  fillBots(targetCount, pickBotFn) {
    const target = clampInt(targetCount, this.players.length, this.config.maxPlayers, this.config.maxPlayers);
    const added = [];
    while (this.players.length < target) {
      const used = this.players.filter((p) => p.isBot).map((p) => p.botId);
      const bot = pickBotFn?.(used) ?? null;
      if (!bot) break;
      const result = this.addBot(bot.id, bot);
      if (!result.ok) break;
      added.push(result.player);
    }
    return added;
  }

  removePlayer(playerId, { silent = false } = {}) {
    const player = this.playerMap.get(playerId);
    if (!player) return { ok: false, error: "Игрок не найден." };
    if (this._started && this.phase !== PHASE.ENDED) {
      // Keep the role in play: losing a client must not break the balance.
      player.connected = false;
      player.ready = false;
      if (!player.alive) player.deadDisconnected = true;
      this._changed("disconnect");
      return { ok: true, kept: true };
    }
    this.players = this.players.filter((p) => p.id !== playerId);
    this.playerMap.delete(playerId);
    this.votes.delete(playerId);
    if (this.hostId === playerId) {
      const nextHost = this.players.find((p) => !p.isBot) ?? this.players[0] ?? null;
      this.hostId = nextHost?.id ?? null;
      for (const p of this.players) p.isHost = p.id === this.hostId;
    }
    if (!silent) this._addLog("leave", `${player.name} покидает комнату.`, { tone: "muted", playerId });
    this._changed("leave");
    return { ok: true, removed: true };
  }

  kickPlayer(hostId, playerId) {
    if (!this.isHost(hostId)) return { ok: false, error: "Только хост может исключать." };
    if (this._started) return { ok: false, error: "Во время игры нельзя исключать." };
    if (playerId === hostId) return { ok: false, error: "Нельзя исключить себя." };
    const player = this.playerMap.get(playerId);
    if (!player) return { ok: false, error: "Игрок не найден." };
    this.removePlayer(playerId, { silent: true });
    this._addLog("kick", `${player.name} исключён хостом.`, { tone: "warn" });
    this._changed("kick");
    return { ok: true };
  }

  setReady(playerId, ready) {
    const player = this.playerMap.get(playerId);
    if (!player) return { ok: false, error: "Игрок не найден." };
    if (this._started) return { ok: false, error: "Игра уже началась." };
    if (player.isBot) return { ok: true };
    player.ready = ready === true;
    this._changed("ready");
    return { ok: true };
  }

  updateConfig(hostId, patch = {}) {
    if (!this.isHost(hostId)) return { ok: false, error: "Только хост может менять настройки." };
    if (this._started && this.phase !== PHASE.ENDED) {
      return { ok: false, error: "Настройки меняются только в лобби." };
    }
    const merged = normalizeRoomConfig(
      {
        ...this.config,
        ...patch,
        roles: { ...this.config.roles, ...(patch.roles ?? {}) },
        timers: { ...this.config.timers, ...(patch.timers ?? {}) },
      },
      this.players.length,
    );
    if (merged.maxPlayers < this.players.length) {
      return { ok: false, error: `В комнате уже ${this.players.length} игроков.` };
    }
    merged.minStart = Math.min(merged.minStart, merged.maxPlayers);
    this.config = merged;
    this._changed("config");
    return { ok: true, config: this.config };
  }

  canStart() {
    if (this.phase !== PHASE.LOBBY) return { ok: false, error: "Игра уже началась." };
    if (this.players.length < this.config.minStart) {
      return {
        ok: false,
        error: `Нужно минимум ${this.config.minStart} игроков. Сейчас ${this.players.length}.`,
      };
    }
    const humans = this.players.filter((player) => !player.isBot);
    const notReady = humans.filter((player) => !player.ready && player.id !== this.hostId);
    if (notReady.length) {
      return { ok: false, error: `Не готовы: ${notReady.map((p) => p.name).join(", ")}` };
    }
    return { ok: true };
  }

  start(force = false) {
    if (this.phase !== PHASE.LOBBY) return { ok: false, error: "Игра уже началась." };
    const check = this.canStart();
    if (!check.ok && !force) return check;
    if (this.players.length < 4) return { ok: false, error: "Нужно минимум 4 игрока." };

    const now = this.clock();
    this.config = normalizeRoomConfig(this.config, this.players.length);
    this.setup = computeRoleSetup(this.players.length, this.config.roles);
    const roles = shuffle(this.setup.ids, this.rng);

    for (const player of this.players) {
      player.roleId = roles.pop() ?? "civilian";
      player.team = teamOfRole(player.roleId);
      player.alive = true;
      player.death = null;
      player.ready = true;
      player.connected = true;
      player.notes = [];
      player.investigations = [];
      player.lastHealTarget = null;
      player.selfHeals = 0;
      player.contractUsed = false;
      player.stats = {
        votesCast: 0,
        votesReceived: 0,
        correctVotes: 0,
        messages: 0,
        nightActions: 0,
      };
      player._lastChatAt = 0;
      player._recentChats = [];
    }

    this._started = true;
    this.startedAt = now;
    this.day = 1;
    this.winner = null;
    this.voteResult = null;
    this.lastNight = null;
    this.lastWordsPlayerId = null;
    this.lastWordsSpoken = false;
    this.night = null;
    this.votes.clear();
    this.chat = [];
    this.chatSeq = 0;
    this.log = [];
    this.logSeq = 0;
    this.version = 0;
    this.phaseSerial = 0;
    this._allVotedAt = 0;

    this._addLog("start", "Роли розданы. Город засыпает.", { tone: "gold" });
    this._enterNight(now, { first: true });
    this.events.emit("started", { setup: this.setup });
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Main loop
  // -----------------------------------------------------------------------

  tick(now = this.clock()) {
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.ENDED) return false;
    if (this.phase === PHASE.VOTING && this._allVotedAt && now >= this._allVotedAt) {
      this._resolveVoting(now);
      return true;
    }
    if (now < this.phaseEndsAt) return false;

    switch (this.phase) {
      case PHASE.NIGHT:
        this._resolveNight(now);
        return true;
      case PHASE.DAWN:
        this._setPhase(PHASE.DISCUSSION, this.config.timers.discussion, "discussion", now);
        this._addLog("phase", "Город просыпается. Начинается обсуждение.", { tone: "gold" });
        return true;
      case PHASE.DISCUSSION:
        this._setPhase(PHASE.VOTING, this.config.timers.voting, "voting", now);
        this.votes.clear();
        this._allVotedAt = 0;
        this._addLog("phase", "Голосование началось. Кого повесим?", { tone: "danger" });
        return true;
      case PHASE.VOTING:
        this._resolveVoting(now);
        return true;
      case PHASE.VERDICT:
        if (this.lastWordsPlayerId) {
          this._setPhase(PHASE.LAST_WORDS, PHASE_DURATIONS.lastWords, "lastWords", now);
          this._addLog("phase", "Последнее слово.", { tone: "muted" });
        } else {
          this._nextNight(now);
        }
        return true;
      case PHASE.LAST_WORDS:
        this._nextNight(now);
        return true;
      default:
        return false;
    }
  }

  _changed(reason = "state", extra = {}) {
    this.version += 1;
    this.events.emit("state", { reason, version: this.version, ...extra });
  }

  _setPhase(phase, seconds, reason = "phase", at = this.clock()) {
    this.phase = phase;
    this.phaseSerial += 1;
    this.phaseStartedAt = at;
    this.phaseDurationMs = Math.max(0, Math.round(Number(seconds) * 1000));
    this.phaseEndsAt = this.phaseDurationMs ? at + this.phaseDurationMs : 0;
    this._changed(reason);
    this.events.emit("phase", { phase, day: this.day, phaseSerial: this.phaseSerial });
  }

  _enterNight(now, { first = false } = {}) {
    if (!first) this.day += 1;
    this.night = {
      killVotes: new Map(),
      doctor: null,
      sheriff: null,
      contract: null,
      resolved: false,
    };
    this.votes.clear();
    this.voteResult = null;
    this.lastWordsPlayerId = null;
    this.lastWordsSpoken = false;
    this._allVotedAt = 0;
    this._setPhase(PHASE.NIGHT, this.config.timers.night, "night", now);
    this._addLog("phase", `Ночь ${this.day}. Город засыпает.`, { tone: "night" });
  }

  _nextNight(now) {
    if (this._checkVictory(now)) return;
    this._enterNight(now);
  }

  // -----------------------------------------------------------------------
  // Night
  // -----------------------------------------------------------------------

  _aliveMafiaIds() {
    return this.players.filter((p) => p.alive && p.team === "mafia").map((p) => p.id);
  }

  _nightTargetsFor(player, action) {
    return this.players
      .filter((target) => {
        if (!target.alive) return false;
        if (target.id === player.id) return false;
        if (action === "kill" || action === "contract") return target.team !== "mafia";
        return true;
      })
      .map((target) => target.id);
  }

  setNightAction(playerId, action, targetId) {
    if (this.phase !== PHASE.NIGHT) return { ok: false, error: "Сейчас не ночь." };
    const player = this.playerMap.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Игрок не может действовать." };
    if (player.muted) return { ok: false, error: "Вы заглушены." };
    const roleId = player.roleId;
    const role = ROLES[roleId];
    if (!role) return { ok: false, error: "Нет роли." };
    const target = targetId ? this.playerMap.get(targetId) : null;

    if (action === "kill") {
      if (role.team !== "mafia") return { ok: false, error: "Только мафия выбирает жертву." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.team === "mafia") return { ok: false, error: "Нельзя убивать своих." };
      this.night.killVotes.set(playerId, targetId);
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    if (action === "heal") {
      if (roleId !== "doctor") return { ok: false, error: "Только доктор лечит." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.id === player.id && player.selfHeals >= 1) {
        return { ok: false, error: "Себя можно спасти только один раз за игру." };
      }
      if (player.lastHealTarget === target.id) {
        return { ok: false, error: "Нельзя лечить одного и того же игрока две ночи подряд." };
      }
      this.night.doctor = { targetId: target.id, byId: player.id };
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    if (action === "check") {
      if (roleId !== "sheriff") return { ok: false, error: "Только шериф проверяет." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.id === player.id) return { ok: false, error: "Нельзя проверить себя." };
      this.night.sheriff = { targetId: target.id, byId: player.id };
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    if (action === "contract") {
      if (roleId !== "assassin") return { ok: false, error: "Только ассасин подписывает контракт." };
      if (this.day < 2) return { ok: false, error: "Контракт доступен со 2-й ночи." };
      if (player.contractUsed) return { ok: false, error: "Контракт уже использован." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.team === "mafia") return { ok: false, error: "Нельзя подписать контракт на своего." };
      this.night.contract = { targetId: target.id, byId: player.id };
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    return { ok: false, error: "Неизвестное действие." };
  }

  _remainingNightActionFor(roleId, playerId) {
    const player = this.playerMap.get(playerId);
    if (!player?.alive) return null;
    const night = this.night;
    if (!night) return null;
    if (roleId === "mafia" || roleId === "assassin") {
      return {
        type: "kill",
        selected: night.killVotes.get(playerId) ?? null,
        options: this._nightTargetsFor(player, "kill"),
      };
    }
    if (roleId === "doctor") {
      return {
        type: "heal",
        selected: night.doctor?.byId === playerId ? night.doctor.targetId : null,
        options: this._nightTargetsFor(player, "heal"),
        blocked: [
          ...(player.lastHealTarget ? [player.lastHealTarget] : []),
          ...(player.selfHeals >= 1 ? [player.id] : []),
        ],
        selfHeals: player.selfHeals,
      };
    }
    if (roleId === "sheriff") {
      return {
        type: "check",
        selected: night.sheriff?.byId === playerId ? night.sheriff.targetId : null,
        options: this._nightTargetsFor(player, "check"),
      };
    }
    return null;
  }

  _resolveNight(now) {
    if (!this.night || this.night.resolved) return;
    this.night.resolved = true;

    const killVotes = [...this.night.killVotes.entries()].filter(([voterId]) => {
      const voter = this.playerMap.get(voterId);
      return voter?.alive && voter.team === "mafia";
    });
    const tally = new Map();
    for (const [, targetId] of killVotes) {
      tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
    }
    let targetId = null;
    if (tally.size) {
      const max = Math.max(...tally.values());
      const top = [...tally.entries()].filter(([, count]) => count === max).map(([id]) => id);
      targetId = pickOne(top, this.rng);
    }

    const doctorAction = this.night.doctor;
    const doctor = doctorAction ? this.playerMap.get(doctorAction.byId) : null;
    const healedId = doctorAction?.targetId ?? null;
    const healed = Boolean(healedId && targetId === healedId);

    const sheriffAction = this.night.sheriff;
    const sheriff = sheriffAction ? this.playerMap.get(sheriffAction.byId) : null;
    if (sheriff && sheriffAction?.targetId) {
      const checked = this.playerMap.get(sheriffAction.targetId);
      if (checked) {
        const result = checked.team === "mafia" ? "mafia" : "clean";
        sheriff.investigations.push({ targetId: checked.id, name: checked.name, result, day: this.day });
        this._addNote(
          sheriff,
          result === "mafia"
            ? `Проверка: ${checked.name} — мафия.`
            : `Проверка: ${checked.name} — не мафия.`,
          result === "mafia" ? "danger" : "town",
        );
      }
    }

    let contractTargetId = null;
    if (this.night.contract) {
      const assassin = this.playerMap.get(this.night.contract.byId);
      const target = this.playerMap.get(this.night.contract.targetId);
      if (assassin && target?.alive && assassin.alive && this.day >= 2 && !assassin.contractUsed) {
        assassin.contractUsed = true;
        contractTargetId = target.id;
        this._addNote(assassin, `Контракт выполнен: ${target.name}.`, "danger");
      }
    }

    if (doctor && healedId) {
      const healedPlayer = this.playerMap.get(healedId);
      if (healedPlayer) {
        doctor.lastHealTarget = healedId;
        if (healedId === doctor.id) doctor.selfHeals += 1;
        const contractKill = contractTargetId === healedId;
        const mafiaKill = targetId === healedId && healed;
        if (contractKill) {
          this._addNote(doctor, `${healedPlayer.name} погиб: контракт ассасина сильнее лечения.`, "danger");
        } else if (mafiaKill) {
          this._addNote(doctor, `Вы спасли ${healedPlayer.name} от мафии.`, "town");
        } else {
          this._addNote(doctor, `${healedPlayer.name} этой ночью не нуждался в помощи.`, "muted");
        }
      }
    }

    const killedIds = new Set();
    if (targetId && !healed) killedIds.add(targetId);
    if (contractTargetId) killedIds.add(contractTargetId);

    const deaths = [];
    for (const id of killedIds) {
      const player = this.playerMap.get(id);
      if (!player?.alive) continue;
      const cause = contractTargetId === id ? "assassin" : "mafia";
      this._killPlayer(id, "night", { cause, byId: null });
      deaths.push({ id, name: player.name, roleId: player.roleId, cause });
    }

    if (killedIds.size === 0) {
      this._addLog("night", "Ночь прошла без жертв.", { tone: "town" });
    } else {
      const names = deaths.map((death) => death.name).join(", ");
      this._addLog("night", `Ночью погибли: ${names}.`, { tone: "danger" });
    }

    const mafiaIds = this._aliveMafiaIds();
    if (mafiaIds.length && deaths.length) {
      for (const id of mafiaIds) {
        const mafiaPlayer = this.playerMap.get(id);
        if (mafiaPlayer) {
          this._addNote(mafiaPlayer, `Устранён: ${deaths.map((death) => death.name).join(", ")}.`, "danger");
        }
      }
    } else if (mafiaIds.length) {
      for (const id of mafiaIds) {
        const mafiaPlayer = this.playerMap.get(id);
        if (mafiaPlayer) this._addNote(mafiaPlayer, "Этой ночью никто не погиб.", "muted");
      }
    }

    this.lastNight = {
      day: this.day,
      deaths,
      saved: Boolean(targetId && healed && contractTargetId !== targetId),
      at: now,
    };

    if (this._checkVictory(now)) return;
    this._setPhase(PHASE.DAWN, PHASE_DURATIONS.dawn, "dawn", now);
    this._addLog("phase", `День ${this.day}. Город просыпается.`, { tone: "gold" });
  }

  // -----------------------------------------------------------------------
  // Day / voting
  // -----------------------------------------------------------------------

  castVote(playerId, targetId) {
    if (this.phase !== PHASE.VOTING) return { ok: false, error: "Сейчас не голосование." };
    const player = this.playerMap.get(playerId);
    if (!player?.alive) return { ok: false, error: "Мёртвые не голосуют." };
    if (this.votes.has(playerId)) return { ok: false, error: "Голос уже учтён." };
    if (targetId !== "skip") {
      const target = this.playerMap.get(targetId);
      if (!target?.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.id === playerId) return { ok: false, error: "Нельзя голосовать за себя." };
    }
    this.votes.set(playerId, targetId);
    player.stats.votesCast += 1;
    if (targetId !== "skip") {
      const target = this.playerMap.get(targetId);
      if (target) target.stats.votesReceived += 1;
    }
    const alive = this.alivePlayers.length;
    if (this.votes.size >= alive && !this._allVotedAt) {
      this._allVotedAt = this.clock() + 2200;
      this.phaseEndsAt = Math.min(this.phaseEndsAt, this._allVotedAt);
    }
    this._changed("vote");
    return { ok: true };
  }

  _resolveVoting(now) {
    if (this.phase !== PHASE.VOTING) return;
    const tally = new Map();
    let skipped = 0;
    for (const [voterId, targetId] of this.votes) {
      const voter = this.playerMap.get(voterId);
      if (!voter?.alive) continue;
      if (targetId === "skip") {
        skipped += 1;
      } else {
        tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
      }
    }
    const entries = [...tally.entries()]
      .map(([id, count]) => {
        const target = this.playerMap.get(id);
        return {
          targetId: id,
          name: target?.name ?? "?",
          count,
          voters: [...this.votes.entries()].filter(([, t]) => t === id).map(([v]) => v),
        };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const top = entries[0] ?? null;
    const tie = entries.length > 1 && entries[0].count === entries[1].count;
    const enough = top && top.count >= VOTE_MIN && !tie;
    const eliminatedId = enough ? top.targetId : null;

    this.voteResult = {
      counts: entries,
      eliminatedId,
      eliminatedName: eliminatedId ? this.playerMap.get(eliminatedId)?.name : null,
      tie,
      topCount: top?.count ?? 0,
      skipped,
      totalVoters: this.votes.size,
      aliveCount: this.alivePlayers.length,
      at: now,
    };

    if (eliminatedId) {
      const eliminated = this.playerMap.get(eliminatedId);
      this._killPlayer(eliminatedId, "vote", { cause: "vote" });
      this._addLog(
        "vote",
        `Город повесил ${eliminated.name} (${top.count} ${top.count === 1 ? "голос" : "голоса"}).`,
        { tone: "danger", playerId: eliminatedId },
      );
      if (eliminated.roleId === "jester") {
        this.endGame("neutral", { reason: "jester", playerId: eliminatedId, roleId: "jester" });
        return;
      }
      if (this._checkVictory(now)) return;
      this.lastWordsPlayerId = eliminatedId;
      this.lastWordsSpoken = false;
      this._setPhase(PHASE.VERDICT, PHASE_DURATIONS.verdict, "verdict", now);
    } else {
      if (tie) this._addLog("vote", "Голоса разделились. Никто не повешен.", { tone: "warn" });
      else if (top && top.count < VOTE_MIN) this._addLog("vote", "Городу не хватило голосов. Никто не повешен.", { tone: "warn" });
      else this._addLog("vote", "Город не смог договориться. Никто не повешен.", { tone: "warn" });
      this.lastWordsPlayerId = null;
      if (this._checkVictory(now)) return;
      this._setPhase(PHASE.VERDICT, 5, "verdict", now);
    }
  }

  // -----------------------------------------------------------------------
  // Victory
  // -----------------------------------------------------------------------

  _checkVictory(now = this.clock()) {
    if (this.phase === PHASE.ENDED) return true;
    const alive = this.alivePlayers;
    const mafia = alive.filter((player) => player.team === "mafia").length;
    const others = alive.filter((player) => player.team !== "mafia").length;

    if (mafia === 0 && others === 0) {
      this.endGame("none", { reason: "empty" });
      return true;
    }
    if (mafia === 0) {
      this.endGame("town", { reason: "mafia-eliminated" });
      return true;
    }
    if (others === 0) {
      this.endGame("mafia", { reason: "last-survivor" });
      return true;
    }
    if (mafia >= others) {
      this.endGame("mafia", { reason: "parity" });
      return true;
    }
    return false;
  }

  endGame(team, meta = {}) {
    if (this.phase === PHASE.ENDED) return;
    const now = this.clock();
    const winnerIds =
      team === "neutral"
        ? [meta.playerId].filter(Boolean)
        : this.players.filter((player) => player.team === team).map((player) => player.id);

    const titles = {
      town: "Город победил",
      mafia: "Мафия победила",
      neutral: "Шут победил",
      none: "Никто не победил",
    };
    const subtitles = {
      town: "Улицы снова принадлежат людям. На этот раз.",
      mafia: "Город затих. Навсегда.",
      neutral: "Город повесил того, кто этого и хотел.",
      none: "Все ушли в ночь. История осталась без героя.",
    };

    this.winner = {
      team,
      teamName: TEAMS[team]?.name ?? "Никто",
      title: titles[team] ?? "Игра окончена",
      subtitle: subtitles[team] ?? "",
      reason: meta.reason ?? "",
      roleId: meta.roleId ?? null,
      playerId: meta.playerId ?? null,
      winnerIds,
      endedAt: now,
      mvpId: null,
    };
    this.winner.mvpId = this._computeMvp(winnerIds, team, meta.playerId);
    this.phase = PHASE.ENDED;
    this.phaseSerial += 1;
    this.phaseEndsAt = 0;
    this.phaseDurationMs = 0;
    this.endedAt = now;
    this._started = true;
    this._addLog("end", `${this.winner.title}.`, { tone: team === "mafia" ? "danger" : team === "neutral" ? "neutral" : "town" });
    this.winner.summary = this._resultSummary();
    this._changed("end");
    this.events.emit("ended", this.winner);
  }

  _computeMvp(winnerIds, team, jesterId) {
    let bestId = null;
    let bestScore = -Infinity;
    for (const player of this.players) {
      let score = 0;
      if (winnerIds.includes(player.id)) score += 3;
      if (player.alive) score += 2;
      if (player.team === "town") score += player.stats.correctVotes * 1.2;
      if (player.team === "mafia") {
        if (team === "mafia") score += 2;
        if (player.roleId === "assassin" && player.contractUsed) score += 2;
      }
      if (player.roleId === "sheriff") score += player.investigations.length * 0.4;
      if (player.roleId === "jester" && team === "neutral" && player.id === jesterId) score += 12;
      score += Math.min(2, player.stats.messages * 0.04);
      score += player.death ? 0 : 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestId = player.id;
      }
    }
    return bestId;
  }

  _resultSummary() {
    const lines = [
      `MAFIA — ${this.winner.title}`,
      `Комната ${this.roomCode} · ${this.players.length} игроков · ${this.day} дн.`,
      "",
    ];
    for (const player of [...this.players].sort((a, b) => a.seat - b.seat)) {
      const role = ROLES[player.roleId]?.name ?? "?";
      const alive = player.alive ? "жив" : "мёртв";
      lines.push(`${player.name} — ${role} (${alive})`);
    }
    return lines.join("\n").slice(0, 1800);
  }

  // -----------------------------------------------------------------------
  // Chat
  // -----------------------------------------------------------------------

  addChat(playerId, text, meta = {}) {
    const now = this.clock();
    const player = this.playerMap.get(playerId);
    if (!player) return { ok: false, error: "Игрок не найден." };
    if (player.muted) return { ok: false, error: "Вы заглушены хостом." };

    const quickId = typeof meta.quickId === "string" ? meta.quickId : null;
    const quick = quickId ? getQuickMessage(quickId) : null;
    if (quickId && !quick) return { ok: false, error: "Неизвестная быстрая фраза." };

    let targetId = meta.targetId ?? null;
    const resolved = this._resolveChannel(player, meta.channel ?? "public");
    if (!resolved.ok) return resolved;
    const channel = resolved.channel;

    if (quick?.needsTarget) {
      const target = targetId ? this.playerMap.get(targetId) : null;
      if (!target) return { ok: false, error: "Выберите игрока для этой фразы." };
      if (target.id === player.id) return { ok: false, error: "Нельзя адресовать фразу себе." };
      if (channel !== "dead" && !target.alive) return { ok: false, error: "Выберите живого игрока." };
      targetId = target.id;
    } else if (targetId) {
      const target = this.playerMap.get(targetId);
      targetId = target?.id ?? null;
    }

    if (this.phase === PHASE.LAST_WORDS) {
      if (channel === "public") {
        if (player.id !== this.lastWordsPlayerId) return { ok: false, error: "Сейчас говорит только повешенный." };
        if (this.lastWordsSpoken) return { ok: false, error: "Последнее слово уже сказано." };
      }
    }

    const canonical = quick ? quick.text : sanitizeChat(text);
    if (!canonical) return { ok: false, error: "Пустое сообщение." };
    if (canonical.length > 160) return { ok: false, error: "Слишком длинное сообщение." };

    if (!player.isBot) {
      const gap = quick ? CHAT_QUICK_GAP_MS : CHAT_MIN_GAP_MS;
      if (now - player._lastChatAt < gap) {
        return {
          ok: false,
          error: "Не так быстро — дайте прочитать.",
          retryAfter: gap - (now - player._lastChatAt),
        };
      }
      const recent = (player._recentChats ?? []).filter((at) => now - at < CHAT_WINDOW_MS);
      if (recent.length >= CHAT_WINDOW_MAX) {
        const wait = Math.max(250, CHAT_WINDOW_MS - (now - recent[0]));
        return {
          ok: false,
          error: `Слишком много сообщений подряд. Подождите ${Math.ceil(wait / 1000)} с.`,
          retryAfter: wait,
        };
      }
      player._lastChatAt = now;
      player._recentChats = [...recent, now];
    }

    const message = {
      id: `m_${++this.chatSeq}`,
      seq: this.chatSeq,
      at: now,
      day: this.day,
      phase: this.phase,
      playerId: player.id,
      name: player.name,
      color: player.color,
      channel,
      text: canonical,
      quickId: quick?.id ?? null,
      intent: quick?.intent ?? (typeof meta.intent === "string" ? meta.intent.slice(0, 30) : null),
      targetId,
      roleId: this.phase === PHASE.ENDED ? player.roleId : null,
    };
    if (this.phase === PHASE.LAST_WORDS && channel === "public") {
      this.lastWordsSpoken = true;
    }
    player.stats.messages += 1;
    this.chat.push(message);
    if (this.chat.length > 400) this.chat.splice(0, this.chat.length - 400);
    this.events.emit("chat", message);
    return { ok: true, message };
  }

  addBotChat(playerId, text, meta = {}) {
    const player = this.playerMap.get(playerId);
    if (!player?.isBot) return { ok: false, error: "Не бот." };
    return this.addChat(playerId, text, meta);
  }

  _resolveChannel(player, requested) {
    let channel = requested;
    if (channel === "mafia") {
      if (player.team !== "mafia") return { ok: false, error: "Это закрытый чат мафии." };
      if (!player.alive) return { ok: false, error: "Мёртвые не пишут в чат мафии." };
      if (this.phase !== PHASE.NIGHT) return { ok: false, error: "Мафия говорит только ночью." };
      return { ok: true, channel: "mafia" };
    }
    if (channel === "dead") {
      if (player.alive) return { ok: false, error: "Чат мёртвых доступен только мёртвым." };
      return { ok: true, channel: "dead" };
    }
    if (channel !== "public") return { ok: false, error: "Неизвестный канал." };
    if (!player.alive) {
      if (this.phase === PHASE.LAST_WORDS && player.id === this.lastWordsPlayerId) {
        return { ok: true, channel: "public" };
      }
      return { ok: false, error: "Мёртвые читают общий чат, но пишут только в «Мёртвые»." };
    }
    if (this.phase === PHASE.NIGHT) return { ok: false, error: "Ночью город спит." };
    if (!PUBLIC_CHAT_PHASES.has(this.phase)) return { ok: false, error: "Сейчас нельзя писать в общий чат." };
    return { ok: true, channel: "public" };
  }

  _canSeeChat(message, viewer, spectator) {
    if (message.channel === "public") return true;
    if (message.channel === "dead") return spectator || Boolean(viewer && !viewer.alive);
    if (message.channel === "mafia") {
      if (spectator) return true;
      // The dead watch the living: they keep the mafia feed as a ghost, but
      // still cannot write to it.
      if (viewer && !viewer.alive) return true;
      return Boolean(viewer && viewer.alive && viewer.team === "mafia");
    }
    return false;
  }

  canSeeChat(message, viewerId) {
    const viewer = this.playerMap.get(viewerId) ?? null;
    return this._canSeeChat(message, viewer, !viewer);
  }

  // -----------------------------------------------------------------------
  // Notes & log
  // -----------------------------------------------------------------------

  _addNote(player, text, tone = "muted") {
    player.notes.push({ at: this.clock(), day: this.day, text: String(text).slice(0, 180), tone });
    if (player.notes.length > 24) player.notes.splice(0, player.notes.length - 24);
  }

  _addLog(type, text, { tone = "muted", playerId = null } = {}) {
    this.log.push({
      id: `l_${++this.logSeq}`,
      at: this.clock(),
      day: this.day,
      phase: this.phase,
      type,
      text: String(text).slice(0, 220),
      tone,
      playerId,
    });
    if (this.log.length > 160) this.log.splice(0, this.log.length - 160);
  }

  // -----------------------------------------------------------------------
  // Death
  // -----------------------------------------------------------------------

  _killPlayer(playerId, phase, { cause = "unknown", byId = null } = {}) {
    const player = this.playerMap.get(playerId);
    if (!player?.alive) return false;
    player.alive = false;
    player.death = {
      day: this.day,
      phase,
      cause,
      byId,
      at: this.clock(),
    };
    return true;
  }

  // -----------------------------------------------------------------------
  // Rematch / teardown
  // -----------------------------------------------------------------------

  /** Reset to lobby preserving players; used by the "Ещё раз" button. */
  resetToLobby() {
    const now = this.clock();
    this.phase = PHASE.LOBBY;
    this.phaseSerial += 1;
    this.phaseStartedAt = now;
    this.phaseEndsAt = 0;
    this.phaseDurationMs = 0;
    this.day = 0;
    this.startedAt = 0;
    this.endedAt = 0;
    this._started = false;
    this.setup = null;
    this.winner = null;
    this.voteResult = null;
    this.lastNight = null;
    this.lastWordsPlayerId = null;
    this.lastWordsSpoken = false;
    this.night = null;
    this.votes.clear();
    this.chat = [];
    this.chatSeq = 0;
    this.log = [];
    this.logSeq = 0;
    this.version = 0;
    for (const player of this.players) {
      player.alive = true;
      player.death = null;
      player.roleId = null;
      player.team = null;
      player.notes = [];
      player.investigations = [];
      player.lastHealTarget = null;
      player.selfHeals = 0;
      player.contractUsed = false;
      player.ready = player.isBot || player.isHost;
      player._lastChatAt = 0;
      player._recentChats = [];
      player.stats = {
        votesCast: 0,
        votesReceived: 0,
        correctVotes: 0,
        messages: 0,
        nightActions: 0,
      };
    }
    this._addLog("lobby", "Возвращение в лобби.", { tone: "muted" });
    this._changed("reset");
  }

  destroy() {
    this.events.clear();
  }

  // -----------------------------------------------------------------------
  // Views
  // -----------------------------------------------------------------------

  getPublicLobby() {
    const host = this.playerMap.get(this.hostId);
    return {
      code: this.roomCode,
      name: this.config.name,
      hostId: this.hostId,
      hostName: host?.name ?? "",
      players: this.players.length,
      humans: this.players.filter((player) => !player.isBot).length,
      bots: this.players.filter((player) => player.isBot).length,
      maxPlayers: this.config.maxPlayers,
      minStart: this.config.minStart,
      status: this.phase === PHASE.LOBBY ? "lobby" : this.phase === PHASE.ENDED ? "ended" : "playing",
      public: this.config.public,
      quick: this.config.quick,
      createdAt: this.createdAt,
      updatedAt: this.clock(),
    };
  }

  getView(viewerId, { withChat = true } = {}) {
    const viewer = this.playerMap.get(viewerId) ?? null;
    const spectator = !viewer;
    const ended = this.phase === PHASE.ENDED;
    const revealAll = ended || spectator;
    const mafiaViewer = Boolean(viewer && viewer.team === "mafia");
    const now = this.clock();

    const players = this.players.map((player) => {
      const showRole =
        revealAll ||
        player.id === viewer?.id ||
        (mafiaViewer && player.team === "mafia") ||
        Boolean(this.config.revealOnDeath && !player.alive);
      return {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        color: player.color,
        isBot: player.isBot,
        botId: player.botId,
        isHost: player.id === this.hostId,
        seat: player.seat,
        alive: player.alive,
        connected: player.connected,
        ready: player.ready,
        muted: player.muted,
        roleId: showRole ? player.roleId : null,
        team: showRole ? player.team : null,
        death: player.death,
        voted: this.votes.has(player.id),
        isViewer: player.id === viewerId,
        stats: ended ? player.stats : undefined,
      };
    });

    const alive = this.players.filter((player) => player.alive);
    const myRole = viewer?.roleId ? ROLES[viewer.roleId] : null;
    const canAct = this.phase === PHASE.NIGHT && Boolean(viewer?.alive);

    let night = null;
    if (this.phase === PHASE.NIGHT && this.night) {
      const action = viewer?.alive ? this._remainingNightActionFor(viewer.roleId, viewer.id) : null;
      night = {
        action,
        canAct,
        contract: {
          available:
            viewer?.roleId === "assassin" &&
            viewer.alive &&
            this.day >= 2 &&
            !viewer.contractUsed,
          used: Boolean(viewer?.contractUsed),
          selected:
            viewer && this.night.contract?.byId === viewer.id
              ? this.night.contract.targetId
              : null,
        },
        mafia: mafiaViewer
          ? {
              teammates: this.players
                .filter((player) => player.team === "mafia")
                .map((player) => ({
                  id: player.id,
                  name: player.name,
                  roleId: player.roleId,
                  alive: player.alive,
                })),
              killVote: this.night.killVotes.get(viewer.id) ?? null,
              killVotes: [...this.night.killVotes.entries()].map(([voterId, targetId]) => ({
                voterId,
                targetId,
              })),
            }
          : null,
      };
    }

    const revealedVotes = this.phase === PHASE.VOTING ? null : this.voteResult;
    const chatMessages = this.chat.filter((message) => this._canSeeChat(message, viewer, spectator));
    const chat = withChat ? chatMessages.slice(-120) : undefined;
    const chatTail = chatMessages.slice(-8).map((message) => ({
      id: message.id,
      seq: message.seq,
    }));

    const chatChannels = [];
    const chatWriteChannels = [];
    if (viewer) {
      if (this.phase === PHASE.LAST_WORDS) {
        chatChannels.push("public");
        if (!viewer.alive) chatChannels.push("mafia", "dead");
        if (viewer.id === this.lastWordsPlayerId && !this.lastWordsSpoken) chatWriteChannels.push("public");
        else if (!viewer.alive) chatWriteChannels.push("dead");
      } else if (!viewer.alive) {
        // The dead keep watching the living — public and mafia feeds — but
        // their only microphone is the dead room.
        chatChannels.push("public", "mafia", "dead");
        chatWriteChannels.push("dead");
      } else if (this.phase === PHASE.NIGHT) {
        if (viewer.team === "mafia") {
          chatChannels.push("mafia");
          chatWriteChannels.push("mafia");
        }
      } else if (PUBLIC_CHAT_PHASES.has(this.phase)) {
        chatChannels.push("public");
        chatWriteChannels.push("public");
      }
    }
    const recentChats = (viewer?._recentChats ?? []).filter((at) => now - at < CHAT_WINDOW_MS);

    return {
      v: 2,
      roomCode: this.roomCode,
      hostId: this.hostId,
      selfId: viewerId,
      isHost: viewerId === this.hostId,
      spectator,
      phase: this.phase,
      phaseSerial: this.phaseSerial,
      phaseStartedAt: this.phaseStartedAt,
      phaseEndsAt: this.phaseEndsAt,
      phaseDurationMs: this.phaseDurationMs,
      day: this.day,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      now,
      version: this.version,
      config: {
        name: this.config.name,
        maxPlayers: this.config.maxPlayers,
        minStart: this.config.minStart,
        public: this.config.public,
        quick: this.config.quick,
        roles: { ...this.config.roles },
        timers: { ...this.config.timers },
        botChat: this.config.botChat,
        revealOnDeath: this.config.revealOnDeath,
        allowSpectators: this.config.allowSpectators,
      },
      setup: this.setup
        ? { counts: { ...this.setup.counts }, warnings: [...this.setup.warnings], mafiaTeam: this.setup.mafiaTeam }
        : null,
      players,
      self: viewer
        ? {
            id: viewer.id,
            roleId: viewer.roleId,
            team: viewer.team,
            roleName: myRole?.name ?? null,
            alive: viewer.alive,
            ready: viewer.ready,
            muted: viewer.muted,
            isBot: viewer.isBot,
            notes: viewer.notes.slice(-12),
            investigations: viewer.investigations.slice(-8),
            contractUsed: viewer.contractUsed,
            selfHeals: viewer.selfHeals,
            lastHealTarget: viewer.lastHealTarget,
            canChat: chatWriteChannels.length > 0,
            chatChannels,
            chatWriteChannels,
            chatCount: recentChats.length,
            chatLimit: CHAT_WINDOW_MAX,
            chatWindowMs: CHAT_WINDOW_MS,
            lastChatAt: viewer._lastChatAt,
          }
        : {
            spectator: true,
            canChat: false,
            chatChannels: [],
            chatWriteChannels: [],
          },
      lobby: {
        canStart: this.canStart(),
        ready: viewer?.ready ?? false,
        humans: this.players.filter((player) => !player.isBot).length,
        bots: this.players.filter((player) => player.isBot).length,
      },
      night,
      votes: {
        myVote: viewer ? this.votes.get(viewer.id) ?? null : null,
        votedIds: [...this.votes.keys()],
        totalAlive: alive.length,
        allVoted: this.votes.size >= alive.length,
        revealed: revealedVotes,
      },
      lastNight: this.lastNight,
      lastWords: this.lastWordsPlayerId
        ? {
            playerId: this.lastWordsPlayerId,
            name: this.playerMap.get(this.lastWordsPlayerId)?.name ?? "",
            spoken: this.lastWordsSpoken,
            canSpeak: viewerId === this.lastWordsPlayerId,
          }
        : null,
      log: this.log.slice(-70),
      chat,
      chatTail,
      winner: this.winner,
    };
  }
}

export function roomStatusLabel(status) {
  if (status === "lobby") return "Лобби";
  if (status === "playing") return "Идёт игра";
  if (status === "ended") return "Завершена";
  return "—";
}
