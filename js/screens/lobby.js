import { html, mount, qs } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { avatar, playerColor, roleChip, showPlayerModal, emptyState } from "../ui/components.js";
import { openModal, closeModal } from "../ui/modal.js";
import { RoomForm } from "../ui/roomForm.js";
import { createChat } from "../ui/chat.js";
import { computeRoleSetup, ROLES, TEAMS } from "../data/roles.js";
import { initials, playersLabel } from "../core/format.js";
import { asset } from "../core/assets.js";

function roleSummary(config) {
  const setup = computeRoleSetup(config.maxPlayers, config.roles);
  return Object.entries(setup.counts)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => {
      const role = ROLES[id];
      return html`<span class="role-mini" style="--role-color:${role.color}" title="${role.name} × ${count}">
        <img src="${asset(role.icon)}" alt="" width="22" height="22" />
        <span>${role.name}</span><b>${count}</b>
      </span>`;
    });
}

function seatCard(player, view, { isHost, selfId }) {
  if (!player) {
    return html`<div class="seat seat--empty">
      <span class="seat__number">·</span>
      <span class="seat__empty-icon">${icon("plus", { size: 17 })}</span>
      <span class="seat__empty-text">Свободно</span>
      ${isHost ? html`<button class="seat__add" type="button" data-lobby-add-bot aria-label="Добавить бота">${icon("bot", { size: 16 })}</button>` : ""}
    </div>`;
  }
  const isSelf = player.id === selfId;
  const ready = player.isBot || player.ready;
  // Mirror all visible seat text so voice control and screen readers agree.
  const visualLabel = [
    String(player.seat + 1),
    ...(player.isBot ? [] : [initials(player.name)]),
    player.name,
    ...(player.isBot ? ["AI"] : []),
    ...(isSelf ? ["вы"] : []),
    ...(player.isHost ? ["хост"] : []),
    ready ? "готов" : "ждём",
  ].join(" ");
  return html`<article
    class="seat ${!player.alive ? "seat--dead" : ""} ${isSelf ? "seat--self" : ""} ${player.isHost ? "seat--host" : ""}"
    data-lobby-player="${player.id}"
    tabindex="0"
    role="button"
    aria-label="${visualLabel} — подробнее"
    title="Подробнее об игроке"
    style="--seat-color:${playerColor(player)}"
  >
    <span class="seat__number">${player.seat + 1}</span>
    ${avatar(player, { size: "md", host: player.isHost, you: isSelf, duplicateBadges: false })}
    <div class="seat__info">
      <span class="seat__name truncate">${player.name}</span>
      <span class="seat__tags">
        ${player.isBot ? html`<span class="seat__tag">AI</span>` : ""}
        ${isSelf ? html`<span class="seat__tag">вы</span>` : ""}
        ${player.isHost ? html`<span class="seat__tag seat__tag--gold">хост</span>` : ""}
      </span>
    </div>
    <span class="seat__ready ${ready ? "is-ready" : ""}">${ready ? icon("check", { size: 13 }) : ""} ${ready ? "Готов" : "Ждём"}</span>
    ${isHost && !isSelf && !player.isBot
      ? html`<button class="seat__kick" type="button" data-lobby-kick="${player.id}" aria-label="Исключить ${player.name}">${icon("x", { size: 14 })}</button>`
      : ""}
  </article>`;
}

export function createLobbyScreen(ctx, initialView) {
  const app = ctx.app;
  let view = initialView;
  let chat = null;
  let rootRef = null;
  let lastConfigModal = null;

  const htmlScreen = html`<div class="screen lobby-screen">
    <div class="page lobby-page" data-lobby-page>
      <div data-lobby-head></div>
      <div class="lobby-layout">
        <div class="lobby-main">
          <section class="panel lobby-seats-panel">
            <div class="panel__head">
              <span class="panel__title">${icon("users", { size: 15 })} Город собирается</span>
              <span class="muted lobby-seats-count" data-lobby-count></span>
            </div>
            <div class="panel__body">
              <div class="seat-grid" data-lobby-seats></div>
            </div>
          </section>
          <div data-lobby-actions></div>
          <section class="panel lobby-config">
            <div class="panel__head">
              <span class="panel__title">${icon("settings", { size: 15 })} Правила комнаты</span>
              <span class="badge badge--muted" data-lobby-access></span>
            </div>
            <div class="panel__body" data-lobby-config></div>
          </section>
        </div>
        <aside class="lobby-side">
          <section class="panel lobby-chat-panel">
            <div class="panel__head">
              <span class="panel__title">${icon("chat", { size: 15 })} Лобби</span>
              <span class="muted">до старта</span>
            </div>
            <div class="lobby-chat-slot" data-lobby-chat></div>
          </section>
          <section class="panel lobby-tips">
            <div class="panel__body">
              <p class="field__hint">
                ${icon("shield", { size: 13 })}
                Роли раздаются только при старте. Наблюдатели и мёртвые не видят ваш закрытый чат.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </div>`;

  const openSettings = () => {
    if (!view?.isHost) return;
    const handle = openModal({
      title: "Настройки комнаты",
      subtitle: "Изменения применяются сразу и видны всем в лобби.",
      wide: true,
      body: html`<div data-lobby-settings-form></div>`,
      footer: html`<button class="btn btn--primary" type="button" data-modal-close>Готово</button>`,
    });
    if (!handle) return;
    const form = new RoomForm(qs("[data-lobby-settings-form]", handle.body), {
      value: view.config,
      onChange: (value) => {
        if (value.maxPlayers < view.players.length) {
          app.toast(`В комнате уже ${view.players.length} игроков.`, { tone: "warn" });
          form.setValue(view.config);
          return;
        }
        const result = app.updateRoomConfig(value);
        if (result?.ok === false) {
          app.toast(result.error ?? "Не удалось изменить настройки.", { tone: "warn" });
          form.setValue(view.config);
        }
      },
    });
    lastConfigModal = { handle, form };
    handle.root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-modal-close]")) lastConfigModal = null;
    });
    handle.close = ((close) => (reason) => {
      form.destroy();
      lastConfigModal = null;
      close(reason);
    })(handle.close);
  };

  const renderHead = () => {
    if (!rootRef || !view) return;
    const head = qs("[data-lobby-head]", rootRef);
    const session = view.session ?? {};
    const modes =
      session.mode === "online"
        ? html`<span class="badge badge--town">${icon("wifi", { size: 11 })} Онлайн</span>`
        : session.mode === "lan"
          ? html`<span class="badge badge--town">${icon("monitor", { size: 11 })} Локальная сеть</span>`
          : html`<span class="badge badge--muted">${icon("monitor", { size: 11 })} Порты</span>`;
    mount(
      head,
      html`<header class="lobby-head panel panel--gold">
        <div class="lobby-head__main">
          <div class="row wrap">
            ${modes}
            ${view.config.public ? html`<span class="badge">${icon("globe", { size: 11 })} публичная</span>` : html`<span class="badge badge--muted">${icon("lock", { size: 11 })} по коду</span>`}
            ${view.session?.spectators ? html`<span class="badge badge--muted">${icon("eye", { size: 11 })} наблюдателей: ${view.session.spectators}</span>` : ""}
          </div>
          <h1 class="lobby-head__title">${view.config.name}</h1>
          <p class="lobby-head__sub">
            ${icon("crown", { size: 13 })} Хост: ${view.players.find((player) => player.isHost)?.name ?? "—"}
            <span>·</span> ${playersLabel(view.players.length)} из ${view.config.maxPlayers}
          </p>
        </div>
        <div class="lobby-head__code">
          <span class="field__label">Код комнаты</span>
          <span class="code-pill">${view.roomCode}</span>
        </div>
        <div class="lobby-head__actions">
          <button class="btn btn--gold-ghost btn--sm" type="button" data-lobby-share>${icon("share", { size: 15 })} Позвать</button>
          <button class="btn btn--quiet btn--sm" type="button" data-lobby-copy-link>${icon("link", { size: 15 })} Ссылка</button>
          <button class="btn btn--quiet btn--sm" type="button" data-lobby-leave>${icon("logout", { size: 15 })} Выйти</button>
        </div>
      </header>
      ${session.mode === "local"
        ? html`<div class="notice lobby-local-note">${icon("info", { size: 16 })}<span>Порты живут в этом браузере. Откройте ссылку/код в другой вкладке — и город соберётся. Для других устройств нужен онлайн-relay.</span></div>`
        : session.mode === "lan"
          ? html`<div class="notice lobby-local-note">${icon("monitor", { size: 16 })}<span>Локальная сеть: друзья открывают ссылку на этом компьютере. Сервер уже раздаёт и игру, и relay — как LAN-игра в CS2.</span></div>`
          : html`<div class="notice lobby-local-note">${icon("wifi", { size: 16 })}<span>Онлайн-комната: отправьте ссылку друзьям. Relay передаёт только игровые сообщения, не роли.</span></div>`}`,
    );
  };

  const renderSeats = () => {
    if (!rootRef || !view) return;
    const seats = qs("[data-lobby-seats]", rootRef);
    const bySeat = new Map(view.players.map((player) => [player.seat, player]));
    const slots = Array.from({ length: view.config.maxPlayers }, (_, index) => bySeat.get(index) ?? null);
    mount(
      seats,
      html`${slots.map((player) => seatCard(player, view, { isHost: view.isHost, selfId: view.selfId }))}`,
    );
    const count = qs("[data-lobby-count]", rootRef);
    if (count) count.textContent = `${view.players.length} / ${view.config.maxPlayers}`;
  };

  const renderActions = () => {
    if (!rootRef || !view) return;
    const wrap = qs("[data-lobby-actions]", rootRef);
    const isHost = view.isHost;
    const isSelf = view.players.find((player) => player.id === view.selfId);
    const bots = view.lobby?.bots ?? 0;
    const canStart = view.lobby?.canStart ?? { ok: false, error: "" };
    const missing = Math.max(0, view.config.minStart - view.players.length);
    const startHint = canStart.ok ? "Город готов. Роли будут розданы сразу." : canStart.error || "Проверьте готовность игроков.";
    if (isHost) {
      mount(
        wrap,
        html`<section class="panel lobby-actions">
          <div class="panel__body lobby-actions__body">
            <div class="lobby-actions__primary">
              <button class="btn btn--primary btn--lg" type="button" data-lobby-start>
                ${icon("play", { size: 18 })} Начать игру
              </button>
              <div class="lobby-actions__hint ${canStart.ok ? "is-ok" : ""}">
                ${icon(canStart.ok ? "check" : "info", { size: 14 })} ${startHint}
              </div>
            </div>
            <div class="lobby-actions__tools">
              ${missing > 0
                ? html`<button class="btn btn--gold-ghost btn--sm" type="button" data-lobby-fill>${icon("bot", { size: 15 })} Заполнить до старта</button>`
                : html`<button class="btn btn--ghost btn--sm" type="button" data-lobby-add-bot>${icon("plus", { size: 15 })} Бот</button>`}
              ${bots ? html`<button class="btn btn--quiet btn--sm" type="button" data-lobby-remove-bots>${icon("trash", { size: 15 })} Убрать ботов (${bots})</button>` : ""}
              <button class="btn btn--ghost btn--sm" type="button" data-lobby-settings>${icon("settings", { size: 15 })} Настройки</button>
            </div>
          </div>
        </section>`,
      );
    } else {
      const ready = Boolean(view.self?.ready);
      mount(
        wrap,
        html`<section class="panel lobby-actions">
          <div class="panel__body lobby-actions__body">
            <div class="lobby-actions__primary">
              <button class="btn ${ready ? "btn--ghost" : "btn--primary"} btn--lg" type="button" data-lobby-ready>
                ${icon(ready ? "check" : "clock", { size: 18 })} ${ready ? "Вы готовы" : "Я готов"}
              </button>
              <div class="lobby-actions__hint ${ready ? "is-ok" : ""}">
                ${ready ? "Ждём хоста и остальных игроков." : "Отметьте готовность, чтобы хост мог начать."}
              </div>
            </div>
            <div class="lobby-actions__tools">
              <button class="btn btn--quiet btn--sm" type="button" data-lobby-copy-link>${icon("copy", { size: 15 })} Ссылка</button>
              ${isSelf?.muted ? html`<span class="badge badge--danger">заглушены</span>` : ""}
            </div>
          </div>
        </section>`,
      );
    }
  };

  const renderConfig = () => {
    if (!rootRef || !view) return;
    const config = view.config;
    mount(qs("[data-lobby-config]", rootRef), html`<div class="lobby-config__grid">
      <div class="lobby-config__block">
        <span class="field__label">Роли</span>
        <div class="role-mini-row">${roleSummary(config)}</div>
      </div>
      <div class="lobby-config__block">
        <span class="field__label">Таймеры</span>
        <div class="lobby-config__timers">
          <span>${icon("moon", { size: 13 })} ${config.timers.night} с</span>
          <span>${icon("chat", { size: 13 })} ${config.timers.discussion} с</span>
          <span>${icon("vote", { size: 13 })} ${config.timers.voting} с</span>
        </div>
      </div>
      <div class="lobby-config__block">
        <span class="field__label">Правила</span>
        <div class="row wrap">
          <span class="badge badge--muted">от ${config.minStart} игроков</span>
          <span class="badge badge--muted">${config.revealOnDeath ? "роль после смерти" : "роль скрыта"}</span>
          <span class="badge badge--muted">${config.allowSpectators ? "зрители" : "без зрителей"}</span>
          <span class="badge badge--muted">${config.botChat === "quiet" ? "тихие боты" : config.botChat === "loud" ? "болтливые боты" : "обычные боты"}</span>
        </div>
      </div>
    </div>`);
    const access = qs("[data-lobby-access]", rootRef);
    if (access) access.textContent = config.public ? "Видна в списке" : "Только по коду";
  };

  const update = (nextView) => {
    if (!nextView) return;
    view = nextView;
    if (!rootRef) return;
    renderHead();
    renderSeats();
    renderActions();
    renderConfig();
    chat?.update(view);
    if (lastConfigModal && view.isHost) {
      // The engine is authoritative; keep an open modal in sync when possible.
      lastConfigModal.form?.setValue(view.config);
    }
  };

  const screen = {
    title: "Лобби",
    html: htmlScreen,
    mount(root) {
      rootRef = root;
      chat = createChat({
        view,
        onSend: (payload) => app.sendChat(payload),
        getTargets: () => (view?.players ?? []).filter((player) => player.alive && player.id !== view?.selfId),
        emptyText: "Скажите привет. Город любит тех, кто говорит первым.",
      });
      chat.mountInto(qs("[data-lobby-chat]", root));
      update(view);

      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const kick = target.closest("[data-lobby-kick]");
        if (kick) {
          event.stopPropagation();
          void app.kickPlayer(kick.dataset.lobbyKick);
          return;
        }
        if (target.closest("[data-lobby-start]")) {
          app.startGame();
          return;
        }
        if (target.closest("[data-lobby-ready]")) {
          app.setReady(!view?.self?.ready);
          return;
        }
        if (target.closest("[data-lobby-settings]")) {
          openSettings();
          return;
        }
        if (target.closest("[data-lobby-fill]")) {
          app.fillToMin();
          return;
        }
        if (target.closest("[data-lobby-add-bot]")) {
          app.fillBots(1);
          return;
        }
        if (target.closest("[data-lobby-remove-bots]")) {
          app.removeBots();
          return;
        }
        if (target.closest("[data-lobby-share]")) {
          app.openShare();
          return;
        }
        if (target.closest("[data-lobby-copy-link]")) {
          app.copyText(app.getShareUrl(), "Ссылка скопирована.");
          return;
        }
        if (target.closest("[data-lobby-leave]")) {
          void app.leaveSession({ go: "/" });
          return;
        }
        const card = target.closest("[data-lobby-player]");
        if (card) {
          const player = view?.players.find((entry) => entry.id === card.dataset.lobbyPlayer);
          if (player) showPlayerModal(player, view);
        }
      });

      root.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const card = event.target instanceof Element ? event.target.closest("[data-lobby-player]") : null;
        if (!card) return;
        event.preventDefault();
        const player = view?.players.find((entry) => entry.id === card.dataset.lobbyPlayer);
        if (player) showPlayerModal(player, view);
      });
    },
    update,
    destroy() {
      if (lastConfigModal) {
        closeModal("route");
        lastConfigModal = null;
      }
      chat = null;
      rootRef = null;
    },
  };
  return screen;
}
