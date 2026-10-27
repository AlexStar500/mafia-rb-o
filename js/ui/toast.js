import { html, qs } from "./dom.js";
import { icon } from "./icons.js";

const MAX_TOASTS = 4;
const ICONS = {
  info: "info",
  warn: "alert",
  danger: "alert",
  town: "check",
  gold: "spark",
};

/**
 * Small, safe toast stack. Text is always inserted through the escaping
 * template helper; icons are trusted inline SVG.
 */
export function toast(text, { tone = "info", duration = 3600, iconName = null } = {}) {
  const root = qs("#toast-root");
  if (!root) return () => {};
  const message = String(text ?? "").trim();
  if (!message) return () => {};

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
  return () => {
    clearTimeout(timer);
    remove();
  };
}
