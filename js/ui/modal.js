import { html, mount, qs, focusFirst, trapFocus } from "./dom.js";
import { icon } from "./icons.js";

let active = null;
let escBound = false;

function bindEscape() {
  if (escBound) return;
  escBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !active) return;
    if (active.dismissible) {
      event.preventDefault();
      active.close("escape");
    }
  });
}

/**
 * Opens a modal dialog. `body` and `footer` must be SafeHtml (from `html` or
 * `raw`). Returns a handle with the mounted nodes.
 */
export function openModal({
  title = "",
  subtitle = "",
  body = null,
  footer = null,
  wide = false,
  role = false,
  className = "",
  dismissible = true,
  onClose = null,
} = {}) {
  bindEscape();
  closeModal("replaced", { silent: true });
  const root = qs("#modal-root");
  if (!root) return null;

  const previousFocus = document.activeElement;
  mount(
    root,
    html`<div class="modal-backdrop" data-modal-close aria-hidden="true"></div>
      <div
        class="modal ${wide ? "modal--wide" : ""} ${role ? "modal--role" : ""} ${className}"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabindex="-1"
      >
        <header class="modal__head">
          <div class="grow">
            <h2 class="modal__title" id="modal-title">${title}</h2>
            ${subtitle ? html`<p class="modal__sub">${subtitle}</p>` : ""}
          </div>
          ${dismissible
            ? html`<button class="icon-btn modal__close" type="button" data-modal-close aria-label="Закрыть">
                ${icon("x", { size: 20 })}
              </button>`
            : ""}
        </header>
        <div class="modal__body" data-modal-body>${body}</div>
        ${footer ? html`<footer class="modal__foot">${footer}</footer>` : ""}
      </div>`,
  );

  const panel = qs(".modal", root);
  const bodyNode = qs("[data-modal-body]", root);
  const footNode = qs(".modal__foot", root);
  const untrap = trapFocus(panel);
  document.body.classList.add("modal-open");

  let closed = false;
  const close = (reason = "close") => {
    if (closed) return;
    closed = true;
    untrap();
    if (active?.close === close) active = null;
    mount(root, "");
    document.body.classList.remove("modal-open");
    if (previousFocus instanceof HTMLElement) previousFocus.focus?.({ preventScroll: true });
    onClose?.(reason);
  };

  active = { close, dismissible, panel };

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-modal-close]")) {
      event.preventDefault();
      close("backdrop");
    }
  });

  requestAnimationFrame(() => focusFirst(bodyNode ?? panel) || panel.focus?.({ preventScroll: true }));
  return { root, panel, body: bodyNode, footer: footNode, close };
}

export function closeModal(reason = "close", { silent = false } = {}) {
  const current = active;
  if (!current) return;
  if (silent) {
    // closeModal below normally restores focus; silent replacements should not
    // steal focus back to the trigger.
    current.close(reason);
    return;
  }
  current.close(reason);
}

export function isModalOpen() {
  return Boolean(active);
}

/**
 * Promise-based confirmation dialog. Resolves false on close/cancel and true
 * only when the confirm button is pressed.
 */
export function confirmModal({
  title = "Подтвердите действие",
  message = "",
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  tone = "danger",
  detail = "",
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value, reason) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (reason) closeModal(reason);
    };
    const handle = openModal({
      title,
      body: html`<div class="confirm">
        <p class="confirm__message">${message}</p>
        ${detail ? html`<p class="confirm__detail">${detail}</p>` : ""}
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-confirm-cancel>${cancelLabel}</button>
        <button class="btn ${tone === "danger" ? "btn--danger" : "btn--primary"}" type="button" data-confirm-ok>
          ${confirmLabel}
        </button>`,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    if (!handle) {
      resolve(false);
      return;
    }
    handle.footer?.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-confirm-cancel]")) {
        finish(false, "cancel");
      } else if (target?.closest("[data-confirm-ok]")) {
        finish(true, "confirm");
      }
    });
  });
}
