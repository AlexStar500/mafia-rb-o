import { html, qs, qsa } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { normalizeRelayEndpoint } from "../net/protocol.js";
import { probeSameOriginRelay } from "../net/auto.js";
import { isValidRoomCode, normalizeRoomCode } from "../core/security.js";
import { loadRoomRegistry } from "../core/storage.js";

export function createJoinScreen(ctx) {
  const app = ctx.app;
  const settings = app.settings;
  const query = ctx.route?.query ?? {};
  const invitedCode = normalizeRoomCode(query.code ?? query.room ?? "");
  const invitedRelay = normalizeRelayEndpoint(query.relay ?? "");
  let mode = invitedRelay
    ? "online"
    : ["local", "lan", "online"].includes(query.mode)
      ? query.mode
      : settings.relayUrl
        ? "online"
        : "local";
  let sameOrigin = "";
  const recent = loadRoomRegistry()
    .filter((room) => room?.code)
    .slice(0, 4);

  const htmlScreen = html`<div class="screen">
    <div class="page join-page">
      <header class="page-head">
        <span class="eyebrow">${icon("key", { size: 13 })} Вход по коду</span>
        <h1 class="page-title">Вас ждут за столом</h1>
        <p class="page-sub">Шесть символов, один город. Код нечувствителен к регистру.</p>
      </header>

      <div class="join-layout">
        <form class="panel panel--gold join-card" data-join-form autocomplete="off">
          ${invitedCode
            ? html`<div class="join-invite">${icon("share", { size: 16 })} <span>Приглашение в комнату <b>${invitedCode}</b></span></div>`
            : ""}
          <div class="panel__body">
            <label class="field join-code-field" for="join-code">
              <span class="field__label">Код комнаты</span>
              <input
                class="input code-input join-code-input"
                id="join-code"
                data-join-code
                type="text"
                inputmode="text"
                maxlength="6"
                value="${invitedCode}"
                placeholder="ABC234"
                autocomplete="off"
                spellcheck="false"
                aria-describedby="join-code-hint"
              />
              <span class="field__hint" id="join-code-hint">Код показывает хост в лобби и в ссылке-приглашении.</span>
            </label>

            <div class="join-mode">
              <span class="field__label">Способ подключения</span>
              <div class="mode-picker mode-picker--compact" role="radiogroup" aria-label="Способ подключения">
                <button class="mode-option ${mode === "local" ? "is-active" : ""}" type="button" data-join-mode="local" role="radio" aria-checked="${mode === "local" ? "true" : "false"}">
                  <span class="mode-option__icon">${icon("monitor", { size: 18 })}</span>
                  <span><b>Порты</b><span>Вкладки этого браузера, без сервера</span></span>
                </button>
                <button class="mode-option ${mode === "lan" ? "is-active" : ""}" type="button" data-join-mode="lan" role="radio" aria-checked="${mode === "lan" ? "true" : "false"}">
                  <span class="mode-option__icon">${icon("monitor", { size: 18 })}</span>
                  <span><b>Локальная сеть</b><span>Компьютер-хост в той же сети</span></span>
                </button>
                <button class="mode-option ${mode === "online" ? "is-active" : ""}" type="button" data-join-mode="online" role="radio" aria-checked="${mode === "online" ? "true" : "false"}">
                  <span class="mode-option__icon">${icon("wifi", { size: 18 })}</span>
                  <span><b>Онлайн</b><span>Через relay-сервер</span></span>
                </button>
              </div>
            </div>

            <div class="relay-field ${mode === "online" ? "" : "hidden"}" data-join-relay-field>
              <label class="field" for="join-relay">
                <span class="field__label">Адрес relay</span>
                <input
                  class="input"
                  id="join-relay"
                  type="text"
                  data-join-relay
                  value="${invitedRelay || settings.relayUrl}"
                  placeholder="wss://your-relay.example/ws"
                  autocomplete="off"
                  spellcheck="false"
                />
                <span class="field__hint">Если поле пустое, relay на этом же адресе подставится сам.</span>
                <span class="field__error" data-join-error></span>
              </label>
            </div>
            <div class="relay-field ${mode === "lan" ? "" : "hidden"}" data-join-lan-field>
              <div class="notice">
                ${icon("info", { size: 16 })}
                <span data-join-lan-status>Проверяем локальный сервер…</span>
              </div>
              <span class="field__error" data-join-lan-error></span>
            </div>

            <label class="setting-row setting-row--switch join-spectate" for="join-spectate">
              <span class="setting-row__text">
                <span class="setting-row__title">Войти наблюдателем</span>
                <span class="setting-row__hint">Если игра уже идёт и хост разрешает зрителей.</span>
              </span>
              <span class="switch">
                <input id="join-spectate" type="checkbox" data-join-spectate />
                <span class="switch__track" aria-hidden="true"></span>
              </span>
            </label>

            <button class="btn btn--primary btn--lg btn--block" type="submit" data-join-submit>
              ${icon("door", { size: 18 })} Войти в комнату
            </button>
          </div>
        </form>

        <aside class="join-aside">
          <section class="panel">
            <div class="panel__head"><span class="panel__title">${icon("info", { size: 15 })} Как это работает</span></div>
            <div class="panel__body join-help">
              <div class="join-help__row">
                <span class="join-help__icon">${icon("monitor", { size: 18 })}</span>
                <div><b>Порты</b><p>Комната живёт во вкладках этого браузера. Сервер не нужен — работает и на GitHub Pages, и на mafia.rb-o.ru.</p></div>
              </div>
              <div class="join-help__row">
                <span class="join-help__icon">${icon("monitor", { size: 18 })}</span>
                <div><b>Локальная сеть</b><p>Хост запускает <span class="mono">npm start</span> на компьютере, друзья открывают его адрес в той же сети. Сервер и relay — в одном процессе, как LAN в CS2.</p></div>
              </div>
              <div class="join-help__row">
                <span class="join-help__icon">${icon("wifi", { size: 18 })}</span>
                <div><b>Онлайн</b><p>Нужен relay в интернете: <span class="mono">npm run relay</span> на VPS или Render. Адрес можно взять из ссылки-приглашения.</p></div>
              </div>
              <div class="join-help__row">
                <span class="join-help__icon">${icon("shield", { size: 18 })}</span>
                <div><b>Безопасно</b><p>Relay не видит роли и закрытые чаты. Вся логика игры — у хоста.</p></div>
              </div>
            </div>
          </section>

          ${recent.length
            ? html`<section class="panel">
                <div class="panel__head"><span class="panel__title">${icon("clock", { size: 15 })} Недавние комнаты</span></div>
                <div class="panel__body recent-rooms">
                  ${recent.map(
                    (room) => html`<button class="recent-room" type="button" data-recent-code="${room.code}">
                      <span class="recent-room__name truncate">${room.name || "Ночной город"}</span>
                      <span class="code-pill code-pill--sm">${room.code}</span>
                    </button>`,
                  )}
                </div>
              </section>`
            : ""}

          <button class="btn btn--ghost btn--block" type="button" data-go-create>${icon("plus", { size: 16 })} Создать свою комнату</button>
        </aside>
      </div>
    </div>
  </div>`;

  return {
    title: "Вход по коду",
    html: htmlScreen,
    mount(root) {
      const codeInput = qs("[data-join-code]", root);
      const relayField = qs("[data-join-relay-field]", root);
      const lanField = qs("[data-join-lan-field]", root);
      const relayInput = qs("[data-join-relay]", root);
      const spectate = qs("[data-join-spectate]", root);
      const lanStatus = () => {
        const node = qs("[data-join-lan-status]", root);
        if (!node) return;
        node.textContent = sameOrigin
          ? `Сервер найден: ${sameOrigin.replace(/^wss?:/, "ws:")}`
          : "Сервер не найден. Откройте игру по адресу компьютера-хоста.";
      };
      const detectSameOrigin = () =>
        probeSameOriginRelay().then((url) => {
          sameOrigin = url;
          lanStatus();
          return url;
        });
      void detectSameOrigin();

      codeInput.addEventListener("input", () => {
        codeInput.value = normalizeRoomCode(codeInput.value);
      });
      codeInput.addEventListener("paste", (event) => {
        const text = event.clipboardData?.getData("text") ?? "";
        if (!text) return;
        event.preventDefault();
        codeInput.value = normalizeRoomCode(text);
      });

      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const modeButton = target.closest("[data-join-mode]");
        if (modeButton) {
          mode = modeButton.dataset.joinMode;
          for (const button of qsa("[data-join-mode]", root)) {
            button.classList.toggle("is-active", button === modeButton);
            button.setAttribute("aria-checked", button === modeButton ? "true" : "false");
          }
          relayField.classList.toggle("hidden", mode !== "online");
          lanField.classList.toggle("hidden", mode !== "lan");
          if (mode === "lan") {
            lanStatus();
            void detectSameOrigin();
          }
          return;
        }
        const recentButton = target.closest("[data-recent-code]");
        if (recentButton) {
          codeInput.value = recentButton.dataset.recentCode;
          codeInput.focus();
          return;
        }
        if (target.closest("[data-go-create]")) app.navigate("/create");
      });

      qs("[data-join-form]", root).addEventListener("submit", async (event) => {
        event.preventDefault();
        const error = qs("[data-join-error]", root);
        const lanError = qs("[data-join-lan-error]", root);
        const code = normalizeRoomCode(codeInput.value);
        if (!isValidRoomCode(code)) {
          app.toast("Код комнаты — 6 символов без похожих I/O/0/1.", { tone: "warn" });
          codeInput.setAttribute("aria-invalid", "true");
          codeInput.focus({ preventScroll: true });
          app.playSfx("error");
          return;
        }
        codeInput.removeAttribute("aria-invalid");
        let relayUrl = "";
        if (mode === "online") {
          relayUrl = normalizeRelayEndpoint(relayInput.value);
          if (relayUrl && typeof location !== "undefined" && location.protocol === "https:" && !relayUrl.startsWith("wss:")) {
            error.textContent = "На HTTPS нужен wss:// relay.";
            relayInput.setAttribute("aria-invalid", "true");
            relayInput.focus({ preventScroll: true });
            return;
          }
          if (!relayUrl) relayUrl = await detectSameOrigin();
          if (!relayUrl) {
            error.textContent = "Укажите корректный relay адрес.";
            relayInput.setAttribute("aria-invalid", "true");
            relayInput.focus({ preventScroll: true });
            return;
          }
          error.textContent = "";
          relayInput.removeAttribute("aria-invalid");
          app.updateSettings({ relayUrl });
        }
        if (mode === "lan") {
          relayUrl = await detectSameOrigin();
          if (!relayUrl) {
            lanError.textContent = "Локальный сервер не найден. Откройте игру по адресу компьютера-хоста.";
            app.playSfx("error");
            return;
          }
          lanError.textContent = "";
        }
        void app.joinRoom({ code, mode, spectate: spectate.checked, relayUrl });
      });
    },
    destroy() {},
  };
}
