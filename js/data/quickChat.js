/**
 * Quick chat. Phrases are canonical: the server/host sends the id, never
 * trusted free text, so players cannot inject markup or fake another player.
 */

export const QUICK_CATEGORIES = Object.freeze([
  { id: "accuse", name: "Обвинить", icon: "blade", tone: "danger" },
  { id: "defend", name: "Защита", icon: "shield", tone: "town" },
  { id: "role", name: "Роль", icon: "mask", tone: "gold" },
  { id: "question", name: "Вопрос", icon: "question", tone: "info" },
  { id: "vote", name: "Голос", icon: "vote", tone: "danger" },
  { id: "night", name: "Ночь", icon: "moon", tone: "night" },
  { id: "emote", name: "Эмоции", icon: "spark", tone: "muted" },
  { id: "chaos", name: "Шут", icon: "joker", tone: "neutral" },
]);

export const QUICK_MESSAGES = Object.freeze([
  // Обвинения
  { id: "acc-1", cat: "accuse", intent: "accuse", needsTarget: true, text: "Я бы начал с игрока {target}." },
  { id: "acc-2", cat: "accuse", intent: "accuse", needsTarget: true, text: "История игрока {target} не сходится." },
  { id: "acc-3", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} слишком много знает для мирного." },
  { id: "acc-4", cat: "accuse", intent: "accuse", needsTarget: true, text: "Я не верю ни одному слову игрока {target}." },
  { id: "acc-5", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} защищает тех, кого стоит повесить." },
  { id: "acc-6", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} слишком удобно молчит." },
  { id: "acc-7", cat: "accuse", intent: "accuse", needsTarget: true, text: "Ставлю на игрока {target}." },
  { id: "acc-8", cat: "accuse", intent: "accuse", needsTarget: true, text: "Игрок {target} путается в именах и голосах." },

  // Защита
  { id: "def-1", cat: "defend", intent: "defend", text: "Я мирный. Без роли." },
  { id: "def-2", cat: "defend", intent: "defend", text: "Меня подставляют." },
  { id: "def-3", cat: "defend", intent: "defend", text: "Не тратьте голос на меня." },
  { id: "def-4", cat: "defend", intent: "defend", text: "У вас нет доказательств." },
  { id: "def-5", cat: "defend", intent: "defend", text: "Я могу объяснить каждое слово." },
  { id: "def-6", cat: "defend", intent: "defend", text: "Проверьте меня, если хотите." },
  { id: "def-7", cat: "defend", intent: "defend", text: "Я голосую вместе с городом." },
  { id: "def-8", cat: "defend", intent: "defend", text: "Не дайте мафии разбить нас." },

  // Роль
  { id: "role-1", cat: "role", intent: "claim-sheriff", text: "Я шериф." },
  { id: "role-2", cat: "role", intent: "claim-doctor", text: "Я доктор." },
  { id: "role-3", cat: "role", intent: "claim-civilian", text: "Я обычный мирный." },
  { id: "role-4", cat: "role", intent: "claim-jester", text: "Я шут. Не голосуйте за меня." },
  { id: "role-5", cat: "role", intent: "result-mafia", needsTarget: true, text: "Моя проверка: игрок {target} — мафия." },
  { id: "role-6", cat: "role", intent: "result-clean", needsTarget: true, text: "Моя проверка: игрок {target} чист." },
  { id: "role-7", cat: "role", intent: "role-info", text: "У меня есть информация, но не всем её стоит слышать." },
  { id: "role-8", cat: "role", intent: "role-late", text: "Раскроюсь, если будет нужно." },

  // Вопросы
  { id: "q-1", cat: "question", intent: "question", text: "Кто что видел ночью?" },
  { id: "q-2", cat: "question", intent: "question", text: "Почему все молчат?" },
  { id: "q-3", cat: "question", intent: "question", needsTarget: true, text: "Кто-нибудь верит словам игрока {target}?" },
  { id: "q-4", cat: "question", intent: "question", text: "Кого проверил шериф?" },
  { id: "q-5", cat: "question", intent: "question", text: "Почему голос именно против меня?" },
  { id: "q-6", cat: "question", intent: "question", text: "Кто ещё сомневается?" },
  { id: "q-7", cat: "question", intent: "question", needsTarget: true, text: "Кто голосует вместе с игроком {target}?" },
  { id: "q-8", cat: "question", intent: "question", needsTarget: true, text: "Что мы теряем, если повесим игрока {target}?" },

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

  // Эмоции
  { id: "emo-1", cat: "emote", intent: "emote", text: "GG" },
  { id: "emo-2", cat: "emote", intent: "emote", text: "Спокойно." },
  { id: "emo-3", cat: "emote", intent: "emote", text: "Всем удачи." },
  { id: "emo-4", cat: "emote", intent: "emote", text: "Это подозрительно." },
  { id: "emo-5", cat: "emote", intent: "emote", text: "Я запутался." },
  { id: "emo-6", cat: "emote", intent: "emote", text: "Дайте мне шанс." },
  { id: "emo-7", cat: "emote", intent: "emote", text: "Я не верю своим глазам." },
  { id: "emo-8", cat: "emote", intent: "emote", text: "Ну и ночка." },

  // Шут / хаос
  { id: "chaos-1", cat: "chaos", intent: "claim-jester", text: "Может, я шут?" },
  { id: "chaos-2", cat: "chaos", intent: "chaos", text: "Повесьте меня, если скучно." },
  { id: "chaos-3", cat: "chaos", intent: "chaos", text: "Я просто хочу повеселиться." },
  { id: "chaos-4", cat: "chaos", intent: "chaos", text: "Не голосуйте за меня, пожалуйста." },
  { id: "chaos-5", cat: "chaos", intent: "chaos", text: "Я слишком опасен для этого города." },
  { id: "chaos-6", cat: "chaos", intent: "chaos", text: "Мне всё равно. Я уже мёртв внутри." },
  { id: "chaos-7", cat: "chaos", intent: "chaos", text: "Скучно. Давайте голосовать." },
  { id: "chaos-8", cat: "chaos", intent: "chaos", text: "Сюрприз будет." },
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
export function quickText(phrase, targetName = "…") {
  const name = String(targetName ?? "").trim() || "…";
  return String(phrase?.text ?? "").replace(/\{target\}/g, name);
}

/** Placeholder shown before a target is picked: "Игрок … слишком много знает." */
export function quickPreview(phrase) {
  return String(phrase?.text ?? "")
    .replace(/\{target\}/g, "…")
    .replace(/…\./g, "…");
}

export function quickMessageCount() {
  return QUICK_MESSAGES.length;
}
