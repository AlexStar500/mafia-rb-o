import { pickOne, randomInt, seededRng, stableNoise } from "../core/random.js";
import { sanitizeChat } from "../core/security.js";
import { BOT_BY_ID } from "../data/bots.js";
import { isAggressiveIntent, pickBotLine } from "../data/botPhrases.js";
import { BOT_CHAT_LEVELS, ROLES, hidesMafiaRoster, isMafiaCoreRole } from "../data/roles.js";

const DEFAULT_TRAITS = Object.freeze({
  logic: 0.6,
  aggression: 0.5,
  chattiness: 0.6,
  deception: 0.5,
  loyalty: 0.5,
  chaos: 0.3,
});

function traitsOf(bot) {
  return { ...DEFAULT_TRAITS, ...(bot?.traits ?? {}) };
}

function styleOf(bot) {
  return bot?.style ?? "deadpan";
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.6;
  return Math.max(0, Math.min(1, n));
}

/**
 * Picks from scored candidates with a temperature based on intelligence.
 * Smart bots mostly take the best option; careless bots wander. No candidate
 * gets a bonus for being a bot or a human.
 */
function pickByScore(scored, { rng = Math.random, logic = 0.6 } = {}) {
  if (!scored.length) return null;
  const skill = clamp01(logic);
  if (rng() < (1 - skill) * 0.32) {
    return scored[Math.floor(rng() * scored.length) % scored.length]?.id ?? null;
  }
  const max = Math.max(...scored.map((item) => item.score));
  const temperature = 0.3 + (1 - skill) * 2.1;
  const weighted = scored.map((item) => ({
    id: item.id,
    weight: Math.exp((item.score - max) / temperature),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (!(total > 0)) return scored[0]?.id ?? null;
  let roll = rng() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.id;
  }
  return weighted[weighted.length - 1]?.id ?? null;
}

/**
 * The chat director is the reason twelve bots do not shout at once.
 * It applies a global cadence, a per-bot cooldown and an anti-dogpile rule.
 */
export class ChatDirector {
  constructor({ engine, level = "normal", rng = Math.random }) {
    this.engine = engine;
    this.rng = rng;
    this.level = BOT_CHAT_LEVELS[level] ? level : "normal";
    this.queue = [];
    this.recent = [];
    this.nextAt = 0;
    this._seq = 0;
  }

  setLevel(level) {
    if (BOT_CHAT_LEVELS[level]) this.level = level;
  }

  get config() {
    return BOT_CHAT_LEVELS[this.level];
  }

  request({ bot, text, intent = "emote", targetId = null, channel = "public", delay = 0, priority = 1 }) {
    const clean = sanitizeChat(text);
    if (!clean) return null;
    const now = this.engine.clock();
    const item = {
      id: ++this._seq,
      bot,
      playerId: bot.playerId,
      text: clean.slice(0, 160),
      intent,
      targetId,
      channel,
      createdAt: now,
      desiredAt: now + Math.max(1800, delay),
      expiresAt: now + 28_000,
      phaseSerial: this.engine.phaseSerial,
      priority,
    };
    this.queue.push(item);
    if (this.queue.length > 40) {
      this.queue.sort((a, b) => b.priority - a.priority || a.desiredAt - b.desiredAt);
      this.queue.length = 40;
    }
    return item;
  }

  tick(now = this.engine.clock()) {
    if (!this.queue.length) return;
    this.recent = this.recent.filter((entry) => now - entry.at < 15_000);
    this.queue = this.queue.filter((item) => {
      if (now > item.expiresAt) return false;
      const player = this.engine.getPlayer(item.playerId);
      if (!player?.alive && item.channel === "public") return false;
      if (item.phaseSerial !== this.engine.phaseSerial) {
        // A final whisper from the dead is allowed; everything else belongs to
        // the phase in which it was written.
        return item.channel === "dead" || item.intent === "last-words";
      }
      return true;
    });
    if (now < this.nextAt) return;

    const recentGlobal = this.recent.filter((entry) => now - entry.at < 10_000);
    if (recentGlobal.length >= this.config.maxPerPhase) return;

    this.queue.sort((a, b) => b.priority - a.priority || a.desiredAt - b.desiredAt);
    const index = this.queue.findIndex((item) => item.desiredAt <= now);
    if (index < 0) return;
    const item = this.queue[index];

    const player = this.engine.getPlayer(item.playerId);
    if (!player?.alive) {
      this.queue.splice(index, 1);
      return;
    }
    if (now - (item.bot.lastSpokeAt ?? 0) < 11_000) return;
    // Everyone reads before speaking: a bot never answers in the same breath.
    if (now - item.createdAt < 2200) return;

    // Anti-dogpile: one aggressive push per target per window, no echo parties.
    if (isAggressiveIntent(item.intent) && item.targetId) {
      const sameTarget = this.recent.filter(
        (entry) =>
          entry.targetId === item.targetId &&
          isAggressiveIntent(entry.intent) &&
          now - entry.at < 12_000,
      );
      if (sameTarget.length >= 1) {
        this.queue.splice(index, 1);
        return;
      }
    }
    if (["greeting", "greeting-reply", "answer", "agree"].includes(item.intent)) {
      const echo = this.recent.some(
        (entry) => entry.intent === item.intent && now - entry.at < (item.intent === "greeting" ? 12_000 : 7_000),
      );
      if (echo) {
        this.queue.splice(index, 1);
        return;
      }
    }

    const channel = item.channel === "mafia" ? "mafia" : item.channel === "dead" ? "dead" : "public";
    const result = this.engine.addChat(item.playerId, item.text, {
      channel,
      intent: item.intent,
      targetId: item.targetId,
    });
    this.queue.splice(index, 1);
    if (!result.ok) return;

    item.bot.lastSpokeAt = now;
    this.recent.push({
      at: now,
      intent: item.intent,
      targetId: item.targetId,
      playerId: item.playerId,
    });
    const gap = this.level === "quiet" ? 7000 : this.level === "loud" ? 3800 : 5200;
    this.nextAt = now + gap + Math.round(this.rng() * 1400);
  }

  clear() {
    this.queue = [];
    this.recent = [];
    this.nextAt = 0;
  }
}

/**
 * One bot's brain. It only ever reads:
 *  - its own role;
 *  - public chat and actions;
 *  - mafia teammates if it is mafia;
 *  - sheriff investigation results if it is the sheriff.
 * No hidden roles leak into town bot decisions.
 */
export class BotBrain {
  constructor({ engine, playerId, level = "normal", director, rng }) {
    this.engine = engine;
    this.playerId = playerId;
    this.player = engine.getPlayer(playerId);
    this.persona = BOT_BY_ID[this.player?.botId] ?? null;
    this.traits = traitsOf(this.persona);
    this.style = styleOf(this.persona);
    this.rng = rng ?? seededRng(`${engine.roomCode}:${playerId}:${this.persona?.id ?? "bot"}`);
    this.level = BOT_CHAT_LEVELS[level] ?? BOT_CHAT_LEVELS.normal;
    this.director = director;
    this.memory = {
      suspicion: new Map(),
      jesterRisk: new Map(),
      claims: new Map(),
      recentAccusations: [],
      trust: new Map(),
      opinionLock: new Map(),
    };
    this.phaseSerial = -1;
    this.spokenThisPhase = 0;
    this.maxChat = 3;
    this.nextChatAt = 0;
    this.replyAt = 0;
    this.pendingReply = null;
    this.pendingDefense = false;
    this.lastDefendedAt = 0;
    this.lastClaimAt = 0;
    this.nightActed = false;
    this.contractAt = 0;
    this.contractTried = false;
    this.voteAt = 0;
    this.voted = false;
    this.lastWordsSent = false;
    this.lobbyGreeted = false;
    this.lastFreeReplyAt = 0;
    this.lastSpokeAt = 0;
    this._phaseEnteredAt = 0;
  }

  get role() {
    return this.player?.roleId ? ROLES[this.player.roleId] : null;
  }

  get team() {
    return this.player?.team ?? null;
  }

  get isMafia() {
    return this.player?.team === "mafia";
  }

  /** Bartender and spy play for mafia but never see the family or its chat. */
  get canSeeMafia() {
    if (this.engine.config?.mode === "secret") return false;
    return this.isMafia && !hidesMafiaRoster(this.roleId);
  }

  get roleId() {
    return this.player?.roleId ?? null;
  }

  syncPhase(now) {
    const serial = this.engine.phaseSerial;
    if (serial === this.phaseSerial) return;
    this.phaseSerial = serial;
    this.spokenThisPhase = 0;
    this.nightActed = false;
    this.contractAt = 0;
    this.contractTried = false;
    this.voteAt = 0;
    this.voted = false;
    this.lastWordsSent = false;
    this.lastClaimAt = 0;
    this.dayActionAt = 0;
    this.dayActionTried = false;
    this._phaseEnteredAt = now;
    const level = this.level;
    const base = level.maxPerPhase;
    this.maxChat = Math.max(
      1,
      Math.min(7, Math.round(base * (0.65 + this.traits.chattiness * 0.8) * (0.8 + this.rng() * 0.4))),
    );
    this.nextChatAt = now + Math.round(4200 + this.rng() * 9000);
    if (this.engine.phase === "discussion") {
      this.nextChatAt = now + Math.round(3600 + this.rng() * 7200);
    }
  }

  tick(now = this.engine.clock()) {
    if (!this.player?.isBot) return;
    if (this.engine.phase === "lobby") {
      this.syncPhase(now);
      this.tickLobby(now);
      return;
    }
    if (!this.engine.isStarted) return;
    this.syncPhase(now);
    if (!this.player.alive) {
      if (
        this.engine.phase === "lastWords" &&
        this.engine.lastWordsPlayerId === this.playerId &&
        !this.lastWordsSent
      ) {
        this.sendLastWords(now);
      } else {
        this.tickDeadChat(now);
      }
      return;
    }

    if (this.engine.phase === "night") this.tickNight(now);
    else if (this.engine.phase === "discussion" || this.engine.phase === "voting") {
      this.tickDayAction(now);
      this.tickDayChat(now);
      if (this.engine.phase === "voting") this.tickVoting(now);
    } else if (this.engine.phase === "lastWords") {
      if (this.engine.lastWordsPlayerId === this.playerId) this.sendLastWords(now);
    }
  }

  // -----------------------------------------------------------------------
  // Lobby
  // -----------------------------------------------------------------------

  /** The dead keep talking — quietly, in their own channel. */
  tickDeadChat(now) {
    if (this.engine.phase === "lobby" || this.engine.phase === "ended") return;
    if (!this.deadChatAt) this.deadChatAt = now + 2500 + this.rng() * 9000;
    if (now < this.deadChatAt) return;
    this.deadChatAt = now + 14000 + this.rng() * 22_000;
    const pool = ["emote", "smalltalk", "gg", "confusion"];
    const intent = pool[Math.floor(this.rng() * pool.length)];
    const text = pickBotLine(intent, this.style, this.varsFor(null), this.rng);
    if (!text) return;
    this.engine.addBotChat(this.playerId, text, {
      channel: "dead",
      intent,
      targetId: null,
    });
  }

  tickLobby(now) {
    if (!this.player?.alive) return;
    if (this.pendingReply && now >= this.replyAt) {
      const reply = this.pendingReply;
      this.pendingReply = null;
      this.sendReply(reply, now);
      return;
    }
    if (this.lobbyGreeted) return;
    if (this.engine.players.length < 2) return;
    if (now < this.nextChatAt) return;
    const greetingsAlready = this.engine.chat.filter((message) => message.intent === "greeting").length;
    if (greetingsAlready >= 2) {
      this.lobbyGreeted = true;
      return;
    }
    this.lobbyGreeted = true;
    this.spokenThisPhase += 1;
    this.nextChatAt = now + 30_000;
    this.scheduleChat({
      text: pickBotLine("greeting", this.style, {}, this.rng),
      intent: "greeting",
      channel: "public",
      delay: 200 + this.rng() * 900,
      priority: 0.6,
    });
  }

  // -----------------------------------------------------------------------
  // Night
  // -----------------------------------------------------------------------

  tickNight(now) {
    if (!this.nightActed) {
      if (this.nightActedAt === undefined || this.nightActedAt < this._phaseEnteredAt) {
        this.nightActedAt = now + Math.round(1200 + this.rng() * 4200);
      }
      if (now >= this.nightActedAt) {
        this.nightActed = true;
        this.chooseNightAction(now);
      }
    }

    if (this.roleId === "assassin" && this.engine.day >= 2 && !this.player.contractUsed) {
      if (!this.contractTried) {
        this.contractTried = true;
        this.contractAt = now + Math.round(1600 + this.rng() * 3600);
      }
      if (now >= this.contractAt && this.contractAt > 0) {
        this.tryContract(now);
      }
    }

    if (this.isMafia && this.engine.config?.mode !== "secret" && this.spokenThisPhase < 2 && this.rng() < 0.5) {
      if (this.nextChatAt <= now) {
        const targetId = this.chooseMafiaTarget();
        if (targetId) {
          this.scheduleChat({
            text: pickBotLine("mafia-night", this.style, this.varsFor(targetId), this.rng),
            intent: "mafia-night",
            targetId,
            channel: "mafia",
            delay: Math.round(400 + this.rng() * 1200),
            priority: 0.5,
          });
          this.spokenThisPhase += 1;
        }
        this.nextChatAt = now + 9000 + this.rng() * 7000;
      }
    }
  }

  chooseNightAction(now) {
    const roleId = this.roleId;
    if (!roleId) return;
    if (isMafiaCoreRole(roleId)) {
      const targetId = this.chooseMafiaTarget();
      if (targetId) {
        this.engine.setNightAction(this.playerId, "kill", targetId);
        this.lastNightTarget = targetId;
      }
      return;
    }
    if (roleId === "doctor") {
      const targetId = this.chooseDoctorTarget();
      if (targetId) this.engine.setNightAction(this.playerId, "heal", targetId);
      return;
    }
    if (roleId === "sheriff") {
      const targetId = this.chooseSheriffTarget();
      if (targetId) this.engine.setNightAction(this.playerId, "check", targetId);
      return;
    }
    if (roleId === "bartender") {
      const targetId = this.chooseBartenderTarget();
      if (targetId) this.engine.setNightAction(this.playerId, "drink", targetId);
      return;
    }
    if (roleId === "musician") {
      const targetId = this.chooseMusicianTarget();
      if (targetId) this.engine.setNightAction(this.playerId, "block", targetId);
      return;
    }
    if (roleId === "puppeteer" && !this.player.puppetTargetId) {
      const targetId = this.choosePuppetTarget();
      if (targetId) this.engine.setNightAction(this.playerId, "puppet", targetId);
    }
  }

  tryContract(now) {
    if (!this.roleId || this.roleId !== "assassin") return;
    if (this.player.contractUsed) return;
    const targetId = this.chooseMafiaTarget(true);
    if (!targetId) return;
    const threat = this.threatOf(targetId);
    if (threat >= 3 || this.engine.day >= 3 || this.rng() < this.traits.logic * 0.5) {
      const result = this.engine.setNightAction(this.playerId, "contract", targetId);
      if (result.ok && this.engine.config?.mode !== "secret") {
        this.scheduleChat({
          text: pickBotLine("mafia-night", this.style, this.varsFor(targetId), this.rng),
          intent: "mafia-night",
          targetId,
          channel: "mafia",
          delay: 800,
          priority: 0.4,
        });
      }
    }
  }

  chooseMafiaTarget(contract = false) {
    const secret = this.engine.config?.mode === "secret";
    const candidates = this.engine.players.filter(
      (player) => player.alive && player.id !== this.playerId && (secret || player.team !== "mafia"),
    );
    if (!candidates.length) return null;

    const existing = [...(this.engine.night?.killVotes?.entries() ?? [])]
      .filter(([, targetId]) => candidates.some((player) => player.id === targetId))
      .map(([, targetId]) => targetId);
    if (!contract && existing.length) {
      const counts = new Map();
      for (const id of existing) counts.set(id, (counts.get(id) ?? 0) + 1);
      const max = Math.max(...counts.values());
      const top = [...counts.entries()].filter(([, count]) => count === max).map(([id]) => id);
      const humanVoted = [...(this.engine.night?.killVotes?.keys() ?? [])].some(
        (voterId) => !this.engine.getPlayer(voterId)?.isBot,
      );
      const followChance = humanVoted ? 0.72 : 0.56;
      if (this.rng() < followChance) return pickOne(top, this.rng);
    }

    const scored = candidates.map((player) => ({
      id: player.id,
      score:
        this.threatOf(player.id) +
        this.suspicionOf(player.id) * 0.25 +
        this.rng() * 2.2,
    }));
    return pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
  }

  chooseDoctorTarget() {
    const player = this.player;
    if (!player) return null;
    const candidates = this.engine.players.filter((target) => {
      if (!target.alive) return false;
      if (target.id === player.lastHealTarget) return false;
      if (target.id === player.id && player.selfHeals >= 1) return false;
      return true;
    });
    if (!candidates.length) return null;
    const scored = candidates.map((target) => {
      const claim = this.claimsOf(target.id);
      let score = this.threatOf(target.id) * 0.9 + this.rng() * 1.2;
      if (claim?.role === "sheriff") score += 4;
      if (claim?.role === "doctor") score += 2.2;
      if (target.id === player.id) score += 0.8;
      return { id: target.id, score };
    });
    return pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
  }

  chooseSheriffTarget() {
    const checked = new Set((this.player.investigations ?? []).map((entry) => entry.targetId));
    const candidates = this.engine.players.filter(
      (target) => target.alive && target.id !== this.playerId && !checked.has(target.id),
    );
    const pool = candidates.length
      ? candidates
      : this.engine.players.filter((target) => target.alive && target.id !== this.playerId);
    if (!pool.length) return null;
    const scored = pool.map((target) => ({
      id: target.id,
      score: this.suspicionOf(target.id) + this.threatOf(target.id) * 0.4 + this.rng() * 2,
    }));
    return pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
  }

  chooseBartenderTarget() {
    const candidates = this.engine.players.filter(
      (target) => target.alive && target.id !== this.playerId,
    );
    if (!candidates.length) return null;
    const scored = candidates.map((target) => ({
      id: target.id,
      score: this.threatOf(target.id) * 0.8 + (this.claimsOf(target.id) ? 1.5 : 0) + this.rng() * 2.4,
    }));
    return pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
  }

  chooseMusicianTarget() {
    const candidates = this.engine.players.filter(
      (target) => target.alive && target.id !== this.playerId,
    );
    if (!candidates.length) return null;
    const scored = candidates.map((target) => {
      let score = this.suspicionOf(target.id) * 0.6 + this.threatOf(target.id) * 0.5 + this.rng() * 2.2;
      const claim = this.claimsOf(target.id);
      if (claim?.role === "sheriff") score += 2.4;
      if (claim?.role === "doctor") score += 1.2;
      return { id: target.id, score };
    });
    return pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
  }

  choosePuppetTarget() {
    const candidates = this.engine.players.filter(
      (target) => target.alive && target.id !== this.playerId,
    );
    if (!candidates.length) return null;
    const scored = candidates.map((target) => {
      const claim = this.claimsOf(target.id);
      let score = this.threatOf(target.id) * 0.5 + this.rng() * 2.6;
      if (claim?.role === "sheriff") score += 2;
      if (claim?.role === "doctor") score += 1.2;
      // A loud town voice tends to survive longer than a quiet one.
      const speeches = this.engine.chat.filter((message) => message.playerId === target.id).length;
      score += Math.min(1.6, speeches * 0.06);
      return { id: target.id, score };
    });
    return pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
  }

  tickDayAction(now) {
    const roleId = this.roleId;
    if (roleId !== "spy" && roleId !== "judge") return;
    if (this.dayActionTried) return;
    if (!this.dayActionAt) {
      this.dayActionAt = now + Math.round(7000 + this.rng() * 9000);
    }
    if (now < this.dayActionAt) return;
    this.dayActionTried = true;

    if (roleId === "spy") {
      if (this.player.spyRevealDay === this.engine.day) return;
      const candidates = this.engine.players.filter(
        (target) => target.alive && target.id !== this.playerId,
      );
      if (!candidates.length) return;
      const scored = candidates.map((target) => ({
        id: target.id,
        score: this.suspicionOf(target.id) + this.threatOf(target.id) * 0.4 + this.rng() * 2,
      }));
      const targetId = pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
      if (targetId) this.engine.setDayAction(this.playerId, "reveal", targetId);
      return;
    }

    if (this.player.judgeUsed || this.engine.day < 2) return;
    const candidates = this.engine.players.filter(
      (target) => target.alive && target.id !== this.playerId,
    );
    if (!candidates.length) return;
    const scored = candidates.map((target) => ({
      id: target.id,
      score:
        this.suspicionOf(target.id) +
        this.threatOf(target.id) * 0.6 +
        this.rng() * 1.5,
    }));
    const targetId = pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
    if (!targetId) return;
    // A cautious judge only acts on a strong, investigated case.
    const confidence = this.suspicionOf(targetId) + this.threatOf(targetId) * 0.5;
    if (confidence < 4.2 && this.rng() > 0.22) return;
    this.engine.setDayAction(this.playerId, "judge", targetId);
  }

  // -----------------------------------------------------------------------
  // Day chat & voting
  // -----------------------------------------------------------------------

  tickDayChat(now) {
    if (this.engine.phase !== "discussion" && this.engine.phase !== "voting") return;
    if (this.spokenThisPhase >= this.maxChat && this.spokenThisPhase >= 2) return;
    if (this.pendingReply && now >= this.replyAt && this.spokenThisPhase < this.maxChat + 2) {
      const reply = this.pendingReply;
      this.pendingReply = null;
      this.sendReply(reply, now);
      return;
    }
    if (this.pendingDefense && now >= this.lastDefendedAt + 5000 && this.spokenThisPhase < this.maxChat + 1) {
      this.pendingDefense = false;
      this.lastDefendedAt = now;
      this.scheduleChat({
        text: pickBotLine("defend-self", this.style, this.varsFor(this.playerId), this.rng),
        intent: "defend-self",
        channel: "public",
        delay: 500,
        priority: 2.4,
      });
      this.spokenThisPhase += 1;
      return;
    }
    if (now < this.nextChatAt) return;
    if (this.spokenThisPhase >= this.maxChat) return;

    const plan = this.planMessage(now);
    if (!plan) {
      this.nextChatAt = now + 7000 + this.rng() * 8000;
      return;
    }
    this.scheduleChat(plan);
    this.spokenThisPhase += 1;
    const pace = this.engine.phase === "voting" ? 1.6 : 1;
    this.nextChatAt =
      now + Math.round((6200 + this.rng() * 9500) / (0.65 + this.traits.chattiness * 0.7) * pace);
  }

  sendReply(reply, now) {
    this.scheduleChat({
      ...reply,
      delay: 0,
      priority: reply.priority ?? 2,
    });
    this.spokenThisPhase += 1;
    this.nextChatAt = now + 7000 + this.rng() * 6000;
  }

  planMessage(now) {
    const roleId = this.roleId;
    const day = this.engine.day;
    const aliveOthers = this.engine.players.filter(
      (player) => player.alive && player.id !== this.playerId,
    );
    if (!aliveOthers.length) return null;

    // A real sheriff eventually shares a guilty result.
    if (roleId === "sheriff" && this.player.investigations?.length) {
      const guilty = this.player.investigations.filter((entry) => entry.result === "mafia").at(-1);
      if (guilty && (day >= 2 || this.pendingDefense || this.rng() < 0.25) && now - this.lastClaimAt > 15_000) {
        this.lastClaimAt = now;
        const target = this.engine.getPlayer(guilty.targetId);
        if (target?.alive) {
          this.rememberClaim(this.playerId, "sheriff");
          return {
            text: `${pickBotLine("claim-sheriff", this.style, {}, this.rng)} ${pickBotLine(
              "result-mafia",
              this.style,
              this.varsFor(target.id),
              this.rng,
            )}`.slice(0, 160),
            intent: "result-mafia",
            targetId: target.id,
            channel: "public",
            delay: 200,
            priority: 3,
          };
        }
      }
    }

    // A doctor under pressure may claim to survive.
    if (roleId === "doctor" && this.pendingDefense && now - this.lastClaimAt > 20_000) {
      this.lastClaimAt = now;
      this.rememberClaim(this.playerId, "doctor");
      return {
        text: pickBotLine("claim-doctor", this.style, {}, this.rng),
        intent: "claim-doctor",
        channel: "public",
        delay: 200,
        priority: 2.8,
      };
    }

    if (roleId === "jester") {
      // The jester wants to look worth voting out — but not obviously so.
      if (this.pendingDefense || this.rng() < 0.35) {
        const target = pickOne(aliveOthers, this.rng);
        if (target && this.rng() < 0.45) {
          return {
            text: pickBotLine("claim-jester", this.style, {}, this.rng),
            intent: "claim-jester",
            channel: "public",
            delay: 300,
            priority: 1.5,
          };
        }
        return {
          text: pickBotLine("chaos", this.style, this.varsFor(target?.id), this.rng),
          intent: "chaos",
          targetId: target?.id ?? null,
          channel: "public",
          delay: 500,
          priority: 1.2,
        };
      }
    }

    if (this.canSeeMafia) {
      // Fake a sheriff claim if someone else claimed it and the lie is worth it.
      const sheriffClaims = [...this.memory.claims.entries()].filter(
        ([id, claim]) => claim.role === "sheriff" && id !== this.playerId,
      );
      if (
        sheriffClaims.length &&
        !this.memory.claims.has(this.playerId) &&
        this.rng() < this.traits.deception * 0.55 &&
        now - this.lastClaimAt > 20_000
      ) {
        this.lastClaimAt = now;
        const victims = aliveOthers.filter((target) => target.team !== "mafia");
        const victim = pickOne(victims, this.rng);
        if (victim) {
          this.rememberClaim(this.playerId, "sheriff");
          return {
            text: `${pickBotLine("claim-sheriff", this.style, {}, this.rng)} ${pickBotLine(
              "result-mafia",
              this.style,
              this.varsFor(victim.id),
              this.rng,
            )}`.slice(0, 160),
            intent: "result-mafia",
            targetId: victim.id,
            channel: "public",
            delay: 600,
            priority: 2.6,
          };
        }
      }
      const targetId = this.choosePublicTarget();
      if (!targetId) return null;
      const intent = this.rng() < 0.3 ? "vote-call" : "accuse";
      return {
        text: pickBotLine(intent, this.style, this.varsFor(targetId), this.rng),
        intent,
        targetId,
        channel: "public",
        delay: 500 + this.rng() * 1200,
        priority: 1.1,
      };
    }

    // Town logic: listen to a credible sheriff claim, otherwise push a suspect.
    const credibleResult = this.credibleSheriffResult();
    if (credibleResult && this.rng() < 0.68) {
      return {
        text: pickBotLine(
          this.rng() < 0.5 ? "agree" : "vote-call",
          this.style,
          this.varsFor(credibleResult.targetId),
          this.rng,
        ),
        intent: "vote-call",
        targetId: credibleResult.targetId,
        channel: "public",
        delay: 700,
        priority: 1.8,
      };
    }

    if (this.rng() < 0.2) {
      const other = pickOne(aliveOthers, this.rng);
      return {
        text: pickBotLine("question", this.style, this.varsFor(other?.id), this.rng),
        intent: "question",
        targetId: other?.id ?? null,
        channel: "public",
        delay: 600,
        priority: 0.9,
      };
    }

    const targetId = this.choosePublicTarget();
    if (!targetId) return null;
    const target = this.engine.getPlayer(targetId);
    const currentAccusations = this.memory.recentAccusations.filter(
      (entry) => entry.targetId === targetId && this.engine.clock() - entry.at < 15_000,
    ).length;
    if (currentAccusations > 0 && this.rng() < 0.5) {
      return {
        text: pickBotLine("agree", this.style, this.varsFor(targetId), this.rng),
        intent: "agree",
        targetId,
        channel: "public",
        delay: 500,
        priority: 1.2,
      };
    }
    if (target?.claimedJester && this.rng() < 0.6) {
      return {
        text: pickBotLine("disagree", this.style, this.varsFor(targetId), this.rng),
        intent: "disagree",
        targetId,
        channel: "public",
        delay: 500,
        priority: 1.3,
      };
    }
    return {
      text: pickBotLine(this.rng() < 0.25 ? "question" : "accuse", this.style, this.varsFor(targetId), this.rng),
      intent: this.rng() < 0.25 ? "question" : "accuse",
      targetId,
      channel: "public",
      delay: 500 + this.rng() * 1200,
      priority: 1,
    };
  }

  tickVoting(now) {
    if (this.voted) return;
    if (!this.voteAt) {
      // Bots do not pounce: they listen to the discussion and only then commit,
      // somewhere between six and eighteen seconds into the vote. If the phase
      // is short, they still leave themselves a couple of seconds of margin.
      const delay = Math.round(6000 + this.rng() * 12_000);
      const latest = this.engine.phaseEndsAt ? this.engine.phaseEndsAt - 3000 : 0;
      this.voteAt = latest ? Math.min(now + delay, Math.max(now + 2500, latest)) : now + delay;
    }
    if (now < this.voteAt) return;
    this.voted = true;
    const targetId = this.pickVote();
    const result = this.engine.castVote(this.playerId, targetId || "skip");
    if (!result.ok) this.voted = true;
  }

  pickVote() {
    const candidates = this.engine.players.filter(
      (player) => player.alive && player.id !== this.playerId,
    );
    if (!candidates.length) return "skip";

    const mafia = this.canSeeMafia;
    const scored = candidates.map((target) => {
      let score = this.suspicionOf(target.id) + this.rng() * 0.8;
      if (mafia) {
        score += this.threatOf(target.id) * 0.9;
        score -= this.jesterRiskOf(target.id) * 1.9;
      } else {
        score -= this.jesterRiskOf(target.id) * 2.3;
        if (this.roleId === "jester") score += this.rng() * 1.5;
      }
      const claim = this.claimsOf(target.id);
      if (!mafia && claim?.role === "sheriff" && this.roleId !== "sheriff") score -= 0.5;
      if (this.recentlyAccusedMe(target.id)) score += this.traits.aggression * 1.1;
      return { id: target.id, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top) return "skip";
    if (this.roleId === "jester") return top.id;
    if (top.score < 0.1 && this.rng() < 0.22) return "skip";
    return pickByScore(scored, { rng: this.rng, logic: this.traits.logic }) ?? top.id;
  }

  choosePublicTarget() {
    if (this.canSeeMafia) {
      const candidates = this.engine.players.filter(
        (player) =>
          player.alive &&
          player.id !== this.playerId &&
          player.team !== "mafia" &&
          !this.memory.claims.get(player.id)?.role?.includes("jester"),
      );
      if (!candidates.length) return null;
      const scored = candidates.map((target) => ({
        id: target.id,
        score:
          this.threatOf(target.id) +
          this.suspicionOf(target.id) * 0.4 +
          this.rng() * 1.8,
      }));
      return pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
    }

    const candidates = this.engine.players.filter(
      (player) => player.alive && player.id !== this.playerId,
    );
    if (!candidates.length) return null;
    const scored = candidates.map((target) => ({
      id: target.id,
      score:
        this.suspicionOf(target.id) -
        this.jesterRiskOf(target.id) * 2 +
        this.rng() * 1.8,
    }));
    return pickByScore(scored, { rng: this.rng, logic: this.traits.logic });
  }

  // -----------------------------------------------------------------------
  // Incoming chat
  // -----------------------------------------------------------------------

  onChat(message, now = this.engine.clock()) {
    if (!this.player?.isBot || !message) return;
    if (message.playerId === this.playerId) return;
    // A drunk tongue is noise, not evidence. Bots never decode it.
    if (message.drunk) return;
    if (message.channel === "dead" && this.player.alive) return;
    if (message.channel === "mafia" && !this.canSeeMafia) return;
    if (!this.player.alive) return;

    const speaker = this.engine.getPlayer(message.playerId);
    if (!speaker || speaker.id === this.playerId) return;

    if (this.engine.phase === "lobby") {
      if (message.channel === "public" && !message.quickId) this.handleFreeText(message, speaker, now);
      return;
    }
    if (this.engine.phase === "ended") return;

    const target = message.targetId ? this.engine.getPlayer(message.targetId) : null;
    const intent = message.intent ?? null;
    const targetId = target?.id ?? null;

    if (intent === "claim-sheriff") {
      this.rememberClaim(speaker.id, "sheriff");
      if (this.roleId === "sheriff") this.addSuspicion(speaker.id, 5);
      else this.addTrust(speaker.id, 0.8);
    } else if (intent === "claim-doctor") {
      this.rememberClaim(speaker.id, "doctor");
      if (this.roleId === "doctor") this.addSuspicion(speaker.id, 4.2);
    } else if (intent === "claim-jester" || intent === "chaos") {
      this.addJesterRisk(speaker.id, intent === "claim-jester" ? 4 : 0.8);
      if (this.roleId === "jester") this.addSuspicion(speaker.id, 1.2);
    } else if (intent === "claim-civilian") {
      this.rememberClaim(speaker.id, "civilian");
    } else if (intent === "claim-role" && message.quickRoleId) {
      this.rememberClaim(speaker.id, message.quickRoleId);
      if (message.quickRoleId === this.roleId) this.addSuspicion(speaker.id, 1.4);
    } else if (intent === "greeting" && this.rng() < 0.4 && this.spokenThisPhase < this.maxChat) {
      this.scheduleReply(
        {
          text: pickBotLine("greeting-reply", this.style, this.varsFor(speaker.id), this.rng),
          intent: "greeting-reply",
          targetId: speaker.id,
          channel: "public",
          priority: 1.1,
        },
        now,
      );
    }

    if (message.quickId || message.intent) {
      const key = `${intent}:${targetId ?? ""}`;
      this.memory.recentAccusations.push({ key, targetId, at: now, speaker: speaker.id });
      if (this.memory.recentAccusations.length > 30) this.memory.recentAccusations.shift();
    }

    if (intent === "accuse" || intent === "vote-call") {
      if (targetId && targetId !== this.playerId) {
        this.addSuspicion(targetId, 0.75 + this.trustOf(speaker.id) * 0.5);
        this.addSuspicion(speaker.id, -0.06);
      }
      if (targetId === this.playerId) {
        this.pendingDefense = true;
        this.replyAt = now + Math.round(2200 + this.rng() * 3000);
      }
    } else if (intent === "defend-self") {
      this.addSuspicion(speaker.id, -0.18);
    } else if (intent === "defend-other" && targetId) {
      this.addSuspicion(targetId, -0.28);
      this.addTrust(speaker.id, 0.1);
    } else if (intent === "agree" && targetId) {
      this.addSuspicion(targetId, 0.32);
    } else if (intent === "disagree" && targetId) {
      this.addSuspicion(targetId, -0.34);
    } else if (intent === "result-mafia" && targetId) {
      const credibility = this.claimCredibility(speaker.id, "sheriff");
      this.rememberClaim(speaker.id, "sheriff");
      this.addSuspicion(targetId, 2.8 * credibility);
      this.addTrust(speaker.id, 0.45 * credibility);
    } else if (intent === "result-clean" && targetId) {
      const credibility = this.claimCredibility(speaker.id, "sheriff");
      this.addSuspicion(targetId, -1.2 * credibility);
    } else if (intent === "question") {
      if (this.rng() < 0.32 && this.spokenThisPhase < this.maxChat) {
        this.scheduleReply(
          {
            text: pickBotLine("answer", this.style, this.varsFor(targetId ?? speaker.id), this.rng),
            intent: "answer",
            targetId: targetId ?? speaker.id,
            channel: "public",
            priority: 1.4,
          },
          now,
        );
      }
    } else if (intent === "night" || intent === "emote") {
      this.addSuspicion(speaker.id, 0.01);
    }

    // A human or bot directly mentions this bot's name alongside an accusation.
    if (
      message.text &&
      message.text.toLowerCase().includes(this.player.name.toLowerCase()) &&
      /мафи|веша|голос|врёшь|врешь/i.test(message.text)
    ) {
      this.pendingDefense = true;
      this.replyAt = now + Math.round(2200 + this.rng() * 2800);
    }

    if (!message.quickId && !intent) this.handleFreeText(message, speaker, now);
  }

  /**
   * Small, deliberately shallow language understanding. Bots react to greetings,
   * direct questions, role claims and accusations by name — the same cues a
   * distracted human at the table would notice. They never read hidden roles.
   */
  handleFreeText(message, speaker, now = this.engine.clock()) {
    if (message.channel !== "public") return;
    const text = String(message.text ?? "").trim();
    if (!text) return;
    const lower = text.toLowerCase();
    const myName = String(this.player?.name ?? "").toLowerCase();
    const myFirst = myName.split(/\s+/)[0] ?? "";
    const mentionsMe =
      Boolean(myName) && (lower.includes(myName) || (myFirst.length >= 4 && lower.includes(myFirst)));

    const greeting = /(^|[\s,.!])(привет|прив|здравствуй|здравствуйте|хай|йо|ку|доброе утро|добрый день|добрый вечер|hello|hi)([\s,.!?]|$)/i.test(
      lower,
    );
    const question =
      text.includes("?") ||
      /(^|\s)(кто|что|почему|зачем|где|когда|как|правда|серьёзно|серьезно)(\s|$)/i.test(lower);
    const accusation = /(мафи|веша|голос|врёшь|врешь|подозр|виноват|убий)/i.test(lower);

    const canReply = () =>
      this.engine.phase !== "ended" &&
      this.spokenThisPhase < this.maxChat + 2 &&
      now - this.lastFreeReplyAt > 3800;

    const reply = (line, intent, targetId = speaker.id, priority = 2) => {
      if (!line || !canReply()) return false;
      this.lastFreeReplyAt = now;
      this.scheduleReply(
        { text: line, intent, targetId, channel: "public", priority },
        now,
      );
      return true;
    };

    if (greeting) {
      const chance = mentionsMe ? 0.9 : 0.28 + this.traits.chattiness * 0.34;
      if (this.rng() < chance) {
        const line = pickBotLine("greeting-reply", this.style, this.varsFor(speaker.id), this.rng);
        if (reply(line, "greeting-reply", speaker.id, 2.2)) return;
      }
    }

    if (mentionsMe && accusation) {
      this.pendingDefense = true;
      this.replyAt = now + Math.round(700 + this.rng() * 1400);
      reply(
        pickBotLine("defend-self", this.style, this.varsFor(speaker.id), this.rng),
        "defend-self",
        speaker.id,
        2.6,
      );
      return;
    }

    const claim = lower.match(/(^|\s)я\s+(шериф|доктор|шут|мирн(ый|ая|ые)?)(\s|[.,!]|$)/i);
    if (claim) {
      const role = claim[2].startsWith("шериф")
        ? "sheriff"
        : claim[2].startsWith("доктор")
          ? "doctor"
          : claim[2].startsWith("шут")
            ? "jester"
            : "civilian";
      if (role === "jester") this.addJesterRisk(speaker.id, 1.6);
      else this.rememberClaim(speaker.id, role);
      if (this.roleId === role) this.addSuspicion(speaker.id, 2.4);
    }

    if (accusation) {
      const mentioned = this.engine.players.filter((player) => {
        if (player.id === this.playerId || player.id === speaker.id) return false;
        const name = String(player.name ?? "").toLowerCase();
        if (!name) return false;
        const first = name.split(/\s+/)[0] ?? "";
        return lower.includes(name) || (first.length >= 4 && lower.includes(first));
      });
      for (const player of mentioned) {
        this.addSuspicion(player.id, 0.4 + this.trustOf(speaker.id) * 0.35);
      }
      if (mentioned.length && this.rng() < 0.3) {
        const victim = pickOne(mentioned, this.rng);
        if (
          reply(
            pickBotLine("agree", this.style, this.varsFor(victim.id), this.rng),
            "agree",
            victim.id,
            1.5,
          )
        ) {
          return;
        }
      }
    }

    if (question) {
      const chance = 0.28 + this.traits.logic * 0.38;
      if (this.rng() < chance) {
        const options = this.engine.players.filter((player) => player.id !== this.playerId && player.id !== speaker.id);
        const named = options.find((player) => {
          const name = String(player.name ?? "").toLowerCase();
          const first = name.split(/\s+/)[0] ?? "";
          return name && (lower.includes(name) || (first.length >= 4 && lower.includes(first)));
        });
        const line = pickBotLine(
          this.traits.logic < 0.4 ? "confusion" : "answer",
          this.style,
          this.varsFor(named?.id ?? speaker.id),
          this.rng,
        );
        if (reply(line, "answer", named?.id ?? speaker.id, 1.6)) return;
      }
    }

    if (mentionsMe && this.rng() < 0.45) {
      reply(
        pickBotLine("smalltalk", this.style, {}, this.rng),
        "smalltalk",
        speaker.id,
        1.2,
      );
      return;
    }

    if (!greeting && !question && this.rng() < this.traits.chattiness * 0.07) {
      reply(pickBotLine("smalltalk", this.style, {}, this.rng), "smalltalk", speaker.id, 0.8);
    }
  }

  scheduleReply(reply, now) {
    if (!reply?.text) return;
    this.pendingReply = reply;
    this.replyAt = now + Math.round(2200 + this.rng() * 3200);
  }

  sendLastWords(now) {
    if (this.lastWordsSent) return;
    this.lastWordsSent = true;
    const suspects = this.engine.players.filter(
      (player) => player.alive && player.id !== this.playerId,
    );
    const suspect = pickOne(suspects, this.rng);
    const text =
      this.roleId === "jester"
        ? pickBotLine("claim-jester", this.style, {}, this.rng)
        : pickBotLine("last-words", this.style, this.varsFor(suspect?.id), this.rng);
    this.engine.addBotChat(this.playerId, text, {
      channel: "public",
      intent: "last-words",
      targetId: suspect?.id ?? null,
    });
  }

  // -----------------------------------------------------------------------
  // Memory helpers
  // -----------------------------------------------------------------------

  suspicionOf(targetId) {
    if (!targetId || targetId === this.playerId) return -100;
    const target = this.engine.getPlayer(targetId);
    if (!target?.alive) return -100;
    if (this.canSeeMafia && target.team === "mafia") return -100;
    let base = this.memory.suspicion.get(targetId);
    if (base === undefined) {
      base = (stableNoise(this.playerId, targetId, "sus") - 0.5) * 0.7;
      this.memory.suspicion.set(targetId, base);
    }
    if (this.roleId === "sheriff") {
      const result = this.player.investigations?.find((entry) => entry.targetId === targetId);
      if (result?.result === "mafia") base += 8;
      if (result?.result === "clean") base -= 2.4;
    }
    const claims = this.claimsOf(targetId);
    if (claims?.role === "sheriff" && this.roleId === "sheriff") base += 4;
    if (claims?.role === "doctor" && this.roleId === "doctor") base += 3;
    return base;
  }

  addSuspicion(targetId, delta) {
    if (!targetId) return;
    const target = this.engine.getPlayer(targetId);
    if (!target) return;
    if (this.canSeeMafia && target.team === "mafia") return;
    const now = this.engine.clock();
    const current = this.suspicionOf(targetId);
    const lock = this.memory.opinionLock.get(targetId);
    // A bot that has just made up its mind sticks to it for a while: incoming
    // chat can nudge the number, but it cannot flip the sign in one sentence.
    let applied = delta;
    if (lock && now < lock.until) {
      if ((delta > 0 && current < 0) || (delta < 0 && current > 0)) applied = delta * 0.15;
      else applied = delta * 0.55;
    }
    const next = Math.max(-12, Math.min(20, current + applied));
    this.memory.suspicion.set(targetId, next);
    if (Math.abs(applied) >= 0.85) {
      this.memory.opinionLock.set(targetId, { until: now + 12_000 + this.rng() * 8000, at: now });
    }
  }

  jesterRiskOf(targetId) {
    return this.memory.jesterRisk.get(targetId) ?? 0;
  }

  addJesterRisk(targetId, delta) {
    const current = this.jesterRiskOf(targetId);
    this.memory.jesterRisk.set(targetId, Math.max(0, Math.min(12, current + delta)));
  }

  addTrust(playerId, delta) {
    const current = this.memory.trust.get(playerId) ?? 0.5;
    this.memory.trust.set(playerId, Math.max(0, Math.min(1, current + delta)));
  }

  trustOf(playerId) {
    return this.memory.trust.get(playerId) ?? 0.5;
  }

  rememberClaim(playerId, role) {
    this.memory.claims.set(playerId, { role, at: this.engine.clock(), day: this.engine.day });
  }

  claimsOf(playerId) {
    return this.memory.claims.get(playerId) ?? null;
  }

  claimCredibility(playerId, role) {
    const claim = this.claimsOf(playerId);
    if (claim?.role && claim.role !== role) return 0.25;
    if (this.roleId === "sheriff" && playerId !== this.playerId) return 0.2;
    return 0.7 + this.trustOf(playerId) * 0.3;
  }

  credibleSheriffResult() {
    if (this.roleId === "sheriff") return null;
    const claims = [...this.memory.claims.entries()].filter(
      ([id, claim]) => claim.role === "sheriff" && id !== this.playerId,
    );
    if (claims.length !== 1) return null;
    const [sheriffId] = claims[0];
    const result = this.memory.recentAccusations
      .filter((entry) => entry.speaker === sheriffId && entry.key.startsWith("result-mafia:"))
      .at(-1);
    if (!result?.targetId) return null;
    const target = this.engine.getPlayer(result.targetId);
    if (!target?.alive) return null;
    if (this.jesterRiskOf(target.id) > 4) return null;
    return { targetId: target.id, sheriffId };
  }

  recentlyAccusedMe(accuserId) {
    return this.memory.recentAccusations.some(
      (entry) => entry.speaker === accuserId && entry.targetId === this.playerId,
    );
  }

  threatOf(targetId) {
    const target = this.engine.getPlayer(targetId);
    if (!target) return 0;
    if (this.canSeeMafia && target.team === "mafia") return -100;
    let score = this.rng() * 0.6;
    const claim = this.claimsOf(targetId);
    if (claim?.role === "sheriff") score += 4.2;
    else if (claim?.role === "doctor") score += 3.1;
    else if (claim?.role === "civilian") score += 0.2;
    else if (claim?.role === "jester") score -= 0.8;
    const messages = this.engine.chat.filter((message) => message.playerId === targetId).length;
    score += Math.min(2.2, messages * 0.14);
    score -= this.jesterRiskOf(targetId) * 0.5;
    return score;
  }

  varsFor(targetId) {
    const target = targetId ? this.engine.getPlayer(targetId) : null;
    return {
      name: target?.name ?? "кто-то",
      me: this.player?.name ?? "я",
      day: this.engine.day,
    };
  }

  scheduleChat(plan) {
    if (!plan?.text) return false;
    const item = this.director.request({
      bot: this,
      text: plan.text,
      intent: plan.intent ?? "emote",
      targetId: plan.targetId ?? null,
      channel: plan.channel ?? "public",
      delay: plan.delay ?? 0,
      priority: plan.priority ?? 1,
    });
    return Boolean(item);
  }
}

/**
 * Owns all bot brains and the shared chat director. The host session ticks it
 * with the same virtual clock as the engine, so spectator speed controls work.
 */
export class BotRuntime {
  constructor({ engine, level = "normal", rng = Math.random }) {
    this.engine = engine;
    this.rng = rng;
    this.level = BOT_CHAT_LEVELS[level] ? level : "normal";
    this.director = new ChatDirector({ engine, level: this.level, rng });
    this.brains = new Map();
    this._offChat = engine.on("chat", (message) => this.handleChat(message));
    this.sync();
  }

  setLevel(level) {
    if (!BOT_CHAT_LEVELS[level]) return;
    this.level = level;
    this.director.setLevel(level);
    for (const brain of this.brains.values()) brain.level = BOT_CHAT_LEVELS[level];
  }

  sync() {
    const bots = this.engine.players.filter((player) => player.isBot);
    for (const bot of bots) {
      if (!this.brains.has(bot.id)) {
        this.brains.set(
          bot.id,
          new BotBrain({
            engine: this.engine,
            playerId: bot.id,
            level: this.level,
            director: this.director,
            rng: seededRng(`${this.engine.roomCode}:${bot.id}:brain`),
          }),
        );
      }
    }
    for (const id of [...this.brains.keys()]) {
      if (!this.engine.getPlayer(id)) this.brains.delete(id);
    }
  }

  tick(now = this.engine.clock()) {
    this.sync();
    if (this.engine.config.botChat !== this.level) this.setLevel(this.engine.config.botChat);
    for (const brain of this.brains.values()) brain.tick(now);
    this.director.tick(now);
  }

  handleChat(message) {
    for (const brain of this.brains.values()) {
      if (this.engine.canSeeChat(message, brain.playerId)) {
        brain.onChat(message);
      }
    }
  }

  dispose() {
    this._offChat?.();
    this.brains.clear();
    this.director.clear();
  }
}
