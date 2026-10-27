/**
 * Roles, teams and automatic role balance.
 * Pure data + functions, safe to import in Node tests and in the browser.
 */

export const TEAMS = Object.freeze({
  town: Object.freeze({
    id: "town",
    name: "Город",
    short: "ГОРОД",
    color: "#4fb477",
    glow: "rgba(79, 180, 119, .55)",
    win: "Все мафиози мертвы.",
  }),
  mafia: Object.freeze({
    id: "mafia",
    name: "Мафия",
    short: "МАФИЯ",
    color: "#e14c5a",
    glow: "rgba(225, 76, 90, .55)",
    win: "Мафия сравнялась числом с городом.",
  }),
  neutral: Object.freeze({
    id: "neutral",
    name: "Нейтрал",
    short: "НЕЙТРАЛ",
    color: "#a66bff",
    glow: "rgba(166, 107, 255, .55)",
    win: "Шут должен быть повешен на голосовании.",
  }),
});

export const ROLES = Object.freeze({
  mafia: Object.freeze({
    id: "mafia",
    name: "Мафия",
    team: "mafia",
    icon: "assets/img/roles/mafia.png",
    color: "#e14c5a",
    tagline: "Ночной город — твой.",
    short: "Убивает ночью вместе с командой. Знает своих.",
    description:
      "Каждую ночь мафия сообща выбирает жертву. Ты знаешь, кто в команде, и можешь говорить с ними в закрытом чате. Днём притворяйся мирным, срывай голосование и уводи подозрения на других.",
    abilities: [
      "Ночью голосует за убийство вместе с командой.",
      "Видит состав мафии и её ночной чат.",
      "Побеждает, когда мафии становится не меньше, чем остальных живых.",
    ],
    tips: "Не убивай молчунов — они полезны. Убирай тех, кому верят.",
    night: true,
  }),
  sheriff: Object.freeze({
    id: "sheriff",
    name: "Шериф",
    team: "town",
    alias: "Комиссар",
    icon: "assets/img/roles/sheriff.png",
    color: "#4fb477",
    tagline: "Правда стоит одной пули.",
    short: "Раз в ночь проверяет одного игрока.",
    description:
      "Ты — комиссар города. Ночью выбираешь игрока и узнаёшь, мафия он или нет. Результат приходит тебе лично. Днём решай, когда раскрыться: правда может спасти город, а может сделать тебя первой целью мафии.",
    abilities: [
      "Ночью проверяет одного игрока: «мафия» или «не мафия».",
      "Ассасин проверяется как мафия.",
      "Не может проверять себя.",
    ],
    tips: "Не раскрывайся слишком рано. Один точный результат сильнее трёх догадок.",
    night: true,
  }),
  civilian: Object.freeze({
    id: "civilian",
    name: "Мирный",
    team: "town",
    icon: "assets/img/roles/civilian.png",
    color: "#4fb477",
    tagline: "У города есть ты.",
    short: "Ночью спит, днём ищет мафию.",
    description:
      "У тебя нет ночной способности, зато есть голос, логика и право задавать неудобные вопросы. Слушай, сопоставляй, спорь. Именно мирные решают, кого город повесит сегодня.",
    abilities: [
      "Ночью отдыхает.",
      "Днём обсуждает, голосует и может раскрыться как мирный.",
      "Побеждает вместе с городом.",
    ],
    tips: "Иногда молчание — тоже информация. Считай, кто кого защищает.",
    night: false,
  }),
  doctor: Object.freeze({
    id: "doctor",
    name: "Доктор",
    team: "town",
    icon: "assets/img/roles/doctor.png",
    color: "#4fb477",
    tagline: "Кто-то должен выжить.",
    short: "Лечит одного игрока за ночь.",
    description:
      "Каждую ночь ты выбираешь, кого спасти. Если мафия атакует этого игрока, он выживет. Нельзя лечить одного и того же игрока две ночи подряд. Себя можно спасти только один раз за игру.",
    abilities: [
      "Ночью лечит одного живого игрока, включая себя.",
      "Нельзя лечить одного игрока две ночи подряд.",
      "Самолечение доступно один раз за игру.",
      "Контракт ассасина пробивает лечение.",
    ],
    tips: "Лечи тех, кого мафия боится, а не тех, кого жалко.",
    night: true,
  }),
  assassin: Object.freeze({
    id: "assassin",
    name: "Ассасин",
    team: "mafia",
    icon: "assets/img/roles/assassin.png",
    color: "#e14c5a",
    tagline: "Один контракт. Одна тень.",
    short: "Мафия. Один раз убивает сквозь лечение.",
    description:
      "Ты — тень мафии. Участвуешь в ночном выборе команды, но у тебя есть личный контракт: один раз за игру, начиная со второй ночи, ты можешь убить любого игрока. Эта смерть игнорирует доктора. Шериф видит тебя как мафию.",
    abilities: [
      "Играет за мафию и знает команду.",
      "Один раз за игру (со 2-й ночи) подписывает контракт.",
      "Жертва контракта умирает даже под защитой доктора.",
      "Шериф проверяет тебя как мафию.",
    ],
    tips: "Придержи контракт для шерифа или доктора. Один точный удар решает игру.",
    night: true,
  }),
  jester: Object.freeze({
    id: "jester",
    name: "Шут",
    team: "neutral",
    icon: "assets/img/roles/jester.png",
    color: "#a66bff",
    tagline: "Смейся, пока вешают.",
    short: "Побеждает, если его повесят на голосовании.",
    description:
      "Ты — одинокий шут. Твоя цель — быть повешенным голосованием города. Если тебя убьют ночью, ты проиграешь. Если город тебя повесит — ты побеждаешь немедленно, даже если мафия ещё жива. В игре может быть только один шут.",
    abilities: [
      "Побеждает сразу, если его исключили голосованием.",
      "Проигрывает, если погиб ночью или игра закончилась без его казни.",
      "В игре максимум один шут.",
    ],
    tips: "Веди себя подозрительно, но не слишком очевидно. Если все поймут, что ты шут, — не повесят.",
    night: false,
  }),
});

export const ROLE_ORDER = Object.freeze([
  "mafia",
  "assassin",
  "sheriff",
  "doctor",
  "civilian",
  "jester",
]);

export const TEAM_ORDER = Object.freeze(["mafia", "town", "neutral"]);

export const ROLE_LIMITS = Object.freeze({
  minPlayers: 4,
  maxPlayers: 20,
  minStart: 4,
  maxJester: 1,
});

export const BOT_CHAT_LEVELS = Object.freeze({
  quiet: { id: "quiet", name: "Тихие", maxPerPhase: 2, chance: 0.35, gap: 8 },
  normal: { id: "normal", name: "Обычные", maxPerPhase: 4, chance: 0.65, gap: 5 },
  loud: { id: "loud", name: "Болтливые", maxPerPhase: 7, chance: 0.9, gap: 3 },
});

export const DEFAULT_ROOM_CONFIG = Object.freeze({
  name: "Ночной город",
  maxPlayers: 8,
  minStart: 5,
  public: true,
  quick: false,
  roles: Object.freeze({
    doctor: true,
    assassin: false,
    jester: false,
  }),
  timers: Object.freeze({
    night: 28,
    discussion: 75,
    voting: 30,
  }),
  botChat: "normal",
  revealOnDeath: true,
  allowSpectators: true,
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Validate and normalize a room config without throwing on junk input. */
export function normalizeRoomConfig(input = {}, playerCount) {
  const base = DEFAULT_ROOM_CONFIG;
  const src = input && typeof input === "object" ? input : {};
  const roles = src.roles && typeof src.roles === "object" ? src.roles : {};
  const timers = src.timers && typeof src.timers === "object" ? src.timers : {};
  const count = clampInt(playerCount ?? src.maxPlayers, ROLE_LIMITS.minPlayers, ROLE_LIMITS.maxPlayers, base.maxPlayers);
  const maxPlayers = clampInt(src.maxPlayers, ROLE_LIMITS.minPlayers, ROLE_LIMITS.maxPlayers, count);
  const minStart = clampInt(src.minStart, ROLE_LIMITS.minStart, maxPlayers, Math.min(5, maxPlayers));
  return {
    name: String(src.name ?? base.name).slice(0, 32) || base.name,
    maxPlayers,
    minStart,
    public: src.public !== false && src.public !== 0,
    quick: src.quick === true || src.quick === 1,
    roles: {
      doctor: roles.doctor !== false && roles.doctor !== 0,
      assassin: roles.assassin === true || roles.assassin === 1,
      jester: roles.jester === true || roles.jester === 1,
    },
    timers: {
      night: clampInt(timers.night, 12, 90, base.timers.night),
      discussion: clampInt(timers.discussion, 20, 240, base.timers.discussion),
      voting: clampInt(timers.voting, 12, 90, base.timers.voting),
    },
    botChat: BOT_CHAT_LEVELS[src.botChat] ? src.botChat : base.botChat,
    revealOnDeath: src.revealOnDeath !== false && src.revealOnDeath !== 0,
    allowSpectators: src.allowSpectators !== false && src.allowSpectators !== 0,
  };
}

/**
 * Automatic balance. Returns role ids, counts and human-readable warnings.
 * `options` is `config.roles`.
 */
export function computeRoleSetup(playerCount, options = {}) {
  const n = clampInt(playerCount, ROLE_LIMITS.minPlayers, ROLE_LIMITS.maxPlayers, 8);
  const warnings = [];
  let mafiaTeam = Math.max(1, Math.floor((n + 2) / 4));
  mafiaTeam = Math.min(mafiaTeam, 5);

  let assassin = options.assassin === true && n >= 8 ? 1 : 0;
  if (options.assassin === true && n < 8) warnings.push("Ассасин доступен от 8 игроков.");

  let doctor = options.doctor !== false && n >= 5 ? 1 : 0;
  if (options.doctor !== false && n < 5) warnings.push("Доктор доступен от 5 игроков.");

  let jester = options.jester === true && n >= 7 ? 1 : 0;
  if (options.jester === true && n < 7) warnings.push("Шут доступен от 7 игроков.");

  // Assassin replaces one mafia member, keeping the mafia size balanced.
  let mafia = mafiaTeam - assassin;
  if (assassin && mafia < 1) {
    assassin = 0;
    mafia = mafiaTeam;
  }

  let civilians = n - mafia - assassin - 1 - doctor - jester;
  if (civilians < 1) {
    if (jester) {
      jester = 0;
      civilians += 1;
      warnings.push("Шут отключён: слишком мало мирных для баланса.");
    } else if (doctor) {
      doctor = 0;
      civilians += 1;
      warnings.push("Доктор отключён: слишком мало мирных для баланса.");
    }
  }
  if (civilians < 1) {
    // Extremely defensive fallback; should never happen for n >= 4.
    civilians = 1;
    warnings.push("Баланс скорректирован автоматически.");
  }

  const counts = {
    mafia,
    assassin,
    sheriff: 1,
    doctor,
    civilian: civilians,
    jester,
  };

  // Sanity: total must match exactly.
  let total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total !== n) {
    counts.civilian += n - total;
    total = n;
  }

  const ids = [];
  for (const [roleId, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) ids.push(roleId);
  }

  return {
    playerCount: n,
    mafiaTeam: mafia + assassin,
    counts,
    ids,
    warnings,
  };
}

export function getRole(roleId) {
  return ROLES[roleId] ?? null;
}

export function getTeam(teamId) {
  return TEAMS[teamId] ?? null;
}

export function getRoleIcon(roleId) {
  return ROLES[roleId]?.icon ?? ROLES.civilian.icon;
}

export function isMafiaRole(roleId) {
  return ROLES[roleId]?.team === "mafia";
}

export function roleNames() {
  return ROLE_ORDER.map((id) => ROLES[id].name);
}
