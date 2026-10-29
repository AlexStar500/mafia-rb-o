import { html, mount, qs, qsa } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { emptyState } from "../ui/components.js";
import { roomHasSpace, roomStatusText, roomModeText, roomFilter, describeRoom } from "../net/rooms.js";
import { playersLabel, pluralRu } from "../core/format.js";
import { normalizeRoomCode } from "../core/security.js";

const PAGE_SIZE = 8;

function roomCard(room) {
  const joinable = room.status === "lobby" && roomHasSpace(room);
  const spectate = room.status === "playing";
  const disabled = room.status === "ended" || (room.status === "lobby" && !roomHasSpace(room));
  return html`<article class="room-card ${room.status === "playing" ? "room-card--live" : ""}">
    <div class="room-card__top">
      <span class="badge ${room.source === "online" ? "badge--town" : "badge--muted"}">
        ${icon(room.source === "online" ? (room.lan ? "monitor" : "wifi") : "monitor", { size: 11 })} ${roomModeText(room)}
      </span>
      <span class="badge ${room.status === "lobby" ? "badge--town badge--dot" : room.status === "playing" ? "badge--danger badge--dot" : "badge--muted"}">
        ${roomStatusText(room)}
      </span>
      ${room.quick ? html`<span class="badge">${icon("spark", { size: 10 })} быстрый</span>` : ""}
    </div>
    <div class="room-card__body">
      <h3 class="room-card__name">${room.name}</h3>
      <p class="room-card__host">
        ${icon("crown", { size: 13 })} ${room.hostName || "Хост"} · ${room.source === "online" ? (room.lan ? "по IP" : "по сети") : "этот браузер"}
      </p>
      <div class="room-card__meta">
        <span>${icon("users", { size: 14 })} <b>${room.players}</b>/${room.maxPlayers}</span>
        <span>${icon("play", { size: 13 })} от ${room.minStart}</span>
        ${room.bots ? html`<span>${icon("bot", { size: 13 })} ${room.bots}</span>` : ""}
      </div>
      <div class="room-card__fill"><span style="width:${Math.round((Number(room.players) / Math.max(1, Number(room.maxPlayers))) * 100)}%"></span></div>
    </div>
    <div class="room-card__foot">
      <span class="code-pill code-pill--sm">${room.code}</span>
      <button
        class="btn ${joinable ? "btn--primary" : "btn--ghost"} btn--sm"
        type="button"
        data-room-join="${room.code}"
        data-room-source="${room.source}"
        data-room-status="${room.status}"
        ${disabled ? "disabled" : ""}
      >
        ${icon(spectate ? "eye" : joinable ? "door" : "lock", { size: 15 })}
        ${spectate ? "Смотреть" : joinable ? "Войти" : "Заполнена"}
      </button>
    </div>
  </article>`;
}

export function createRoomsScreen(ctx) {
  const app = ctx.app;
  let mode = "all";
  let status = "all";
  let rooms = [];
  let loading = true;
  let error = null;
  let onlineError = null;
  let localCount = 0;
  let onlineCount = 0;
  let timer = null;
  let generation = 0;
  let rootRef = null;
  let lastRefresh = 0;
  let shown = PAGE_SIZE;

  const htmlScreen = html`<div class="screen">
    <div class="page rooms-page">
      <header class="page-head rooms-head">
        <div>
          <span class="eyebrow">${icon("users", { size: 13 })} Живые комнаты</span>
          <h1 class="page-title">Найдите свой город</h1>
          <p class="page-sub">
            «Это устройство» живут во вкладках этого браузера. «По IP» — хост запускает сервер, остальные заходят по его адресу, хоть из другой сети.
            «Онлайн» идёт через relay и работает с любого устройства.
          </p>
        </div>
        <button class="btn btn--primary" type="button" data-go-create>${icon("plus", { size: 17 })} Создать</button>
      </header>

      <section class="rooms-toolbar panel panel--flat">
        <form class="rooms-code" data-rooms-code-form autocomplete="off">
          <span class="field__label">Войти по коду</span>
          <div class="input-group">
            <input
              class="input code-input"
              data-rooms-code
              type="text"
              inputmode="text"
              maxlength="6"
              placeholder="ABC234"
              aria-label="Код комнаты"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="btn btn--primary" type="submit" data-rooms-code-submit>${icon("door", { size: 16 })} Войти</button>
          </div>
        </form>
        <div class="rooms-filters">
          <div class="filter-row">
            <span class="field__label">Источник</span>
            <div class="seg" role="group" aria-label="Источник комнат">
              <button class="seg__btn is-active" type="button" data-filter-mode="all">Все</button>
              <button class="seg__btn" type="button" data-filter-mode="local">Это устройство</button>
              <button class="seg__btn" type="button" data-filter-mode="online">Сеть</button>
            </div>
          </div>
          <div class="filter-row">
            <span class="field__label">Статус</span>
            <div class="seg" role="group" aria-label="Статус комнат">
              <button class="seg__btn is-active" type="button" data-filter-status="all">Все</button>
              <button class="seg__btn" type="button" data-filter-status="open">Открытые</button>
              <button class="seg__btn" type="button" data-filter-status="playing">Идут</button>
            </div>
          </div>
          <button class="btn btn--ghost btn--icon" type="button" data-rooms-refresh aria-label="Обновить комнаты" title="Обновить">
            ${icon("refresh", { size: 18 })}
          </button>
        </div>
      </section>

      <div class="rooms-status" data-rooms-status></div>
      <div class="room-grid" data-room-grid>
        ${Array.from({ length: 3 }, () => html`<div class="room-card room-card--skeleton"><div class="skeleton" style="height:100%"></div></div>`)}
      </div>
      <div class="rooms-more" data-rooms-more></div>

      <div class="rooms-foot">
        <p class="field__hint">
          ${icon("info", { size: 13 })}
          ${app.settings.relayUrl
            ? "Онлайн-комнаты видны всем, у кого есть адрес relay. Комнаты этого устройства видны только в этом браузере."
            : "Онлайн-режим выключен: без relay устройства не увидят друг друга. Укажите relay в настройках, чтобы играть по сети."}
        </p>
        <button class="btn btn--quiet btn--sm" type="button" data-go-settings>${icon("settings", { size: 15 })} Настройки сети</button>
      </div>
    </div>
  </div>`;

  const render = () => {
    if (!rootRef) return;
    const grid = qs("[data-room-grid]", rootRef);
    const statusNode = qs("[data-rooms-status]", rootRef);
    const moreNode = qs("[data-rooms-more]", rootRef);
    const filtered = rooms.filter((room) => roomFilter(room, { mode, status }));
    const visible = filtered.slice(0, shown);
    const relayNote = onlineError
      ? html`<span class="rooms-status__warn">${icon("alert", { size: 13 })} ${onlineError}</span>`
      : app.settings.relayUrl
        ? html`<span class="rooms-status__ok">${icon("wifi", { size: 13 })} relay доступен</span>`
        : html`<span>${icon("monitor", { size: 13 })} режим портов</span>`;
    mount(
      statusNode,
      html`<span>${loading ? "Ищем комнаты…" : `${filtered.length} ${pluralRu(filtered.length, ["комната", "комнаты", "комнат"])}`}</span>
        ${filtered.length > visible.length ? html`<span class="rooms-status__counts">показано ${visible.length}</span>` : ""}
        <span class="rooms-status__counts">Это устройство ${localCount} · Сеть ${onlineCount}</span>
        ${relayNote}`,
    );

    if (loading && !visible.length) {
      mount(
        grid,
        html`${Array.from({ length: 3 }, () => html`<div class="room-card room-card--skeleton"><div class="skeleton" style="height:100%"></div></div>`)}`,
      );
      mount(moreNode, "");
      return;
    }
    if (error) {
      mount(
        grid,
        emptyState({
          iconName: "alert",
          title: "Список недоступен",
          text: error,
          action: html`<button class="btn btn--ghost btn--sm" type="button" data-rooms-refresh>Попробовать снова</button>`,
        }),
      );
      mount(moreNode, "");
      return;
    }
    if (!visible.length) {
      mount(
        grid,
        emptyState({
          iconName: rooms.length ? "search" : "door",
          title: rooms.length ? "Под фильтр никто не подошёл" : "Пока никого",
          text: rooms.length
            ? "Смените фильтр или загляните в другой режим."
            : "Создайте комнату, позовите друзей или запустите город с ботами.",
          action: html`<div class="row wrap center">
            <button class="btn btn--primary btn--sm" type="button" data-go-create>Создать комнату</button>
            <button class="btn btn--ghost btn--sm" type="button" data-go-quick>Быстрый старт</button>
          </div>`,
        }),
      );
      mount(moreNode, "");
      return;
    }
    mount(grid, html`${visible.map(roomCard)}`);
    const left = filtered.length - visible.length;
    mount(
      moreNode,
      left > 0
        ? html`<button class="btn btn--ghost btn--sm" type="button" data-rooms-more-btn>
            ${icon("chevron", { size: 15 })} Показать ещё ${Math.min(PAGE_SIZE, left)}
          </button>
          <span class="rooms-more__hint">${visible.length} из ${filtered.length}</span>`
        : "",
    );
  };

  const load = async ({ reset = false } = {}) => {
    const seq = ++generation;
    if (reset) shown = PAGE_SIZE;
    loading = true;
    render();
    try {
      const result = await app.listRooms({
        onLocal: (partial) => {
          if (seq !== generation) return;
          rooms = Array.isArray(partial.rooms) ? partial.rooms : [];
          localCount = Number(partial.localCount) || 0;
          onlineCount = 0;
          onlineError = null;
          error = null;
          render();
        },
      });
      if (seq !== generation) return;
      rooms = Array.isArray(result.rooms) ? result.rooms : [];
      localCount = Number(result.localCount) || 0;
      onlineCount = Number(result.onlineCount) || 0;
      onlineError = result.onlineError ?? null;
      error = null;
      lastRefresh = Date.now();
    } catch (err) {
      if (seq !== generation) return;
      error = err?.message ?? "Не удалось получить список комнат.";
    } finally {
      if (seq === generation) {
        loading = false;
        render();
      }
    }
  };

  return {
    title: "Комнаты",
    html: htmlScreen,
    mount(root) {
      rootRef = root;
      const codeInput = qs("[data-rooms-code]", root);
      codeInput.addEventListener("input", () => {
        codeInput.value = normalizeRoomCode(codeInput.value);
      });
      qs("[data-rooms-code-form]", root).addEventListener("submit", (event) => {
        event.preventDefault();
        const code = normalizeRoomCode(codeInput.value);
        if (!code) {
          app.toast("Введите шестизначный код комнаты.", { tone: "warn" });
          codeInput.focus();
          return;
        }
        void app.joinRoomSmart(code, { mode });
      });

      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const modeButton = target.closest("[data-filter-mode]");
        if (modeButton) {
          mode = modeButton.dataset.filterMode;
          shown = PAGE_SIZE;
          for (const button of qsa("[data-filter-mode]", root)) button.classList.toggle("is-active", button === modeButton);
          render();
          return;
        }
        const statusButton = target.closest("[data-filter-status]");
        if (statusButton) {
          status = statusButton.dataset.filterStatus;
          shown = PAGE_SIZE;
          for (const button of qsa("[data-filter-status]", root)) button.classList.toggle("is-active", button === statusButton);
          render();
          return;
        }
        if (target.closest("[data-rooms-refresh]")) {
          void load({ reset: true });
          return;
        }
        if (target.closest("[data-rooms-more-btn]")) {
          shown += PAGE_SIZE;
          render();
          return;
        }
        const join = target.closest("[data-room-join]");
        if (join) {
          const room = rooms.find((entry) => entry.code === join.dataset.roomJoin && entry.source === join.dataset.roomSource);
          const spectate = join.dataset.roomStatus !== "lobby";
          void app.joinRoom({
            code: join.dataset.roomJoin,
            mode: room?.lan ? "lan" : join.dataset.roomSource === "online" ? "online" : "local",
            spectate,
            roomName: room?.name ?? "",
          });
          return;
        }
        if (target.closest("[data-go-create]")) app.navigate("/create");
        else if (target.closest("[data-go-quick]")) app.navigate("/quick");
        else if (target.closest("[data-go-settings]")) app.navigate("/settings");
      });
      void load({ reset: true });
      timer = setInterval(() => {
        if (document.hidden) return;
        if (Date.now() - lastRefresh < 6500) return;
        void load();
      }, 7000);
    },
    destroy() {
      clearInterval(timer);
      timer = null;
      generation += 1;
      rootRef = null;
    },
  };
}
