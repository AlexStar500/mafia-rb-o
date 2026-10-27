/*
 * Classic (non-module) boot guard. It runs even when the ES module graph fails
 * to load — a stale service-worker cache, a half-deployed release or a dead
 * connection. Without it the boot spinner spins forever and the page looks
 * blank, which is impossible to diagnose from a phone.
 */
(function () {
  var started = false;
  var reported = false;

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

  window.addEventListener("error", function (event) {
    if (started) return;
    panel("Город не открылся", "Не удалось загрузить файлы игры.");
    var detail = document.querySelector(".boot-guard__detail");
    if (detail && describe(event)) detail.textContent = describe(event);
  });

  window.addEventListener("unhandledrejection", function (event) {
    if (started) return;
    panel("Город не открылся", "Загрузка прервалась.");
    var detail = document.querySelector(".boot-guard__detail");
    if (detail && describe(event)) detail.textContent = describe(event);
  });

  // A slow phone network should still get a way out instead of a never-ending
  // spinner. If the app boots later it simply replaces this message.
  setTimeout(function () {
    if (started) return;
    panel("Город долго не отвечает", "Файлы игры не успели загрузиться. Проверьте связь и обновите страницу.");
  }, 15000);

  window.__mafiaBootOk = function () {
    started = true;
  };
})();
