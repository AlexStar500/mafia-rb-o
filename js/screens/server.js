import { html } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

const MODES = Object.freeze([
  {
    icon: "monitor",
    title: "Это устройство",
    subtitle: "Один браузер, без сервера",
    text: "Комната живёт во вкладках этого браузера. Откройте игру в соседней вкладке и войдите по коду. Сервер не нужен — работает сразу.",
    steps: ["Создайте комнату", "Скопируйте код или ссылку", "Откройте их в другой вкладке"],
    no: "Комната исчезает, когда закрыты все вкладки. Другие устройства подключиться не смогут.",
  },
  {
    icon: "globe",
    title: "По IP",
    subtitle: "Сервер на своём компьютере",
    text: "Хост запускает сервер у себя, а друзья заходят по его адресу. Для этого на компьютере хоста нужен Node.js. Если возиться не хочется — выберите «Онлайн».",
    steps: [
      "Скачайте игру с GitHub (зелёная кнопка Code → Download ZIP) и распакуйте",
      "Установите Node.js с nodejs.org, если его ещё нет",
      "В папке с игрой запустите терминал и выполните: npm install",
      "Затем: npm start — в терминале появится адрес вида http://192.168.x.x:8080",
      "Друзья открывают этот адрес и вводят код комнаты",
    ],
    no: "Из другой сети нужен проброс порта 8080 или туннель. Для обычной игры с друзьями проще «Онлайн».",
  },
  {
    icon: "wifi",
    title: "Онлайн",
    subtitle: "Relay в интернете",
    text: "Relay связывает разные устройства через интернет. Логика игры остаётся у хоста — relay только передаёт сообщения и список комнат, ролей не видит.",
    steps: ["Вставьте адрес relay (или оставьте пустым)", "Создайте комнату", "Отправьте ссылку-приглашение друзьям"],
    no: "Нужен рабочий relay. Публичный адрес ниже.",
  },
]);

export function createServerScreen(ctx) {
  const app = ctx.app;

  const htmlScreen = html`<div class="screen">
    <div class="page rules-page">
      <header class="rules-hero">
        <div class="rules-hero__copy">
          <span class="eyebrow">${icon("globe", { size: 13 })} Сеть и серверы</span>
          <h1 class="page-title">Соберите всех<br /><span class="gold">за одним столом.</span></h1>
          <p class="page-sub">
            Игра — статический сайт, ей не нужен сервер. Сервер нужен только для того, чтобы
            соединять разные устройства: по локальной сети, по IP или через relay в интернете.
          </p>
          <div class="rules-hero__actions">
            <button class="btn btn--primary" type="button" data-go-create>${icon("plus", { size: 17 })} Создать комнату</button>
            <button class="btn btn--ghost" type="button" data-go-settings>${icon("wifi", { size: 16 })} Адрес relay</button>
          </div>
        </div>
        <aside class="rules-hero__card panel panel--gold" aria-label="Коротко о сети">
          <span class="rules-hero__stamp">${icon("shield", { size: 22 })}</span>
          <strong>Без сервера — тоже игра</strong>
          <dl class="rules-facts">
            <div><dt>Это устройство</dt><dd>0 настроек</dd></div>
            <div><dt>По IP</dt><dd>Node.js + сервер</dd></div>
            <div><dt>Онлайн</dt><dd>relay</dd></div>
          </dl>
          <p class="field__hint">Роли и закрытый чат всегда остаются у хоста.</p>
        </aside>
      </header>

      <section class="rules-modes">
        ${MODES.map(
          (mode) => html`<article class="mode-explain">
            <span class="mode-explain__icon">${icon(mode.icon, { size: 22 })}</span>
            <div>
              <h3>${mode.title}</h3>
              <p class="muted">${mode.subtitle}</p>
              <p>${mode.text}</p>
              <ol class="step-list step-list--compact">
                ${mode.steps.map(
                  (step, index) => html`<li><span>${index + 1}</span><div>${step}</div></li>`,
                )}
              </ol>
              <p class="field__hint">${mode.no}</p>
            </div>
          </article>`,
        )}
      </section>

      <section class="rules-section">
        <div class="section-title"><span>${icon("wifi", { size: 14 })} Поднять свой relay</span></div>
        <div class="rules-grid">
          <section class="panel rules-card">
            <div class="panel__head"><span class="panel__title">${icon("monitor", { size: 15 })} Локально / VPS / Render</span></div>
            <div class="panel__body">
              <ul class="rule-list">
                <li>${icon("check", { size: 14 })}<span>Установите Node.js 18+ и зависимости: <span class="mono">npm install</span></span></li>
                <li>${icon("check", { size: 14 })}<span>Запустите сервер: <span class="mono">npm start</span> — это сайт + relay на одном порту.</span></li>
                <li>${icon("check", { size: 14 })}<span>Только relay (WebSocket): <span class="mono">npm run relay</span>.</span></li>
                <li>${icon("check", { size: 14 })}<span>Проверьте здоровье: <span class="mono">/health</span> вернёт JSON с <span class="mono">"ok":true</span>.</span></li>
              </ul>
            </div>
          </section>

          <section class="panel rules-card">
            <div class="panel__head"><span class="panel__title">${icon("lock", { size: 15 })} Адреса и безопасность</span></div>
            <div class="panel__body">
              <ul class="rule-list">
                <li>${icon("check", { size: 14 })}<span>Свой relay указывается в настройках или в ссылке-приглашении.</span></li>
                <li>${icon("check", { size: 14 })}<span>Relay видит только коды комнат и публичные метаданные — не роли и не закрытый чат.</span></li>
                <li>${icon("check", { size: 14 })}<span>Через HTTPS/WSS соединение шифруется. Игра на <span class="mono">https:</span> требует <span class="mono">wss://</span>.</span></li>
              </ul>
            </div>
          </section>
        </div>
      </section>

      <section class="rules-section">
        <div class="section-title"><span>${icon("question", { size: 14 })} Частые вопросы</span></div>
        <div class="faq">
          <details class="faq-item" open>
            <summary class="faq-item__q">
              <span>Почему онлайн-комната не подключается?</span>
              <span class="faq-item__chevron">${icon("chevron", { size: 16 })}</span>
            </summary>
            <div class="faq-item__a">
              <p>Сначала проверьте адрес relay: откройте его в браузере и убедитесь, что <span class="mono">/api/health</span> или <span class="mono">/health</span> отвечает JSON. Если адрес прямой Vercel — он может быть заблокирован в вашей сети; используйте домен-прокси (Cloudflare) или свой relay.</p>
            </div>
          </details>
          <details class="faq-item">
            <summary class="faq-item__q">
              <span>Что делать, если друзья из другой сети не могут зайти по IP?</span>
              <span class="faq-item__chevron">${icon("chevron", { size: 16 })}</span>
            </summary>
            <div class="faq-item__a">
              <p>Пробросьте порт <span class="mono">8080</span> на роутере или поднимите Cloudflare Tunnel до локального сервера. Тогда ссылка-приглашение будет вести на публичный адрес.</p>
            </div>
          </details>
          <details class="faq-item">
            <summary class="faq-item__q">
              <span>Можно ли играть вообще без сервера?</span>
              <span class="faq-item__chevron">${icon("chevron", { size: 16 })}</span>
            </summary>
            <div class="faq-item__a">
              <p>Да — режим «Это устройство» работает во вкладках одного браузера без единого сервера. Это удобно для тренировки и проверки ролей.</p>
            </div>
          </details>
        </div>
      </section>

      <footer class="rules-cta">
        <div>
          <strong>Сервер понятен. Собирайте город.</strong>
          <p class="muted">Всё, что нужно друзьям — адрес и код комнаты.</p>
        </div>
        <div class="row wrap">
          <button class="btn btn--primary" type="button" data-go-create>${icon("plus", { size: 16 })} Создать комнату</button>
          <button class="btn btn--ghost" type="button" data-go-quick>${icon("play", { size: 16 })} Быстрый старт</button>
        </div>
      </footer>
    </div>
  </div>`;

  return {
    title: "Сеть и серверы",
    html: htmlScreen,
    mount(root) {
      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (target.closest("[data-go-create]")) app.navigate("/create");
        else if (target.closest("[data-go-settings]")) app.navigate("/settings");
        else if (target.closest("[data-go-quick]")) app.navigate("/quick");
      });
    },
    destroy() {},
  };
}
