/**
 * Runtime Russian → English layer.
 *
 * The game is written in Russian. Instead of threading a `t()` call through
 * every template, English is applied to the rendered DOM: text nodes and the
 * usual user-facing attributes are translated, and a MutationObserver keeps
 * lazily rendered screens, toasts and modals in sync.
 *
 * User content is never touched: chat messages, nicknames, room names, codes
 * and form values are excluded. Dynamic strings (days, counts, timers) are
 * handled by patterns when they are not in the exact-match dictionary.
 */

import { EN } from "../data/i18n-en.js";

export const LANGUAGE_OPTIONS = Object.freeze([
  { id: "ru", label: "Русский", short: "RU" },
  { id: "en", label: "English", short: "EN" },
]);

/** Curated fixes for machine translation of game terms. */
const OVERRIDES = Object.freeze({
  "Близнец · пара": "Twin · pair",
  "Близнец × 0": "Twin × 0",
  "Близнецы всегда парой.": "Twins always come as a pair.",
  "Мафия ×1 убрана: состав не помещается в город.": "Mafia ×1 removed: the roster does not fit the town.",
  "Мафия ×2 · Шериф ×1 · Доктор ×1 · Мирный ×4": "Mafia ×2 · Sheriff ×1 · Doctor ×1 · Civilian ×4",
  "Мафия 2 · шериф 1 · доктор 1 · мирные 4": "Mafia 2 · sheriff 1 · doctor 1 · civilians 4",
  "Ваша роль · Мафия": "Your role · Mafia",
  "Мирный житель": "Civilian",
  "Мирные жители": "Civilians",
  "Порты": "Tabs",
  "порты": "tabs",
  "«Порты»": "“Tabs”",
  "Комната в портах создана.": "Tab room created.",
  "Комната живёт во вкладках этого браузера. Сервер не нужен — работает сразу.":
    "The room lives in tabs of this browser. No server needed — it works right away.",
  "Да. Тренировка с ботами и «Порты» работают полностью в браузере. Порты — это комнаты в соседних вкладках одного браузера. Чтобы играть с других устройств, есть «По IP» (хост запускает npm start, остальные заходят по его адресу; с пробросом порта подключаются из другой сети) и «Онлайн» через relay. Статический хостинг сам по себе не соединяет устройства.":
    "Yes. Bot training and Tabs work entirely in the browser. Tabs are rooms in other tabs of the same browser. To play from other devices, use “By IP” (the host runs npm start and the others open its address; with port forwarding they can connect from another network) and “Online” via the relay. Static hosting alone does not connect devices.",
  "«Порты» живут во вкладках этого браузера. «По IP» — хост запускает сервер, остальные заходят по его адресу, хоть из другой сети. «Онлайн» идёт через relay и работает с любого устройства.":
    "“Tabs” live in tabs of this browser. “By IP” means the host runs a server and the others open its address, even from another network. “Online” goes through the relay and works from any device.",
  "Мафия ×1 убрана: состав не помещается в город.": "Mafia ×1 removed: the roster does not fit the town.",
  "Шериф": "Sheriff",
  "Доктор": "Doctor",
  "Мирный": "Civilian",
  "Мирные": "Civilians",
  "Наблюдатель": "Spectator",
  "Наблюдатели": "Spectators",
  "Приговор": "Verdict",
  "Последнее слово": "Last words",
  "Рассвет": "Dawn",
  "Закат": "Dusk",
  "Хроника": "Chronicle",
  "Эфир": "Chat",
  "Итоги": "Results",
  "Язык интерфейса": "Interface language",
  "Сеть и серверы": "Network and servers",
  "Сеть и relay": "Network and relay",
  "Сеть": "Network",
  "Русский или English": "Russian or English",
  "Меню, правила, подсказки и системные сообщения. Ники и чат не переводятся.":
    "Menus, rules, hints and system messages. Nicknames and chat are never translated.",
  "Недавние комнаты": "Recent rooms",
  "Сеть": "Network",
  "https://mafiarbovercel.vercel.app или wss://relay.example/ws":
    "https://mafiarbovercel.vercel.app or wss://relay.example/ws",
  "Ночь 1. Город засыпает.": "Night 1. The town falls asleep.",
  "День 1. Город просыпается.": "Day 1. The town wakes up.",
});

const TEXT_SKIP = [
  "script",
  "style",
  "noscript",
  "textarea",
  "select",
  "option",
  "code",
  "pre",
  ".avatar",
  ".chat__msg-text",
  ".chat__msg-name",
  ".seat__name",
  ".player-card__name",
  ".vote-result__name",
  ".end-role-row__name",
  ".bot-tile__name",
  ".room-card__name",
  ".recent-room__name",
  ".lobby-head__title",
  ".code-pill",
  ".share-box__code",
  ".code-input",
  ".input--nick",
  "#profile-name",
  "#profile-avatar",
  "[contenteditable='true']",
  "[data-i18n-skip]",
].join(",");

const ATTR_SKIP = ["[data-i18n-skip]", ".code-pill", ".share-box__code"].join(",");
const ATTRS = ["placeholder", "title", "aria-label", "alt"];

const state = (globalThis.__mafiaI18nState ??= {
  language: "ru",
  observer: null,
  textOriginals: new WeakMap(),
  attrOriginals: new WeakMap(),
});

export function normalizeLanguage(value) {
  return value === "en" ? "en" : "ru";
}

export function currentLanguage() {
  return state.language;
}

function plural(count, one, many) {
  return Number(count) === 1 ? one : many;
}

/**
 * Exact substitutions for fragments that the dictionary cannot match as a
 * whole because they contain numbers, names or a changing phase.
 */
function applyPatterns(text) {
  let out = text;
  out = out.replace(/Ночь\s+(\d+)\.\s*Город засыпает\.?/g, "Night $1. The town falls asleep.");
  out = out.replace(/День\s+(\d+)\.\s*Город просыпается\.?/g, "Day $1. The town wakes up.");
  out = out.replace(/Ночь\s+(\d+)/g, "Night $1");
  out = out.replace(/День\s+(\d+)/g, "Day $1");
  out = out.replace(/Рассвет\s+(\d+)/g, "Dawn $1");
  out = out.replace(/ночь\s+(\d+)/gi, "night $1");
  out = out.replace(/день\s+(\d+)/gi, "day $1");
  out = out.replace(/^Ночью погибли:\s*(.+)$/g, "Killed at night: $1");
  out = out.replace(/^Говорит\s+(.+)$/g, "Speaking: $1");
  out = out.replace(/^Последнее слово:\s*(.+)$/g, "Last words: $1");
  out = out.replace(/^Проголосовали\s+(\d+)\s+из\s+(\d+)$/g, "Voted $1 of $2");
  out = out.replace(/^Максимум:\s*(\d+)\s*(?:голос|голоса|голосов)\s*·\s*проголосовали\s*(\d+)$/g, "Max: $1 votes · voted $2");
  out = out.replace(/^Город слушает вас$/g, "The town is listening");
  out = out.replace(/^Ночь прошла без жертв\.?$/g, "The night passed without casualties.");
  out = out.replace(/·\s*день\s+(\d+)/gi, "· day $1");
  out = out.replace(/д\.\s?(\d+)/g, "d.$1");
  out = out.replace(/(\d+)\s*дн\./g, "$1 d.");
  out = out.replace(
    /(\d+)\s+(игроков|игрока|игрок)/gi,
    (_, count) => `${count} ${plural(count, "player", "players")}`,
  );
  out = out.replace(
    /(\d+)\s+(голосов|голоса|голос)/gi,
    (_, count) => `${count} ${plural(count, "vote", "votes")}`,
  );
  out = out.replace(
    /(\d+)\s+(комнаты|комната|комнат)/gi,
    (_, count) => `${count} ${plural(count, "room", "rooms")}`,
  );
  out = out.replace(
    /(\d+)\s+(дней|дня|день)/gi,
    (_, count) => `${count} ${plural(count, "day", "days")}`,
  );
  out = out.replace(/(\d+)\s*мс/g, "$1 ms");
  out = out.replace(/(\d+)\s*мин/g, "$1 min");
  out = out.replace(/(\d+)\s*сек/g, "$1 sec");
  out = out.replace(/за\s+(\d+)\s*с(?![\u0400-\u04FF])/g, "in $1 s");
  out = out.replace(/(\d+)\s+из\s+(\d+)/g, "$1 of $2");
  out = out.replace(/^от\s+(\d+)$/gi, "From $1");
  out = out.replace(/Сеть\s+(\d+)/g, "Network $1");
  out = out.replace(/этот браузер/gi, "this browser");
  out = out.replace(/по IP/gi, "by IP");
  out = out.replace(/по сети/gi, "online");
  out = out.replace(/—\s*профиль игрока/gi, "— player profile");
  out = out.replace(/—\s*подробнее/gi, "— details");
  out = out.replace(/Выберите цель на карте\./g, "Choose a target on the map.");
  out = out.replace(/,\s*доступен как цель/g, ", available as a target");
  out = out.replace(/,\s*мёртв/g, ", dead");
  out = out.replace(/,\s*мертв/g, ", dead");
  out = out.replace(/самолечение/gi, "self-heal");
  out = out.replace(/использовано/g, "used");
  out = out.replace(/доступно/g, "available");
  out = out.replace(/Хост:/g, "Host:");
  out = out.replace(/(^|\s)вы(?=\s|$)/g, "$1you");
  out = out.replace(/(^|\s)хост(?=\s|$)/g, "$1host");
  out = out.replace(/(^|\s)готов(?=\s|$)/g, "$1ready");
  out = out.replace(/(^|\s)ждём(?=\s|$)/g, "$1waiting");
  out = out.replace(/Партия/g, "Game");
  out = out.replace(/Лобби/g, "Lobby");
  out = out.replace(/Финал/g, "Finale");
  out = out.replace(/МАФИЯ/g, "MAFIA");
  out = out.replace(/живых из/gi, "alive of");
  out = out.replace(/комнат:\s*(\d+)/gi, "rooms: $1");
  out = out.replace(/живых/gi, "alive");
  out = out.replace(/мёртв/gi, "dead");
  out = out.replace(/мертв/gi, "dead");
  out = out.replace(/«Порты»/g, "“Tabs”");
  out = out.replace(/Порты/g, "Tabs");
  out = out.replace(/порты/g, "tabs");
  out = out.replace(/в портах/gi, "in tabs");
  out = out.replace(/Мирный/g, "Civilian");
  out = out.replace(/Мирные/g, "Civilians");
  out = out.replace(/Близнец/g, "Twin");
  out = out.replace(/Близнецы/g, "Twins");
  out = out.replace(/(\d+)\s+ролей, живые комнаты и город, который врёт красиво\./g, "$1 roles, living rooms and a city that lies beautifully.");
  out = out.replace(/(\d+)\s+ролей/g, "$1 roles");
  return out;
}

/** Translate one string, preserving surrounding whitespace. */
export function translateText(value, lang = state.language) {
  if (typeof value !== "string" || lang !== "en" || !value) return value;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  if (!match) return value;
  const [, before, body, after] = match;
  if (!body) return value;
  const key = body.replace(/\s+/g, " ").trim();
  const exact = OVERRIDES[key] ?? EN[key];
  if (exact) return `${before}${exact}${after}`;
  const patterned = applyPatterns(body);
  return patterned === body ? value : `${before}${patterned}${after}`;
}

function isSkipped(element, selector) {
  return Boolean(element?.closest?.(selector));
}

function translateNode(node) {
  const current = node.nodeValue;
  if (!current || !current.trim()) return;
  if (isSkipped(node.parentElement, TEXT_SKIP)) return;
  let original = state.textOriginals.get(node);
  if (original === undefined || /[\u0400-\u04FF]/.test(current)) {
    original = current;
    state.textOriginals.set(node, original);
  }
  const next = translateText(original, state.language);
  if (next !== current) node.nodeValue = next;
}

function translateAttribute(element, name) {
  if (!ATTRS.includes(name)) return;
  if (isSkipped(element, ATTR_SKIP)) return;
  const current = element.getAttribute(name);
  if (!current || !current.trim()) return;
  if (/^https?:|^\/|^#|^data:/i.test(current)) return;
  let store = state.attrOriginals.get(element);
  if (!store) {
    store = {};
    state.attrOriginals.set(element, store);
  }
  let original = store[name];
  if (original === undefined || /[\u0400-\u04FF]/.test(current)) {
    original = current;
    store[name] = original;
  }
  const next = translateText(original, state.language);
  if (next !== current) element.setAttribute(name, next);
}

function translateSubtree(root) {
  if (!root) return;
  if (root.nodeType === 3) {
    translateNode(root);
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    for (const name of ATTRS) translateAttribute(root, name);
  }
  const element = root.nodeType === 1 ? root : root.documentElement ?? null;
  if (!element) return;
  for (const node of element.querySelectorAll(ATTRS.map((name) => `[${name}]`).join(","))) {
    for (const name of ATTRS) translateAttribute(node, name);
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateNode(node);
    node = walker.nextNode();
  }
}

function onMutations(records) {
  for (const record of records) {
    if (record.type === "characterData") {
      translateNode(record.target);
    } else if (record.type === "attributes") {
      translateAttribute(record.target, record.attributeName);
    } else {
      for (const node of record.addedNodes) translateSubtree(node);
    }
  }
}

/**
 * Switch the interface language and keep future DOM changes translated.
 * Safe to call repeatedly; the observer is installed once.
 */
export function applyLanguage(value) {
  const next = normalizeLanguage(value);
  const changed = next !== state.language;
  state.language = next;
  if (typeof document === "undefined") return state.language;
  document.documentElement.lang = next;
  document.documentElement.dataset.lang = next;
  if (!state.observer && typeof MutationObserver !== "undefined") {
    state.observer = new MutationObserver(onMutations);
    state.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }
  translateSubtree(document.documentElement);
  if (changed) document.documentElement.dispatchEvent(new CustomEvent("mafia:language", { detail: { lang: next } }));
  return state.language;
}

export function stopLanguageObserver() {
  state.observer?.disconnect();
  state.observer = null;
}
