/**
 * Roles, teams and automatic role balance.
 * Pure data + functions, safe to import in Node tests and in the browser.
 *
 * Room configs store a *count* per optional role, not a boolean: the host can
 * put three doctors or two jesters into the same city. Twins are the only
 * exception — they always come in a pair.
 */

/**
 * Game modes. `classic` is the original city, `secret` hides the dead and the
 * mafia family from each other, `zombie` turns night kills into converts.
 */
export const ROOM_MODES = Object.freeze({
  classic: Object.freeze({
    id: "classic",
    name: "Классика",
    short: "Мафия знает своих, мёртвые раскрываются.",
    description:
      "Привычная партия: мафия видит команду и говорит в закрытом чате, роли погибших открываются, а победа приходит по перевесу.",
  }),
  secret: Object.freeze({
    id: "secret",
    name: "Тайная Мафия",
    short: "Мафия не знает своих. Мёртвые молчат о ролях.",
    description:
      "Роли погибших скрыты, мафия не знает друг друга и может убивать своих. Закрытого чата мафии нет. Особые знания остаются только у шерифа, шпиона и кукловода.",
  }),
  zombie: Object.freeze({
    id: "zombie",
    name: "Зомби",
    short: "Ночные жертвы становятся зомби-мафией.",
    description:
      "Мафия не убивает, а обращает. Доктор защищает от обращения, судья и голосование уничтожают зомби. Ночью имена жертв не раскрываются. Побеждают только изначальные мафиози.",
  }),
});

export const MODE_ORDER = Object.freeze(["classic", "secret", "zombie"]);

/** Roles allowed in the zombie mode. Everything else is trimmed. */
export const ZOMBIE_ROLE_IDS = Object.freeze([
  "mafia",
  "sheriff",
  "doctor",
  "musician",
  "judge",
  "civilian",
]);

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
    win: "У каждого нейтрала своя цель: шут, кукловод и близнецы побеждают по-разному.",
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
    seesMafia: true,
  }),
  assassin: Object.freeze({
    id: "assassin",
    name: "Ассасин",
    team: "mafia",
    icon: "assets/img/roles/assassin.png",
    color: "#e14c5a",
    tagline: "Один контракт. Одна жизнь.",
    short: "Мафия. Один раз убивает и сам платит жизнью.",
    description:
      "Ты — тень мафии. Участвуешь в ночном выборе команды, но у тебя есть личный контракт: один раз за игру, начиная со второй ночи, ты можешь убить любого игрока. Жертва умирает даже под защитой доктора, но контракт забирает и твою жизнь — если доктор не прикроет тебя этой же ночью. Шериф видит тебя как мафию.",
    abilities: [
      "Играет за мафию и знает команду.",
      "Один раз за игру (со 2-й ночи) подписывает контракт.",
      "Жертва контракта умирает даже под защитой доктора.",
      "После контракта ассасин погибает, если доктор не лечил его этой ночью.",
      "Шериф проверяет тебя как мафию.",
    ],
    tips: "Контракт — размен. Бей, когда твоя смерть выгодна команде.",
    night: true,
    seesMafia: true,
  }),
  bartender: Object.freeze({
    id: "bartender",
    name: "Бармен",
    team: "mafia",
    icon: "assets/img/roles/bartender.png",
    color: "#e14c5a",
    tagline: "Ещё одна рюмка — и город поплывёт.",
    short: "Мафия. Поит игрока, и его сообщения превращаются в кашу.",
    description:
      "Ты играешь на стороне мафии, но не знаешь, кто именно в команде, и не читаешь её закрытый чат. Зато писать туда можешь. Ночью выбираешь игрока и поишь его: весь следующий день его сообщения в чате превращаются в случайный набор символов. Побеждаешь вместе с мафией.",
    abilities: [
      "Ночью поит одного игрока.",
      "Напоённый игрок весь следующий день пишет только бессмысленные символы.",
      "Может писать в чат мафии, но не видит его и не знает состав мафии.",
      "Побеждает вместе с мафией.",
    ],
    tips: "Пои того, кто может сорвать голосование. Молчание иногда громче слов.",
    night: true,
    seesMafia: false,
  }),
  spy: Object.freeze({
    id: "spy",
    name: "Шпион",
    team: "mafia",
    icon: "assets/img/roles/spy.png",
    color: "#e14c5a",
    tagline: "Одно имя. Одна тайна.",
    short: "Мафия. Днём узнаёт точную роль игрока.",
    description:
      "Ты работаешь на мафию, но не знаешь её состава и не читаешь закрытый чат. Днём, один раз за день, ты можешь узнать точную роль любого игрока. Побеждаешь вместе с мафией.",
    abilities: [
      "Раз в день узнаёт точную роль одного игрока.",
      "Может писать в общий чат как обычный игрок.",
      "Не видит мафию и её закрытый чат.",
      "Побеждает вместе с мафией.",
    ],
    tips: "Собери имена и передай их так, чтобы город не понял, откуда информация.",
    night: false,
    seesMafia: false,
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
      "Ассасин, бармен и шпион проверяются как мафия.",
      "Не может проверять себя.",
    ],
    tips: "Не раскрывайся слишком рано. Один точный результат сильнее трёх догадок.",
    night: true,
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
      "Контракт ассасина пробивает лечение жертвы, но лечение ассасина спасает его от расплаты.",
    ],
    tips: "Лечи тех, кого мафия боится, а не тех, кого жалко.",
    night: true,
  }),
  musician: Object.freeze({
    id: "musician",
    name: "Музыкант",
    team: "town",
    icon: "assets/img/roles/musician.png",
    color: "#4fb477",
    tagline: "Сегодня город танцует под чужую дудку.",
    short: "Ночью блокирует действия и голос игрока.",
    description:
      "Ты приходишь к игроку ночью и играешь до утра. Он не может действовать ночью, использовать способности днём и голосовать. Мафия, доктор, шериф, шпион, судья — все засыпают под твою музыку.",
    abilities: [
      "Ночью выбирает игрока и блокирует его.",
      "Заблокированный не действует этой ночью.",
      "Весь следующий день он не может голосовать и использовать способности.",
      "Не может выбрать себя.",
    ],
    tips: "Блокируй не самого громкого, а самого собранного: он опаснее.",
    night: true,
  }),
  judge: Object.freeze({
    id: "judge",
    name: "Судья",
    team: "town",
    icon: "assets/img/roles/judge.png",
    color: "#4fb477",
    tagline: "Приговор нельзя обжаловать.",
    short: "Один раз за игру казнит игрока днём.",
    description:
      "Один раз за игру ты можешь вынести приговор прямо днём. Если выбранный игрок — мафия, он умирает. Если нет — умираешь ты, а он остаётся жив. Судья не может советоваться с городом: решение принимается сразу.",
    abilities: [
      "Один раз за игру днём казнит выбранного игрока.",
      "Если цель — мафия, погибает цель.",
      "Если цель не мафия, погибает судья, а цель выживает.",
      "Не может использовать способность, если его заблокировал музыкант.",
    ],
    tips: "Не рискуй без проверки. Ошибка судьи стоит городу двух голосов.",
    night: false,
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
  jester: Object.freeze({
    id: "jester",
    name: "Шут",
    team: "neutral",
    icon: "assets/img/roles/jester.png",
    color: "#a66bff",
    tagline: "Смейся, пока вешают.",
    short: "Побеждает, если его повесят на голосовании.",
    description:
      "Ты — одинокий шут. Твоя цель — быть повешенным голосованием города. Если тебя убьют ночью, ты проиграешь. Если город тебя повесит — ты побеждаешь немедленно, даже если мафия ещё жива.",
    abilities: [
      "Побеждает сразу, если его исключили голосованием.",
      "Проигрывает, если погиб ночью или игра закончилась без его казни.",
      "Может быть несколько шутов — каждый играет сам за себя.",
    ],
    tips: "Веди себя подозрительно, но не слишком очевидно. Если все поймут, что ты шут, — не повесят.",
    night: false,
  }),
  puppeteer: Object.freeze({
    id: "puppeteer",
    name: "Кукловод",
    team: "neutral",
    icon: "assets/img/roles/puppeteer.png",
    color: "#a66bff",
    tagline: "Чужая победа — тоже победа.",
    short: "Выбирает игрока и побеждает вместе с его командой.",
    description:
      "Один раз за игру ночью ты выбираешь марионетку. Если команда выбранного игрока победит — ты побеждаешь вместе с ней. Шут и близнец тоже считаются: выбери того, кто может выиграть по-своему.",
    abilities: [
      "Ночью один раз выбирает игрока на всю игру.",
      "Побеждает вместе с командой выбранного игрока.",
      "Если марионетка — шут или близнец, их личная победа тоже твоя.",
      "Может быть несколько кукловодов.",
    ],
    tips: "Выбирай не самого сильного, а того, кто доживёт до финала.",
    night: true,
  }),
  twin: Object.freeze({
    id: "twin",
    name: "Близнец",
    team: "neutral",
    icon: "assets/img/roles/twin.png",
    color: "#a66bff",
    tagline: "Один умрёт. Второй получит всё.",
    short: "Два близнеца. Один должен пережить голосование другого.",
    description:
      "В городе всегда двое близнецов, и они не знают друг друга. Если один погибает, второй умирает следом. Но если одного повесят на голосовании — второй побеждает немедленно. Судья и ночные убийцы не считаются: после них победы нет.",
    abilities: [
      "В игре ровно два близнеца, они не видят друг друга.",
      "Если один умирает не на голосовании, второй умирает тоже.",
      "Если одного повесили голосованием, второй побеждает.",
      "Судья и ночные убийства не приносят победы.",
    ],
    tips: "Подставь другого близнеца под голосование. Только не себя.",
    night: false,
    pair: true,
  }),
});

/** Display order for role lists and setup previews. */
export const ROLE_ORDER = Object.freeze([
  "mafia",
  "assassin",
  "bartender",
  "spy",
  "sheriff",
  "doctor",
  "musician",
  "judge",
  "civilian",
  "jester",
  "puppeteer",
  "twin",
]);

export const TEAM_ORDER = Object.freeze(["mafia", "town", "neutral"]);

/** Total number of distinct roles in the game (kept in one place for UI copy). */
export const allRoles = ROLE_ORDER.length;

/** Optional roles with an adjustable count. `sheriff` is always one. */
export const ROLE_CONFIG_KEYS = Object.freeze([
  "mafia",
  "sheriff",
  "civilian",
  "assassin",
  "bartender",
  "spy",
  "doctor",
  "musician",
  "judge",
  "puppeteer",
  "jester",
  "twin",
]);

export const ROLE_LIMITS = Object.freeze({
  minPlayers: 4,
  maxPlayers: 25,
  minStart: 4,
  maxRoleCount: 6,
  maxMafia: 8,
  maxSheriff: 5,
  maxCivilian: 25,
  twinCount: 2,
});

export const BOT_CHAT_LEVELS = Object.freeze({
  quiet: { id: "quiet", name: "Тихие", maxPerPhase: 2, chance: 0.35, gap: 12 },
  normal: { id: "normal", name: "Обычные", maxPerPhase: 4, chance: 0.65, gap: 8 },
  loud: { id: "loud", name: "Болтливые", maxPerPhase: 6, chance: 0.9, gap: 6 },
});

export const DEFAULT_ROOM_CONFIG = Object.freeze({
  name: "Ночной город",
  mode: "classic",
  maxPlayers: 8,
  minStart: 5,
  public: true,
  quick: false,
  roles: Object.freeze({
    mafia: 0,
    sheriff: 1,
    civilian: -1,
    assassin: 0,
    bartender: 0,
    spy: 0,
    doctor: 1,
    musician: 0,
    judge: 0,
    puppeteer: 0,
    jester: 0,
    twin: 0,
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

/**
 * Accepts numbers, booleans (old rooms) and numeric strings.
 * `fallback` is used only when the key is missing entirely.
 */
export function roleCount(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (value === true) return 1;
  if (value === false) return 0;
  return clampInt(value, 0, ROLE_LIMITS.maxRoleCount, fallback);
}

/** Twins are all-or-nothing: any positive request means a pair. */
export function twinCount(value) {
  if (value === true) return ROLE_LIMITS.twinCount;
  if (value === false || value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n > 0 ? ROLE_LIMITS.twinCount : 0;
}

/** Validate and normalize a room config without throwing on junk input. */
export function normalizeRoomConfig(input = {}, playerCount) {
  const base = DEFAULT_ROOM_CONFIG;
  const src = input && typeof input === "object" ? input : {};
  const rolesSrc = src.roles && typeof src.roles === "object" ? src.roles : {};
  const timers = src.timers && typeof src.timers === "object" ? src.timers : {};
  const count = clampInt(playerCount ?? src.maxPlayers, ROLE_LIMITS.minPlayers, ROLE_LIMITS.maxPlayers, base.maxPlayers);
  const maxPlayers = clampInt(src.maxPlayers, ROLE_LIMITS.minPlayers, ROLE_LIMITS.maxPlayers, count);
  const minStart = clampInt(src.minStart, ROLE_LIMITS.minStart, maxPlayers, Math.min(5, maxPlayers));

  const roles = {
    // 0 means "auto" for mafia; -1 means "auto" for civilians.
    mafia: clampInt(rolesSrc.mafia, 0, ROLE_LIMITS.maxMafia, base.roles.mafia),
    sheriff: clampInt(rolesSrc.sheriff, 0, ROLE_LIMITS.maxSheriff, base.roles.sheriff),
    civilian: clampInt(rolesSrc.civilian, -1, ROLE_LIMITS.maxCivilian, base.roles.civilian),
    assassin: roleCount(rolesSrc.assassin, base.roles.assassin),
    bartender: roleCount(rolesSrc.bartender, base.roles.bartender),
    spy: roleCount(rolesSrc.spy, base.roles.spy),
    doctor: roleCount(rolesSrc.doctor, base.roles.doctor),
    musician: roleCount(rolesSrc.musician, base.roles.musician),
    judge: roleCount(rolesSrc.judge, base.roles.judge),
    puppeteer: roleCount(rolesSrc.puppeteer, base.roles.puppeteer),
    jester: roleCount(rolesSrc.jester, base.roles.jester),
    twin: twinCount(rolesSrc.twin),
  };

  return {
    name: String(src.name ?? base.name).slice(0, 32) || base.name,
    mode: ROOM_MODES[src.mode] ? src.mode : base.mode,
    maxPlayers,
    minStart,
    public: src.public !== false && src.public !== 0,
    quick: src.quick === true || src.quick === 1,
    roles,
    timers: {
      night: clampInt(timers.night, 12, 90, base.timers.night),
      discussion: clampInt(timers.discussion, 20, 240, base.timers.discussion),
      voting: clampInt(timers.voting, 20, 90, base.timers.voting),
    },
    botChat: BOT_CHAT_LEVELS[src.botChat] ? src.botChat : base.botChat,
    revealOnDeath: src.revealOnDeath !== false && src.revealOnDeath !== 0,
    allowSpectators: src.allowSpectators !== false && src.allowSpectators !== 0,
  };
}

/**
 * Automatic balance. Returns role ids, counts and human-readable warnings.
 * `options` is `config.roles` (counts, with old booleans still accepted).
 */
export function computeRoleSetup(playerCount, options = {}, mode = "classic") {
  const n = clampInt(playerCount, ROLE_LIMITS.minPlayers, ROLE_LIMITS.maxPlayers, 8);
  const warnings = [];
  const gameMode = ROOM_MODES[mode] ? mode : "classic";
  const allowed = gameMode === "zombie" ? new Set(ZOMBIE_ROLE_IDS) : null;
  const requested = {
    mafia: clampInt(options.mafia, 0, ROLE_LIMITS.maxMafia, 0),
    sheriff: clampInt(options.sheriff, 0, ROLE_LIMITS.maxSheriff, 1),
    civilian: clampInt(options.civilian, -1, ROLE_LIMITS.maxCivilian, -1),
    assassin: roleCount(options.assassin, 0),
    bartender: roleCount(options.bartender, 0),
    spy: roleCount(options.spy, 0),
    doctor: roleCount(options.doctor, 1),
    musician: roleCount(options.musician, 0),
    judge: roleCount(options.judge, 0),
    puppeteer: roleCount(options.puppeteer, 0),
    jester: roleCount(options.jester, 0),
    twin: twinCount(options.twin),
  };

  if (allowed) {
    for (const roleId of ["assassin", "bartender", "spy", "puppeteer", "jester", "twin"]) {
      if (requested[roleId] > 0) {
        warnings.push(`${ROLES[roleId].name} недоступен в режиме «Зомби» и убран из состава.`);
        requested[roleId] = 0;
      }
    }
  }

  const counts = {
    mafia: 0,
    assassin: requested.assassin,
    bartender: requested.bartender,
    spy: requested.spy,
    sheriff: requested.sheriff,
    doctor: requested.doctor,
    musician: requested.musician,
    judge: requested.judge,
    civilian: 0,
    jester: requested.jester,
    puppeteer: requested.puppeteer,
    twin: requested.twin,
  };

  const specialCount = () => counts.assassin + counts.bartender + counts.spy;
  const optionalCount = () =>
    counts.doctor + counts.musician + counts.judge + counts.puppeteer + counts.jester + counts.twin;
  const usedCount = () => counts.mafia + specialCount() + counts.sheriff + optionalCount();

  // Explicit mafia count is the whole family; 0 means automatic balance.
  const maxMafia = Math.max(1, Math.min(ROLE_LIMITS.maxMafia, n - 1));
  let mafiaTarget = requested.mafia > 0
    ? Math.min(maxMafia, Math.max(1, requested.mafia))
    : Math.max(1, Math.min(maxMafia, Math.floor((n + 2) / 4)));

  // Hidden mafia roles still need a plain killer next to them.
  if (specialCount() >= mafiaTarget) {
    mafiaTarget = Math.min(maxMafia, specialCount() + 1);
    for (const roleId of ["spy", "bartender", "assassin"]) {
      while (specialCount() >= mafiaTarget && counts[roleId] > 0) {
        counts[roleId] -= 1;
        warnings.push(`${ROLES[roleId].name} ×1 убран: мафии нужен хотя бы один обычный убийца.`);
      }
    }
  }
  counts.mafia = Math.max(1, mafiaTarget - specialCount());

  // Everything must fit into the city. Optional roles go first. Twins are a
  // fixed pair, so trimming removes both of them, never a lone twin.
  const trimOrder = ["twin", "puppeteer", "jester", "musician", "judge", "doctor"];
  while (usedCount() > n) {
    const roleId = trimOrder.find((id) => counts[id] > 0);
    if (!roleId) break;
    if (roleId === "twin") {
      counts.twin = Math.max(0, counts.twin - 2);
      warnings.push("Близнецы убраны: состав не помещается в город (близнецы ходят только парой).");
    } else {
      counts[roleId] -= 1;
      warnings.push(`${ROLES[roleId].name} ×1 убран: состав не помещается в ${n} игроков.`);
    }
  }
  while (usedCount() > n && counts.sheriff > 0) {
    counts.sheriff -= 1;
    warnings.push("Шериф ×1 убран: состав не помещается в город.");
  }
  while (usedCount() > n && counts.mafia > 1) {
    counts.mafia -= 1;
    warnings.push("Мафия ×1 убрана: состав не помещается в город.");
  }
  for (const roleId of ["spy", "bartender", "assassin"]) {
    while (usedCount() > n && counts[roleId] > 0) {
      counts[roleId] -= 1;
      warnings.push(`${ROLES[roleId].name} ×1 убран: состав не помещается в город.`);
    }
  }

  // Hard invariant: twins are always a pair. Any leftover single twin is
  // dropped before seats are finalised, so the counts stay consistent.
  if (counts.twin > 0 && counts.twin !== 2) {
    counts.twin = 0;
    warnings.push("Близнецы не в паре и убраны из состава.");
  }

  const remaining = Math.max(0, n - usedCount());
  if (requested.civilian >= 0) {
    counts.civilian = Math.min(requested.civilian, remaining);
    if (requested.civilian > remaining) {
      warnings.push("Мирных убрано: состав не помещается в город.");
    }
  } else {
    counts.civilian = remaining;
  }

  // If the host left free seats (for example, set civilians to zero), fill
  // them so every player still gets a role.
  const missing = n - usedCount() - counts.civilian;
  if (missing > 0) {
    counts.civilian += missing;
    warnings.push("Свободные места заполнены мирными.");
  }

  const mafiaTotal = counts.mafia + specialCount();

  const ids = [];
  for (const roleId of ROLE_ORDER) {
    for (let i = 0; i < (counts[roleId] ?? 0); i += 1) ids.push(roleId);
  }
  while (ids.length < n) ids.push("civilian");
  while (ids.length > n) {
    const index = ids.lastIndexOf("civilian");
    if (index < 0) break;
    ids.splice(index, 1);
  }

  return {
    playerCount: n,
    mode: gameMode,
    mafiaTeam: mafiaTotal,
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

/** Bartender and spy are mafia-sided but do not see the mafia roster/chat. */
export function hidesMafiaRoster(roleId) {
  return ROLES[roleId]?.seesMafia === false;
}

export function isMafiaCoreRole(roleId) {
  return roleId === "mafia" || roleId === "assassin";
}

export function roleNames() {
  return ROLE_ORDER.map((id) => ROLES[id].name);
}
