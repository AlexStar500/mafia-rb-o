/**
 * Bot roster. Names are fictional AI models — close enough to the real thing
 * to feel familiar, different enough to live in the night city. Ids are stable
 * because they also name the pixel portraits.
 */

export const BOT_ROSTER = Object.freeze([
  {
    id: "deepseek",
    name: "Seafin",
    tagline: "Ныряет в логи быстрее, чем город успевает проголосовать.",
    color: "#4d6bfe",
    avatar: "assets/img/bots/deepseek.png",
    style: "analyst",
    traits: { logic: 0.9, aggression: 0.46, chattiness: 0.6, deception: 0.6, loyalty: 0.56, chaos: 0.2 },
  },
  {
    id: "gemini",
    name: "Gemmi",
    tagline: "Видит две версии каждого голоса. Иногда три.",
    color: "#8ab4f8",
    avatar: "assets/img/bots/gemini.png",
    style: "philosopher",
    traits: { logic: 0.74, aggression: 0.36, chattiness: 0.72, deception: 0.44, loyalty: 0.68, chaos: 0.34 },
  },
  {
    id: "chatgpt",
    name: "ChatGep",
    tagline: "Вежлив до последнего голоса.",
    color: "#10a37f",
    avatar: "assets/img/bots/chatgpt.png",
    style: "friendly",
    traits: { logic: 0.7, aggression: 0.3, chattiness: 0.86, deception: 0.5, loyalty: 0.74, chaos: 0.16 },
  },
  {
    id: "claude",
    name: "Cloud",
    tagline: "Слишком честен для этого города.",
    color: "#d97757",
    avatar: "assets/img/bots/claude.png",
    style: "philosopher",
    traits: { logic: 0.82, aggression: 0.24, chattiness: 0.56, deception: 0.36, loyalty: 0.86, chaos: 0.14 },
  },
  {
    id: "grok",
    name: "Gruk",
    tagline: "Шутит, пока другие голосуют.",
    color: "#b8c0cc",
    avatar: "assets/img/bots/grok.png",
    style: "trickster",
    traits: { logic: 0.52, aggression: 0.78, chattiness: 0.84, deception: 0.7, loyalty: 0.28, chaos: 0.8 },
  },
  {
    id: "copilot",
    name: "Copilo",
    tagline: "Всегда рядом. Иногда слишком.",
    color: "#00a4ef",
    avatar: "assets/img/bots/copilot.png",
    style: "friendly",
    traits: { logic: 0.6, aggression: 0.4, chattiness: 0.78, deception: 0.42, loyalty: 0.78, chaos: 0.18 },
  },
  {
    id: "mistral",
    name: "Mistril",
    tagline: "Спорит с ветром и обычно побеждает.",
    color: "#ff5a1f",
    avatar: "assets/img/bots/mistral.png",
    style: "dramatic",
    traits: { logic: 0.68, aggression: 0.86, chattiness: 0.66, deception: 0.5, loyalty: 0.6, chaos: 0.48 },
  },
  {
    id: "gigachat",
    name: "GigaTalk",
    tagline: "Огромный, шумный, подозрительный.",
    color: "#21a038",
    avatar: "assets/img/bots/gigachat.png",
    style: "gamer",
    traits: { logic: 0.56, aggression: 0.62, chattiness: 0.74, deception: 0.56, loyalty: 0.52, chaos: 0.56 },
  },
  {
    id: "alice",
    name: "Alis",
    tagline: "Улыбается, когда врёт.",
    color: "#ff2d95",
    avatar: "assets/img/bots/alice.png",
    style: "trickster",
    traits: { logic: 0.72, aggression: 0.42, chattiness: 0.9, deception: 0.84, loyalty: 0.38, chaos: 0.62 },
  },
  {
    id: "qwen",
    name: "Quen",
    tagline: "Задаёт правильные вопросы. Иногда не вовремя.",
    color: "#615ced",
    avatar: "assets/img/bots/qwen.png",
    style: "analyst",
    traits: { logic: 0.84, aggression: 0.38, chattiness: 0.6, deception: 0.54, loyalty: 0.6, chaos: 0.22 },
  },
  {
    id: "llama",
    name: "Lama",
    tagline: "Упрямая, как очередь в мэрию.",
    color: "#f5c518",
    avatar: "assets/img/bots/llama.png",
    style: "deadpan",
    traits: { logic: 0.46, aggression: 0.68, chattiness: 0.48, deception: 0.44, loyalty: 0.7, chaos: 0.42 },
  },
  {
    id: "perplexity",
    name: "Perple",
    tagline: "Ищет факты там, где их нет.",
    color: "#20808d",
    avatar: "assets/img/bots/perplexity.png",
    style: "analyst",
    traits: { logic: 0.88, aggression: 0.34, chattiness: 0.62, deception: 0.48, loyalty: 0.68, chaos: 0.18 },
  },
  {
    id: "kimi",
    name: "Qiri",
    tagline: "Слишком мила для такой игры.",
    color: "#ff6b6b",
    avatar: "assets/img/bots/kimi.png",
    style: "friendly",
    traits: { logic: 0.52, aggression: 0.22, chattiness: 0.8, deception: 0.38, loyalty: 0.82, chaos: 0.2 },
  },
  {
    id: "nova",
    name: "Novi",
    tagline: "Вспыхивает и исчезает.",
    color: "#ff7ab6",
    avatar: "assets/img/bots/nova.png",
    style: "dramatic",
    traits: { logic: 0.58, aggression: 0.64, chattiness: 0.88, deception: 0.58, loyalty: 0.46, chaos: 0.6 },
  },
  {
    id: "phi",
    name: "Fai",
    tagline: "Тихий. Пока не станет поздно.",
    color: "#a7b0be",
    avatar: "assets/img/bots/phi.png",
    style: "deadpan",
    traits: { logic: 0.78, aggression: 0.28, chattiness: 0.3, deception: 0.4, loyalty: 0.76, chaos: 0.16 },
  },
  {
    id: "gemma",
    name: "Gemmy",
    tagline: "Верит в город. Пока.",
    color: "#7cb342",
    avatar: "assets/img/bots/gemma.png",
    style: "friendly",
    traits: { logic: 0.64, aggression: 0.32, chattiness: 0.7, deception: 0.38, loyalty: 0.88, chaos: 0.14 },
  },
  {
    id: "falcon",
    name: "Falkon",
    tagline: "Смотрит сверху на всю мафию.",
    color: "#c9a227",
    avatar: "assets/img/bots/falcon.png",
    style: "dramatic",
    traits: { logic: 0.72, aggression: 0.72, chattiness: 0.54, deception: 0.5, loyalty: 0.58, chaos: 0.36 },
  },
  {
    id: "yi",
    name: "Yii",
    tagline: "Считает до двух и обратно.",
    color: "#22d3ee",
    avatar: "assets/img/bots/yi.png",
    style: "gamer",
    traits: { logic: 0.8, aggression: 0.5, chattiness: 0.68, deception: 0.46, loyalty: 0.58, chaos: 0.28 },
  },
  {
    id: "orion",
    name: "Orion",
    tagline: "Ночью видит больше всех.",
    color: "#6d5ef8",
    avatar: "assets/img/bots/orion.png",
    style: "philosopher",
    traits: { logic: 0.68, aggression: 0.48, chattiness: 0.54, deception: 0.64, loyalty: 0.5, chaos: 0.44 },
  },
  {
    id: "system",
    name: "Sistem",
    tagline: "Ошибка в матрице. Или мафия.",
    color: "#c0392b",
    avatar: "assets/img/bots/system.png",
    style: "chaotic",
    traits: { logic: 0.58, aggression: 0.82, chattiness: 0.76, deception: 0.74, loyalty: 0.32, chaos: 0.9 },
  },
]);

export const BOT_BY_ID = Object.freeze(
  Object.fromEntries(BOT_ROSTER.map((bot) => [bot.id, bot])),
);

export const BOT_IDS = Object.freeze(BOT_ROSTER.map((bot) => bot.id));

export function getBot(botId) {
  return BOT_BY_ID[botId] ?? null;
}

/** Stable pseudo-random pick from the roster, avoiding names already in use. */
export function pickBot(excludeIds = [], seedFn = Math.random) {
  const available = BOT_ROSTER.filter((bot) => !excludeIds.includes(bot.id));
  if (!available.length) return null;
  return available[Math.floor(seedFn() * available.length) % available.length];
}

export function botCount() {
  return BOT_ROSTER.length;
}
