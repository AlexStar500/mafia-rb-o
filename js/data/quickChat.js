/**
 * Quick chat. Phrases are canonical: the server/host sends the id, never
 * trusted free text, so players cannot inject markup or fake another player.
 */

export const QUICK_CATEGORIES = Object.freeze([
  { id: "quick", name: "Быстрые сообщения", icon: "spark", tone: "gold" },
  { id: "accuse", name: "Обвинить", icon: "blade", tone: "danger" },
  { id: "defend", name: "Защита", icon: "shield", tone: "town" },
  { id: "role", name: "Роль", icon: "mask", tone: "gold" },
  { id: "question", name: "Вопрос", icon: "question", tone: "info" },
  { id: "vote", name: "Голос", icon: "vote", tone: "danger" },
  { id: "night", name: "Ночь", icon: "moon", tone: "night" },
  { id: "emote", name: "Эмоции", icon: "spark", tone: "muted" },
  { id: "dead", name: "Мёртвые", icon: "skull", tone: "muted" },
  { id: "chaos", name: "Шут", icon: "joker", tone: "neutral" },
]);

export const QUICK_MESSAGES = Object.freeze([
  // Быстрые сообщения — первая вкладка, работает в любом канале
  { id: "quick-1", cat: "quick", intent: "greeting", text: "Привет всем." },
  { id: "quick-2", cat: "quick", intent: "greeting", needsTarget: true, text: "Привет, {target}." },
  { id: "quick-3", cat: "quick", intent: "claim-role", needsRole: true, text: "Я — {role}." },
  { id: "quick-4", cat: "quick", intent: "claim-role", needsRole: true, text: "У меня {role}." },
  { id: "quick-5", cat: "quick", intent: "claim-civilian", text: "Я — Игрок." },
  { id: "quick-6", cat: "quick", intent: "question", text: "Кто здесь?" },
  { id: "quick-7", cat: "quick", intent: "smalltalk", text: "Давайте знакомиться." },
  { id: "quick-8", cat: "quick", intent: "smalltalk", text: "Я слушаю." },

  // Обвинения
  { id: "acc-1", cat: "accuse", intent: "accuse", needsTarget: true, text: "Я бы начал с игрока {target}." },
  { id: "acc-2", cat: "accuse", intent: "accuse", needsTarget: true, text: "История игрока {target} не сходится." },
  { id: "acc-3", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} слишком много знает для мирного." },
  { id: "acc-4", cat: "accuse", intent: "accuse", needsTarget: true, text: "Я не верю ни одному слову игрока {target}." },
  { id: "acc-5", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} защищает тех, кого стоит повесить." },
  { id: "acc-6", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} слишком удобно молчит." },
  { id: "acc-7", cat: "accuse", intent: "accuse", needsTarget: true, text: "Ставлю на игрока {target}." },
  { id: "acc-8", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} путается в именах и голосах." },
  { id: "acc-9", cat: "accuse", intent: "agree", needsTarget: true, text: "Согласен. Игрок {target} — лучший вариант на сегодня." },

  // Защита
  { id: "def-1", cat: "defend", intent: "defend", text: "Я мирный. Без роли." },
  { id: "def-2", cat: "defend", intent: "defend", text: "Меня подставляют." },
  { id: "def-3", cat: "defend", intent: "defend", text: "Не тратьте голос на меня." },
  { id: "def-4", cat: "defend", intent: "defend", text: "У вас нет доказательств." },
  { id: "def-5", cat: "defend", intent: "defend", text: "Я могу объяснить каждое слово." },
  { id: "def-6", cat: "defend", intent: "defend", text: "Проверьте меня, если хотите." },
  { id: "def-7", cat: "defend", intent: "defend", text: "Я голосую вместе с городом." },
  { id: "def-8", cat: "defend", intent: "defend", text: "Не дайте мафии разбить нас." },
  { id: "def-9", cat: "defend", intent: "defend-other", needsTarget: true, text: "Не трогайте игрока {target}. У него есть объяснение." },
  { id: "def-10", cat: "defend", intent: "disagree", text: "Не согласен. Это слишком удобная версия." },

  // Роль
  { id: "role-1", cat: "role", intent: "claim-sheriff", text: "Я шериф." },
  { id: "role-2", cat: "role", intent: "claim-doctor", text: "Я доктор." },
  { id: "role-3", cat: "role", intent: "claim-civilian", text: "Я обычный мирный." },
  { id: "role-4", cat: "role", intent: "claim-jester", text: "Я шут. Не голосуйте за меня." },
  { id: "role-5", cat: "role", intent: "result-mafia", needsTarget: true, text: "Моя проверка: игрок {target} — мафия." },
  { id: "role-6", cat: "role", intent: "result-clean", needsTarget: true, text: "Моя проверка: игрок {target} чист." },
  { id: "role-7", cat: "role", intent: "role-info", text: "У меня есть информация, но не всем её стоит слышать." },
  { id: "role-8", cat: "role", intent: "role-late", text: "Раскроюсь, если будет нужно." },
  { id: "role-9", cat: "role", intent: "claim-mafia", text: "Я мафия." },
  { id: "role-10", cat: "role", intent: "role-think", needsTarget: true, needsRole: true, text: "Я думаю, игрок {target} — {role}." },
  { id: "role-11", cat: "role", intent: "claim-sheriff", text: "Я шериф. Раскрываюсь." },
  { id: "role-12", cat: "role", intent: "claim-doctor", text: "Я доктор. Без пафоса." },
  { id: "role-13", cat: "role", intent: "claim-civilian", text: "Я мирный, у меня нет роли." },
  { id: "role-14", cat: "role", intent: "claim-jester", text: "Я шут. Повесьте меня, если скучно." },

  // Вопросы
  { id: "q-1", cat: "question", intent: "question", text: "Кто что видел ночью?" },
  { id: "q-2", cat: "question", intent: "question", text: "Почему все молчат?" },
  { id: "q-3", cat: "question", intent: "question", needsTarget: true, text: "Кто-нибудь верит словам игрока {target}?" },
  { id: "q-4", cat: "question", intent: "question", text: "Кого проверил шериф?" },
  { id: "q-5", cat: "question", intent: "question", text: "Почему голос именно против меня?" },
  { id: "q-6", cat: "question", intent: "question", text: "Кто ещё сомневается?" },
  { id: "q-7", cat: "question", intent: "question", needsTarget: true, text: "Кто голосует вместе с игроком {target}?" },
  { id: "q-8", cat: "question", intent: "question", needsTarget: true, text: "Что мы теряем, если повесим игрока {target}?" },
  { id: "q-9", cat: "question", intent: "confusion", text: "Я запутался. Объясните ещё раз, без обвинений." },

  // Голосование
  { id: "vote-1", cat: "vote", intent: "vote-call", needsTarget: true, text: "Голосуем против игрока {target}." },
  { id: "vote-2", cat: "vote", intent: "vote-call", text: "Собираем голоса." },
  { id: "vote-3", cat: "vote", intent: "vote-call", text: "Не голосуйте без доказательств." },
  { id: "vote-4", cat: "vote", intent: "vote-call", text: "Нужен второй голос." },
  { id: "vote-5", cat: "vote", intent: "skip", text: "Я пропускаю." },
  { id: "vote-6", cat: "vote", intent: "vote-call", needsTarget: true, text: "Игрок {target} не доживёт до утра." },
  { id: "vote-7", cat: "vote", intent: "vote-call", text: "Давайте решим сейчас." },
  { id: "vote-8", cat: "vote", intent: "vote-call", text: "Я меняю мнение. Дайте время." },

  // Ночь
  { id: "night-1", cat: "night", intent: "night", text: "Ночь будет долгой." },
  { id: "night-2", cat: "night", intent: "night", text: "Кто-то не проснётся." },
  { id: "night-3", cat: "night", intent: "night", text: "Доктор, прикрой меня." },
  { id: "night-4", cat: "night", intent: "night", text: "Я боюсь этой ночи." },
  { id: "night-5", cat: "night", intent: "night", text: "Мафия уже выбрала." },
  { id: "night-6", cat: "night", intent: "night", needsTarget: true, text: "Если я умру — ищите игрока {target}." },
  { id: "night-7", cat: "night", intent: "night", text: "Не ходите по одному." },
  { id: "night-8", cat: "night", intent: "night", text: "Город, держись." },
  { id: "night-9", cat: "night", intent: "smalltalk", text: "Спокойной ночи, город. Постарайтесь проснуться." },

  // Эмоции
  { id: "emo-1", cat: "emote", intent: "emote", text: "GG" },
  { id: "emo-2", cat: "emote", intent: "emote", text: "Спокойно." },
  { id: "emo-3", cat: "emote", intent: "emote", text: "Всем удачи." },
  { id: "emo-4", cat: "emote", intent: "emote", text: "Это подозрительно." },
  { id: "emo-5", cat: "emote", intent: "emote", text: "Я запутался." },
  { id: "emo-6", cat: "emote", intent: "emote", text: "Дайте мне шанс." },
  { id: "emo-7", cat: "emote", intent: "emote", text: "Я не верю своим глазам." },
  { id: "emo-8", cat: "emote", intent: "emote", text: "Ну и ночка." },
  { id: "emo-9", cat: "emote", intent: "gg", text: "GG. Хорошая игра." },

  // Мёртвые
  { id: "dead-1", cat: "dead", intent: "emote", text: "Я всё вижу." },
  { id: "dead-2", cat: "dead", intent: "smalltalk", text: "Город, вы ошиблись." },
  { id: "dead-3", cat: "dead", intent: "smalltalk", text: "Не забудьте про мафию." },
  { id: "dead-4", cat: "dead", intent: "emote", text: "Тишина — это тоже ответ." },
  { id: "dead-5", cat: "dead", intent: "gg", text: "Удачи живым." },
  { id: "dead-6", cat: "dead", intent: "emote", text: "Я за вас." },
  { id: "dead-7", cat: "dead", intent: "smalltalk", text: "Я бы голосовал иначе." },
  { id: "dead-8", cat: "dead", intent: "emote", text: "Здесь хотя бы спокойно." },

  // Шут / хаос
  { id: "chaos-1", cat: "chaos", intent: "claim-jester", text: "Может, я шут?" },
  { id: "chaos-2", cat: "chaos", intent: "chaos", text: "Повесьте меня, если скучно." },
  { id: "chaos-3", cat: "chaos", intent: "chaos", text: "Я просто хочу повеселиться." },
  { id: "chaos-4", cat: "chaos", intent: "chaos", text: "Не голосуйте за меня, пожалуйста." },
  { id: "chaos-5", cat: "chaos", intent: "chaos", text: "Я слишком опасен для этого города." },
  { id: "chaos-6", cat: "chaos", intent: "chaos", text: "Мне всё равно. Я уже мёртв внутри." },
  { id: "chaos-7", cat: "chaos", intent: "chaos", text: "Скучно. Давайте голосовать." },
  { id: "chaos-8", cat: "chaos", intent: "chaos", text: "Сюрприз будет." },

  // Дополнительные фразы (вторая волна)
  { id: "acc-10", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} всю ночь был слишком спокоен." },
  { id: "acc-11", cat: "accuse", intent: "accuse", needsTarget: true, text: "Я почти уверен в игроке {target}." },
  { id: "acc-12", cat: "accuse", intent: "accuse", needsTarget: true, text: "Проверьте игрока {target} — мне кажется, это мафия." },
  { id: "def-11", cat: "defend", intent: "defend", text: "Моя роль полезна городу." },
  { id: "def-12", cat: "defend", intent: "defend", text: "Дайте договорить, я не закончил." },
  { id: "def-13", cat: "defend", intent: "defend-other", needsTarget: true, text: "Игрок {target} выглядит честным. Слышал его ночью." },
  { id: "q-10", cat: "question", intent: "question", text: "Кто-нибудь сегодня вообще проверял кого-то?" },
  { id: "q-11", cat: "question", intent: "question", text: "А если мафия — тот, кто молчит громче всех?" },
  { id: "q-12", cat: "question", intent: "question", needsTarget: true, text: "Кто последним голосовал против игрока {target}?" },
  { id: "vote-9", cat: "vote", intent: "vote-call", text: "У нас мало времени. Решаем." },
  { id: "vote-10", cat: "vote", intent: "vote-call", needsTarget: true, text: "Лучше игрок {target}, чем никого." },
  { id: "vote-11", cat: "vote", intent: "skip", text: "Сегодня пропускаю — доказательств нет." },
  { id: "night-10", cat: "night", intent: "night", text: "Помните, кто что говорил днём." },
  { id: "night-11", cat: "night", intent: "night", needsTarget: true, text: "Если меня убьют, присмотритесь к игроку {target}." },
  { id: "night-12", cat: "night", intent: "night", text: "Шериф, проверь самого тихого." },
  { id: "emo-10", cat: "emote", intent: "emote", text: "Ах вот оно что." },
  { id: "emo-11", cat: "emote", intent: "emote", text: "Интересный поворот." },
  { id: "emo-12", cat: "emote", intent: "emote", text: "Ну наконец-то." },
  { id: "dead-9", cat: "dead", intent: "emote", text: "Я вам говорил." },
  { id: "dead-10", cat: "dead", intent: "smalltalk", text: "Наблюдаю. Очень интересно." },
  { id: "quick-9", cat: "quick", intent: "smalltalk", text: "Привет, город." },
  { id: "quick-10", cat: "quick", intent: "question", text: "Ну что, начнём?" },
]);

export const QUICK_BY_ID = Object.freeze(
  Object.fromEntries(QUICK_MESSAGES.map((message) => [message.id, message])),
);

export const QUICK_BY_CAT = Object.freeze(
  Object.fromEntries(
    QUICK_CATEGORIES.map((cat) => [cat.id, QUICK_MESSAGES.filter((message) => message.cat === cat.id)]),
  ),
);

export function getQuickMessage(id) {
  return QUICK_BY_ID[id] ?? null;
}

/**
 * Fill `{target}` with a nickname. Names are never declined, so every phrase
 * is written around "игрок {target}" instead of "он/его/ему".
 */
export function quickText(phrase, targetName = "…", roleName = "…") {
  const name = String(targetName ?? "").trim() || "…";
  const role = String(roleName ?? "").trim() || "…";
  return String(phrase?.text ?? "")
    .replace(/\{target\}/g, name)
    .replace(/\{role\}/g, role);
}

/** Placeholder shown before a target is picked: "Игрок … слишком много знает." */
export function quickPreview(phrase) {
  return String(phrase?.text ?? "")
    .replace(/\{target\}/g, "…")
    .replace(/\{role\}/g, "…")
    .replace(/…\./g, "…");
}

export function quickMessageCount() {
  return QUICK_MESSAGES.length;
}
