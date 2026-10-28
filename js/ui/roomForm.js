import { html, mount, qs, qsa } from "./dom.js";
import { icon } from "./icons.js";
import { asset } from "../core/assets.js";
import {
  BOT_CHAT_LEVELS,
  MODE_ORDER,
  ROLE_LIMITS,
  ROLE_ORDER,
  ROLES,
  ROOM_MODES,
  computeRoleSetup,
  normalizeRoomConfig,
} from "../data/roles.js";

function switchRow({ id, field, title, hint, checked }) {
  return html`<label class="setting-row setting-row--switch" for="${id}">
    <span class="setting-row__text">
      <span class="setting-row__title">${title}</span>
      <span class="setting-row__hint">${hint}</span>
    </span>
    <span class="switch">
      <input id="${id}" type="checkbox" data-toggle="${field}" ${checked ? html`checked` : ""} />
      <span class="switch__track" aria-hidden="true"></span>
    </span>
  </label>`;
}

function stepper({ field, value, min, max, label }) {
  return html`<div class="stepper" role="group" aria-label="${label}">
    <button type="button" data-step="${field}" data-delta="-1" aria-label="Меньше" ${value <= min ? html`disabled` : ""}>
      ${icon("minus", { size: 15 })}
    </button>
    <output data-step-value="${field}">${value}</output>
    <button type="button" data-step="${field}" data-delta="1" aria-label="Больше" ${value >= max ? html`disabled` : ""}>
      ${icon("plus", { size: 15 })}
    </button>
  </div>`;
}

function timerRow({ field, value, min, max, step, label, hint }) {
  return html`<div class="timer-row">
    <div class="timer-row__head">
      <span class="setting-row__title">${label}</span>
      <output data-timer-output="${field}">${value} с</output>
    </div>
    <input
      type="range"
      min="${min}"
      max="${max}"
      step="${step}"
      value="${value}"
      data-timer="${field}"
      aria-label="${label}"
      style="--range-fill:${Math.round(((value - min) / (max - min)) * 100)}%"
    />
    <span class="setting-row__hint">${hint}</span>
  </div>`;
}

function roleCountRow({ field, title, hint, value, min = 0, max, autoLabel = "" }) {
  const shown = autoLabel && value === min ? autoLabel : value;
  return html`<div class="setting-row setting-row--role">
    <span class="setting-row__text">
      <span class="setting-row__title">${title}</span>
      <span class="setting-row__hint">${hint}</span>
    </span>
    <div class="stepper" role="group" aria-label="${title}">
      <button type="button" data-step="${field}" data-delta="-1" aria-label="Меньше" ${value <= min ? html`disabled` : ""}>
        ${icon("minus", { size: 15 })}
      </button>
      <output data-step-value="${field}">${shown}</output>
      <button type="button" data-step="${field}" data-delta="1" aria-label="Больше" ${value >= max ? html`disabled` : ""}>
        ${icon("plus", { size: 15 })}
      </button>
    </div>
  </div>`;
}

function preview(value) {
  const setup = computeRoleSetup(value.maxPlayers, value.roles, value.mode);
  return html`<div class="role-preview" data-role-preview>
    <div class="role-preview__head">
      <span class="setting-row__title">Состав при полном составе</span>
      <span class="badge badge--muted">${value.maxPlayers} игроков</span>
    </div>
    <div class="role-preview__grid">
      ${ROLE_ORDER.map((roleId) => {
        const count = setup.counts[roleId] ?? 0;
        const role = ROLES[roleId];
        return html`<span class="role-preview__item ${count ? "" : "is-off"}" style="--role-color:${role.color}" title="${role.name} × ${count}">
          <img src="${asset(role.icon)}" alt="" width="28" height="28" loading="lazy" />
          <span>${role.name}</span>
          <b>${count}</b>
        </span>`;
      })}
    </div>
    <p class="role-preview__note">Мафия: ${setup.mafiaTeam} · старт от ${value.minStart} игроков · близнецы всегда парой.</p>
    ${setup.warnings.map((warning) => html`<p class="role-preview__warning">${icon("alert", { size: 13 })} ${warning}</p>`)}
  </div>`;
}

/**
 * Shared room settings form for the create screen and the lobby modal.
 * It calls `onChange` with a normalized config and never trusts DOM values
 * directly in game code.
 */
export class RoomForm {
  constructor(container, { value = {}, onChange = null, disabled = false } = {}) {
    this.container = container;
    this.value = normalizeRoomConfig(value, value.maxPlayers);
    this.onChange = onChange;
    this.disabled = disabled;
    this._timer = null;
    this._render();
    this._bind();
  }

  _render() {
    const value = this.value;
    mount(
      this.container,
      html`<div class="room-form ${this.disabled ? "is-disabled" : ""}" data-room-form>
        <div class="form-section">
          <span class="form-section__title">${icon("door", { size: 15 })} Комната</span>
          <label class="field" for="room-name">
            <span class="field__label">Название</span>
            <input
              class="input"
              id="room-name"
              type="text"
              maxlength="32"
              value="${value.name}"
              data-text="name"
              autocomplete="off"
              placeholder="Ночной город"
            />
          </label>
          <div class="setting-grid">
            <div class="setting-row">
              <span class="setting-row__text">
                <span class="setting-row__title">Максимум игроков</span>
                <span class="setting-row__hint">До ${ROLE_LIMITS.maxPlayers} участников</span>
              </span>
              ${stepper({ field: "maxPlayers", value: value.maxPlayers, min: ROLE_LIMITS.minPlayers, max: ROLE_LIMITS.maxPlayers, label: "Максимум игроков" })}
            </div>
            <div class="setting-row">
              <span class="setting-row__text">
                <span class="setting-row__title">Старт от</span>
                <span class="setting-row__hint">Минимум для начала</span>
              </span>
              ${stepper({ field: "minStart", value: value.minStart, min: ROLE_LIMITS.minStart, max: value.maxPlayers, label: "Минимум игроков" })}
            </div>
          </div>
          <div class="setting-list">
            ${switchRow({
              id: "room-public",
              field: "public",
              title: "Публичная комната",
              hint: "Видна в списке комнат и быстром матче.",
              checked: value.public,
            })}
            ${switchRow({
              id: "room-quick",
              field: "quick",
              title: "Приоритет в быстром матче",
              hint: "Комната будет предложена первой.",
              checked: value.quick,
            })}
          </div>
        </div>

        <div class="form-section">
          <span class="form-section__title">${icon("spark", { size: 15 })} Режим</span>
          <div class="mode-picker mode-picker--stack" role="group" aria-label="Режим игры">
            ${MODE_ORDER.map((modeId) => {
              const mode = ROOM_MODES[modeId];
              return html`<button
                class="mode-picker__option ${value.mode === modeId ? "is-active" : ""}"
                type="button"
                data-room-mode="${modeId}"
                aria-pressed="${value.mode === modeId ? "true" : "false"}"
              >
                <strong>${mode.name}</strong>
                <span>${mode.short}</span>
              </button>`;
            })}
          </div>
          <p class="form-section__note" data-mode-note>${ROOM_MODES[value.mode]?.description ?? ""}</p>
        </div>

        <div class="form-section">
          <span class="form-section__title">${icon("mask", { size: 15 })} Роли</span>
          <p class="form-section__note">Каждую роль можно поставить несколько раз. «Авто» оставляет баланс за городом.</p>
          <div class="setting-list">
            ${roleCountRow({
              field: "roles.mafia",
              title: "Мафия",
              hint: "Сколько всего мафиози. 0 — авто, с учётом особых ролей.",
              value: value.roles.mafia,
              min: 0,
              max: ROLE_LIMITS.maxMafia,
              autoLabel: "авто",
            })}
            ${roleCountRow({
              field: "roles.sheriff",
              title: "Шериф",
              hint: "Сколько комиссаров в городе. Можно оставить 0.",
              value: value.roles.sheriff,
              min: 0,
              max: ROLE_LIMITS.maxSheriff,
            })}
            ${roleCountRow({
              field: "roles.civilian",
              title: "Мирные",
              hint: "Сколько обычных горожан. -1 — авто, 0 — ни одного.",
              value: value.roles.civilian,
              min: -1,
              max: ROLE_LIMITS.maxCivilian,
              autoLabel: "авто",
            })}
            ${roleCountRow({
              field: "roles.assassin",
              title: "Ассасин",
              hint: "Мафия с одним контрактом сквозь лечение. Со 2-й ночи.",
              value: value.roles.assassin,
              max: ROLE_LIMITS.maxRoleCount,
            })}
            ${roleCountRow({
              field: "roles.bartender",
              title: "Бармен",
              hint: "Мафия. Поит игрока, и его днём не разобрать.",
              value: value.roles.bartender,
              max: ROLE_LIMITS.maxRoleCount,
            })}
            ${roleCountRow({
              field: "roles.spy",
              title: "Шпион",
              hint: "Мафия. Раз в день узнаёт точную роль игрока.",
              value: value.roles.spy,
              max: ROLE_LIMITS.maxRoleCount,
            })}
            ${roleCountRow({
              field: "roles.doctor",
              title: "Доктор",
              hint: "Лечит одного игрока за ночь.",
              value: value.roles.doctor,
              max: ROLE_LIMITS.maxRoleCount,
            })}
            ${roleCountRow({
              field: "roles.musician",
              title: "Музыкант",
              hint: "Блокирует ночные действия и дневной голос.",
              value: value.roles.musician,
              max: ROLE_LIMITS.maxRoleCount,
            })}
            ${roleCountRow({
              field: "roles.judge",
              title: "Судья",
              hint: "Один раз за игру казнит днём. Ошибка стоит жизни.",
              value: value.roles.judge,
              max: ROLE_LIMITS.maxRoleCount,
            })}
            ${roleCountRow({
              field: "roles.jester",
              title: "Шут",
              hint: "Побеждает, если его повесят голосованием.",
              value: value.roles.jester,
              max: ROLE_LIMITS.maxRoleCount,
            })}
            ${roleCountRow({
              field: "roles.puppeteer",
              title: "Кукловод",
              hint: "Выбирает марионетку и побеждает вместе с ней.",
              value: value.roles.puppeteer,
              max: ROLE_LIMITS.maxRoleCount,
            })}
            ${switchRow({
              id: "role-twin",
              field: "roles.twin",
              title: "Близнецы",
              hint: "Всегда пара. Один переживший голосование другого побеждает.",
              checked: value.roles.twin > 0,
            })}
          </div>
          <div class="role-preview-slot" data-preview-slot>${preview(value)}</div>
        </div>

        <div class="form-section">
          <span class="form-section__title">${icon("clock", { size: 15 })} Темп игры</span>
          ${timerRow({
            field: "night",
            value: value.timers.night,
            min: 12,
            max: 90,
            step: 2,
            label: "Ночь",
            hint: "Мафия, доктор и шериф действуют одновременно.",
          })}
          ${timerRow({
            field: "discussion",
            value: value.timers.discussion,
            min: 20,
            max: 240,
            step: 5,
            label: "Обсуждение",
            hint: "Время на аргументы и быстрые фразы.",
          })}
          ${timerRow({
            field: "voting",
            value: value.timers.voting,
            min: 12,
            max: 90,
            step: 2,
            label: "Голосование",
            hint: "Один голос за фазу, без переголосования.",
          })}
          <div class="setting-row setting-row--stack">
            <span class="setting-row__text">
              <span class="setting-row__title">Активность ботов</span>
              <span class="setting-row__hint">Как часто ИИ-горожане пишут в чат.</span>
            </span>
            <div class="seg" role="group" aria-label="Активность ботов">
              ${Object.values(BOT_CHAT_LEVELS).map(
                (level) => html`<button
                  class="seg__btn ${value.botChat === level.id ? "is-active" : ""}"
                  type="button"
                  data-bot-level="${level.id}"
                >
                  ${level.name}
                </button>`,
              )}
            </div>
          </div>
        </div>

        <div class="form-section">
          <span class="form-section__title">${icon("eye", { size: 15 })} Правила и доступ</span>
          <div class="setting-list">
            ${switchRow({
              id: "room-reveal",
              field: "revealOnDeath",
              title: "Вскрывать роль после смерти",
              hint: "Город видит роль погибшего. Так проще новичкам.",
              checked: value.revealOnDeath,
            })}
            ${switchRow({
              id: "room-spectators",
              field: "allowSpectators",
              title: "Разрешить наблюдателей",
              hint: "Можно подключаться к идущей игре без участия.",
              checked: value.allowSpectators,
            })}
          </div>
        </div>
      </div>`,
    );
  }

  _bind() {
    this.container.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || this.disabled) return;
      const modeButton = target.closest("[data-room-mode]");
      if (modeButton) {
        this.value.mode = modeButton.dataset.roomMode;
        this._normalize();
        this._sync();
        this._notify();
        return;
      }
      const step = target.closest("[data-step]");
      if (step) {
        const field = step.dataset.step;
        const delta = Number(step.dataset.delta) || 0;
        if (field.startsWith("roles.")) {
          const roleId = field.slice(6);
          const min = roleId === "civilian" ? -1 : 0;
          const max = roleId === "mafia"
            ? ROLE_LIMITS.maxMafia
            : roleId === "sheriff"
              ? ROLE_LIMITS.maxSheriff
              : roleId === "civilian"
                ? ROLE_LIMITS.maxCivilian
                : ROLE_LIMITS.maxRoleCount;
          const current = Number(this.value.roles[roleId]) || 0;
          this.value.roles[roleId] = Math.max(min, Math.min(max, current + delta));
        } else if (field === "maxPlayers") {
          this.value.maxPlayers = Math.max(ROLE_LIMITS.minPlayers, Math.min(ROLE_LIMITS.maxPlayers, this.value.maxPlayers + delta));
          if (this.value.minStart > this.value.maxPlayers) this.value.minStart = this.value.maxPlayers;
        } else if (field === "minStart") {
          this.value.minStart = Math.max(ROLE_LIMITS.minStart, Math.min(this.value.maxPlayers, this.value.minStart + delta));
        }
        this._normalize();
        this._sync();
        this._notify();
        return;
      }
      const level = target.closest("[data-bot-level]");
      if (level) {
        this.value.botChat = level.dataset.botLevel;
        this._sync();
        this._notify();
      }
    });

    this.container.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || this.disabled) return;
      if (target.dataset.text === "name") {
        this.value.name = target.value;
        this._notify(true);
        return;
      }
      if (target.dataset.timer) {
        this.value.timers[target.dataset.timer] = Number(target.value);
        this._normalize();
        this._sync();
        this._notify(true);
      }
    });

    this.container.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || this.disabled) return;
      const field = target.dataset.toggle;
      if (!field) return;
      const checked = target.checked;
      if (field.startsWith("roles.")) {
        this.value.roles[field.slice(6)] = checked;
      } else if (field === "public") {
        this.value.public = checked;
        if (!checked) this.value.quick = false;
      } else if (field === "quick") {
        this.value.quick = checked;
        if (checked) this.value.public = true;
      } else if (["revealOnDeath", "allowSpectators"].includes(field)) {
        this.value[field] = checked;
      }
      this._normalize();
      this._sync();
      this._notify();
    });
  }

  _normalize() {
    this.value = normalizeRoomConfig(this.value);
    if (this.value.minStart > this.value.maxPlayers) this.value.minStart = this.value.maxPlayers;
  }

  _sync() {
    const value = this.value;
    const nameInput = qs('[data-text="name"]', this.container);
    if (nameInput && document.activeElement !== nameInput) nameInput.value = value.name;

    for (const field of ["maxPlayers", "minStart"]) {
      const output = qs(`[data-step-value="${field}"]`, this.container);
      if (output) output.textContent = String(value[field]);
      const buttons = qsa(`[data-step="${field}"]`, this.container);
      for (const button of buttons) {
        const delta = Number(button.dataset.delta);
        const next = value[field] + delta;
        const min = field === "maxPlayers" ? ROLE_LIMITS.minPlayers : ROLE_LIMITS.minStart;
        const max = field === "maxPlayers" ? ROLE_LIMITS.maxPlayers : value.maxPlayers;
        button.disabled = next < min || next > max;
      }
    }

    for (const field of ["mafia", "sheriff", "civilian", "assassin", "bartender", "spy", "doctor", "musician", "judge", "jester", "puppeteer"]) {
      const key = `roles.${field}`;
      const current = Number(value.roles[field]) || 0;
      const output = qs(`[data-step-value="${key}"]`, this.container);
      if (output) {
        const auto = (field === "mafia" && current === 0) || (field === "civilian" && current === -1);
        output.textContent = auto ? "авто" : String(current);
      }
      for (const button of qsa(`[data-step="${key}"]`, this.container)) {
        const delta = Number(button.dataset.delta);
        const next = current + delta;
        const min = field === "civilian" ? -1 : 0;
        const max = field === "mafia"
          ? ROLE_LIMITS.maxMafia
          : field === "sheriff"
            ? ROLE_LIMITS.maxSheriff
            : field === "civilian"
              ? ROLE_LIMITS.maxCivilian
              : ROLE_LIMITS.maxRoleCount;
        button.disabled = next < min || next > max;
      }
    }

    for (const button of qsa("[data-room-mode]", this.container)) {
      const active = button.dataset.roomMode === value.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const modeNote = qs("[data-mode-note]", this.container);
    if (modeNote) modeNote.textContent = ROOM_MODES[value.mode]?.description ?? "";

    for (const input of qsa("[data-toggle]", this.container)) {
      const field = input.dataset.toggle;
      let checked = false;
      if (field.startsWith("roles.")) checked = Boolean(value.roles[field.slice(6)]);
      else checked = Boolean(value[field]);
      input.checked = checked;
    }

    for (const input of qsa("[data-timer]", this.container)) {
      const field = input.dataset.timer;
      const current = value.timers[field];
      input.value = String(current);
      const min = Number(input.min);
      const max = Number(input.max);
      const pct = Math.round(((current - min) / (max - min)) * 100);
      input.style.setProperty("--range-fill", `${pct}%`);
      const output = qs(`[data-timer-output="${field}"]`, this.container);
      if (output) output.textContent = current >= 60 ? `${Math.floor(current / 60)}:${String(current % 60).padStart(2, "0")}` : `${current} с`;
    }

    for (const button of qsa("[data-bot-level]", this.container)) {
      const active = button.dataset.botLevel === value.botChat;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }

    // Re-rendering only the preview keeps focus and scroll on the form controls.
    const slot = qs("[data-preview-slot]", this.container);
    if (slot) mount(slot, preview(value));
    this.container.classList.toggle("is-disabled", this.disabled);
    for (const control of qsa("input, button", this.container)) {
      if (control.dataset.step || control.dataset.botLevel || control.dataset.toggle || control.dataset.timer || control.dataset.text) {
        if (control.dataset.step) {
          if (this.disabled) control.disabled = true;
        } else {
          control.disabled = this.disabled;
        }
      }
    }
  }

  _notify(delayed = false) {
    if (!this.onChange) return;
    clearTimeout(this._timer);
    if (delayed) {
      this._timer = setTimeout(() => this.onChange?.(this.getValue()), 120);
    } else {
      this.onChange(this.getValue());
    }
  }

  getValue() {
    this._normalize();
    return { ...this.value, roles: { ...this.value.roles }, timers: { ...this.value.timers } };
  }

  setValue(value) {
    this.value = normalizeRoomConfig(value, value?.maxPlayers);
    this._sync();
  }

  setDisabled(disabled) {
    this.disabled = disabled === true;
    this._sync();
  }

  destroy() {
    clearTimeout(this._timer);
  }
}

export function rolePreviewFor(config) {
  return computeRoleSetup(normalizeRoomConfig(config).maxPlayers, normalizeRoomConfig(config).roles);
}
