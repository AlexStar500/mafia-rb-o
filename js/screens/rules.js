import { html, qs } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { roleChip, showRoleModal } from "../ui/components.js";
import { ROLES, ROLE_ORDER } from "../data/roles.js";

const STEPS = Object.freeze([
  {
    icon: "users",
    title: "Соберите город",
    text: "Создайте комнату, позовите друзей по ссылке или коду и доберите свободные места ботами.",
  },
  {
    icon: "mask",
    title: "Получите роль",
    text: "Роли раздаются тайно при старте. Мафия видит своих, город — только себя.",
  },
  {
    icon: "moon",
    title: "Переживите ночь",
    text: "Мафия выбирает жертву, шериф проверяет, доктор лечит, ассасин берёт контракт.",
  },
  {
    icon: "vote",
    title: "Решите днём",
    text: "Обсудите улики, найдите ложь и повесьте подозреваемого. Или город уснёт снова.",
  },
]);

const PHASES = Object.freeze([
  {
    icon: "moon",
    tone: "night",
    title: "Ночь",
    time: "12–90 секунд",
    text: "Все закрывают глаза. Ночные роли по очереди выбирают цели. Мафия договаривается в закрытом чате, город молчит.",
    notes: ["Мафия: общий выбор жертвы", "Шериф: проверка одного игрока", "Доктор: лечение, нельзя лечить одного и того же дважды подряд", "Ассасин: контракт со второй ночи, один раз за игру"],
  },
  {
    icon: "sun",
    tone: "dawn",
    title: "Рассвет",
    time: "короткая пауза",
    text: "Город узнаёт, кто не проснулся. Причина смерти может быть скрыта, если хост выключил раскрытие ролей.",
    notes: ["Жертва мафии", "Жертва контракта ассасина", "Спасённый доктором остаётся жив"],
  },
  {
    icon: "chat",
    tone: "day",
    title: "Обсуждение",
    time: "20–240 секунд",
    text: "Живые игроки спорят, делятся проверками и строят версии. Мёртвые читают общий чат, пишут только в «Мёртвые» и больше не видят чат мафии.",
    notes: ["Быстрые фразы понимают боты", "Свободный текст проходит модерацию", "Спам и флуд ограничены лимитом"],
  },
  {
    icon: "vote",
    tone: "danger",
    title: "Голосование",
    time: "12–90 секунд",
    text: "У каждого живого один голос. Можно пропустить. Побеждает простое большинство, но нужно минимум два голоса.",
    notes: ["Равенство голосов — никто не повешен", "Переголосовать нельзя", "Голос видят все после вскрытия"],
  },
  {
    icon: "gavel",
    tone: "verdict",
    title: "Приговор",
    time: "автоматически",
    text: "Город вешает выбранного. Если это шут — шут побеждает немедленно и игра заканчивается.",
    notes: ["Роль может раскрыться", "Последнее слово — только у повешенного", "Ночь начинается заново"],
  },
  {
    icon: "scroll",
    tone: "muted",
    title: "Последнее слово",
    time: "10–20 секунд",
    text: "Повешенный получает последний шанс сказать городу правду. Или ложь, которая переживёт его.",
    notes: ["Пишет только повешенный", "Остальные читают", "После слова начинается новая ночь"],
  },
]);

const FAQ = Object.freeze([
  {
    q: "Можно ли играть без сервера?",
    a: "Да. Тренировка с ботами и «Порты» работают полностью в браузере. Порты — это комнаты в соседних вкладках одного браузера. Чтобы играть с других устройств, есть «По IP» (хост запускает npm start, остальные заходят по его адресу; с пробросом порта подключаются из другой сети) и «Онлайн» через relay. Статический хостинг сам по себе не соединяет устройства.",
  },
  {
    q: "Кто видит мою роль?",
    a: "Только вы и ваши союзники-мафиози. Хост тоже не получает чужую роль в интерфейсе: серверная логика формирует персональный снимок состояния для каждого клиента. После смерти роль может раскрыться, если это включено в настройках комнаты.",
  },
  {
    q: "Что видит relay?",
    a: "Только служебные кадры: кто вошёл, кто вышел, обновление лобби и пересылку игровых сообщений. Роли и закрытый чат мафии передаются адресно и не попадают в публичный список комнат.",
  },
  {
    q: "Как боты понимают быстрые фразы?",
    a: "Каждая быстрая фраза имеет канонический ID, категорию и адресата. Сначала выбирается фраза, потом игрок — поэтому «Он мафия» всегда означает конкретного человека. Боты читают смысл: обвинение, оправдание, вопрос, проверку.",
  },
  {
    q: "Почему боты не кричат все сразу?",
    a: "У ботов есть режиссёр чата: он ограничивает число реплик за фазу, не даёт повторять одну и ту же мысль и придерживает самых громких. Реакция на обвинение появляется с задержкой, как у живых игроков.",
  },
  {
    q: "Можно ли смотреть чужую игру?",
    a: "Да, если хост разрешил наблюдателей. Наблюдатель видит все роли и общий чат, но не может писать, голосовать или действовать ночью. В режиме «ИИ-город» доступны пауза и ускорение времени.",
  },
  {
    q: "Что происходит при выходе игрока?",
    a: "В лобби игрок просто исчезает из состава. В игре он остаётся в списке как отключённый и может быть заменён ботом или исключён хостом. Роли при этом не пересдаются.",
  },
  {
    q: "Как работает победа?",
    a: "Город побеждает, когда уничтожена вся мафия. Мафия — когда живых мирных не больше, чем мафии. Шут побеждает только если его повесили. После финала можно сразу начать реванш с теми же игроками.",
  },
]);

function phaseCard(phase) {
  return html`<article class="timeline-item timeline-item--${phase.tone}">
    <span class="timeline-item__dot">${icon(phase.icon, { size: 17 })}</span>
    <div class="timeline-item__body">
      <div class="timeline-item__head">
        <h3>${phase.title}</h3>
        <span class="timeline-item__time">${icon("clock", { size: 12 })} ${phase.time}</span>
      </div>
      <p>${phase.text}</p>
      <ul class="timeline-item__notes">
        ${phase.notes.map((note) => html`<li>${icon("check", { size: 12 })}<span>${note}</span></li>`)}
      </ul>
    </div>
  </article>`;
}

function faqItem(entry, index) {
  return html`<details class="faq-item" ${index === 0 ? html`open` : ""}>
    <summary class="faq-item__q">
      <span>${entry.q}</span>
      <span class="faq-item__chevron">${icon("chevron", { size: 16 })}</span>
    </summary>
    <div class="faq-item__a"><p>${entry.a}</p></div>
  </details>`;
}

export function createRulesScreen(ctx) {
  const app = ctx.app;

  const htmlScreen = html`<div class="screen">
    <div class="page rules-page">
      <header class="rules-hero">
        <div class="rules-hero__copy">
          <span class="eyebrow">${icon("scroll", { size: 13 })} Правила Ночного города</span>
          <h1 class="page-title">Лгите красиво.<br /><span class="gold">Доживите до утра.</span></h1>
          <p class="page-sub">
            Мафия — игра на десять минут и один длинный вечер. Здесь нет ведущего: город ведёт себя сам,
            роли раздаются тайно, а время идёт по таймеру. Ниже — всё, что нужно знать перед первой партией.
          </p>
          <div class="rules-hero__actions">
            <button class="btn btn--primary" type="button" data-go-quick>${icon("play", { size: 17 })} Попробовать с ботами</button>
            <button class="btn btn--ghost" type="button" data-go-roles>${icon("mask", { size: 16 })} Кодекс ролей</button>
          </div>
        </div>
        <aside class="rules-hero__card panel panel--gold" aria-label="Коротко о партии">
          <span class="rules-hero__stamp">${icon("moon", { size: 22 })}</span>
          <strong>Одна партия</strong>
          <dl class="rules-facts">
            <div><dt>Игроки</dt><dd>4–20</dd></div>
            <div><dt>Роли</dt><dd>6</dd></div>
            <div><dt>Ночь</dt><dd>12–90 с</dd></div>
            <div><dt>День</dt><dd>20–240 с</dd></div>
          </dl>
          <p class="field__hint">Таймеры можно изменить при создании комнаты.</p>
        </aside>
      </header>

      <section class="rules-steps" aria-label="Четыре шага партии">
        ${STEPS.map(
          (step, index) => html`<article class="rule-step">
            <span class="rule-step__num">${index + 1}</span>
            <span class="rule-step__icon">${icon(step.icon, { size: 20 })}</span>
            <h2>${step.title}</h2>
            <p>${step.text}</p>
          </article>`,
        )}
      </section>

      <section class="rules-section">
        <div class="section-title"><span>${icon("clock", { size: 14 })} Как идёт партия</span></div>
        <div class="timeline">${PHASES.map(phaseCard)}</div>
      </section>

      <div class="rules-grid">
        <section class="panel rules-card">
          <div class="panel__head"><span class="panel__title">${icon("vote", { size: 15 })} Голосование</span></div>
          <div class="panel__body">
            <ul class="rule-list">
              <li>${icon("check", { size: 14 })}<span>Один живой игрок — один голос. Голос нельзя отозвать или изменить.</span></li>
              <li>${icon("check", { size: 14 })}<span>Простое большинство отправляет игрока на виселицу.</span></li>
              <li>${icon("check", { size: 14 })}<span>Нужно минимум два голоса. Один голос никого не вешает.</span></li>
              <li>${icon("check", { size: 14 })}<span>При равенстве голосов не происходит ничего — город не смог решить.</span></li>
              <li>${icon("check", { size: 14 })}<span>Пропуск голоса учитывается отдельно и не спасает от равенства.</span></li>
            </ul>
            <div class="notice">
              ${icon("info", { size: 16 })}
              <span>После приговора голоса раскрываются. По ним видно, кто кого защищал.</span>
            </div>
          </div>
        </section>

        <section class="panel rules-card">
          <div class="panel__head"><span class="panel__title">${icon("shield", { size: 15 })} Ночные правила</span></div>
          <div class="panel__body">
            <ul class="rule-list">
              <li>${icon("check", { size: 14 })}<span>Доктор не может лечить одного и того же игрока две ночи подряд.</span></li>
              <li>${icon("check", { size: 14 })}<span>Доктор может один раз за игру вылечить себя.</span></li>
              <li>${icon("check", { size: 14 })}<span>Шериф видит команду проверенного: «мафия» или «не мафия». Ассасин выглядит мафией.</span></li>
              <li>${icon("check", { size: 14 })}<span>Контракт ассасина доступен со второй ночи, один раз за игру и игнорирует лечение.</span></li>
              <li>${icon("check", { size: 14 })}<span>Если мафия не выбрала жертву, ночь проходит без убийства.</span></li>
            </ul>
          </div>
        </section>

        <section class="panel rules-card">
          <div class="panel__head"><span class="panel__title">${icon("crown", { size: 15 })} Условия победы</span></div>
          <div class="panel__body">
            <div class="win-row win-row--town">
              <span class="win-row__icon">${icon("shield", { size: 18 })}</span>
              <div><b>Город</b><p>Вся мафия мертва. Живые мирные и шериф празднуют.</p></div>
            </div>
            <div class="win-row win-row--mafia">
              <span class="win-row__icon">${icon("blade", { size: 18 })}</span>
              <div><b>Мафия</b><p>Живых мирных не больше, чем мафии. Город больше не может сопротивляться.</p></div>
            </div>
            <div class="win-row win-row--neutral">
              <span class="win-row__icon">${icon("joker", { size: 18 })}</span>
              <div><b>Шут</b><p>Шут добился, чтобы его повесили. Победа мгновенная, даже если город был близок к финалу.</p></div>
            </div>
            <p class="field__hint">Если шут погибает ночью, игра продолжается по обычным правилам.</p>
          </div>
        </section>

        <section class="panel rules-card">
          <div class="panel__head"><span class="panel__title">${icon("bot", { size: 15 })} Боты и чат</span></div>
          <div class="panel__body">
            <p class="rules-card__lead">
              ИИ-горожане играют по наблюдениям: помнят голоса, реплики и проверки, но не видят чужие роли.
              Они умеют ошибаться, менять мнение и молчать, когда сказать нечего.
            </p>
            <ul class="rule-list">
              <li>${icon("check", { size: 14 })}<span>Быстрые фразы имеют категории: обвинение, защита, вопрос, роль, итог.</span></li>
              <li>${icon("check", { size: 14 })}<span>Бот отвечает не сразу, а с задержкой и только если сообщение его касается.</span></li>
              <li>${icon("check", { size: 14 })}<span>Режиссёр чата не даёт всем одновременно обвинить одного игрока.</span></li>
              <li>${icon("check", { size: 14 })}<span>Свободный текст очищается от ссылок, управления и повторяющихся символов.</span></li>
            </ul>
          </div>
        </section>
      </div>

      <section class="rules-section">
        <div class="section-title"><span>${icon("mask", { size: 14 })} Роли за тридцать секунд</span></div>
        <div class="rules-roles">
          ${ROLE_ORDER.map((roleId) => {
            const role = ROLES[roleId];
            return html`<button class="rules-role" type="button" data-rule-role="${roleId}" style="--role-color:${role.color}">
              <span class="rules-role__head">
                ${roleChip(roleId)}
                <span class="rules-role__arrow">${icon("forward", { size: 15 })}</span>
              </span>
              <span class="rules-role__text">${role.short}</span>
            </button>`;
          })}
        </div>
      </section>

      <section class="rules-modes">
        <article class="mode-explain">
          <span class="mode-explain__icon">${icon("bot", { size: 22 })}</span>
          <div>
            <h3>Тренировка</h3>
            <p>Вы и боты. Ничего не нужно настраивать. Идеально для первой партии.</p>
          </div>
        </article>
        <article class="mode-explain">
          <span class="mode-explain__icon">${icon("monitor", { size: 22 })}</span>
          <div>
            <h3>Порты</h3>
            <p>Друзья подключаются во вкладках этого браузера. Сервер не нужен.</p>
          </div>
        </article>
        <article class="mode-explain">
          <span class="mode-explain__icon">${icon("globe", { size: 22 })}</span>
          <div>
            <h3>По IP</h3>
            <p>Хост запускает сервер через <span class="mono">npm start</span>, остальные заходят по адресу. С пробросом порта играют из другой сети.</p>
          </div>
        </article>
        <article class="mode-explain">
          <span class="mode-explain__icon">${icon("wifi", { size: 22 })}</span>
          <div>
            <h3>Онлайн-комната</h3>
            <p>Разные устройства через relay. Логика игры остаётся у хоста, relay — только транспорт.</p>
          </div>
        </article>
      </section>

      <section class="rules-section">
        <div class="section-title"><span>${icon("question", { size: 14 })} Частые вопросы</span></div>
        <div class="faq">${FAQ.map(faqItem)}</div>
      </section>

      <section class="panel panel--gold rules-security">
        <div class="rules-security__icon">${icon("shield", { size: 26 })}</div>
        <div>
          <h2>Безопасность без компромиссов</h2>
          <p>
            Роли не хранятся в localStorage и не попадают в публичные сообщения. Ник не может быть служебным,
            текст проходит очистку, а действия ограничены по частоте. У статического клиента нет сервера, поэтому
            закрытая информация живёт в памяти вкладки хоста, а не в облаке.
          </p>
        </div>
      </section>

      <footer class="rules-cta">
        <div>
          <strong>Правила прочитаны. Город ждёт.</strong>
          <p class="muted">Первая партия бесплатна. Как и все остальные.</p>
        </div>
        <div class="row wrap">
          <button class="btn btn--primary" type="button" data-go-quick>${icon("play", { size: 16 })} Начать</button>
          <button class="btn btn--ghost" type="button" data-go-create>${icon("plus", { size: 16 })} Создать комнату</button>
        </div>
      </footer>
    </div>
  </div>`;

  return {
    title: "Как играть",
    html: htmlScreen,
    mount(root) {
      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const role = target.closest("[data-rule-role]");
        if (role) {
          showRoleModal(role.dataset.ruleRole);
          return;
        }
        if (target.closest("[data-go-quick]")) app.navigate("/quick");
        else if (target.closest("[data-go-create]")) app.navigate("/create");
        else if (target.closest("[data-go-roles]")) app.navigate("/roles");
      });

      // Old browsers without <details> still get a usable FAQ.
      if (!("open" in document.createElement("details"))) {
        for (const details of root.querySelectorAll(".faq-item")) {
          details.classList.add("faq-item--fallback");
          qs("summary", details)?.addEventListener("click", (event) => {
            event.preventDefault();
            details.classList.toggle("is-open");
          });
        }
      }
    },
    destroy() {},
  };
}
