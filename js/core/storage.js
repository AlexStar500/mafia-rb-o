import { clampNumber, createId, normalizeHexColor, normalizeRelayUrl, sanitizeNick } from "./security.js";

const PREFIX = "mafia.v2";
const SETTINGS_KEY = `${PREFIX}.settings`;
const DEVICE_KEY = `${PREFIX}.device`;
const ROOMS_KEY = `${PREFIX}.rooms`;
const SW_KEY = `${PREFIX}.sw`;

export const DEFAULT_SETTINGS = Object.freeze({
  nick: "",
  color: "#d9b36c",
  music: 0.42,
  sfx: 0.62,
  muted: false,
  reducedMotion: false,
  effects: "auto",
  relayUrl: "",
  lang: "ru",
  botChat: "normal",
  rememberRoom: true,
  showHints: true,
  revealOnDeath: true,
  lastPlayerCount: 8,
});

export const AVATAR_COLORS = Object.freeze([
  "#d9b36c",
  "#e14c5a",
  "#4fb477",
  "#6fb6ff",
  "#a66bff",
  "#f08a5d",
  "#5ad1c8",
  "#e9e3d5",
]);

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readJson(key, fallback = null) {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  try {
    storage()?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function normalizeSettings(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    nick: sanitizeNick(src.nick) || "",
    color: normalizeHexColor(src.color, DEFAULT_SETTINGS.color),
    music: clampNumber(src.music, 0, 1, DEFAULT_SETTINGS.music),
    sfx: clampNumber(src.sfx, 0, 1, DEFAULT_SETTINGS.sfx),
    muted: src.muted === true,
    reducedMotion: src.reducedMotion === true,
    effects: ["auto", "full", "low"].includes(src.effects) ? src.effects : "auto",
    relayUrl: normalizeRelayUrl(src.relayUrl) || "",
    lang: src.lang === "en" ? "en" : "ru",
    botChat: ["quiet", "normal", "loud"].includes(src.botChat) ? src.botChat : DEFAULT_SETTINGS.botChat,
    rememberRoom: src.rememberRoom !== false,
    showHints: src.showHints !== false,
    revealOnDeath: src.revealOnDeath !== false,
    lastPlayerCount: Math.max(4, Math.min(20, Math.round(Number(src.lastPlayerCount) || 8))),
  };
}

export function loadSettings() {
  return normalizeSettings(readJson(SETTINGS_KEY, DEFAULT_SETTINGS));
}

export function saveSettings(settings) {
  const clean = normalizeSettings(settings);
  const ok = writeJson(SETTINGS_KEY, clean);
  return { ok, settings: clean };
}

export function clearSettings() {
  removeKey(SETTINGS_KEY);
  removeKey(DEVICE_KEY);
  removeKey(ROOMS_KEY);
  return true;
}

export function getDeviceId() {
  let id = "";
  try {
    id = storage()?.getItem(DEVICE_KEY) ?? "";
  } catch {
    id = "";
  }
  if (!id) {
    id = createId("dev");
    try {
      storage()?.setItem(DEVICE_KEY, id);
    } catch {
      // private mode: the id lives for this page only
    }
  }
  return id;
}

export function loadRoomRegistry() {
  const data = readJson(ROOMS_KEY, { rooms: [] });
  return Array.isArray(data.rooms) ? data.rooms : [];
}

export function saveRoomRegistry(rooms) {
  const clean = (Array.isArray(rooms) ? rooms : [])
    .filter((room) => room && typeof room.code === "string")
    .slice(0, 40);
  return writeJson(ROOMS_KEY, { rooms: clean });
}

export function clearChatCache() {
  // Chat is intentionally never persisted. This function exists so the UI can
  // clearly communicate that there is nothing to delete.
  return true;
}

export function markServiceWorker(version) {
  try {
    storage()?.setItem(SW_KEY, String(version));
  } catch {
    // ignore
  }
}

export function getServiceWorkerVersion() {
  try {
    return storage()?.getItem(SW_KEY) ?? "";
  } catch {
    return "";
  }
}
