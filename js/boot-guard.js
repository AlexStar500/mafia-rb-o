/*
 * Classic (non-module) boot guard. It runs even when the ES module graph fails
 * to load — a stale service-worker cache, a half-deployed release or a dead
 * connection. Without it the boot spinner spins forever and the page looks
 * blank, which is impossible to diagnose from a phone.
 *
 * If the page is controlled by an old service worker, the guard clears the
 * cache once and reloads by itself. That is the usual reason a freshly deployed
 * site still shows an empty screen on a phone that visited it before.
 */
(function () {
  var started = false;
  var reported = false;

  function heal() {
    if (!("serviceWorker" in navigator)) return;
    var key = "mafia.bootHeal";
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch (error) {
      return;
    }
    Promise.resolve()
      .then(function () {
        if (navigator.serviceWorker.getRegistrations) return navigator.serviceWorker.getRegistrations();
        return [];
      })
      .then(function (regs) {
        return Promise.all(regs.map(function (reg) {
          return reg.unregister();
        }));
      })
      .then(function () {
        if (!window.caches) return [];
        return caches.keys();
      })
      .then(function (keys) {
        return Promise.all(keys.map(function (name) {
          return caches.delete(name);
        }));
      })
      .catch(function () {
        // A failed clean-up is not fatal: the panel below still helps.
      })
      .then(function () {
        location.reload();
      });
  }

  function panel(title, text) {
    if (reported) return;
    reported = true;
    var root = document.getElementById("screen");
    if (!root) return;
    var box = document.createElement("div");
    box.className = "screen";
    box.innerHTML =
      '<div class="page page--narrow"><div class="panel panel--danger lost-panel"><div class="panel__body">' +
      '<span class="eyebrow">Сбой загрузки</span>' +
      '<h1 class="page-title"></h1>' +
      '<p class="page-sub"></p>' +
      '<p class="page-sub boot-guard__detail"></p>' +
      '<button class="btn btn--primary" type="button" data-boot-reload>Обновить страницу</button>' +
      "</div></div></div>";
    box.querySelector(".page-title").textContent = title;
    box.querySelector(".page-sub").textContent = text;
    box.querySelector(".boot-guard__detail").textContent = "Если не помогает — очистите данные сайта в настройках браузера.";
    box.querySelector("[data-boot-reload]").addEventListener("click", function () {
      location.reload();
    });
    root.replaceChildren(box);
  }

  function describe(event) {
    if (!event) return "";
    if (typeof event === "string") return event;
    var message = event.message || (event.reason && (event.reason.message || String(event.reason))) || "";
    var where = event.filename ? " (" + String(event.filename).split("/").pop() + ")" : "";
    return message ? String(message).slice(0, 180) + where : "";
  }

  function fail(title, text, event) {
    if (started) return;
    // The first failure is almost always a stale cache: heal silently and let
    // the reload try again. Only the second failure gets the manual panel.
    var healed = false;
    try {
      healed = sessionStorage.getItem("mafia.bootHeal") === "1";
    } catch (error) {
      healed = false;
    }
    if (!healed) {
      heal();
      return;
    }
    panel(title, text);
    var detail = document.querySelector(".boot-guard__detail");
    if (detail && describe(event)) detail.textContent = describe(event);
  }

  window.addEventListener("error", function (event) {
    fail("Город не открылся", "Не удалось загрузить файлы игры.", event);
  });

  window.addEventListener("unhandledrejection", function (event) {
    fail("Город не открылся", "Загрузка прервалась.", event);
  });

  // A slow phone network should still get a way out instead of a never-ending
  // spinner. If the app boots later it simply replaces this message.
  setTimeout(function () {
    if (started) return;
    fail("Город долго не отвечает", "Файлы игры не успели загрузиться. Проверьте связь и обновите страницу.");
  }, 15000);

  window.__mafiaBootOk = function () {
    started = true;
    try {
      sessionStorage.removeItem("mafia.bootHeal");
    } catch (error) {
      // ignore
    }
  };
})();
