import { html, mount, qs, qsa } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { avatar } from "../ui/components.js";
import { confirmModal } from "../ui/modal.js";
import { AVATAR_COLORS } from "../core/storage.js";
import { nickError, normalizeRelayUrl } from "../core/security.js";
import { textOf } from "../core/format.js";
import { LANGUAGE_OPTIONS } from "../core/i18n.js";
import { BOT_CHAT_LEVELS, ROLE_ORDER } from "../data/roles.js";

const EFFECT_OPTIONS = Object.freeze([
  { id: "auto", name: "Авто" },
  { id: "full", name: "Полные" },
  { id: "low", name: "Минимум" },
]);

function percent(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function setRangeFill(input) {
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  input.style.setProperty("--range-fill", `${Math.round((value / max) * 100)}%`);
}

function stateLine(state) {
  if (!state) return "Проверяем…";
  if (state.error) return textOf(state.error, "Relay недоступен.");
  if (state.ok) {
    const parts = [`${state.latency} мс`];
    if (Number.isFinite(Number(state.rooms))) parts.push(`комнат: ${state.rooms}`);
    return `Relay отвечает · ${parts.join(" · ")}`;
  }
  return "Relay недоступен.";
}

export function createSettingsScreen(ctx) {
  const app = ctx.app;
  let settings = { ...app.settings };
  let color = settings.color;
  let name = settings.nick || "";
  let relayDraft = settings.relayUrl || "";
  let relayState = null;
  let testing = false;
  let rootRef = null;

  const install = app.getInstallState?.() ?? { canInstall: false, installed: false };
  const sw = app.getServiceWorkerState?.() ?? { supported: false, registered: false };

  const htmlScreen = html`<div class="screen">
    <div class="page settings-page">
      <header class="page-head">
        <span class="eyebrow">${icon("settings", { size: 13 })} Настройки</span>
        <h1 class="page-title">Ваш город, ваши правила</h1>
        <p class="page-sub">Профиль, звук, доступность и сеть. Всё хранится в этом браузере — аккаунта нет.</p>
      </header>

      <div class="settings-layout">
        <main class="settings-main">
          <section class="panel settings-card" id="settings-language">
            <div class="panel__head">
              <span class="panel__title">${icon("globe", { size: 15 })} Язык интерфейса</span>
              <span class="muted">Interface language</span>
            </div>
            <div class="panel__body">
              <div class="setting-row">
                <span class="setting-row__text">
                  <span class="setting-row__title">Русский или English</span>
                  <span class="setting-row__hint">Меню, правила, подсказки и системные сообщения. Ники и чат не переводятся.</span>
                </span>
                <div class="seg" role="group" aria-label="Язык интерфейса">
                  ${LANGUAGE_OPTIONS.map(
                    (option) => html`<button
                      class="seg__btn ${option.id === settings.lang ? "is-active" : ""}"
                      type="button"
                      data-settings-lang="${option.id}"
                      aria-pressed="${option.id === settings.lang ? "true" : "false"}"
                    >${option.short}</button>`,
                  )}
                </div>
              </div>
            </div>
          </section>

          <section class="panel settings-card" id="settings-profile">
            <div class="panel__head">
              <span class="panel__title">${icon("mask", { size: 15 })} Профиль</span>
              <span class="muted">имя видят другие игроки</span>
            </div>
            <div class="panel__body">
              <div class="profile-editor">
                <div class="profile-editor__preview" data-settings-preview>
                  ${avatar({ name: name || "Игрок", color }, { size: "xl" })}
                </div>
                <div class="profile-editor__fields">
                  <label class="field" for="settings-nick">
                    <span class="field__label">Ник</span>
                    <input
                      class="input"
                      id="settings-nick"
                      data-settings-nick
                      type="text"
                      maxlength="16"
                      value="${name}"
                      placeholder="Например, Полночь"
                      autocomplete="nickname"
                      spellcheck="false"
                    />
                    <span class="field__hint">2–16 символов. Буквы, цифры, пробел, точка и дефис.</span>
                    <span class="field__error" data-settings-error></span>
                  </label>
                  <div class="profile-editor__colors">
                    <span class="field__label">Цвет метки</span>
                    <div class="swatch-row" role="radiogroup" aria-label="Цвет метки">
                      ${AVATAR_COLORS.map(
                        (swatch) => html`<button
                          class="swatch ${swatch === color ? "is-active" : ""}"
                          type="button"
                          data-settings-color="${swatch}"
                          style="--swatch:${swatch}"
                          role="radio"
                          aria-checked="${swatch === color ? "true" : "false"}"
                          aria-label="Цвет ${swatch}"
                        ></button>`,
                      )}
                    </div>
                  </div>
                  <button class="btn btn--primary btn--sm" type="button" data-settings-save>${icon("check", { size: 15 })} Сохранить профиль</button>
                </div>
              </div>
              <p class="field__hint settings-profile-note">
                ${icon("info", { size: 13 })}
                Ник проверяется на служебные имена и нецензурную лексику. Уникальность не гарантируется — в городе бывают тёзки.
              </p>
            </div>
          </section>

          <section class="panel settings-card" id="settings-audio">
            <div class="panel__head">
              <span class="panel__title">${icon("music", { size: 15 })} Звук</span>
              <button class="btn btn--quiet btn--sm" type="button" data-settings-mute>
                ${icon(settings.muted ? "volumeOff" : "volume", { size: 15 })} <span data-mute-label>${settings.muted ? "Включить" : "Выключить"}</span>
              </button>
            </div>
            <div class="panel__body">
              <div class="audio-setting">
                <div class="audio-setting__head">
                  <span class="setting-row__title">Музыка</span>
                  <output data-music-out>${percent(settings.music)}</output>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value="${Math.round(settings.music * 100)}"
                  data-music-range
                  aria-label="Громкость музыки"
                  style="--range-fill:${Math.round(settings.music * 100)}%"
                />
                <span class="field__hint">День и ночь — две авторские темы, которые сменяются вместе с фазой.</span>
              </div>
              <div class="audio-setting">
                <div class="audio-setting__head">
                  <span class="setting-row__title">Эффекты</span>
                  <output data-sfx-out>${percent(settings.sfx)}</output>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value="${Math.round(settings.sfx * 100)}"
                  data-sfx-range
                  aria-label="Громкость эффектов"
                  style="--range-fill:${Math.round(settings.sfx * 100)}%"
                />
                <span class="field__hint">Щелчки, голосование, ночные переходы. Синтезируются в браузере.</span>
              </div>
              <div class="row wrap">
                <button class="btn btn--ghost btn--sm" type="button" data-settings-preview-sfx>${icon("play", { size: 14 })} Проверить звук</button>
                <span class="muted small">Первый звук появится после касания или клика — так требует браузер.</span>
              </div>
            </div>
          </section>

          <section class="panel settings-card" id="settings-access">
            <div class="panel__head"><span class="panel__title">${icon("eye", { size: 15 })} Доступность и подсказки</span></div>
            <div class="panel__body settings-rows">
              <div class="setting-row setting-row--stack">
                <span class="setting-row__text">
                  <span class="setting-row__title">Эффекты</span>
                  <span class="setting-row__hint">Туман, дождь и луна. «Авто» сам снижает качество, если браузер не держит 50 fps.</span>
                </span>
                <div class="seg" role="group" aria-label="Эффекты">
                  ${EFFECT_OPTIONS.map(
                    (option) => html`<button
                      class="seg__btn ${option.id === settings.effects ? "is-active" : ""}"
                      type="button"
                      data-settings-effects="${option.id}"
                      aria-pressed="${option.id === settings.effects ? "true" : "false"}"
                    >${option.name}</button>`,
                  )}
                </div>
              </div>
              <label class="setting-row setting-row--switch" for="settings-motion">
                <span class="setting-row__text">
                  <span class="setting-row__title">Меньше движения</span>
                  <span class="setting-row__hint">Убирает все анимации интерфейса. Полезно, если от движения укачивает.</span>
                </span>
                <span class="switch">
                  <input id="settings-motion" type="checkbox" data-settings-motion ${settings.reducedMotion ? html`checked` : ""} />
                  <span class="switch__track" aria-hidden="true"></span>
                </span>
              </label>
              <label class="setting-row setting-row--switch" for="settings-hints">
                <span class="setting-row__text">
                  <span class="setting-row__title">Подсказки в игре</span>
                  <span class="setting-row__hint">Короткие пояснения к кнопкам и фазам. Можно выключить, когда освоитесь.</span>
                </span>
                <span class="switch">
                  <input id="settings-hints" type="checkbox" data-settings-hints ${settings.showHints ? html`checked` : ""} />
                  <span class="switch__track" aria-hidden="true"></span>
                </span>
              </label>
              <label class="setting-row setting-row--switch" for="settings-reveal">
                <span class="setting-row__text">
                  <span class="setting-row__title">Раскрывать роль после смерти</span>
                  <span class="setting-row__hint">Значение по умолчанию для новых комнат. Внутри комнаты правило задаёт хост.</span>
                </span>
                <span class="switch">
                  <input id="settings-reveal" type="checkbox" data-settings-reveal ${settings.revealOnDeath ? html`checked` : ""} />
                  <span class="switch__track" aria-hidden="true"></span>
                </span>
              </label>
            </div>
          </section>

          <section class="panel settings-card" id="settings-game">
            <div class="panel__head"><span class="panel__title">${icon("sliders", { size: 15 })} Игра по умолчанию</span></div>
            <div class="panel__body">
              <div class="setting-row setting-row--stack">
                <span class="setting-row__text">
                  <span class="setting-row__title">Болтливость ботов</span>
                  <span class="setting-row__hint">Сколько ИИ-горожане говорят в каждой фазе.</span>
                </span>
                <div class="seg" role="group" aria-label="Болтливость ботов">
                  ${Object.values(BOT_CHAT_LEVELS).map(
                    (level) => html`<button
                      class="seg__btn ${level.id === settings.botChat ? "is-active" : ""}"
                      type="button"
                      data-settings-chat="${level.id}"
                      aria-pressed="${level.id === settings.botChat ? "true" : "false"}"
                    >${level.name}</button>`,
                  )}
                </div>
              </div>
              <div class="setting-row">
                <span class="setting-row__text">
                  <span class="setting-row__title">Размер города по умолчанию</span>
                  <span class="setting-row__hint">Подставляется в быстром старте и при создании комнаты.</span>
                </span>
                <div class="stepper" role="group" aria-label="Игроков по умолчанию">
                  <button type="button" data-settings-players="-1" aria-label="Меньше">${icon("minus", { size: 15 })}</button>
                  <output data-settings-players-out>${settings.lastPlayerCount}</output>
                  <button type="button" data-settings-players="1" aria-label="Больше">${icon("plus", { size: 15 })}</button>
                </div>
              </div>
            </div>
          </section>

          <section class="panel settings-card" id="settings-network">
            <div class="panel__head">
              <span class="panel__title">${icon("wifi", { size: 15 })} Сеть и relay</span>
              <span class="badge ${settings.relayUrl ? "badge--town" : "badge--muted"}">${settings.relayUrl ? "онлайн включён" : "режим портов"}</span>
            </div>
            <div class="panel__body">
              <div class="notice">
                ${icon("info", { size: 16 })}
                <span>
                  Для других устройств есть два пути: «По IP» (<span class="mono">npm start</span> у хоста, остальные заходят по его адресу)
                  или онлайн-relay. Без сервера работают тренировка и «Порты» — комнаты в соседних вкладках этого браузера.
                </span>
              </div>
              <label class="field settings-relay" for="settings-relay">
                <span class="field__label">Адрес relay</span>
                <div class="input-group">
                  <input
                    class="input mono"
                    id="settings-relay"
                    data-settings-relay
                    type="url"
                    value="${relayDraft}"
                    placeholder="https://relay.mafia.rb-o.ru"
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <button class="btn btn--ghost" type="button" data-settings-test>${testing ? "Проверяем…" : "Проверить"}</button>
                </div>
                <span class="field__error" data-relay-error></span>
                <span class="field__hint" data-relay-status>${relayState ? stateLine(relayState) : "Введите http(s):// адрес Vercel-релея или wss:// адрес WebSocket-сервера."}</span>
              </label>
              <div class="row wrap">
                <button class="btn btn--primary btn--sm" type="button" data-settings-save-relay>${icon("check", { size: 15 })} Сохранить адрес</button>
                <button class="btn btn--quiet btn--sm" type="button" data-settings-clear-relay ${settings.relayUrl ? "" : "disabled"}>Отключить онлайн</button>
              </div>
              <div class="settings-diagnostics">
                <div>
                  <span class="field__label">Режим</span>
                  <p>${settings.relayUrl ? "Порты и онлайн-комнаты" : "Только порты этого браузера"}</p>
                </div>
                <div>
                  <span class="field__label">Установка</span>
                  <p data-install-text>${install.installed ? "Приложение установлено" : install.canInstall ? "Доступна установка" : "Через меню браузера"}</p>
                </div>
                <div>
                  <span class="field__label">Офлайн-кэш</span>
                  <p data-sw-text>${!sw.supported ? "Не поддерживается" : sw.registered ? "Service worker активен" : "Ещё не зарегистрирован"}</p>
                </div>
              </div>
              <button class="btn btn--ghost btn--sm ${install.installed || !install.canInstall ? "hidden" : ""}" type="button" data-settings-install>
                ${icon("download", { size: 15 })} Установить приложение
              </button>
            </div>
          </section>

          <section class="panel settings-card settings-danger">
            <div class="panel__head"><span class="panel__title">${icon("trash", { size: 15 })} Данные</span></div>
            <div class="panel__body">
              <div class="setting-row">
                <span class="setting-row__text">
                  <span class="setting-row__title">Очистить настройки и историю комнат</span>
                  <span class="setting-row__hint">Ник, цвет, звук, relay и список недавних комнат будут удалены. Активная партия не пострадает до перезагрузки.</span>
                </span>
                <button class="btn btn--danger btn--sm" type="button" data-settings-clear>${icon("trash", { size: 14 })} Очистить</button>
              </div>
              <p class="field__hint">
                ${icon("shield", { size: 13 })}
                Чаты и роли никогда не сохраняются на диск. Очищать нечего — это сделано специально.
              </p>
            </div>
          </section>
        </main>

        <aside class="settings-side">
          <section class="panel settings-summary panel--gold">
            <div class="panel__body">
              <span class="eyebrow">${icon("star", { size: 12 })} Ваш профиль</span>
              <div class="settings-summary__person" data-settings-summary>
                ${avatar({ name: name || "Игрок", color }, { size: "lg" })}
                <div>
                  <strong data-settings-summary-name>${name || "Игрок"}</strong>
                  <span class="muted">горожанин</span>
                </div>
              </div>
              <p class="field__hint">Имя и цвет видны в лобби, чате и за столом. Роль — никогда.</p>
            </div>
          </section>

          <section class="panel settings-side-card">
            <div class="panel__head"><span class="panel__title">${icon("info", { size: 14 })} О игре</span></div>
            <div class="panel__body">
              <dl class="about-list">
                <div><dt>Версия</dt><dd>${app.version ?? "2.0"}</dd></div>
                <div><dt>Ролей</dt><dd>${ROLE_ORDER.length}</dd></div>
                <div><dt>Ботов</dt><dd>20</dd></div>
                <div><dt>Музыка</dt><dd>авторская</dd></div>
                <div><dt>Хранение</dt><dd>localStorage</dd></div>
              </dl>
              <p class="field__hint">Арт и музыка созданы для «Ночного города». Игра работает без сборки и без внешних библиотек.</p>
              <div class="row wrap">
                <button class="btn btn--quiet btn--sm" type="button" data-go-rules>${icon("scroll", { size: 14 })} Правила</button>
                <button class="btn btn--quiet btn--sm" type="button" data-go-roles>${icon("mask", { size: 14 })} Роли</button>
              </div>
            </div>
          </section>

          <section class="panel settings-side-card settings-side-card--quiet">
            <div class="panel__body">
              <span class="settings-quote" aria-hidden="true">“</span>
              <p>Город не прощает тех, кто молчит слишком уверенно.</p>
              <span class="field__hint">— из записных книжек комиссара</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </div>`;

  function save(patch, message = "") {
    settings = app.updateSettings(patch) ?? settings;
    if (message) app.toast(message, { tone: "town" });
  }

  function renderPreview() {
    const target = qs("[data-settings-preview]", rootRef);
    if (target) mount(target, avatar({ name: name || "Игрок", color }, { size: "xl" }));
    const summary = qs("[data-settings-summary]", rootRef);
    if (summary) {
      mount(
        summary,
        html`${avatar({ name: name || "Игрок", color }, { size: "lg" })}
          <div><strong>${name || "Игрок"}</strong><span class="muted">горожанин</span></div>`,
      );
    }
  }

  function saveProfile() {
    const input = qs("[data-settings-nick]", rootRef);
    const error = qs("[data-settings-error]", rootRef);
    const message = nickError(name);
    if (message) {
      error.textContent = message;
      input?.setAttribute("aria-invalid", "true");
      input?.classList.add("shake");
      setTimeout(() => input?.classList.remove("shake"), 450);
      input?.focus({ preventScroll: true });
      app.playSfx("error");
      return;
    }
    error.textContent = "";
    input?.removeAttribute("aria-invalid");
    const result = app.updateProfile({ nick: name, color });
    if (result?.ok === false) {
      error.textContent = result.error ?? "Не удалось сохранить профиль.";
      return;
    }
    settings = app.settings;
    renderPreview();
    app.playSfx("check");
    app.toast("Профиль сохранён.", { tone: "town" });
  }

  async function testRelay() {
    if (testing) return;
    const input = qs("[data-settings-relay]", rootRef);
    const error = qs("[data-relay-error]", rootRef);
    const status = qs("[data-relay-status]", rootRef);
    const value = normalizeRelayUrl(input?.value ?? "");
    if (!value) {
      error.textContent = "Нужен корректный ws://, wss://, http:// или https:// адрес.";
      input?.setAttribute("aria-invalid", "true");
      input?.focus({ preventScroll: true });
      return;
    }
    error.textContent = "";
    input?.removeAttribute("aria-invalid");
    testing = true;
    const button = qs("[data-settings-test]", rootRef);
    if (button) button.textContent = "Проверяем…";
    if (status) status.textContent = "Соединяемся с relay…";
    try {
      relayState = await app.testRelay(value);
    } catch (err) {
      relayState = { ok: false, error: err?.message ?? "Relay недоступен." };
    } finally {
      testing = false;
      if (button) button.textContent = "Проверить";
      if (status) status.textContent = stateLine(relayState);
      if (relayState?.ok) app.playSfx("join");
      else app.playSfx("error");
    }
  }

  return {
    title: "Настройки",
    html: htmlScreen,
    mount(root) {
      rootRef = root;
      for (const input of qsa('input[type="range"]', root)) setRangeFill(input);

      qs("[data-settings-nick]", root)?.addEventListener("input", (event) => {
        name = event.target.value;
        const error = qs("[data-settings-error]", root);
        if (error?.textContent) error.textContent = "";
        qs("[data-settings-nick]", root)?.removeAttribute("aria-invalid");
        renderPreview();
      });
      qs("[data-settings-nick]", root)?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveProfile();
        }
      });

      root.addEventListener("input", (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.matches("[data-music-range]")) {
          setRangeFill(input);
          const value = Number(input.value) / 100;
          const out = qs("[data-music-out]", root);
          if (out) out.textContent = percent(value);
          settings = app.updateSettings({ music: value }) ?? settings;
        } else if (input.matches("[data-sfx-range]")) {
          setRangeFill(input);
          const value = Number(input.value) / 100;
          const out = qs("[data-sfx-out]", root);
          if (out) out.textContent = percent(value);
          settings = app.updateSettings({ sfx: value }) ?? settings;
        }
      });

      root.addEventListener("change", (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.matches("[data-settings-motion]")) {
          save({ reducedMotion: input.checked });
        } else if (input.matches("[data-settings-hints]")) {
          save({ showHints: input.checked });
        } else if (input.matches("[data-settings-reveal]")) {
          save({ revealOnDeath: input.checked });
        }
      });

      qs("[data-settings-save]", root)?.addEventListener("click", saveProfile);

      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const swatch = target.closest("[data-settings-color]");
        if (swatch) {
          color = swatch.dataset.settingsColor;
          for (const button of qsa("[data-settings-color]", root)) {
            button.classList.toggle("is-active", button === swatch);
            button.setAttribute("aria-checked", button === swatch ? "true" : "false");
          }
          renderPreview();
          if (settings.nick) app.updateProfile({ color });
          return;
        }

        if (target.closest("[data-settings-mute]")) {
          settings = app.updateSettings({ muted: !settings.muted }) ?? settings;
          const label = qs("[data-mute-label]", root);
          if (label) label.textContent = settings.muted ? "Включить" : "Выключить";
          app.playSfx("click");
          return;
        }

        if (target.closest("[data-settings-preview-sfx]")) {
          app.playSfx("start");
          return;
        }

        const effects = target.closest("[data-settings-effects]");
        if (effects) {
          settings = app.updateSettings({ effects: effects.dataset.settingsEffects }) ?? settings;
          for (const button of qsa("[data-settings-effects]", root)) {
            button.classList.toggle("is-active", button === effects);
            button.setAttribute("aria-pressed", button === effects ? "true" : "false");
          }
          app.playSfx("click");
          return;
        }

        const languageButton = target.closest("[data-settings-lang]");
        if (languageButton) {
          settings = app.updateSettings({ lang: languageButton.dataset.settingsLang }) ?? settings;
          for (const button of qsa("[data-settings-lang]", root)) {
            button.classList.toggle("is-active", button === languageButton);
            button.setAttribute("aria-pressed", button === languageButton ? "true" : "false");
          }
          app.playSfx("click");
          return;
        }

        const chat = target.closest("[data-settings-chat]");
        if (chat) {
          settings = app.updateSettings({ botChat: chat.dataset.settingsChat }) ?? settings;
          for (const button of qsa("[data-settings-chat]", root)) {
            button.classList.toggle("is-active", button === chat);
            button.setAttribute("aria-pressed", button === chat ? "true" : "false");
          }
          return;
        }

        const step = target.closest("[data-settings-players]");
        if (step) {
          const next = Math.max(4, Math.min(20, settings.lastPlayerCount + Number(step.dataset.settingsPlayers)));
          settings = app.updateSettings({ lastPlayerCount: next }) ?? settings;
          const out = qs("[data-settings-players-out]", root);
          if (out) out.textContent = String(next);
          return;
        }

        if (target.closest("[data-settings-test]")) {
          void testRelay();
          return;
        }

        if (target.closest("[data-settings-save-relay]")) {
          const input = qs("[data-settings-relay]", root);
          const error = qs("[data-relay-error]", root);
          const raw = input?.value ?? "";
          const value = raw.trim() ? normalizeRelayUrl(raw) : "";
          if (raw.trim() && !value) {
            error.textContent = "Некорректный адрес. Пример: https://relay.mafia.rb-o.ru";
            input?.setAttribute("aria-invalid", "true");
            return;
          }
          error.textContent = "";
          input?.removeAttribute("aria-invalid");
          relayDraft = value;
          settings = app.updateSettings({ relayUrl: value }) ?? settings;
          app.toast(value ? "Relay сохранён." : "Онлайн отключён.", { tone: "town" });
          return;
        }

        if (target.closest("[data-settings-clear-relay]")) {
          relayDraft = "";
          relayState = null;
          const input = qs("[data-settings-relay]", root);
          if (input) input.value = "";
          settings = app.updateSettings({ relayUrl: "" }) ?? settings;
          const status = qs("[data-relay-status]", root);
          if (status) status.textContent = "Онлайн отключён. Работают порты этого браузера.";
          app.toast("Онлайн отключён.", { tone: "warn" });
          return;
        }

        if (target.closest("[data-settings-install]")) {
          void app.promptInstall?.().then((accepted) => {
            if (accepted) app.toast("Установка началась.", { tone: "town" });
          });
          return;
        }

        if (target.closest("[data-settings-clear]")) {
          void confirmModal({
            title: "Очистить локальные данные?",
            message: "Будут удалены ник, цвет, настройки звука, адрес relay и история комнат.",
            detail: "Активная игра продолжится, пока вы не перезагрузите страницу. Роли и чаты на диск не сохранялись.",
            confirmLabel: "Очистить",
            cancelLabel: "Оставить",
          }).then((confirmed) => {
            if (!confirmed) return;
            const result = app.clearLocalData?.();
            settings = result?.settings ?? { ...app.settings };
            name = settings.nick || "";
            color = settings.color;
            relayDraft = settings.relayUrl;
            app.toast("Локальные данные очищены.", { tone: "town" });
            app.navigate("/", { replace: true });
          });
          return;
        }

        if (target.closest("[data-go-rules]")) app.navigate("/rules");
        else if (target.closest("[data-go-roles]")) app.navigate("/roles");
      });
    },
    destroy() {
      rootRef = null;
    },
  };
}
