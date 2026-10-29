export function pad2(value) {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

export function formatShortTime(ts) {
  const date = new Date(Number(ts) || Date.now());
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function pluralRu(count, forms) {
  const n = Math.abs(Math.trunc(Number(count) || 0)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

export function playersLabel(count) {
  return `${count} ${pluralRu(count, ["игрок", "игрока", "игроков"])}`;
}

export function dayLabel(day) {
  return `День ${dayNumber(day)}`;
}

export function nightLabel(day) {
  return `Ночь ${dayNumber(day)}`;
}

/** Coerce anything to a small day number so labels never print "[object Object]". */
export function dayNumber(value, fallback = 1) {
  if (value && typeof value === "object") {
    value = value.day ?? value.number ?? value.value ?? value.count;
  }
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Safe, human-readable text for values that cross boundaries (server payloads,
 * errors, notices). Objects are unwrapped instead of stringified as
 * "[object Object]".
 */
export function textOf(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message || fallback;
  if (typeof value === "object") {
    for (const key of ["message", "error", "reason", "text", "title", "detail"]) {
      const nested = value[key];
      if (typeof nested === "string" && nested.trim()) return nested;
      if (nested != null && typeof nested !== "object") return String(nested);
    }
  }
  return fallback;
}

export function percent(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

export function truncate(text, limit = 80) {
  const str = String(text ?? "");
  return str.length > limit ? `${str.slice(0, Math.max(0, limit - 1))}…` : str;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} сек`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} мин ${rest} сек` : `${m} мин`;
}

export function initials(name) {
  const clean = String(name ?? "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => [...part][0]?.toUpperCase() ?? "").join("") || "?";
}

export async function copyText(text) {
  const value = String(text ?? "");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadText(filename, text, mime = "text/plain") {
  try {
    const blob = new Blob([String(text ?? "")], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export function friendlyError(error) {
  const raw = textOf(error);
  if (/Failed to fetch|WebSocket|network/i.test(raw)) return "Связь потеряна. Проверь сеть или режим этого устройства.";
  if (/quota/i.test(raw)) return "Хранилище переполнено. Очисти кэш в настройках.";
  return raw || "Что-то пошло не так.";
}
