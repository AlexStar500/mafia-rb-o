/**
 * Minimal DOM helpers.
 *
 * All dynamic user content goes through `html` which escapes by default.
 * Only `raw()` (trusted templates and inline SVG icons) bypasses escaping.
 */

const ESCAPE = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"'`]/g, (char) => ESCAPE[char]);
}

export class SafeHtml {
  constructor(value) {
    this.value = String(value ?? "");
  }

  toString() {
    return this.value;
  }
}

export function raw(value) {
  return new SafeHtml(value);
}

function renderValue(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (value === null || value === undefined || value === false || value === true) return "";
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += renderValue(values[i]);
    out += strings[i + 1] ?? "";
  }
  return new SafeHtml(out);
}

export function mount(target, template) {
  if (!target) return target;
  target.innerHTML = template instanceof SafeHtml ? template.value : String(template ?? "");
  return target;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function delegate(root, eventName, selector, handler, options) {
  if (!root) return () => {};
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (!target || !root.contains(target)) return;
    handler(event, target);
  };
  root.addEventListener(eventName, listener, options);
  return () => root.removeEventListener(eventName, listener, options);
}

export function on(root, eventName, handler, options) {
  if (!root) return () => {};
  root.addEventListener(eventName, handler, options);
  return () => root.removeEventListener(eventName, handler, options);
}

export function attr(name, value) {
  if (value === null || value === undefined || value === false) return "";
  if (value === true) return ` ${name}`;
  return ` ${name}="${esc(value)}"`;
}

export function cls(...values) {
  return values
    .flat()
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function debounce(fn, delay = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function focusFirst(root) {
  if (!root) return;
  const target = root.querySelector(
    "[autofocus], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
  );
  target?.focus?.({ preventScroll: true });
}

/** Keep focus inside a modal. */
export function trapFocus(root) {
  if (!root) return () => {};
  const handler = (event) => {
    if (event.key !== "Tab") return;
    const nodes = qsa(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      root,
    ).filter((node) => node.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}

/** Set a CSS custom property, guarding against bad numbers. */
export function cssVar(node, name, value) {
  if (node?.style) node.style.setProperty(name, String(value));
}

export function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

export function plural(count, forms) {
  const n = Math.abs(Math.trunc(Number(count) || 0)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}
