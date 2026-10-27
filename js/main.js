import { createApp } from "./app.js";
import { loadSettings, markServiceWorker } from "./core/storage.js";

function boot() {
  try {
    const app = createApp({ settings: loadSettings() });
    app.start();
    globalThis.__mafiaBootOk?.();
    // A small, intentional debug handle for the console. It is not used by the
    // game logic and never contains secrets.
    globalThis.mafia = app;
    registerServiceWorker(app);
  } catch (error) {
    console.error("[boot]", error);
    const root = document.querySelector("#screen");
    if (root) {
      root.innerHTML = `
        <div class="screen">
          <div class="page page--narrow">
            <div class="panel panel--danger lost-panel">
              <div class="panel__body">
                <span class="eyebrow">Сбой загрузки</span>
                <h1 class="page-title">Город не открылся</h1>
                <p class="page-sub">Обновите страницу. Если ошибка повторяется, проверьте консоль браузера.</p>
                <button class="btn btn--primary" type="button" data-reload>Обновить</button>
              </div>
            </div>
          </div>
        </div>`;
      root.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
    }
  }
}

function registerServiceWorker(app) {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(location.hostname)) return;

  // Pick up a new build automatically, but never reload in the middle of a
  // live room: the session lives only in this tab's memory.
  let refreshing = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing || app.isSessionActive) return;
    refreshing = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const swUrl = new URL("../sw.js", import.meta.url);
      const scope = new URL("../", import.meta.url);
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: scope.pathname,
        updateViaCache: "none",
      });
      app.setServiceWorkerRegistration(registration);
      markServiceWorker(app.version);
      registration.update?.().catch(() => {});
    } catch (error) {
      console.info("[sw] not registered", error?.message ?? error);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
