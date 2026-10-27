import { AudioManager } from "./audio/manager.js";
import { friendlyError } from "./core/format.js";
import { copyText as copyToClipboard } from "./core/format.js";
import {
  clearSettings,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "./core/storage.js";
import {
  clampInt,
  createId,
  isValidRoomCode,
  nickError,
  normalizeHexColor,
  normalizeRoomCode,
  sanitizeNick,
} from "./core/security.js";
import { normalizeRelayEndpoint } from "./net/protocol.js";
import { probeSameOriginRelay, resolveRelayForMode } from "./net/auto.js";
import { applyEffects, autoTuneEffects } from "./core/effects.js";
import { initials } from "./core/format.js";
import { normalizeRoomConfig } from "./data/roles.js";
import { checkRelay } from "./net/online.js";
import { listAllRooms, quickMatchRoom } from "./net/rooms.js";
import {
  createSoloSession,
  createSpectatorSession,
  joinRoom as joinNetworkRoom,
  openRoom,
} from "./net/session.js";
import { html, mount } from "./ui/dom.js";
import { icon } from "./ui/icons.js";
import { confirmModal, openModal } from "./ui/modal.js";
import { Router, bootRedirect, sessionPath } from "./ui/router.js";
import { toast as showToast } from "./ui/toast.js";
import { createMenuScreen } from "./screens/menu.js";
import { createQuickScreen } from "./screens/quick.js";
import { createRoomsScreen } from "./screens/rooms.js";
import { createCreateScreen } from "./screens/create.js";
import { createJoinScreen } from "./screens/join.js";
import { createLobbyScreen } from "./screens/lobby.js";
import { createGameScreen } from "./screens/game.js";
import { createRolesScreen } from "./screens/roles.js";
import { createRulesScreen } from "./screens/rules.js";
import { createSettingsScreen } from "./screens/settings.js";

const DEFAULT_TITLE = "МАФИЯ · Ночной город";
const ROUTE_TITLES = Object.freeze({
  menu: "",
  quick: "Быстрый старт",
  rooms: "Комнаты",
  create: "Создать комнату",
  join: "Вход по коду",
  roles: "Роли и баланс",
  rules: "Как играть",
  settings: "Настройки",
  session: "Игра",
  notFound: "Страница не найдена",
});
const INFORMATION_ROUTES = new Set(["roles", "rules", "settings", "notFound"]);
const DOCK_ROUTE = Object.freeze({
  menu: "menu",
  quick: "menu",
  rooms: "rooms",
  create: "rooms",
  join: "rooms",
  roles: "roles",
  rules: "roles",
  settings: "settings",
});

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export class App {
  constructor({ settings = loadSettings(), base = null } = {}) {
    this.version = "2.0.18";
    this.settings = normalizeSettings(settings);
    this.playerId = createId("p");
    this.session = null;
    this.view = null;
    this.route = null;
    this.screen = null;
    this.screenKind = "";
    this.screenSession = null;
    this.relayUrl = this.settings.relayUrl;
    this._autoRelay = "";
    this._autoRelayAt = 0;
    this._sessionUnsubs = [];
    this._busyNode = null;
    this._installEvent = null;
    this._swRegistration = null;
    this._closedByApp = false;

    this.audio = new AudioManager(this.settings);
    this.router = new Router({
      base,
      onRoute: (route, info) => {
        void this._handleRoute(route, info);
      },
      guard: (to, meta) => this._guard(to, meta),
    });

    this._bindShell();
    this._applySettings();
    this._renderProfile();
    this._bindBeforeUnload();
    this._bindInstall();
    autoTuneEffects(this.settings, {
      onLite: () => {
        this._effectsLite = true;
      },
    });
  }

  // -----------------------------------------------------------------------
  // Boot & shell
  // -----------------------------------------------------------------------

  start() {
    const redirect = this._bootRedirect();
    if (redirect) {
      try {
        history.replaceState(history.state ?? {}, "", this.router.browserPath(redirect));
      } catch {
        // A blocked history rewrite still leaves a usable join screen link.
      }
    }
    this.router.start();
  }

  _bootRedirect() {
    try {
      return bootRedirect(location.pathname, location.search);
    } catch {
      return "";
    }
  }

  _bindShell() {
    document.querySelector(".brand")?.addEventListener("click", () => {
      void this.navigate("/");
    });
    document.querySelector("#settings-btn")?.addEventListener("click", () => {
      void this.navigate("/settings");
    });
    document.querySelector("#profile-btn")?.addEventListener("click", () => {
      void this.navigate("/settings");
    });
    document.querySelector("#return-game")?.addEventListener("click", () => {
      if (!this.session) return;
      void this.router.navigate(sessionPath(this.session.roomCode));
    });
    document.querySelector("#music-toggle")?.addEventListener("click", () => {
      void this.audio.unlock();
      const muted = !this.settings.muted;
      this.updateSettings({ muted });
      this.playSfx("click");
    });
    document.querySelector("#dock")?.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-route]") : null;
      if (!target) return;
      const route = target.dataset.route;
      if (route) void this.navigate(route === "menu" ? "/" : `/${route}`);
    });

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-copy]") : null;
      if (!target) return;
      event.preventDefault();
      const text = target.dataset.copy ?? "";
      if (text) void this.copyText(text, "Скопировано.");
    });
    this._updateMusicButton();
  }

  _bindBeforeUnload() {
    window.addEventListener("beforeunload", (event) => {
      if (!this.session || this.session.closed) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  _bindInstall() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this._installEvent = event;
      this._refreshInstallUI();
    });
    window.addEventListener("appinstalled", () => {
      this._installEvent = null;
      this._refreshInstallUI();
      this.toast("Приложение установлено.", { tone: "town" });
    });
  }

  setServiceWorkerRegistration(registration) {
    this._swRegistration = registration ?? null;
    this._refreshInstallUI();
  }

  getInstallState() {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
      window.navigator.standalone === true;
    return {
      canInstall: Boolean(this._installEvent),
      installed: standalone,
    };
  }

  getServiceWorkerState() {
    return {
      supported: "serviceWorker" in navigator,
      registered: Boolean(this._swRegistration),
      active: Boolean(this._swRegistration?.active),
      controlled: Boolean(navigator.serviceWorker?.controller),
    };
  }

  async promptInstall() {
    if (!this._installEvent) {
      this.toast("Установка через меню браузера: «Добавить на главный экран».", { tone: "info" });
      return false;
    }
    const prompt = this._installEvent;
    this._installEvent = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      const accepted = choice?.outcome === "accepted";
      if (accepted) this.toast("Устанавливаем приложение…", { tone: "town" });
      return accepted;
    } catch {
      return false;
    } finally {
      this._refreshInstallUI();
    }
  }

  _refreshInstallUI() {
    const state = this.getInstallState();
    const button = document.querySelector("[data-settings-install]");
    if (button) button.classList.toggle("hidden", state.installed || !state.canInstall);
    const text = document.querySelector("[data-install-text]");
    if (text) {
      text.textContent = state.installed
        ? "Приложение установлено"
        : state.canInstall
          ? "Доступна установка"
          : "Через меню браузера";
    }
  }

  _applySettings() {
    document.body.classList.toggle("reduced-motion", this.settings.reducedMotion);
    document.body.classList.toggle("hide-hints", !this.settings.showHints);
    document.body.dataset.botChat = this.settings.botChat;
    applyEffects(this.settings, { lite: this._effectsLite === true });
    this.audio.setSettings(this.settings);
    this._updateMusicButton();
  }

  _updateMusicButton() {
    const button = document.querySelector("#music-toggle");
    if (!button) return;
    button.classList.toggle("is-active", !this.settings.muted);
    button.setAttribute("aria-label", this.settings.muted ? "Включить музыку" : "Выключить музыку");
    button.setAttribute("title", this.settings.muted ? "Включить музыку" : "Выключить музыку");
  }

  _renderProfile() {
    const name = this.settings.nick || "Игрок";
    const avatar = document.querySelector("#profile-avatar");
    if (avatar) {
      avatar.textContent = initials(name);
      avatar.style.setProperty("--profile-color", this.settings.color);
    }
    const label = document.querySelector("#profile-name");
    if (label) label.textContent = name;
    const button = document.querySelector("#profile-btn");
    if (button) button.setAttribute("aria-label", `${initials(name)} ${name} — профиль игрока`);
  }

  get profile() {
    return {
      id: this.playerId,
      name: this.settings.nick,
      avatar: null,
      color: this.settings.color,
    };
  }

  get isSessionActive() {
    return Boolean(this.session && !this.session.closed);
  }

  // -----------------------------------------------------------------------
  // Settings & profile
  // -----------------------------------------------------------------------

  updateSettings(patch = {}) {
    this.settings = normalizeSettings({ ...this.settings, ...(patch ?? {}) });
    const saved = saveSettings(this.settings);
    this.settings = saved.settings;
    this._applySettings();
    this._renderProfile();
    return this.settings;
  }

  updateProfile(patch = {}) {
    const next = { ...this.settings, ...(patch ?? {}) };
    if (Object.prototype.hasOwnProperty.call(patch, "nick")) {
      const error = nickError(patch.nick);
      if (error) return { ok: false, error };
      next.nick = sanitizeNick(patch.nick);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "color")) {
      next.color = normalizeHexColor(patch.color, this.settings.color);
    }
    this.settings = saveSettings(next).settings;
    this._renderProfile();
    return { ok: true };
  }

  clearLocalData() {
    clearSettings();
    this.settings = loadSettings();
    this._applySettings();
    this._renderProfile();
    return { ok: true, settings: this.settings };
  }

  async testRelay(url) {
    const endpoint = normalizeRelayEndpoint(url);
    if (!endpoint) return { ok: false, error: "Некорректный адрес relay." };
    return checkRelay(endpoint);
  }

  playSfx(name) {
    try {
      this.audio.play(name);
    } catch {
      // Audio is enhancement only.
    }
  }

  setAudioScene(scene) {
    const name = scene === "lastWords" ? "lastWords" : scene;
    try {
      this.audio.setScene(name);
    } catch {
      // Ignore audio failures.
    }
    const atmosphere = document.querySelector("#atmosphere");
    const dayScenes = new Set(["dawn", "discussion", "voting", "verdict", "lastWords"]);
    atmosphere?.classList.toggle("atmosphere--day", dayScenes.has(scene));
    atmosphere?.classList.toggle("atmosphere--verdict", scene === "verdict" || scene === "ended");
    document.body.dataset.phase = String(scene || "menu");
  }

  toast(text, options) {
    return showToast(text, options);
  }

  async copyText(text, message = "Скопировано.") {
    const ok = await copyToClipboard(text);
    this.toast(ok ? message : "Не удалось скопировать. Выделите текст вручную.", {
      tone: ok ? "town" : "warn",
    });
    return ok;
  }

  // -----------------------------------------------------------------------
  // Routing
  // -----------------------------------------------------------------------

  navigate(path, options = {}) {
    return this.router.navigate(path, options);
  }

  async _handleRoute(route, info = {}) {
    this.route = route;
    if (route.name === "session") {
      const ready = await this._prepareSessionRoute(route);
      if (!ready || this.route !== route) return;
      this._mountSession(route);
      return;
    }
    this._renderChrome(route);
    this.setAudioScene("menu");
    this._mountRouteScreen(route, info);
  }

  _mountRouteScreen(route) {
    let screen;
    try {
      switch (route.name) {
        case "menu":
          screen = createMenuScreen({ app: this, route });
          break;
        case "quick":
          screen = createQuickScreen({ app: this, route });
          break;
        case "rooms":
          screen = createRoomsScreen({ app: this, route });
          break;
        case "create":
          screen = createCreateScreen({ app: this, route });
          break;
        case "join":
          screen = createJoinScreen({ app: this, route });
          break;
        case "roles":
          screen = createRolesScreen({ app: this, route });
          break;
        case "rules":
          screen = createRulesScreen({ app: this, route });
          break;
        case "settings":
          screen = createSettingsScreen({ app: this, route });
          break;
        default:
          screen = this._notFoundScreen(route);
      }
    } catch (error) {
      console.error("[app] screen", error);
      screen = this._errorScreen(error);
    }
    this._setScreen(screen, screen.kind ?? route.name);
  }

  _notFoundScreen(route) {
    return {
      kind: "notFound",
      title: "Страница не найдена",
      html: html`<div class="screen">
        <div class="page page--narrow">
          <div class="panel lost-panel">
            <div class="panel__body">
              <span class="eyebrow">${icon("question", { size: 13 })} 404</span>
              <h1 class="page-title">Эта улица никуда не ведёт</h1>
              <p class="page-sub">Маршрут <span class="mono">${route.params?.path ?? route.path ?? ""}</span> не найден. Город иногда меняет карты.</p>
              <div class="row wrap">
                <button class="btn btn--primary" type="button" data-go-home>На главную</button>
                <button class="btn btn--ghost" type="button" data-go-quick>Быстрый старт</button>
              </div>
            </div>
          </div>
        </div>
      </div>`,
      mount(root) {
        root.addEventListener("click", (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("[data-go-home]")) void appNavigate("/");
          else if (target?.closest("[data-go-quick]")) void appNavigate("/quick");
        });
      },
    };
  }

  _errorScreen(error) {
    const text = friendlyError(error);
    return {
      kind: "error",
      title: "Ошибка",
      html: html`<div class="screen">
        <div class="page page--narrow">
          <div class="panel lost-panel panel--danger">
            <div class="panel__body">
              <span class="eyebrow">${icon("alert", { size: 13 })} Сбой</span>
              <h1 class="page-title">Город не смог открыть эту сцену</h1>
              <p class="page-sub">${text}</p>
              <button class="btn btn--primary" type="button" data-go-home>Вернуться на главную</button>
            </div>
          </div>
        </div>
      </div>`,
      mount(root) {
        root.addEventListener("click", (event) => {
          if (event.target instanceof Element && event.target.closest("[data-go-home]")) {
            void appNavigate("/");
          }
        });
      },
    };
  }

  _setScreen(screen, kind) {
    if (!screen) return;
    if (this.screen?.destroy) {
      try {
        this.screen.destroy();
      } catch (error) {
        console.error("[app] screen destroy", error);
      }
    }
    this.screen = screen;
    this.screenKind = kind ?? "";
    const root = document.querySelector("#screen");
    if (!root) return;
    mount(root, screen.html);
    try {
      screen.mount?.(root);
    } catch (error) {
      console.error("[app] screen mount", error);
      this.toast("Сцена открылась с ошибкой. Попробуйте вернуться на главную.", { tone: "danger" });
    }
    document.title = !screen.title || screen.title === DEFAULT_TITLE ? DEFAULT_TITLE : `${screen.title} · МАФИЯ`;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    root.focus?.({ preventScroll: true });
  }

  _renderChrome(route) {
    const active = this.isSessionActive;
    const dock = document.querySelector("#dock");
    if (dock) dock.classList.toggle("hidden", active || route.name === "session");
    const returnButton = document.querySelector("#return-game");
    if (returnButton) {
      const show = active && route.name !== "session" && INFORMATION_ROUTES.has(route.name);
      returnButton.classList.toggle("hidden", !show);
    }
    const topTitle = document.querySelector("#topbar-title");
    if (topTitle) topTitle.textContent = ROUTE_TITLES[route.name] ?? "";
    const dockRoute = DOCK_ROUTE[route.name] ?? "";
    for (const button of document.querySelectorAll("#dock [data-route]")) {
      button.classList.toggle("is-active", button.dataset.route === dockRoute);
    }
    document.body.dataset.route = route.name;
  }

  async _prepareSessionRoute(route) {
    const code = String(route.params?.code ?? "").toUpperCase();
    if (!isValidRoomCode(code)) {
      await this.router.replace(`/join${queryString({ code: route.params?.code ?? "" })}`);
      return false;
    }
    if (this.isSessionActive && this.session.roomCode === code) return true;
    if (route.query?.mode === "solo" || route.query?.mode === "spectate") {
      this.toast("Партия живёт в памяти вкладки и не восстанавливается после перезагрузки.", {
        tone: "warn",
        duration: 5200,
      });
      await this.router.replace("/");
      return false;
    }
    this.toast("Комната не открыта в этой вкладке. Войдите по коду заново.", { tone: "warn" });
    await this.router.replace(`/join${queryString({ code, relay: normalizeRelayEndpoint(route.query?.relay ?? "") })}`);
    return false;
  }

  _mountSession(route) {
    if (!this.isSessionActive) return;
    const view = this.session.view;
    this.view = view;
    this._renderChrome(route);
    if (!view) return;

    if (view.phase === "lobby") {
      if (this.screenKind !== "lobby" || this.screenSession !== this.session) {
        const screen = createLobbyScreen({ app: this, route }, view);
        screen.kind = "lobby";
        this.screenSession = this.session;
        this._setScreen(screen, "lobby");
      } else {
        this.screen.update?.(view);
      }
      this.setAudioScene("lobby");
      this._syncSessionChrome(view);
      return;
    }

    if (this.screenKind !== "game" || this.screenSession !== this.session) {
      const screen = createGameScreen({ app: this, route }, view);
      screen.kind = "game";
      this.screenSession = this.session;
      this._setScreen(screen, "game");
    } else {
      this.screen.update?.(view);
    }
    this._syncSessionChrome(view);
  }

  _syncSessionChrome(view) {
    const topTitle = document.querySelector("#topbar-title");
    if (topTitle) {
      const phase =
        view.phase === "lobby"
          ? "Лобби"
          : view.phase === "night"
            ? `Ночь ${view.day || 1}`
            : view.phase === "ended"
              ? "Финал"
              : `День ${view.day || 1}`;
      topTitle.textContent = `${phase} · ${view.roomCode}`;
    }
    const returnButton = document.querySelector("#return-game");
    if (returnButton) returnButton.classList.add("hidden");
    document.querySelector("#dock")?.classList.add("hidden");
    document.title = `${view.phase === "lobby" ? "Лобби" : `Партия · ${view.roomCode}`} · МАФИЯ`;
  }

  async _guard(to, meta = {}) {
    if (!this.isSessionActive) return true;
    if (to.name === "session" && to.params?.code === this.session.roomCode) return true;
    if (INFORMATION_ROUTES.has(to.name)) return true;
    if (meta.pop && to.name === "session" && to.params?.code === this.session.roomCode) return true;

    const confirmed = await confirmModal({
      title: "Покинуть город?",
      message: "Активная партия закроется для вас. Если вы хост, комната исчезнет для всех.",
      detail: "Прогресс хранится в памяти вкладки хоста и не восстанавливается после выхода.",
      confirmLabel: "Выйти",
      cancelLabel: "Остаться",
    });
    if (!confirmed) return false;
    this._closeCurrentSession("Вы покинули комнату.", { silent: true });
    return true;
  }

  // -----------------------------------------------------------------------
  // Sessions
  // -----------------------------------------------------------------------

  _bindSession(session) {
    this._unbindSession();
    this.session = session;
    this.view = session.view;
    this.relayUrl = session.mode === "online" || session.mode === "lan" ? this.relayUrl : "";
    this._sessionUnsubs = [
      session.on("view", (view) => this._onSessionView(session, view)),
      session.on("notice", ({ tone, text }) => {
        if (this.session !== session) return;
        this.toast(text, { tone: tone === "warn" ? "warn" : tone === "danger" ? "danger" : "info" });
      }),
      session.on("closed", ({ reason }) => {
        if (this.session !== session) return;
        this._unbindSession();
        this.session = null;
        this.view = null;
        this.toast(reason, { tone: "warn" });
        this._renderChrome(this.route ?? { name: "menu" });
        if (this.route?.name === "session") void this.router.replace("/");
      }),
    ];
  }

  _unbindSession() {
    for (const off of this._sessionUnsubs.splice(0)) {
      try {
        off();
      } catch {
        // ignore
      }
    }
    this.screenSession = null;
  }

  _onSessionView(session, view) {
    if (this.session !== session) return;
    this.view = view ?? session.view;
    if (this.route?.name !== "session") {
      this._renderChrome(this.route ?? { name: "menu" });
      return;
    }
    this._mountSession(this.route);
  }

  async _adoptSession(session, { path, relayUrl = "", message = "" } = {}) {
    if (!session) throw new Error("Не удалось открыть комнату.");
    this.relayUrl =
      relayUrl ||
      (session.mode === "online" || session.mode === "lan" ? this.settings.relayUrl : "");
    this._bindSession(session);
    if (message) this.toast(message, { tone: "town" });
    this.playSfx("join");
    const target = path || sessionPath(session.roomCode);
    await this.router.navigate(target);
    if (this.route?.name === "session") this._mountSession(this.route);
    return session;
  }

  _closeCurrentSession(reason = "Комната закрыта.", { silent = false } = {}) {
    const session = this.session;
    if (!session) return;
    this._unbindSession();
    this.session = null;
    this.view = null;
    this.screenSession = null;
    try {
      session.close(reason);
    } catch (error) {
      console.error("[app] close session", error);
    }
    if (!silent) this.toast(reason, { tone: "info" });
    this._renderChrome(this.route ?? { name: "menu" });
  }

  async leaveSession({ go = "/", reason = "Вы покинули комнату.", silent = false } = {}) {
    if (this.session) this._closeCurrentSession(reason, { silent: true });
    this.playSfx("leave");
    if (!silent) this.toast(reason, { tone: "info" });
    await this.router.navigate(go, { replace: true, force: true });
  }

  async _requireNick() {
    if (!nickError(this.settings.nick)) return true;
    const initial = sanitizeNick(this.settings.nick) || "";
    const colors = ["#d9b36c", "#e14c5a", "#4fb477", "#6fb6ff", "#a66bff", "#f08a5d", "#5ad1c8", "#e9e3d5"];
    let color = this.settings.color;
    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (value, reason) => {
        if (settled) return;
        settled = true;
        resolve(value);
        if (reason) handle?.close(reason);
      };
      const handle = openModal({
        title: "Как вас зовут?",
        subtitle: "Имя увидят другие игроки. Роль останется тайной.",
        body: html`<div class="require-nick">
          <label class="field" for="require-nick-input">
            <span class="field__label">Ник</span>
            <input
              class="input"
              id="require-nick-input"
              data-require-nick
              type="text"
              maxlength="16"
              value="${initial}"
              placeholder="Например, Полночь"
              autocomplete="nickname"
              spellcheck="false"
            />
            <span class="field__hint">2–16 символов: буквы, цифры, пробел, точка, дефис.</span>
            <span class="field__error" data-require-error></span>
          </label>
          <div class="profile-editor__colors">
            <span class="field__label">Цвет метки</span>
            <div class="swatch-row" role="radiogroup" aria-label="Цвет метки">
              ${colors.map(
                (swatch) => html`<button
                  class="swatch ${swatch === color ? "is-active" : ""}"
                  type="button"
                  data-require-color="${swatch}"
                  style="--swatch:${swatch}"
                  role="radio"
                  aria-checked="${swatch === color ? "true" : "false"}"
                  aria-label="Цвет ${swatch}"
                ></button>`,
              )}
            </div>
          </div>
        </div>`,
        footer: html`<button class="btn btn--ghost" type="button" data-require-cancel>Позже</button>
          <button class="btn btn--primary" type="button" data-require-save>Сохранить и играть</button>`,
        onClose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
      });
      if (!handle) {
        settled = true;
        resolve(false);
        return;
      }
      const input = handle.body?.querySelector("[data-require-nick]");
      const error = handle.body?.querySelector("[data-require-error]");
      const save = () => {
        const value = input?.value ?? "";
        const message = nickError(value);
        if (message) {
          if (error) error.textContent = message;
          input?.setAttribute("aria-invalid", "true");
          input?.focus({ preventScroll: true });
          return;
        }
        const saved = this.updateProfile({ nick: value, color });
        if (saved.ok === false) {
          if (error) error.textContent = saved.error ?? "Не удалось сохранить имя.";
          return;
        }
        finish(true, "saved");
      };
      handle.root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const swatch = target.closest("[data-require-color]");
        if (swatch) {
          color = swatch.dataset.requireColor;
          for (const button of handle.body?.querySelectorAll("[data-require-color]") ?? []) {
            button.classList.toggle("is-active", button === swatch);
            button.setAttribute("aria-checked", button === swatch ? "true" : "false");
          }
          return;
        }
        if (target.closest("[data-require-save]")) {
          event.preventDefault();
          save();
        } else if (target.closest("[data-require-cancel]")) {
          event.preventDefault();
          finish(false, "cancel");
        }
      });
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        }
      });
    });
    return result === true;
  }

  async startBotGame({ players = this.settings.lastPlayerCount, botChat = this.settings.botChat } = {}) {
    if (!(await this._requireNick())) return false;
    const count = clampInt(players, 4, 20, this.settings.lastPlayerCount || 8);
    const chat = ["quiet", "normal", "loud"].includes(botChat) ? botChat : this.settings.botChat;
    this.updateSettings({ lastPlayerCount: count, botChat: chat });
    this._closeCurrentSession("Предыдущая партия закрыта.", { silent: true });
    const busy = this.busy("Город занимает места…");
    try {
      const config = normalizeRoomConfig({
        name: "Тренировка",
        maxPlayers: count,
        minStart: Math.min(5, count),
        roles: { doctor: true, assassin: false, jester: false },
        botChat: chat,
        revealOnDeath: this.settings.revealOnDeath,
        allowSpectators: true,
        public: false,
        quick: false,
      });
      const session = await createSoloSession({
        self: this.profile,
        config,
        botFill: count,
        autoStart: true,
      });
      await this._adoptSession(session, {
        path: `${sessionPath(session.roomCode)}${queryString({ mode: "solo" })}`,
        message: "Город собран. Роли розданы.",
      });
      return true;
    } catch (error) {
      this.toast(friendlyError(error), { tone: "danger" });
      return false;
    } finally {
      busy();
    }
  }

  async startSpectator({ players = 10 } = {}) {
    if (!(await this._requireNick())) return false;
    const count = clampInt(players, 6, 20, 10);
    this.updateSettings({ lastPlayerCount: count });
    this._closeCurrentSession("Предыдущее наблюдение закрыто.", { silent: true });
    const busy = this.busy("Запускаем ИИ-город…");
    try {
      const config = normalizeRoomConfig({
        name: "Ночной город · наблюдение",
        maxPlayers: count,
        minStart: Math.min(6, count),
        roles: { doctor: true, assassin: count >= 8, jester: count >= 7 },
        botChat: this.settings.botChat,
        revealOnDeath: true,
        allowSpectators: true,
        public: false,
      });
      const session = await createSpectatorSession({
        self: this.profile,
        config,
        botFill: count,
        autoStart: true,
      });
      await this._adoptSession(session, {
        path: `${sessionPath(session.roomCode)}${queryString({ mode: "spectate" })}`,
        message: "Наблюдение включено. Можно ускорить время.",
      });
      this.playSfx("start");
      return true;
    } catch (error) {
      this.toast(friendlyError(error), { tone: "danger" });
      return false;
    } finally {
      busy();
    }
  }

  async createRoom({ config = {}, mode = "local", relayUrl = "", autoFillBots = true } = {}) {
    if (!(await this._requireNick())) return false;
    const clean = normalizeRoomConfig(config);
    const networked = mode === "online" || mode === "lan";
    let relay = "";
    if (networked) {
      relay = await resolveRelayForMode(mode, relayUrl || this.settings.relayUrl);
      if (!relay) {
        this.toast(
          mode === "lan"
            ? "Сервер по IP не найден. Запустите npm start на компьютере-хосте и откройте игру по его адресу."
            : "Для онлайн-комнаты нужен адрес relay.",
          { tone: "warn" },
        );
        return false;
      }
    }
    this._closeCurrentSession("Прошлая комната закрыта.", { silent: true });
    const busy = this.busy("Готовим комнату…");
    try {
      if (mode === "online" && relay) this.updateSettings({ relayUrl: relay });
      this.updateSettings({
        lastPlayerCount: clean.maxPlayers,
        botChat: clean.botChat,
        revealOnDeath: clean.revealOnDeath,
      });
      const session = await openRoom({
        mode: networked ? mode : "local",
        relayUrl: relay,
        self: this.profile,
        config: clean,
        botFill: autoFillBots ? clean.minStart : 0,
        autoStart: false,
      });
      await this._adoptSession(session, {
        path: sessionPath(session.roomCode),
        relayUrl: relay,
        message:
          mode === "online"
            ? "Онлайн-комната создана."
            : mode === "lan"
              ? "Комната по IP создана."
              : "Комната в портах создана.",
      });
      return true;
    } catch (error) {
      this.toast(friendlyError(error), { tone: "danger" });
      return false;
    } finally {
      busy();
    }
  }

  async joinRoom({ code = "", mode = "local", spectate = false, relayUrl = "" } = {}) {
    if (!(await this._requireNick())) return false;
    const roomCode = normalizeRoomCode(code);
    if (!isValidRoomCode(roomCode)) {
      this.toast("Код комнаты — 6 символов без похожих I/O/0/1.", { tone: "warn" });
      return false;
    }
    const networked = mode === "online" || mode === "lan";
    let relay = "";
    if (networked) {
      relay = await resolveRelayForMode(mode, relayUrl || this.settings.relayUrl);
      if (!relay) {
        this.toast(
          mode === "lan"
            ? "Сервер по IP не найден. Откройте игру по адресу компьютера-хоста."
            : "Для онлайн-комнаты нужен адрес relay.",
          { tone: "warn" },
        );
        return false;
      }
    }
    this._closeCurrentSession("Прошлая комната закрыта.", { silent: true });
    const busy = this.busy(spectate ? "Входим наблюдателем…" : "Входим в комнату…");
    try {
      if (mode === "online" && relay) this.updateSettings({ relayUrl: relay });
      const session = await joinNetworkRoom({
        mode: networked ? mode : "local",
        relayUrl: relay,
        code: roomCode,
        self: this.profile,
        spectate: spectate === true,
      });
      await this._adoptSession(session, {
        path: sessionPath(roomCode),
        relayUrl: relay,
        message: session.isSpectator ? "Вы наблюдаете за городом." : "Добро пожаловать в комнату.",
      });
      return true;
    } catch (error) {
      this.toast(friendlyError(error), { tone: "danger" });
      return false;
    } finally {
      busy();
    }
  }

  async joinRoomSmart(code, { mode = "all" } = {}) {
    if (!(await this._requireNick())) return false;
    const roomCode = normalizeRoomCode(code);
    if (!isValidRoomCode(roomCode)) {
      this.toast("Введите шестизначный код комнаты.", { tone: "warn" });
      return false;
    }
    const busy = this.busy("Ищем комнату…");
    let room = null;
    try {
      const listed = await this.listRooms();
      room = listed.rooms.find(
        (entry) => entry.code === roomCode && (mode === "all" || entry.source === mode),
      );
    } catch {
      // Fall through to a direct join attempt.
    } finally {
      busy();
    }
    if (room) {
      return this.joinRoom({
        code: room.code,
        mode: room.source === "online" ? (room.lan ? "lan" : "online") : "local",
        spectate: room.status !== "lobby",
      });
    }
    if (mode === "online" || mode === "lan") {
      return this.joinRoom({ code: roomCode, mode });
    }
    if (mode === "local") {
      return this.joinRoom({ code: roomCode, mode: "local" });
    }
    try {
      return await this.joinRoom({ code: roomCode, mode: "local" });
    } catch {
      return this.joinRoom({ code: roomCode, mode: "online" });
    }
  }

  async quickMatch() {
    if (!(await this._requireNick())) return false;
    const busy = this.busy("Ищем свободный город…");
    let rooms = [];
    try {
      rooms = (await this.listRooms()).rooms;
    } catch {
      rooms = [];
    } finally {
      busy();
    }
    const room = quickMatchRoom(rooms);
    if (room) {
      return this.joinRoom({
        code: room.code,
        mode: room.source === "online" ? (room.lan ? "lan" : "online") : "local",
        spectate: false,
      });
    }
    this.toast("Свободных комнат нет — запускаем тренировку с ботами.", { tone: "info" });
    return this.startBotGame({
      players: this.settings.lastPlayerCount || 8,
      botChat: this.settings.botChat,
    });
  }

  async _sameOriginRelay() {
    if (Date.now() - this._autoRelayAt < 30_000) return this._autoRelay;
    this._autoRelay = await probeSameOriginRelay();
    this._autoRelayAt = Date.now();
    return this._autoRelay;
  }

  async listRooms(options = {}) {
    const relay = this.relayUrl || this.settings.relayUrl || (await this._sameOriginRelay());
    return listAllRooms({ relayUrl: relay, ...options });
  }

  setReady(ready) {
    const result = this.session?.setReady?.(ready === true);
    if (result?.ok === false) this.toast(result.error ?? "Не удалось изменить готовность.", { tone: "warn" });
    return result;
  }

  startGame() {
    if (!this.session?.start) return { ok: false, error: "Комната не открыта." };
    const result = this.session.start();
    if (result?.ok === false) {
      this.toast(result.error ?? "Не удалось начать игру.", { tone: "warn" });
      this.playSfx("error");
    } else {
      this.playSfx("start");
    }
    return result;
  }

  updateRoomConfig(config) {
    if (!this.session?.updateConfig) return { ok: false, error: "Комната не открыта." };
    return this.session.updateConfig(config);
  }

  fillBots(count = 1) {
    const result = this.session?.fillBots?.(count) ?? { ok: false, error: "Комната не открыта." };
    if (result.ok) this.playSfx("join");
    else this.toast(result.error ?? "Не удалось добавить бота.", { tone: "warn" });
    return result;
  }

  fillToMin() {
    const result = this.session?.fillToMin?.() ?? { ok: false, error: "Комната не открыта." };
    if (result.ok) {
      this.toast(`Добавлено ботов: ${result.added ?? 0}.`, { tone: "town" });
    } else {
      this.toast(result.error ?? "Не удалось заполнить комнату.", { tone: "warn" });
    }
    return result;
  }

  removeBots() {
    const result = this.session?.removeBots?.() ?? { ok: false, error: "Комната не открыта." };
    if (result.ok) this.toast(`Удалено ботов: ${result.removed ?? 0}.`, { tone: "info" });
    return result;
  }

  async kickPlayer(playerId) {
    if (!this.session?.kick) return false;
    const player = this.view?.players?.find((entry) => entry.id === playerId);
    const confirmed = await confirmModal({
      title: `Исключить ${player?.name ?? "игрока"}?`,
      message: "Игрок потеряет доступ к комнате. В лобби он сможет войти снова, если место свободно.",
      confirmLabel: "Исключить",
      cancelLabel: "Отмена",
    });
    if (!confirmed) return false;
    const result = this.session.kick(playerId);
    if (result?.ok === false) this.toast(result.error ?? "Не удалось исключить игрока.", { tone: "warn" });
    return result?.ok === true;
  }

  sendChat(payload = {}) {
    if (!this.session) return { ok: false, error: "Чат недоступен." };
    const result = this.session.sendChat(payload);
    if (result?.ok === false && result.error) this.toast(result.error, { tone: "warn" });
    return result;
  }

  nightAction(action, targetId) {
    if (!this.session) return { ok: false, error: "Партия не идёт." };
    const result = this.session.nightAction(action, targetId);
    if (result?.ok === false && result.error) this.toast(result.error, { tone: "warn" });
    return result;
  }

  vote(targetId) {
    if (!this.session) return { ok: false, error: "Партия не идёт." };
    const result = this.session.vote(targetId);
    if (result?.ok === false && result.error) this.toast(result.error, { tone: "warn" });
    return result;
  }

  setSpeed(speed) {
    const result = this.session?.setSpeed?.(speed) ?? { ok: false, error: "Партия не идёт." };
    if (result?.ok === false && result.error) this.toast(result.error, { tone: "warn" });
    return result;
  }

  setPaused(paused) {
    const result = this.session?.setPaused?.(paused === true) ?? { ok: false, error: "Партия не идёт." };
    if (result?.ok === false && result.error) this.toast(result.error, { tone: "warn" });
    return result;
  }

  rematch() {
    if (!this.session?.rematch) return { ok: false, error: "Партия не идёт." };
    const result = this.session.rematch();
    if (result?.ok === false) {
      this.toast(result.error ?? "Не удалось начать реванш.", { tone: "warn" });
    } else {
      this.toast("Новый раунд. Роли будут розданы заново.", { tone: "town" });
      this.playSfx("start");
    }
    return result;
  }

  getShareUrl() {
    if (!this.session) {
      try {
        return new URL(this.router.browserPath("/"), location.origin).toString();
      } catch {
        return "";
      }
    }
    const network = this.session.mode === "online" || this.session.mode === "lan";
    const relay = network ? this.relayUrl || this.settings.relayUrl : "";
    const path = this.router.browserPath(
      `/join${queryString({
        code: this.session.roomCode,
        relay: this.session.mode === "lan" ? "" : relay,
        mode: this.session.mode === "lan" ? "lan" : "",
      })}`,
    );
    if (this.session.mode === "lan" && relay) {
      // A LAN invite must load the app from the host machine: HTTPS GitHub
      // Pages cannot open an insecure ws:// socket to a private address.
      try {
        const url = new URL(relay);
        url.protocol = url.protocol === "wss:" ? "https:" : "http:";
        url.pathname = "/join";
        url.search = "";
        url.searchParams.set("code", this.session.roomCode);
        url.searchParams.set("mode", "lan");
        return url.toString();
      } catch {
        // fall through to the normal origin
      }
    }
    try {
      return new URL(path, location.origin).toString();
    } catch {
      return path;
    }
  }

  openShare() {
    if (!this.session) {
      this.toast("Сначала откройте комнату.", { tone: "warn" });
      return;
    }
    const url = this.getShareUrl();
    const code = this.session.roomCode;
    const mode = this.session.mode;
    const local = mode === "local";
    const lan = mode === "lan";
    const solo = mode === "solo";
    const handle = openModal({
      title: "Позвать в город",
      subtitle: solo
        ? "Это тренировка с ботами"
        : local
          ? "Порты этого браузера"
          : lan
            ? "По IP: ссылка ведёт на компьютер-хост"
            : "Онлайн-комната через relay",
      body: html`<div class="share-box">
        <div class="share-box__code">
          <span class="field__label">Код комнаты</span>
          <span class="code-pill">${code}</span>
        </div>
        <label class="field" for="share-url">
          <span class="field__label">Ссылка-приглашение</span>
          <input class="input mono" id="share-url" data-share-url type="text" readonly value="${url}" />
        </label>
        <div class="notice ${solo ? "notice--danger" : ""}">
          ${icon(solo ? "bot" : local ? "monitor" : lan ? "monitor" : "wifi", { size: 16 })}
          <span>${solo
            ? "Тренировка не подключает других игроков. Создайте комнату, чтобы играть вместе."
            : local
              ? "Порты работают только во вкладках этого браузера. Для других устройств выберите «По IP» или «Онлайн». Сам сайт на GitHub Pages сеть не поднимет."
              : lan
                ? "Как в CS2: ссылка ведёт на адрес хоста. Сервер запускается через npm start. Игроки из других городов подключатся, если открыт порт 8080 (проброс роутера) или Cloudflare Tunnel. Адрес localhost или 127.0.0.1 работает только на самом хосте."
                : "Ссылка уже содержит адрес relay. Другому игроку не нужно ничего настраивать."}</span>
        </div>
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-modal-close>Закрыть</button>
        <button class="btn btn--primary" type="button" data-share-copy>${icon("copy", { size: 15 })} Скопировать ссылку</button>`,
    });
    if (!handle) return;
    const input = handle.body?.querySelector("[data-share-url]");
    input?.addEventListener("focus", () => input.select());
    input?.addEventListener("click", () => input.select());
    handle.footer?.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("[data-share-copy]")) {
        void this.copyText(url, "Ссылка скопирована.");
      }
    });
  }

  busy(text = "Секунду…") {
    if (this._busyNode) {
      const label = this._busyNode.querySelector("p");
      if (label) label.textContent = text;
      return () => {};
    }
    const node = document.createElement("div");
    node.className = "busy";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.innerHTML = html`<div class="busy__panel">
      <span class="spinner spinner--lg"></span>
      <p>${text}</p>
    </div>`.value;
    document.body.append(node);
    document.querySelector("#app")?.setAttribute("aria-busy", "true");
    this._busyNode = node;
    return () => {
      if (this._busyNode !== node) return;
      this._busyNode = null;
      document.querySelector("#app")?.removeAttribute("aria-busy");
      node.remove();
    };
  }
}

// The fallback screens need a way back to the router without importing the app.
let fallbackNavigate = () => {};
function appNavigate(path) {
  return fallbackNavigate(path);
}

export function createApp(options = {}) {
  const app = new App(options);
  fallbackNavigate = (path) => app.navigate(path);
  return app;
}
