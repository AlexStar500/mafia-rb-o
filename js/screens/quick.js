import { html, qs, qsa } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { computeRoleSetup, BOT_CHAT_LEVELS, ROLES, ROLE_LIMITS } from "../data/roles.js";

function setupLine(count) {
  const setup = computeRoleSetup(count, { doctor: 1, assassin: 0, jester: 0 });
  return `Мафия ${setup.counts.mafia} · шериф 1 · доктор ${setup.counts.doctor} · мирные ${setup.counts.civilian}`;
}

export function createQuickScreen(ctx) {
  const app = ctx.app;
  const settings = app.settings;
  let players = Math.max(ROLE_LIMITS.minPlayers, Math.min(ROLE_LIMITS.maxPlayers, Number(settings.lastPlayerCount) || 8));
  let botChat = BOT_CHAT_LEVELS[settings.botChat] ? settings.botChat : "normal";

  const htmlScreen = html`<div class="screen">
    <div class="page page--narrow quick-page">
      <header class="page-head">
        <span class="eyebrow">${icon("spark", { size: 13 })} Быстрый старт</span>
        <h1 class="page-title">Один вечер. Один город.</h1>
        <p class="page-sub">Запустите тренировку с ИИ, посмотрите на город со стороны или найдите живую комнату.</p>
      </header>

      <div class="quick-grid">
        <section class="quick-card quick-card--primary panel panel--gold">
          <div class="quick-card__head">
            <span class="quick-card__icon">${icon("play", { size: 24 })}</span>
            <div>
              <span class="eyebrow">Тренировка</span>
              <h2>С ботами</h2>
            </div>
          </div>
          <p class="quick-card__text">Один живой игрок, остальные — ИИ-горожане. Хорошо для первой партии и для проверки ролей.</p>
          <div class="quick-stepper">
            <div class="quick-stepper__label">
              <span class="setting-row__title">Игроков в городе</span>
              <span class="setting-row__hint" data-setup-line>${setupLine(players)}</span>
            </div>
            <div class="stepper" role="group" aria-label="Количество игроков">
              <button type="button" data-quick-step="-1" aria-label="Меньше" ${players <= 4 ? html`disabled` : ""}>${icon("minus", { size: 15 })}</button>
              <output data-quick-count>${players}</output>
              <button type="button" data-quick-step="1" aria-label="Больше" ${players >= ROLE_LIMITS.maxPlayers ? html`disabled` : ""}>${icon("plus", { size: 15 })}</button>
            </div>
          </div>
          <div class="quick-chat-level">
            <span class="field__label">Болтливость ботов</span>
            <div class="seg" role="group" aria-label="Болтливость ботов">
              ${Object.values(BOT_CHAT_LEVELS).map(
                (level) => html`<button
                  class="seg__btn ${level.id === botChat ? "is-active" : ""}"
                  type="button"
                  data-quick-chat="${level.id}"
                >${level.name}</button>`,
              )}
            </div>
          </div>
          <button class="btn btn--primary btn--lg btn--block" type="button" data-quick-bots>
            ${icon("play", { size: 18 })} Начать с ботами
          </button>
        </section>

        <button class="quick-card panel" type="button" data-quick-spectate>
          <div class="quick-card__head">
            <span class="quick-card__icon quick-card__icon--night">${icon("eye", { size: 24 })}</span>
            <div>
              <span class="eyebrow">Наблюдение</span>
              <h2>Смотреть ИИ-город</h2>
            </div>
          </div>
          <p class="quick-card__text">
            Все роли открыты. Вы не участвуете, но можете ускорять время и ставить игру на паузу.
          </p>
          <span class="quick-card__link">${icon("fast", { size: 15 })} 1× · 2× · 4× и пауза</span>
        </button>

        <button class="quick-card panel" type="button" data-quick-match>
          <div class="quick-card__head">
            <span class="quick-card__icon quick-card__icon--town">${icon("users", { size: 24 })}</span>
            <div>
              <span class="eyebrow">Живые игроки</span>
              <h2>Быстрый матч</h2>
            </div>
          </div>
          <p class="quick-card__text">
            Найдём открытую комнату${settings.relayUrl ? " в сети или в этом браузере" : " в этом браузере"}. Если никого нет — запустим тренировку.
          </p>
          <span class="quick-card__link">${settings.relayUrl ? html`${icon("wifi", { size: 15 })} Relay настроен` : html`${icon("monitor", { size: 15 })} Режим портов`}</span>
        </button>
      </div>

      <div class="quick-foot">
        <span class="muted">Нужны свои правила, роли и таймеры?</span>
        <button class="btn btn--ghost btn--sm" type="button" data-go-create>${icon("plus", { size: 15 })} Создать комнату</button>
        <button class="btn btn--quiet btn--sm" type="button" data-go-join>${icon("key", { size: 15 })} Войти по коду</button>
      </div>
    </div>
  </div>`;

  return {
    title: "Быстрый старт",
    html: htmlScreen,
    mount(root) {
      const countOut = qs("[data-quick-count]", root);
      const setupOut = qs("[data-setup-line]", root);
      const sync = () => {
        countOut.textContent = String(players);
        setupOut.textContent = setupLine(players);
        const buttons = qsa("[data-quick-step]", root);
        for (const button of buttons) {
          const next = players + Number(button.dataset.quickStep);
          button.disabled = next < ROLE_LIMITS.minPlayers || next > ROLE_LIMITS.maxPlayers;
        }
      };
      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const step = target.closest("[data-quick-step]");
        if (step) {
          players = Math.max(ROLE_LIMITS.minPlayers, Math.min(ROLE_LIMITS.maxPlayers, players + Number(step.dataset.quickStep)));
          sync();
          return;
        }
        const chat = target.closest("[data-quick-chat]");
        if (chat) {
          botChat = chat.dataset.quickChat;
          for (const button of qsa("[data-quick-chat]", root)) {
            button.classList.toggle("is-active", button === chat);
          }
          return;
        }
        if (target.closest("[data-quick-bots]")) {
          void app.startBotGame({ players, botChat });
          return;
        }
        if (target.closest("[data-quick-spectate]")) {
          void app.startSpectator({ players: Math.max(8, players) });
          return;
        }
        if (target.closest("[data-quick-match]")) {
          void app.quickMatch();
          return;
        }
        if (target.closest("[data-go-create]")) {
          app.navigate("/create");
          return;
        }
        if (target.closest("[data-go-join]")) {
          app.navigate("/join");
        }
      });
      sync();
    },
    destroy() {},
  };
}

export function quickRoleSummary(players, roles) {
  const setup = computeRoleSetup(players, roles);
  return Object.entries(setup.counts)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => `${ROLES[id]?.name ?? id} ×${count}`)
    .join(" · ");
}
