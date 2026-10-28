import { html, qs, mount } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { RoomForm } from "../ui/roomForm.js";
import { normalizeRelayUrl } from "../core/security.js";
import { probeSameOriginRelay, PUBLIC_HTTP_RELAY, resolveRelayForMode } from "../net/auto.js";
import { normalizeRoomConfig, computeRoleSetup, ROLES } from "../data/roles.js";

function localRelayDefault() {
  try {
    if (typeof location !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(location.hostname)) {
      return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
    }
  } catch {
    // ignore
  }
  return PUBLIC_HTTP_RELAY;
}

function summarySetup(config) {
  const setup = computeRoleSetup(config.maxPlayers, config.roles);
  return Object.entries(setup.counts)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => `${ROLES[id]?.name ?? id} ×${count}`)
    .join(" · ");
}

export function createCreateScreen(ctx) {
  const app = ctx.app;
  const settings = app.settings;
  const initial = normalizeRoomConfig({
    name: "Ночной город",
    maxPlayers: settings.lastPlayerCount || 8,
    minStart: Math.min(5, settings.lastPlayerCount || 8),
    botChat: settings.botChat,
    revealOnDeath: settings.revealOnDeath,
  });
  let mode = settings.relayUrl ? "online" : "local";
  let config = initial;
  let form = null;
  let sameOrigin = "";
  let sameOriginProbe = null;

  const detectSameOrigin = () => {
    if (sameOrigin) return Promise.resolve(sameOrigin);
    if (!sameOriginProbe) {
      sameOriginProbe = probeSameOriginRelay().then((url) => {
        sameOrigin = url;
        // A miss may be a service-worker hiccup: let the next call retry.
        if (!url) sameOriginProbe = null;
        return url;
      });
    }
    return sameOriginProbe ?? Promise.resolve("");
  };

  const lanStatus = (root) => {
    const node = qs("[data-lan-status]", root);
    if (!node) return;
    node.textContent = sameOrigin
      ? `Сервер найден: ${sameOrigin.replace(/^wss?:/, "ws:")}`
      : "Сервер не найден. Запустите npm start — тогда игроки смогут зайти по вашему IP.";
  };

  const htmlScreen = html`<div class="screen">
    <div class="page create-page">
      <header class="page-head">
        <span class="eyebrow">${icon("plus", { size: 13 })} Новая комната</span>
        <h1 class="page-title">Соберите свой город</h1>
        <p class="page-sub">Настройте состав, роли и таймеры. Затем позовите игроков или заполните свободные места ботами.</p>
      </header>

      <div class="create-layout">
        <form class="create-main" data-create-form autocomplete="off">
          <section class="panel create-mode">
            <div class="panel__head">
              <span class="panel__title">${icon("globe", { size: 15 })} Режим комнаты</span>
            </div>
            <div class="panel__body">
              <div class="mode-picker" role="radiogroup" aria-label="Режим комнаты">
                <button class="mode-option ${mode === "local" ? "is-active" : ""}" type="button" data-create-mode="local" role="radio" aria-checked="${mode === "local" ? "true" : "false"}">
                  <span class="mode-option__icon">${icon("monitor", { size: 20 })}</span>
                  <span>
                    <b>Порты</b>
                    <span>Вкладки этого браузера. Без сервера: комната живёт, пока открыта хотя бы одна вкладка.</span>
                  </span>
                </button>
                <button class="mode-option ${mode === "lan" ? "is-active" : ""}" type="button" data-create-mode="lan" role="radio" aria-checked="${mode === "lan" ? "true" : "false"}">
                  <span class="mode-option__icon">${icon("monitor", { size: 20 })}</span>
                  <span>
                    <b>По IP</b>
                    <span>Хост запускает сервер, остальные заходят по его адресу. Можно из другой сети, если открыт порт.</span>
                  </span>
                </button>
                <button class="mode-option ${mode === "online" ? "is-active" : ""}" type="button" data-create-mode="online" role="radio" aria-checked="${mode === "online" ? "true" : "false"}">
                  <span class="mode-option__icon">${icon("wifi", { size: 20 })}</span>
                  <span>
                    <b>Онлайн</b>
                    <span>Relay в интернете, без проброса портов. Работает с любого устройства.</span>
                  </span>
                </button>
              </div>
              <div class="relay-field ${mode === "online" ? "" : "hidden"}" data-relay-field>
                <label class="field" for="create-relay">
                  <span class="field__label">Адрес relay</span>
                  <input
                    class="input"
                    id="create-relay"
                    type="text"
                    data-create-relay
                    value="${settings.relayUrl || localRelayDefault()}"
                    placeholder="https://mafiarbovercel.vercel.app или wss://relay.example/ws"
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <span class="field__hint">Можно оставить пустым: relay на этом же адресе подставится сам. Роли и закрытый чат остаются у хоста.</span>
                  <span class="field__error" data-relay-error></span>
                </label>
              </div>
              <div class="relay-field ${mode === "lan" ? "" : "hidden"}" data-lan-field>
                <div class="notice">
                  ${icon("info", { size: 16 })}
                  <span data-lan-status>Проверяем сервер на этом адресе…</span>
                </div>
                <p class="field__hint">
                  Запустите <span class="mono">npm start</span> на компьютере — ссылка-приглашение будет вести на его IP.
                  Для игроков из других городов включите проброс порта <span class="mono">8080</span> или Cloudflare Tunnel.
                </p>
                <span class="field__error" data-lan-error></span>
              </div>
            </div>
          </section>

          <section class="panel create-settings">
            <div class="panel__head">
              <span class="panel__title">${icon("settings", { size: 15 })} Настройки</span>
            </div>
            <div class="panel__body" data-room-form-slot></div>
          </section>

          <section class="panel create-options">
            <div class="panel__body">
              <label class="setting-row setting-row--switch" for="create-autofill">
                <span class="setting-row__text">
                  <span class="setting-row__title">Заполнить ботами до минимума</span>
                  <span class="setting-row__hint">Сразу можно будет начать, а живые игроки подключатся по ходу лобби.</span>
                </span>
                <span class="switch">
                  <input id="create-autofill" type="checkbox" data-create-autofill checked />
                  <span class="switch__track" aria-hidden="true"></span>
                </span>
              </label>
            </div>
          </section>

          <button class="btn btn--primary btn--lg btn--block" type="submit" data-create-submit>
            ${icon("door", { size: 18 })} Создать комнату
          </button>
        </form>

        <aside class="create-aside">
          <section class="panel panel--gold create-preview">
            <div class="panel__head"><span class="panel__title">${icon("mask", { size: 15 })} Будущий состав</span></div>
            <div class="panel__body">
              <div class="create-preview__line" data-create-summary>${summarySetup(config)}</div>
              <div class="create-preview__facts">
                <span>${icon("users", { size: 14 })} до <b data-fact-max>${config.maxPlayers}</b> игроков</span>
                <span>${icon("play", { size: 13 })} старт от <b data-fact-min>${config.minStart}</b></span>
                <span>${icon("clock", { size: 13 })} ночь <b>${config.timers.night} с</b></span>
              </div>
              <p class="field__hint">Итоговый баланс пересчитывается при старте по фактическому числу игроков.</p>
            </div>
          </section>

          <section class="panel create-help">
            <div class="panel__head"><span class="panel__title">${icon("info", { size: 15 })} Что дальше</span></div>
            <div class="panel__body">
              <ol class="step-list">
                <li><span>1</span><div><b>Лобби</b><p>Ссылка, код и свободные места. Боты заполнят остальное.</p></div></li>
                <li><span>2</span><div><b>Старт</b><p>Роли раздаются автоматически, лишние глаза роли не увидят.</p></div></li>
                <li><span>3</span><div><b>Ночь и день</b><p>Ночные действия, обсуждение, голосование и последнее слово.</p></div></li>
              </ol>
              <div class="row wrap">
                <button class="btn btn--quiet btn--sm" type="button" data-go-rules>${icon("scroll", { size: 14 })} Правила</button>
                <button class="btn btn--quiet btn--sm" type="button" data-go-settings>${icon("wifi", { size: 14 })} Сеть</button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </div>`;

  return {
    title: "Создать комнату",
    html: htmlScreen,
    mount(root) {
      const slot = qs("[data-room-form-slot]", root);
      form = new RoomForm(slot, {
        value: initial,
        onChange: (value) => {
          config = value;
          mount(qs("[data-create-summary]", root), html`${summarySetup(value)}`);
          qs("[data-fact-max]", root).textContent = String(value.maxPlayers);
          qs("[data-fact-min]", root).textContent = String(value.minStart);
        },
      });

      const relayField = qs("[data-relay-field]", root);
      const lanField = qs("[data-lan-field]", root);
      const relayInput = qs("[data-create-relay]", root);
      detectSameOrigin().then(() => lanStatus(root));
      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const modeButton = target.closest("[data-create-mode]");
        if (modeButton) {
          mode = modeButton.dataset.createMode;
          for (const button of root.querySelectorAll("[data-create-mode]")) {
            button.classList.toggle("is-active", button === modeButton);
            button.setAttribute("aria-checked", button === modeButton ? "true" : "false");
          }
          relayField.classList.toggle("hidden", mode !== "online");
          lanField.classList.toggle("hidden", mode !== "lan");
          if (mode === "online" && !relayInput.value) relayInput.value = settings.relayUrl || localRelayDefault();
          if (mode === "lan") {
            lanStatus(root);
            void detectSameOrigin().then(() => lanStatus(root));
          }
          return;
        }
        if (target.closest("[data-go-rules]")) app.navigate("/rules");
        else if (target.closest("[data-go-settings]")) app.navigate("/settings");
      });

      qs("[data-create-form]", root).addEventListener("submit", async (event) => {
        event.preventDefault();
        let relayUrl = "";
        if (mode === "online") {
          const rawRelay = relayInput.value.trim();
          relayUrl = normalizeRelayUrl(rawRelay);
          const error = qs("[data-relay-error]", root);
          if (rawRelay && !relayUrl) {
            error.textContent = "Укажите ws://, wss://, http:// или https:// адрес.";
            relayInput.setAttribute("aria-invalid", "true");
            relayInput.focus({ preventScroll: true });
            return;
          }
          if (!relayUrl) relayUrl = await resolveRelayForMode("online", "");
          if (!relayUrl) {
            error.textContent = "Relay не найден. Укажите адрес вручную.";
            relayInput.setAttribute("aria-invalid", "true");
            relayInput.focus({ preventScroll: true });
            app.playSfx("error");
            return;
          }
          qs("[data-relay-error]", root).textContent = "";
          relayInput.removeAttribute("aria-invalid");
          app.updateSettings({ relayUrl });
        }
        if (mode === "lan") {
          relayUrl = await detectSameOrigin();
          const error = qs("[data-lan-error]", root);
          if (!relayUrl) {
            error.textContent = "Сервер по IP не найден. Запустите npm start и откройте игру по адресу компьютера-хоста.";
            app.playSfx("error");
            return;
          }
          error.textContent = "";
        }
        const autoFill = qs("[data-create-autofill]", root).checked;
        config = form.getValue();
        void app.createRoom({ config, mode, relayUrl, autoFillBots: autoFill });
      });
    },
    destroy() {
      form?.destroy();
      form = null;
    },
  };
}
