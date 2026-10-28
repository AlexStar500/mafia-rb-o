import { html, mount, qs, qsa } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { avatar, roleArt } from "../ui/components.js";
import { openModal } from "../ui/modal.js";
import { AVATAR_COLORS } from "../core/storage.js";
import { nickError, sanitizeNick } from "../core/security.js";
import { asset } from "../core/assets.js";
import { BOT_ROSTER } from "../data/bots.js";
import { allRoles } from "../data/roles.js";
import { QUICK_MESSAGES } from "../data/quickChat.js";

function botModal(bot) {
  const traits = [
    ["Логика", bot.traits.logic],
    ["Агрессия", bot.traits.aggression],
    ["Разговорчивость", bot.traits.chattiness],
    ["Хитрость", bot.traits.deception],
  ];
  return openModal({
    title: bot.name,
    subtitle: "Житель Ночного города",
    role: true,
    body: html`<div class="bot-detail">
      <div class="bot-detail__head">
        <span class="role-art role-art--lg"><img src="${asset(bot.avatar)}" alt="" width="192" height="192" /></span>
        <div>
          <p class="bot-detail__tagline">${bot.tagline}</p>
          <span class="badge badge--muted">${bot.style}</span>
        </div>
      </div>
      <div class="trait-list">
        ${traits.map(
          (entry) => html`<div class="trait">
            <span>${entry[0]}</span>
            <span class="trait__bar"><span style="width:${Math.round(entry[1] * 100)}%"></span></span>
            <b>${Math.round(entry[1] * 100)}</b>
          </div>`,
        )}
      </div>
      <p class="muted">ИИ-горожанин играет по своим наблюдениям: он не видит чужие роли и не читает закрытый чат, если не мафия.</p>
    </div>`,
    footer: html`<button class="btn btn--primary" type="button" data-modal-close>Закрыть</button>`,
  });
}

export function createMenuScreen(ctx) {
  const app = ctx.app;
  const settings = app.settings;
  let color = settings.color;
  let name = settings.nick || "";
  const botLine = BOT_ROSTER.slice(0, 12);

  const rootHtml = html`<div class="screen menu-screen">
    <div class="menu">
      <header class="menu__intro">
        <span class="eyebrow">${icon("moon", { size: 13 })} Браузерная мафия · 4–20 игроков</span>
        <h1 class="menu__logo"><span>МАФИЯ</span><small>Ночной город</small></h1>
        <p class="menu__tagline">
          ${allRoles} ролей, живые комнаты и город, который врёт красиво.
          <span>Играйте с друзьями, добирайте состав ботами или просто смотрите, как ИИ делит власть.</span>
        </p>
        <div class="menu__stats">
          <div class="menu__stat"><b>${allRoles}</b><span>ролей</span></div>
          <div class="menu__stat"><b>20</b><span>игроков</span></div>
          <div class="menu__stat"><b>${QUICK_MESSAGES.length}</b><span>фраз</span></div>
        </div>
      </header>

      <aside class="menu__poster" aria-hidden="true">
        <div class="poster__frame">
          <div class="poster__noise"></div>
          <img class="poster__mafia" src="${asset("assets/img/roles/mafia.png")}" alt="" width="192" height="192" />
          <div class="poster__line">ОНИ УЖЕ В ГОРОДЕ</div>
          <img class="poster__sheriff" src="${asset("assets/img/roles/sheriff.png")}" alt="" width="192" height="192" />
          <div class="poster__stamp">NOIR<br />CITY</div>
        </div>
        <span class="poster__caption">«Не все, кто молчит, спят.»</span>
      </aside>

      <section class="menu__play panel panel--gold">
        <div class="identity">
          <div class="identity__preview" data-profile-preview>${avatar({ name: name || "Игрок", color }, { size: "lg" })}</div>
          <div class="identity__fields">
            <label class="field" for="menu-nick">
              <span class="field__label">Ваше имя в городе</span>
              <input
                class="input input--nick"
                id="menu-nick"
                data-menu-nick
                type="text"
                maxlength="16"
                value="${name}"
                placeholder="Например, Полночь"
                autocomplete="nickname"
                spellcheck="false"
              />
              <span class="field__error" data-menu-error></span>
            </label>
            <div class="identity__colors" data-menu-colors role="radiogroup" aria-label="Цвет метки">
              ${AVATAR_COLORS.map(
                (swatch) => html`<button
                  class="swatch ${swatch === color ? "is-active" : ""}"
                  type="button"
                  data-color="${swatch}"
                  style="--swatch:${swatch}"
                  role="radio"
                  aria-checked="${swatch === color ? "true" : "false"}"
                  aria-label="Цвет ${swatch}"
                ></button>`,
              )}
            </div>
          </div>
          <button class="btn btn--primary btn--lg menu__play-btn" type="button" data-menu-play>
            ${icon("play", { size: 18 })} <span>Играть</span>
          </button>
        </div>
        <div class="menu__secondary">
          <button class="btn btn--ghost btn--sm" type="button" data-go="quick">${icon("spark", { size: 15 })} Быстрый старт</button>
          <button class="btn btn--quiet btn--sm" type="button" data-spectate>${icon("eye", { size: 15 })} Смотреть ИИ-город</button>
          <button class="btn btn--quiet btn--sm" type="button" data-go="rules">${icon("scroll", { size: 15 })} Как играть</button>
          <button class="btn btn--quiet btn--sm" type="button" data-go="server">${icon("globe", { size: 15 })} Сеть и серверы</button>
        </div>
      </section>

      <section class="menu__cards">
        <button class="menu-card menu-card--rooms" type="button" data-go="rooms">
          <span class="menu-card__icon">${icon("users", { size: 22 })}</span>
          <span class="menu-card__body">
            <b>Комнаты</b>
            <span>Найдите живую игру или подключитесь по коду.</span>
          </span>
          ${icon("forward", { size: 18 })}
        </button>
        <button class="menu-card menu-card--create" type="button" data-go="create">
          <span class="menu-card__icon">${icon("plus", { size: 22 })}</span>
          <span class="menu-card__body">
            <b>Создать комнату</b>
            <span>Свои правила, таймеры, роли и боты.</span>
          </span>
          ${icon("forward", { size: 18 })}
        </button>
        <button class="menu-card menu-card--roles" type="button" data-go="roles">
          <span class="menu-card__icon">${icon("mask", { size: 22 })}</span>
          <span class="menu-card__body">
            <b>Роли и баланс</b>
            <span>Кто убивает, кто лечит и кто просто хочет петлю.</span>
          </span>
          ${icon("forward", { size: 18 })}
        </button>
      </section>

      <section class="menu__bots">
        <div class="menu__bots-head">
          <span class="eyebrow">${icon("bot", { size: 13 })} ИИ-горожане</span>
          <span class="muted">20 характеров · своя память · свои обиды</span>
        </div>
        <div class="bot-strip">
          ${botLine.map(
            (bot) => html`<button class="bot-card" type="button" data-bot="${bot.id}" title="${bot.name}">
              <span class="role-art role-art--xs"><img src="${asset(bot.avatar)}" alt="" width="96" height="96" /></span>
              <span>${bot.name}</span>
            </button>`,
          )}
          <button class="bot-card bot-card--more" type="button" data-go="roles">
            <span class="role-art role-art--xs role-art--unknown">${icon("dots", { size: 22 })}</span>
            <span>и другие</span>
          </button>
        </div>
      </section>
    </div>
  </div>`;

  const screen = {
    title: "МАФИЯ · Ночной город",
    html: rootHtml,
    mount(root) {
      const nickname = qs("[data-menu-nick]", root);
      const error = qs("[data-menu-error]", root);
      const preview = qs("[data-profile-preview]", root);

      const updatePreview = () => {
        mount(preview, avatar({ name: name || "Игрок", color }, { size: "lg" }));
      };

      const persist = () => {
        const clean = sanitizeNick(name);
        if (!clean) return false;
        app.updateProfile({ nick: clean, color });
        return true;
      };

      const play = () => {
        const message = nickError(name);
        if (message) {
          error.textContent = message;
          nickname.setAttribute("aria-invalid", "true");
          nickname.classList.add("shake");
          setTimeout(() => nickname.classList.remove("shake"), 450);
          nickname.focus({ preventScroll: true });
          app.playSfx("error");
          return;
        }
        error.textContent = "";
        nickname.removeAttribute("aria-invalid");
        name = sanitizeNick(name);
        persist();
        app.navigate("/quick");
      };

      nickname.addEventListener("input", () => {
        name = nickname.value;
        if (error.textContent) {
          error.textContent = "";
          nickname.removeAttribute("aria-invalid");
        }
        updatePreview();
      });
      nickname.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          play();
        }
      });

      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const swatch = target.closest("[data-color]");
        if (swatch) {
          color = swatch.dataset.color;
          for (const button of qsa("[data-color]", root)) {
            button.classList.toggle("is-active", button.dataset.color === color);
            button.setAttribute("aria-checked", button.dataset.color === color ? "true" : "false");
          }
          updatePreview();
          return;
        }
        const bot = target.closest("[data-bot]");
        if (bot) {
          const persona = BOT_ROSTER.find((entry) => entry.id === bot.dataset.bot);
          if (persona) botModal(persona);
        }
      });

      qs("[data-menu-play]", root)?.addEventListener("click", play);
      qs("[data-spectate]", root)?.addEventListener("click", () => {
        if (!persist()) {
          toastNick(app, nickname);
          return;
        }
        void app.startSpectator({ players: Math.max(8, settings.lastPlayerCount || 8) });
      });
      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("[data-go]") : null;
        if (!target) return;
        // Help pages don't need a nickname to be reachable.
        if (!["rules", "roles", "server"].includes(target.dataset.go) && !persist()) {
          toastNick(app, nickname);
          return;
        }
        app.navigate(`/${target.dataset.go}`);
      });
    },
    destroy() {},
  };
  return screen;
}

function toastNick(app, input) {
  app.toast(nickError(input.value) || "Проверьте имя.", { tone: "warn" });
  input.focus({ preventScroll: true });
}

export { roleArt };
