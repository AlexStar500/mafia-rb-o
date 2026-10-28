import { Emitter } from "../core/events.js";
import { pickOne, randomInt, shuffle } from "../core/random.js";
import { clampInt, isValidPlayerId, sanitizeChat, sanitizeNick } from "../core/security.js";
import { getQuickMessage, quickText } from "../data/quickChat.js";
import {
  ROLES,
  TEAMS,
  computeRoleSetup,
  hidesMafiaRoster,
  isMafiaCoreRole,
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

const DAY_ACTION_PHASES = new Set([PHASE.DAWN, PHASE.DISCUSSION, PHASE.VOTING]);
const DRUNK_ALPHABET = "@#$%^&*!?~";

function teamOfRole(roleId) {
  return ROLES[roleId]?.team ?? "town";
}

/** A drunk tongue only produces meaningless symbols, with a random length. */
function drunkText(length, rng = Math.random) {
  const source = Math.max(4, Math.min(160, Math.round(Number(length) || 12)));
  const size = Math.max(5, Math.min(48, Math.round(source * (0.65 + rng() * 0.9))));
  let text = "";
  for (let i = 0; i < size; i += 1) {
    text += DRUNK_ALPHABET[Math.floor(rng() * DRUNK_ALPHABET.length)] ?? "#";
  }
  return text;
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
      judgeUsed: false,
      spyRevealDay: -1,
      drunkDay: -1,
      blockedDay: -1,
      puppetTargetId: null,
      puppetChosenDay: -1,
      reveals: [],
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
    this.setup = computeRoleSetup(this.players.length, this.config.roles, this.config.mode);
    const roles = shuffle(this.setup.ids, this.rng);

    for (const player of this.players) {
      player.roleId = roles.pop() ?? "civilian";
      player.team = teamOfRole(player.roleId);
      player.originalRoleId = player.roleId;
      player.originalTeam = player.team;
      player.originalMafia = player.team === "mafia";
      player.zombie = false;
      player.cures = 0;
      player.alive = true;
      player.death = null;
      player.ready = true;
      player.connected = true;
      player.notes = [];
      player.investigations = [];
      player.lastHealTarget = null;
      player.selfHeals = 0;
      player.contractUsed = false;
      player.judgeUsed = false;
      player.spyRevealDay = -1;
      player.drunkDay = -1;
      player.blockedDay = -1;
      player.puppetTargetId = null;
      player.puppetChosenDay = -1;
      player.reveals = [];
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
      doctors: new Map(),
      checks: new Map(),
      contracts: new Map(),
      drinks: new Map(),
      blocks: new Map(),
      puppets: new Map(),
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
        if (action !== "heal" && target.id === player.id) return false;
        if (action === "kill" || action === "contract") {
          // In the secret mode the family does not know itself, so a mafia
          // bullet may land on another mafia.
          return this.config.mode === "secret" || target.team !== "mafia";
        }
        if (action === "check") return target.id !== player.id;
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
    const night = this.night;
    if (!night) return { ok: false, error: "Сейчас не ночь." };

    if (action === "kill") {
      if (!isMafiaCoreRole(roleId)) return { ok: false, error: "Только мафия выбирает жертву." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.team === "mafia" && this.config.mode !== "secret") {
        return { ok: false, error: "Нельзя убивать своих." };
      }
      night.killVotes.set(playerId, target.id);
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
      night.doctors.set(playerId, target.id);
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    if (action === "check") {
      if (roleId !== "sheriff") return { ok: false, error: "Только шериф проверяет." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.id === player.id) return { ok: false, error: "Нельзя проверить себя." };
      night.checks.set(playerId, target.id);
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    if (action === "contract") {
      if (roleId !== "assassin") return { ok: false, error: "Только ассасин подписывает контракт." };
      if (this.day < 2) return { ok: false, error: "Контракт доступен со 2-й ночи." };
      if (player.contractUsed) return { ok: false, error: "Контракт уже использован." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.team === "mafia" && this.config.mode !== "secret") {
        return { ok: false, error: "Нельзя подписать контракт на своего." };
      }
      night.contracts.set(playerId, target.id);
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    if (action === "drink") {
      if (roleId !== "bartender") return { ok: false, error: "Только бармен поит гостей." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.id === player.id) return { ok: false, error: "Себе наливать нельзя." };
      night.drinks.set(playerId, target.id);
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    if (action === "block") {
      if (roleId !== "musician") return { ok: false, error: "Только музыкант блокирует." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.id === player.id) return { ok: false, error: "Себя блокировать нельзя." };
      night.blocks.set(playerId, target.id);
      player.stats.nightActions += 1;
      this._changed("night-action");
      return { ok: true };
    }

    if (action === "puppet") {
      if (roleId !== "puppeteer") return { ok: false, error: "Только кукловод выбирает марионетку." };
      if (player.puppetTargetId) return { ok: false, error: "Марионетка уже выбрана." };
      if (!target || !target.alive) return { ok: false, error: "Выберите живого игрока." };
      if (target.id === player.id) return { ok: false, error: "Нельзя выбрать себя." };
      night.puppets.set(playerId, target.id);
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
    if (isMafiaCoreRole(roleId)) {
      return {
        type: "kill",
        selected: night.killVotes.get(playerId) ?? null,
        options: this._nightTargetsFor(player, "kill"),
      };
    }
    if (roleId === "doctor") {
      return {
        type: "heal",
        selected: night.doctors.get(playerId) ?? null,
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
        selected: night.checks.get(playerId) ?? null,
        options: this._nightTargetsFor(player, "check"),
      };
    }
    if (roleId === "bartender") {
      return {
        type: "drink",
        selected: night.drinks.get(playerId) ?? null,
        options: this._nightTargetsFor(player, "drink"),
      };
    }
    if (roleId === "musician") {
      return {
        type: "block",
        selected: night.blocks.get(playerId) ?? null,
        options: this._nightTargetsFor(player, "block"),
      };
    }
    if (roleId === "puppeteer") {
      return {
        type: "puppet",
        selected: night.puppets.get(playerId) ?? null,
        options: player.puppetTargetId ? [] : this._nightTargetsFor(player, "puppet"),
        chosenTargetId: player.puppetTargetId,
      };
    }
    return null;
  }

  _resolveNight(now) {
    if (!this.night || this.night.resolved) return;
    this.night.resolved = true;
    const night = this.night;

    // Musician blocks apply to every other action and to the coming day.
    const blockedIds = new Set();
    for (const [musicianId, targetId] of night.blocks) {
      const musician = this.playerMap.get(musicianId);
      if (musician?.alive && musician.roleId === "musician") blockedIds.add(targetId);
    }
    for (const id of blockedIds) {
      const player = this.playerMap.get(id);
      if (!player?.alive) continue;
      player.blockedDay = this.day;
      this._addNote(player, "Музыкант играл всю ночь. Сегодня вы не голосуете и не действуете.", "warn");
    }

    const killVotes = [...night.killVotes.entries()].filter(([voterId]) => {
      const voter = this.playerMap.get(voterId);
      return voter?.alive && isMafiaCoreRole(voter.roleId) && !blockedIds.has(voterId);
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

    // Doctors may heal several targets at once when the city has several docs.
    const healedTargets = new Set();
    const healActions = [];
    for (const [doctorId, healedId] of night.doctors) {
      const doctor = this.playerMap.get(doctorId);
      if (!doctor?.alive || doctor.roleId !== "doctor" || blockedIds.has(doctorId)) continue;
      const healedPlayer = this.playerMap.get(healedId);
      if (!healedPlayer?.alive) continue;
      doctor.lastHealTarget = healedId;
      if (healedId === doctor.id) doctor.selfHeals += 1;
      healedTargets.add(healedId);
      healActions.push({ doctor, healedPlayer });
    }

    for (const [sheriffId, checkedId] of night.checks) {
      const sheriff = this.playerMap.get(sheriffId);
      if (!sheriff?.alive || sheriff.roleId !== "sheriff" || blockedIds.has(sheriffId)) continue;
      const checked = this.playerMap.get(checkedId);
      if (!checked?.alive) continue;
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

    const contractTargets = new Set();
    const contractAssassins = [];
    for (const [assassinId, victimId] of night.contracts) {
      const assassin = this.playerMap.get(assassinId);
      const victim = this.playerMap.get(victimId);
      if (!assassin?.alive || assassin.roleId !== "assassin" || blockedIds.has(assassinId)) continue;
      if (assassin.contractUsed || this.day < 2 || !victim?.alive) continue;
      assassin.contractUsed = true;
      contractTargets.add(victimId);
      contractAssassins.push(assassin);
      this._addNote(assassin, `Контракт выполнен: ${victim.name}.`, "danger");
    }

    for (const [bartenderId, guestId] of night.drinks) {
      const bartender = this.playerMap.get(bartenderId);
      const guest = this.playerMap.get(guestId);
      if (!bartender?.alive || bartender.roleId !== "bartender" || blockedIds.has(bartenderId)) continue;
      if (!guest?.alive) continue;
      guest.drunkDay = this.day;
      this._addNote(bartender, `${guest.name} напился. Завтра его слова не разобрать.`, "gold");
    }

    for (const [puppeteerId, puppetId] of night.puppets) {
      const puppeteer = this.playerMap.get(puppeteerId);
      const puppet = this.playerMap.get(puppetId);
      if (!puppeteer?.alive || puppeteer.roleId !== "puppeteer" || blockedIds.has(puppeteerId)) continue;
      if (!puppet?.alive || puppeteer.puppetTargetId) continue;
      puppeteer.puppetTargetId = puppetId;
      puppeteer.puppetChosenDay = this.day;
      this._addNote(puppeteer, `Марионетка выбрана: ${puppet.name}. Её роль вы узнаете завтра.`, "neutral");
    }

    const killed = new Set();
    const deaths = [];
    const killOne = (id, cause) => {
      if (!id || killed.has(id)) return;
      const result = this._killWithTwin(id, "night", { cause });
      for (const death of result) {
        if (killed.has(death.id)) continue;
        killed.add(death.id);
        deaths.push(death);
      }
    };

    const converted = [];
    if (this.config.mode === "zombie") {
      // Night kills do not kill: they turn the victim into a zombie.
      if (targetId && !healedTargets.has(targetId) && !this._isJesterShowdown()) {
        const victim = this.playerMap.get(targetId);
        if (victim?.alive && victim.team !== "mafia") {
          this._convertToZombie(victim);
          converted.push(victim);
        }
      }
    } else if (targetId && !healedTargets.has(targetId) && !this._isJesterShowdown()) {
      killOne(targetId, "mafia");
    }
    for (const id of contractTargets) killOne(id, "assassin");

    // A puppeteer who never picks a puppet within two nights fades away.
    if (this.day >= 2) {
      for (const puppeteer of this.players) {
        if (!puppeteer.alive || puppeteer.roleId !== "puppeteer") continue;
        if (puppeteer.puppetTargetId || blockedIds.has(puppeteer.id)) continue;
        this._addLog("night", `${puppeteer.name} так и не выбрал марионетку и исчез.`, {
          tone: "neutral",
          playerId: puppeteer.id,
        });
        killOne(puppeteer.id, "puppeteer");
      }
    }

    // Doctor feedback is written after the kills are known.
    for (const { doctor, healedPlayer } of healActions) {
      if (contractTargets.has(healedPlayer.id)) {
        this._addNote(doctor, `${healedPlayer.name} погиб: контракт ассасина сильнее лечения.`, "danger");
      } else if (targetId === healedPlayer.id) {
        this._addNote(
          doctor,
          this.config.mode === "zombie"
            ? `Вы защитили ${healedPlayer.name} от обращения.`
            : `Вы спасли ${healedPlayer.name} от мафии.`,
          "town",
        );
      } else {
        this._addNote(doctor, `${healedPlayer.name} этой ночью не нуждался в помощи.`, "muted");
      }
    }

    if (this.config.mode === "zombie") {
      // Names never surface: the city only learns that something changed.
      this._addLog("night", "Ночь прошла. Город не знает, кто вернулся изменённым.", { tone: "night" });
    } else if (deaths.length === 0) {
      this._addLog("night", "Ночь прошла без жертв.", { tone: "town" });
    } else {
      const names = deaths.map((death) => death.name).join(", ");
      this._addLog("night", `Ночью погибли: ${names}.`, { tone: "danger" });
    }

    const mafiaIds = this.players.filter((p) => p.alive && isMafiaCoreRole(p.roleId)).map((p) => p.id);
    if (mafiaIds.length && this.config.mode === "zombie") {
      const names = converted.map((player) => player.name).join(", ");
      for (const id of mafiaIds) {
        const mafiaPlayer = this.playerMap.get(id);
        if (!mafiaPlayer) continue;
        if (names) this._addNote(mafiaPlayer, `Обращены в зомби: ${names}.`, "danger");
        else this._addNote(mafiaPlayer, "Этой ночью никто не обратился.", "muted");
      }
    } else if (mafiaIds.length && deaths.length) {
      for (const id of mafiaIds) {
        const mafiaPlayer = this.playerMap.get(id);
        if (mafiaPlayer) this._addNote(mafiaPlayer, `Устранён: ${deaths.map((death) => death.name).join(", ")}.`, "danger");
      }
    } else if (mafiaIds.length) {
      for (const id of mafiaIds) {
        const mafiaPlayer = this.playerMap.get(id);
        if (mafiaPlayer) this._addNote(mafiaPlayer, "Этой ночью никто не погиб.", "muted");
      }
    }

    this.lastNight = {
      day: this.day,
      deaths: this.config.mode === "zombie" ? [] : deaths,
      converted: this.config.mode === "zombie" ? converted.length : 0,
      zombie: this.config.mode === "zombie",
      saved: Boolean(targetId && healedTargets.has(targetId) && !contractTargets.has(targetId)),
      blocked: [...blockedIds],
      drunk: [...night.drinks.values()],
      at: now,
    };

    if (this._checkVictory(now)) return;
    this._setPhase(PHASE.DAWN, PHASE_DURATIONS.dawn, "dawn", now);
    this._addLog("phase", `День ${this.day}. Город просыпается.`, { tone: "gold" });
  }

  /**
   * Judge / spy / any daytime ability. Canonical targets are resolved on the
   * host, so a guest can never invent a role or a verdict.
   */
  setDayAction(playerId, action, targetId) {
    if (!DAY_ACTION_PHASES.has(this.phase)) return { ok: false, error: "Сейчас нельзя действовать днём." };
    const player = this.playerMap.get(playerId);
    if (!player?.alive) return { ok: false, error: "Мёртвые не действуют." };
    if (player.muted) return { ok: false, error: "Вы заглушены." };
    if (player.blockedDay === this.day) return { ok: false, error: "Музыкант не даёт вам действовать сегодня." };
    const target = targetId ? this.playerMap.get(targetId) : null;

    if (action === "reveal") {
      if (player.roleId !== "spy") return { ok: false, error: "Только шпион узнаёт роли." };
      if (player.spyRevealDay === this.day) return { ok: false, error: "Сегодня вы уже узнали роль." };
      if (!target?.alive || target.id === player.id) return { ok: false, error: "Выберите другого живого игрока." };
      const role = ROLES[target.roleId];
      if (!role) return { ok: false, error: "Роль цели неизвестна." };
      player.spyRevealDay = this.day;
      const reveal = {
        targetId: target.id,
        name: target.name,
        roleId: target.roleId,
        roleName: role.name,
        team: target.team,
        day: this.day,
      };
      player.reveals.push(reveal);
      if (player.reveals.length > 12) player.reveals.splice(0, player.reveals.length - 12);
      this._addNote(player, `Шпионаж: ${target.name} — ${role.name}.`, "gold");
      this._changed("day-action");
      return { ok: true, reveal };
    }

    if (action === "cure") {
      if (this.config.mode !== "zombie") return { ok: false, error: "Лечение зомби доступно только в режиме «Зомби»." };
      if (player.roleId !== "doctor") return { ok: false, error: "Только доктор лечит зомби." };
      if (player.cures >= 3) return { ok: false, error: "Доктор уже истратил три дневных лечения." };
      if (!target?.alive || !target.zombie) return { ok: false, error: "Выберите живого зомби." };
      player.cures += 1;
      this._cureZombie(player, target);
      this._addLog(
        "day",
        `Доктор ${player.name} вернул ${target.name} к жизни. Зомби больше нет.`,
        { tone: "town", playerId: target.id },
      );
      this._changed("day-action");
      const ended = this._checkVictory(this.clock());
      return { ok: true, cured: true, targetId: target.id, ended };
    }

    if (action === "judge") {
      if (player.roleId !== "judge") return { ok: false, error: "Только судья выносит приговор." };
      if (player.judgeUsed) return { ok: false, error: "Приговор уже вынесен." };
      if (!target?.alive || target.id === player.id) return { ok: false, error: "Выберите другого живого игрока." };
      player.judgeUsed = true;
      const targetIsMafia = target.team === "mafia";
      const victim = targetIsMafia ? target : player;
      const deaths = this._killWithTwin(victim.id, "day", { cause: "judge", byId: player.id });
      this._addLog(
        "day",
        targetIsMafia
          ? `Судья вынес приговор: ${target.name} — мафия. Приговор исполнен.`
          : `Судья ошибся: ${target.name} не мафия. Судья ${player.name} погиб.`,
        { tone: targetIsMafia ? "town" : "danger", playerId: victim.id },
      );
      this._changed("day-action");
      const ended = this._checkVictory(this.clock());
      return {
        ok: true,
        hit: targetIsMafia,
        victimId: victim.id,
        deaths: deaths.map((death) => death.id),
        ended,
      };
    }

    return { ok: false, error: "Неизвестное дневное действие." };
  }

  // -----------------------------------------------------------------------
  // Day / voting
  // -----------------------------------------------------------------------

  castVote(playerId, targetId) {
    if (this.phase !== PHASE.VOTING) return { ok: false, error: "Сейчас не голосование." };
    const player = this.playerMap.get(playerId);
    if (!player?.alive) return { ok: false, error: "Мёртвые не голосуют." };
    if (player.blockedDay === this.day) {
      return { ok: false, error: "Музыкант не даёт вам голосовать сегодня." };
    }
    if (player.drunkDay === this.day) {
      return { ok: false, error: "Вы слишком пьяны, чтобы голосовать." };
    }
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
    if (this._isJesterShowdown()) {
      const jester = this.alivePlayers.find((player) => player.roleId === "jester");
      const mafia = this.alivePlayers.find((player) => player.team === "mafia");
      const mafiaVote = this.votes.get(mafia.id);
      const jesterVote = this.votes.get(jester.id);
      const mafiaCanVote = mafia.blockedDay !== this.day && mafia.drunkDay !== this.day;
      let team = "mafia";
      let winnerId = mafia.id;
      let reason = "jester-skip";
      if (mafiaVote === jester.id) {
        team = "neutral";
        winnerId = jester.id;
        reason = "jester-voted";
      } else if (jesterVote === mafia.id || !mafiaCanVote) {
        team = "town";
        winnerId = null;
        reason = "jester-hanged-mafia";
      }
      this._addLog(
        "vote",
        reason === "jester-voted"
          ? `Мафия проголосовала против шута. ${jester.name} получает свою петлю.`
          : reason === "jester-hanged-mafia"
            ? `Шут перехитрил мафию: город забирает победу.`
            : `Мафия переждала голосование и добила шута ночью.`,
        { tone: reason === "jester-voted" ? "neutral" : "danger" },
      );
      this.endGame(team, {
        reason,
        ...(team === "neutral" ? { playerId: winnerId, roleId: "jester" } : {}),
      });
      return;
    }
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
      if (eliminated.roleId === "twin") {
        // The surviving twin wins the moment the other is hanged. A judge's
        // verdict is the exception and is resolved before this point.
        const survivor = this.players.find(
          (player) => player.roleId === "twin" && player.id !== eliminatedId && player.alive,
        );
        if (survivor) {
          this._addLog("vote", `Второй близнец, ${survivor.name}, празднует победу.`, { tone: "neutral", playerId: survivor.id });
          this.endGame("neutral", { reason: "twin", playerId: survivor.id, roleId: "twin" });
          return;
        }
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

  /** Final two: one mafia killer and the jester. The vote decides everything. */
  _isJesterShowdown() {
    const alive = this.alivePlayers;
    if (alive.length !== 2) return false;
    const jester = alive.find((player) => player.roleId === "jester");
    const mafia = alive.find((player) => player.team === "mafia");
    return Boolean(jester && mafia);
  }

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
    if (this.config.mode === "zombie") {
      // The city wins only by clearing every zombie; the mafia wins only when
      // the whole living city has turned. Parity alone means nothing.
      if (others === 0) {
        const originals = this.players.filter((player) => player.originalMafia);
        if (!originals.length) {
          this.endGame("none", { reason: "zombie-no-originals" });
        } else {
          this.endGame("mafia", {
            reason: "zombie-apocalypse",
            winnerIds: originals.map((player) => player.id),
          });
        }
        return true;
      }
      return false;
    }
    if (others === 0) {
      this.endGame("mafia", { reason: "last-survivor" });
      return true;
    }
    if (this._isJesterShowdown()) return false;
    if (mafia >= others) {
      this.endGame("mafia", { reason: "parity" });
      return true;
    }
    return false;
  }

  endGame(team, meta = {}) {
    if (this.phase === PHASE.ENDED) return;
    const now = this.clock();
    const baseWinnerIds = Array.isArray(meta.winnerIds)
      ? meta.winnerIds.filter(Boolean)
      : team === "neutral"
        ? [meta.playerId].filter(Boolean)
        : this.players.filter((player) => player.team === team).map((player) => player.id);
    const winnerIds = [...new Set(baseWinnerIds)];

    // A puppeteer wins together with the team (or personal goal) of its puppet.
    const coWinners = [];
    if (team !== "none") {
      for (const player of this.players) {
        if (player.roleId !== "puppeteer" || !player.puppetTargetId) continue;
        if (!winnerIds.includes(player.puppetTargetId)) continue;
        if (winnerIds.includes(player.id)) continue;
        winnerIds.push(player.id);
        const puppet = this.playerMap.get(player.puppetTargetId);
        coWinners.push({
          id: player.id,
          name: player.name,
          roleId: player.roleId,
          targetId: player.puppetTargetId,
          targetName: puppet?.name ?? "",
        });
      }
    }

    const neutralTitle =
      meta.roleId === "jester"
        ? "Шут победил"
        : meta.roleId === "twin"
          ? "Близнец победил"
          : "Нейтрал победил";
    const titles = {
      town: "Город победил",
      mafia: "Мафия победила",
      neutral: neutralTitle,
      none: "Никто не победил",
    };
    const subtitles = {
      town: "Улицы снова принадлежат людям. На этот раз.",
      mafia: "Город затих. Навсегда.",
      neutral:
        meta.roleId === "twin"
          ? "Один близнец ушёл. Второй забрал всё."
          : "Город повесил того, кто этого и хотел.",
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
      coWinners,
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
      if (player.roleId === "spy") score += player.reveals.length * 0.5;
      if (player.roleId === "jester" && team === "neutral" && player.id === jesterId) score += 12;
      if (player.roleId === "twin" && team === "neutral" && player.id === jesterId) score += 12;
      if (player.roleId === "puppeteer" && winnerIds.includes(player.id)) score += 2.5;
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

    let quickRoleId = null;
    if (quick?.needsRole) {
      const roleId = typeof meta.quickRoleId === "string" ? meta.quickRoleId : "";
      if (!ROLES[roleId]) return { ok: false, error: "Выберите роль для этой фразы." };
      quickRoleId = roleId;
    }

    if (this.phase === PHASE.LAST_WORDS) {
      if (channel === "public") {
        if (player.id !== this.lastWordsPlayerId) return { ok: false, error: "Сейчас говорит только повешенный." };
        if (this.lastWordsSpoken) return { ok: false, error: "Последнее слово уже сказано." };
      }
    }

    const canonical = quick
      ? quickText(quick, this.playerMap.get(targetId)?.name, ROLES[quickRoleId]?.name)
      : sanitizeChat(text);
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

    const drunk = player.alive && player.drunkDay === this.day;
    const spoken = drunk ? drunkText(canonical.length, this.rng) : canonical;
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
      text: spoken,
      quickId: drunk ? null : (quick?.id ?? null),
      quickRoleId: drunk ? null : quickRoleId,
      intent: drunk ? "drunk" : (quick?.intent ?? (typeof meta.intent === "string" ? meta.intent.slice(0, 30) : null)),
      targetId: drunk ? null : targetId,
      drunk,
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
      if (this.config.mode === "secret") {
        return { ok: false, error: "В режиме «Тайная Мафия» закрытого чата нет." };
      }
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
    // A player hanged by vote keeps the public room until their last word is
    // spoken. Only then do the dead and mafia feeds open up.
    if (
      viewer &&
      !viewer.alive &&
      this.phase === PHASE.LAST_WORDS &&
      viewer.id === this.lastWordsPlayerId &&
      !this.lastWordsSpoken
    ) {
      return false;
    }
    if (message.channel === "dead") return spectator || Boolean(viewer && !viewer.alive);
    if (message.channel === "mafia") {
      if (this.config.mode === "secret") return spectator;
      if (spectator) return true;
      // The dead watch the living: they keep the mafia feed as a ghost, but
      // still cannot write to it.
      if (viewer && !viewer.alive) return true;
      return Boolean(
        viewer &&
          viewer.alive &&
          viewer.team === "mafia" &&
          !hidesMafiaRoster(viewer.roleId),
      );
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

  /** Zombie mode: the victim survives and joins the mafia. */
  _convertToZombie(player) {
    if (!player?.alive || player.team === "mafia") return false;
    player.originalRoleId = player.originalRoleId ?? player.roleId;
    player.originalTeam = player.originalTeam ?? player.team;
    player.zombie = true;
    player.roleId = "mafia";
    player.team = "mafia";
    this._addNote(player, "Вы стали зомби. Теперь вы играете за мафию.", "danger");
    return true;
  }

  /** Zombie mode: the doctor's daytime cure restores the original role. */
  _cureZombie(doctor, player) {
    if (!player?.alive || !player.zombie) return false;
    player.zombie = false;
    player.roleId = player.originalRoleId ?? "civilian";
    player.team = player.originalTeam ?? teamOfRole(player.roleId);
    player.death = null;
    this._addNote(player, "Доктор вернул вас к жизни. Вы снова за город.", "town");
    return true;
  }

  /**
   * Twins are bound in death: any death except a vote drags the partner along.
   * Returns every body so the night log and the dawn banner can show both.
   */
  _killWithTwin(playerId, phase, options = {}) {
    const first = this.playerMap.get(playerId);
    if (!first?.alive) return [];
    const killed = [];
    if (this._killPlayer(playerId, phase, options)) {
      killed.push({ id: first.id, name: first.name, roleId: first.roleId, cause: options.cause ?? "unknown" });
    }
    if (first.roleId === "twin" && options.cause !== "twin") {
      const partner = this.players.find(
        (player) => player.roleId === "twin" && player.id !== first.id && player.alive,
      );
      if (partner && this._killPlayer(partner.id, phase, { ...options, cause: "twin", byId: first.id })) {
        killed.push({ id: partner.id, name: partner.name, roleId: partner.roleId, cause: "twin" });
      }
    }
    return killed;
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
      player.originalRoleId = null;
      player.originalTeam = null;
      player.originalMafia = false;
      player.zombie = false;
      player.cures = 0;
      player.notes = [];
      player.investigations = [];
      player.lastHealTarget = null;
      player.selfHeals = 0;
      player.contractUsed = false;
      player.judgeUsed = false;
      player.spyRevealDay = -1;
      player.drunkDay = -1;
      player.blockedDay = -1;
      player.puppetTargetId = null;
      player.puppetChosenDay = -1;
      player.reveals = [];
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
    const secretMode = this.config.mode === "secret";
    const mafiaViewer = Boolean(
      viewer &&
        viewer.team === "mafia" &&
        !secretMode &&
        !hidesMafiaRoster(viewer.roleId),
    );
    const now = this.clock();

    const players = this.players.map((player) => {
      const showRole =
        revealAll ||
        player.id === viewer?.id ||
        (mafiaViewer && player.team === "mafia") ||
        Boolean(!secretMode && this.config.revealOnDeath && !player.alive);
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
        zombie: Boolean(
          player.zombie &&
            (showRole || viewer?.roleId === "doctor" || mafiaViewer || spectator),
        ),
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
        blocked: Boolean(viewer && viewer.blockedDay === this.day),
        contract: {
          available:
            viewer?.roleId === "assassin" &&
            viewer.alive &&
            this.day >= 2 &&
            !viewer.contractUsed,
          used: Boolean(viewer?.contractUsed),
          selected: viewer ? this.night.contracts.get(viewer.id) ?? null : null,
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

    const canDayAction = DAY_ACTION_PHASES.has(this.phase) && Boolean(viewer?.alive);
    const dayView = viewer
      ? {
          canAct: canDayAction && viewer.blockedDay !== this.day,
          blocked: viewer.blockedDay === this.day,
          judge: {
            available: viewer.roleId === "judge" && canDayAction && !viewer.judgeUsed && viewer.blockedDay !== this.day,
            used: Boolean(viewer.judgeUsed),
          },
          spy: {
            available:
              viewer.roleId === "spy" &&
              canDayAction &&
              viewer.spyRevealDay !== this.day &&
              viewer.blockedDay !== this.day,
            usedToday: viewer.spyRevealDay === this.day,
          },
          cure: this.config.mode === "zombie" && viewer.roleId === "doctor"
            ? {
                available: canDayAction && viewer.cures < 3 && viewer.blockedDay !== this.day,
                used: viewer.cures,
                left: Math.max(0, 3 - viewer.cures),
              }
            : null,
          puppet: viewer.roleId === "puppeteer"
            ? {
                chosen: Boolean(viewer.puppetTargetId),
                targetId: viewer.puppetTargetId,
                targetName: viewer.puppetTargetId ? this.playerMap.get(viewer.puppetTargetId)?.name ?? "" : "",
                revealed: Boolean(
                  viewer.puppetTargetId &&
                    viewer.puppetChosenDay >= 0 &&
                    this.day > viewer.puppetChosenDay,
                ),
                roleId:
                  viewer.puppetTargetId && this.day > viewer.puppetChosenDay
                    ? this.playerMap.get(viewer.puppetTargetId)?.roleId ?? null
                    : null,
                roleName:
                  viewer.puppetTargetId && this.day > viewer.puppetChosenDay
                    ? ROLES[this.playerMap.get(viewer.puppetTargetId)?.roleId]?.name ?? null
                    : null,
              }
            : null,
          reveals: viewer.reveals.slice(-8),
        }
      : null;

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
        const waitingForLastWord =
          viewer.id === this.lastWordsPlayerId && !this.lastWordsSpoken;
        if (!viewer.alive && !waitingForLastWord) {
          chatChannels.push("dead");
          if (!secretMode) chatChannels.push("mafia");
        }
        if (waitingForLastWord) chatWriteChannels.push("public");
        else if (!viewer.alive) chatWriteChannels.push("dead");
      } else if (!viewer.alive) {
        // The dead keep watching the living — public and mafia feeds — but
        // their only microphone is the dead room.
        chatChannels.push("public", "dead");
        if (!secretMode) chatChannels.push("mafia");
        chatWriteChannels.push("dead");
      } else if (this.phase === PHASE.NIGHT) {
        if (viewer.team === "mafia" && !secretMode) {
          // Hidden mafia roles get the tab as a blind microphone: they can
          // write to the family, but never read it.
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
        mode: this.config.mode,
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
            judgeUsed: viewer.judgeUsed,
            spyRevealDay: viewer.spyRevealDay,
            cures: viewer.cures ?? 0,
            zombie: Boolean(viewer.zombie),
            originalRoleId: viewer.originalRoleId ?? null,
            reveals: viewer.reveals.slice(-8),
            drunk: Boolean(viewer.alive && viewer.drunkDay === this.day),
            blocked: viewer.blockedDay === this.day,
            puppetTargetId: viewer.puppetTargetId,
            puppetTargetName: viewer.puppetTargetId
              ? this.playerMap.get(viewer.puppetTargetId)?.name ?? ""
              : null,
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
      day: dayView,
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
