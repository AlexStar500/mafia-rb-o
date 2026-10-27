import { html, qs } from "./dom.js";
import { icon } from "./icons.js";

const MAX_TOASTS = 4;
const DEDUPE_MS = 4000;
const ICONS = {
  info: "info",
  warn: "alert",
  danger: "alert",
  town: "check",
  gold: "spark",
};

/** message -> { at, dismiss } so the same line never stacks twice. */
const live = new Map();

/**
 * Small, safe toast stack. Text is always inserted through the escaping
 * template helper; icons are trusted inline SVG. Repeating the same text within
 * a few seconds reuses the existing toast instead of stacking a copy.
 */
export function toast(text, { tone = "info", duration = 3600, iconName = null } = {}) {
  const root = qs("#toast-root");
  if (!root) return () => {};
  const message = String(text ?? "").trim();
  if (!message) return () => {};

  const now = Date.now();
  if (live.size > 40) {
    for (const [key, entry] of live) if (now - entry.at > DEDUPE_MS || !entry.node.isConnected) live.delete(key);
  }
  const previous = live.get(message);
  if (previous && now - previous.at < DEDUPE_MS && previous.node.isConnected) {
    return previous.dismiss;
  }

  while (root.children.length >= MAX_TOASTS) root.firstElementChild?.remove();

  const node = document.createElement("div");
  node.className = `toast toast--${tone}`;
  node.innerHTML = html`${icon(iconName ?? ICONS[tone] ?? "info", { size: 18 })}<span>${message}</span>`.value;
  root.append(node);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 260);
  };
  const timer = setTimeout(remove, Math.max(1200, duration));
  node.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  const dismiss = () => {
    clearTimeout(timer);
    remove();
  };
  live.set(message, { at: now, node, dismiss });
  return dismiss;
}
