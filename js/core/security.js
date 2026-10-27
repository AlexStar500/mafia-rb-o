/**
 * Input hardening and abuse protection.
 *
 * Rules:
 *  - user text is normalized and stripped of control / bidi / zero-width chars;
 *  - angle brackets are replaced so even an accidental innerHTML can not open a tag;
 *  - every network payload has an explicit length and enum check;
 *  - rate limits are token buckets with a hard cap.
 */

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_RE = /[\u202a-\u202e\u2066-\u2069]/g;
const ZERO_WIDTH_RE = /[\u200b-\u200f\u2060\ufeff]/g;
const REPEAT_RE = /([\p{L}\p{N}\p{P}\p{S}])\1{4,}/gu;
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+/giu;
const SPACE_RE = /\s+/g;

const PROFANITY_RE =
  /(?<![\p{L}])(ху[йеё]|хуя|хуйн|пизд|бля[дт]|ебан|ебат|ебал|ебуч|заеб|наеб|уеб|мраз|сука|сучк|долбо|пидор|пидар|гандон|мудак|мудил|шлюх|говн)(?![\p{L}])/giu;

const RESERVED_NICKS = new Set([
  "admin",
  "administrator",
  "system",
  "systema",
  "moderator",
  "mod",
  "host",
  "server",
  "support",
  "мафия",
  "шериф",
  "доктор",
  "ассасин",
  "шут",
  "система",
  "админ",
  "модератор",
]);

export function stripUnsafe(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(CONTROL_RE, " ")
    .replace(BIDI_RE, "")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/[<>]/g, (ch) => (ch === "<" ? "‹" : "›"));
}

export function sanitizeText(input, { maxLength = 160, allowEmpty = false, links = false, profanity = true } = {}) {
  let text = stripUnsafe(input)
    .replace(/\r?\n+/g, " ")
    .replace(SPACE_RE, " ")
    .trim();
  if (!links) text = text.replace(LINK_RE, "[ссылка]");
  text = text.replace(REPEAT_RE, "$1$1$1");
  if (profanity) text = text.replace(PROFANITY_RE, (match) => "*".repeat(Math.min(6, Math.max(3, match.length))));
  text = text.slice(0, maxLength).trim();
  if (!text && !allowEmpty) return "";
  return text;
}

export function sanitizeNick(input) {
  const withoutTags = String(input ?? "").replace(/<[^>]*>/g, " ");
  const raw = stripUnsafe(withoutTags)
    .replace(/[^\p{L}\p{N} _.\-]/gu, "")
    .replace(SPACE_RE, " ")
    .trim()
    .slice(0, 16);
  if (!raw) return "";
  if (RESERVED_NICKS.has(raw.toLowerCase())) return "";
  if (/^[._\- ]+$/.test(raw)) return "";
  if (PROFANITY_RE.test(raw)) {
    PROFANITY_RE.lastIndex = 0;
    return "";
  }
  PROFANITY_RE.lastIndex = 0;
  return raw;
}

export function nickError(input) {
  const clean = sanitizeNick(input);
  if (!clean) return "Ник: 2–16 букв, цифр, пробел, точка, дефис. Без служебных имён.";
  if (clean.length < 2) return "Ник слишком короткий — минимум 2 символа.";
  return "";
}

export function sanitizeChat(input) {
  return sanitizeText(input, { maxLength: 160, profanity: true, links: false });
}

export function isValidRoomCode(value) {
  return typeof value === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(value);
}

export function normalizeRoomCode(value) {
  const code = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return isValidRoomCode(code) ? code : "";
}

export function isValidPlayerId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{6,40}$/.test(value);
}

export function isValidAvatarId(value) {
  return value === null || (typeof value === "string" && /^[a-z0-9-]{2,24}$/.test(value));
}

export function normalizeHexColor(value, fallback = "#d9b36c") {
  if (typeof value !== "string") return fallback;
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : fallback;
}

export function normalizeRelayUrl(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim().slice(0, 300);
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (!["ws:", "wss:"].includes(url.protocol)) return "";
  if (url.username || url.password) return "";
  if (typeof location !== "undefined" && location.protocol === "https:" && url.protocol !== "wss:") return "";
  return url.toString();
}

export function isValidRelayUrl(value) {
  return normalizeRelayUrl(value) === value && value.length > 0;
}

export function safeJsonParse(text, fallback = null) {
  if (typeof text !== "string" || text.length > 100_000) return fallback;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
    return value;
  } catch {
    return fallback;
  }
}

export function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function clampInt(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

/** Token bucket. Capacity is the burst limit; refill is tokens per second. */
export class RateLimiter {
  constructor({ capacity = 6, refillPerSec = 1, now = Date.now } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.last = now();
    this.now = now;
  }

  take(cost = 1) {
    const now = this.now();
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = now;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return { ok: true, retryAfter: 0 };
    }
    const missing = cost - this.tokens;
    return { ok: false, retryAfter: Math.ceil((missing / this.refillPerSec) * 1000) };
  }
}

/** Sliding window limiter, useful for "N messages per phase". */
export class WindowLimiter {
  constructor({ limit = 10, windowMs = 60_000, now = Date.now } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.events = [];
    this.now = now;
  }

  take() {
    const now = this.now();
    this.events = this.events.filter((time) => now - time < this.windowMs);
    if (this.events.length >= this.limit) {
      return { ok: false, retryAfter: this.events[0] + this.windowMs - now };
    }
    this.events.push(now);
    return { ok: true, retryAfter: 0 };
  }

  reset() {
    this.events = [];
  }
}

export function createId(prefix = "p") {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return `${prefix}_${cryptoObj.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const bytes = new Uint8Array(10);
  if (cryptoObj?.getRandomValues) cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function hasProfanity(text) {
  PROFANITY_RE.lastIndex = 0;
  const result = PROFANITY_RE.test(String(text ?? ""));
  PROFANITY_RE.lastIndex = 0;
  return result;
}

/** Bounded JSON serializer for network frames. */
export function safeStringify(value, maxLength = 16_384) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof text !== "string" || text.length > maxLength) return null;
  return text;
}
