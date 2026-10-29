import { html, mount, qs } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import {
  avatar,
  playerColor,
  roleChip,
  teamChip,
  roleArt,
  roleModalBody,
  showPlayerModal,
  phaseInfo,
  voteBars,
} from "../ui/components.js";
import { createChat } from "../ui/chat.js";
import { openModal, closeModal, confirmModal } from "../ui/modal.js";
import { ROLES, TEAMS } from "../data/roles.js";
import { dayLabel, formatClock, formatShortTime, playersLabel, pluralRu } from "../core/format.js";
import { asset } from "../core/assets.js";


/**
 * Paint only when the markup actually changed. The host rebuilds its view on
 * every tick, so hammering innerHTML re-created identical panels and made them
 * flicker (and reset scroll/entry state).
 */
function mountStable(target, template) {
  if (!target) return target;
  const markup = String(template ?? "");
  if (target.__stableMarkup === markup) return target;
  target.__stableMarkup = markup;
  return mount(target, markup);
}

const ACTION_LABEL = Object.freeze({
  kill: "Убить",
  heal: "Лечить",
  check: "Проверить",
  contract: "Контракт",
  drink: "Напоить",
  block: "Заблокировать",
  puppet: "Выбрать марионетку",
  reveal: "Узнать роль",
  judge: "Приговор",
  guard: "Защитить",
  cure: "Излечить зомби",
  vote: "Повесить",
});

const ACTION_HINT = Object.freeze({
  kill: "Мафия выбирает жертву вместе. Голос команды учитывается при равенстве.",
  heal: "Лечение не повторяется две ночи подряд. Себя можно спасти один раз за игру.",
  check: "Результат проверки появится в ваших записях. Ассасин, бармен и шпион выглядят как мафия.",
  contract: "Контракт ассасина пробивает лечение доктора и забирает жизнь самого ассасина, если его не прикрыли.",
  drink: "Напоённый игрок весь следующий день пишет только бессмысленные символы.",
  block: "Заблокированный не действует ночью, а днём не голосует и не использует способности.",
  puppet: "Марионетка выбирается один раз на всю игру. Её победа станет вашей.",
  reveal: "Шпион узнаёт точную роль игрока. Один раз в день, без права передумать.",
  judge: "Если цель — мафия, погибнет она. Если нет — погибнете вы. Приговор окончательный.",
  guard: "Защищённого нельзя повесить, казнить судьёй, убить ночью или контрактом. Действует до конца дня и на следующую ночь.",
  cure: "Доктор может вернуть зомби к жизни три раза за игру. После лечения цель снова играет за город.",
  vote: "Один голос за фазу, без переголосования. Ничья означает, что никто не повешен.",
});

const DAY_PHASES = new Set(["dawn", "discussion", "voting"]);

function pluralVotes(count) {
  return `${count} ${pluralRu(count, ["голос", "голоса", "голосов"])}`;
}

function isSelf(view, player) {
  return player.id === view.selfId;
}

function visibleRole(player) {
  return player.roleId ? ROLES[player.roleId] : null;
}

function actionConfig(view, mode) {
  if (!view) return null;
  const self = view.self ?? {};
  if (DAY_PHASES.has(view.phase) && !view.spectator && self.alive) {
    if (mode === "reveal" && view.dayActions?.spy?.available) {
      return {
        kind: "day",
        action: "reveal",
        options: (view.players ?? [])
          .filter((player) => player.alive && player.id !== view.selfId)
          .map((player) => player.id),
        blocked: [],
        queued: null,
      };
    }
    if (mode === "judge" && view.dayActions?.judge?.available) {
      return {
        kind: "day",
        action: "judge",
        options: (view.players ?? [])
          .filter((player) => player.alive && player.id !== view.selfId)
          .map((player) => player.id),
        blocked: [],
        queued: null,
      };
    }
    if (mode === "cure" && view.dayActions?.cure?.available) {
      return {
        kind: "day",
        action: "cure",
        options: (view.players ?? [])
          .filter((player) => player.alive && player.zombie)
          .map((player) => player.id),
        blocked: [],
        queued: null,
      };
    }
    if (mode === "guard" && view.dayActions?.bodyguard?.available) {
      return {
        kind: "day",
        action: "guard",
        options: (view.players ?? [])
          .filter((player) => player.alive)
          .map((player) => player.id),
        blocked: [],
        queued: null,
      };
    }
  }
  if (view.phase === "voting") {
    if (view.spectator || !self.alive) return null;
    if (view.dayActions?.blocked) return null;
    return {
      kind: "vote",
      action: "vote",
      options: (view.players ?? []).filter((player) => player.alive && player.id !== view.selfId).map((player) => player.id),
      blocked: [],
      queued: view.votes?.myVote && view.votes.myVote !== "skip" ? view.votes.myVote : null,
    };
  }
  if (view.phase !== "night" || view.spectator || !self.alive) return null;
  if (mode === "contract" && view.night?.contract?.available) {
    return {
      kind: "contract",
      action: "contract",
      options: (view.players ?? [])
        .filter((player) => player.alive && player.id !== view.selfId && player.team !== "mafia")
        .map((player) => player.id),
      blocked: [],
      queued: view.night.contract.selected ?? null,
    };
  }
  const action = view.night?.action;
  if (!action) return null;
  return {
    kind: action.type,
    action: action.type,
    options: action.options ?? [],
    blocked: action.blocked ?? [],
    queued: action.selected ?? null,
  };
}

function endKey(view) {
  if (!view?.winner) return "";
  return `${view.endedAt || 0}:${view.winner.team}:${view.winner.playerId ?? ""}`;
}

function resultTone(view) {
  if (!view?.winner) return "neutral";
  if (view.spectator) return "gold";
  const self = view.self ?? {};
  if (view.winner.team === "neutral") return view.winner.playerId === view.selfId ? "gold" : "neutral";
  return self.team && self.team === view.winner.team ? "win" : "lose";
}

function targetName(view, id) {
  return (view.players ?? []).find((player) => player.id === id)?.name ?? "—";
}

/**
 * Identity of a view for render skipping. `now` and `session.syncAt` change on
 * every tick, so they must not force a re-render — the countdown has its own
 * timer. Chat is reduced to its length and last sequence number.
 */
function viewSignatureOf(next) {
  const chat = Array.isArray(next.chat) ? next.chat : [];
  const lastSeq = chat.length ? (chat[chat.length - 1].seq ?? 0) : 0;
  const session = next.session ? { ...next.session, syncAt: 0 } : null;
  return `${chat.length}:${lastSeq}:${JSON.stringify({ ...next, now: 0, chat: undefined, session })}`;
}

export function createGameScreen(ctx, initialView) {
  const app = ctx.app;
  let view = initialView;
  let rootRef = null;
  let chat = null;
  let selected = null;
  let mode = null;
  let timer = null;
  let lastPhaseSerial = null;
  let lastStartedAt = null;
  let revealedStart = null;
  let shownEnd = "";
  let playersSignature = "";
  let lastChatSeq = 0;
  let lastMessageSfx = 0;
  let endModal = null;
  let viewSignature = "";
  let clickHandler = null;

  const htmlScreen = html`<div class="screen game-screen">
    <div class="game" data-game>
      <header class="game-hud" data-game-hud></header>
      <div class="game-layout">
        <section class="game-stage">
          <div data-game-spotlight></div>
          <section class="panel players-panel">
            <div class="panel__head">
              <span class="panel__title">${icon("users", { size: 15 })} Город</span>
              <span class="muted players-panel__count" data-game-count></span>
              <span class="players-panel__legend">${icon("target", { size: 12 })} цель</span>
            </div>
            <div class="panel__body players-panel__body">
              <div class="players-grid" data-game-players></div>
            </div>
          </section>
          <div data-game-actions></div>
          <div class="game-info-grid">
            <section class="panel game-log">
              <div class="panel__head">
                <span class="panel__title">${icon("scroll", { size: 15 })} Хроника</span>
              </div>
              <div class="panel__body game-log__body" data-game-log></div>
            </section>
            <section class="panel game-notes">
              <div class="panel__head">
                <span class="panel__title">${icon("edit", { size: 15 })} Записи</span>
              </div>
              <div class="panel__body game-notes__body" data-game-notes></div>
            </section>
          </div>
        </section>
        <aside class="game-side">
          <section class="panel game-role" data-game-role></section>
          <section class="panel game-chat-panel">
            <div class="panel__head">
              <span class="panel__title">${icon("chat", { size: 15 })} Эфир</span>
              <span class="muted game-chat-panel__meta" data-game-chat-meta></span>
            </div>
            <div class="game-chat-slot" data-game-chat></div>
          </section>
        </aside>
      </div>
      <div class="target-bar" data-game-target-bar aria-live="polite"></div>
    </div>
  </div>`;

  const root = () => rootRef;
  const config = () => actionConfig(view, mode);

  const getTargets = (channel = "public") => {
    const others = (view?.players ?? []).filter(
      (player) => player.id !== view?.selfId && (channel === "dead" || player.alive),
    );
    if (!selected) return others;
    return [...others].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
  };

  // -----------------------------------------------------------------------
  // HUD
  // -----------------------------------------------------------------------

  function renderHud() {
    const node = qs("[data-game-hud]", root());
    if (!node || !view) return;
    const info = phaseInfo(view.phase, view.day);
    const self = view.self ?? {};
    const alive = (view.players ?? []).filter((player) => player.alive).length;
    const session = view.session ?? {};
    const modeBadge =
      session.mode === "online"
        ? html`<span class="badge badge--town">${icon("wifi", { size: 10 })} онлайн</span>`
        : session.mode === "lan"
          ? html`<span class="badge badge--town">${icon("monitor", { size: 10 })} по IP</span>`
          : session.spectatorOnly
            ? html`<span class="badge badge--violet">${icon("eye", { size: 10 })} наблюдение</span>`
            : session.mode === "local"
              ? html`<span class="badge badge--muted">${icon("monitor", { size: 10 })} это устройство</span>`
              : html`<span class="badge badge--muted">${icon("bot", { size: 10 })} тренировка</span>`;
    const spectatorControls = session.spectatorOnly
      ? html`<div class="hud-speed" role="group" aria-label="Темп игры">
          ${[1, 2, 4].map(
            (speed) => html`<button
              class="hud-speed__btn ${Number(session.speed) === speed ? "is-active" : ""}"
              type="button"
              data-game-speed="${speed}"
              aria-pressed="${Number(session.speed) === speed ? "true" : "false"}"
            >${speed}×</button>`,
          )}
          <button class="hud-speed__btn hud-speed__btn--pause ${session.paused ? "is-active" : ""}" type="button" data-game-pause aria-pressed="${session.paused ? "true" : "false"}">
            ${icon(session.paused ? "play" : "pause", { size: 13 })}
          </button>
        </div>`
      : "";

    mountStable(
      node,
      html`<div class="hud hud--${info.tone}">
        <div class="hud__main">
          <span class="hud__icon">${icon(info.icon, { size: 24 })}</span>
          <div class="hud__copy">
            <span class="eyebrow">${info.kicker}</span>
            <h1 class="hud__title">${info.label}</h1>
            <p class="hud__hint">${info.hint}</p>
          </div>
        </div>
        <div class="hud__timer" data-game-timer>
          <div class="timer-ring" aria-hidden="true">
            <span class="timer-ring__inner" data-game-time>—</span>
          </div>
          <span class="hud__timer-label" data-game-timer-label>${view.phaseEndsAt ? "до фазы" : "без таймера"}</span>
        </div>
        <div class="hud__meta">
          <div class="row wrap hud__badges">
            ${modeBadge}
            ${view.spectator
              ? html`<span class="badge badge--violet">${icon("eye", { size: 10 })} зритель</span>`
              : html`<span class="badge ${self.alive ? "badge--town" : "badge--muted"}">${icon(self.alive ? "heart" : "skull", { size: 10 })} ${self.alive ? "жив" : "мёртв"}</span>`}
            <span class="badge">${icon("users", { size: 10 })} ${alive} живых</span>
            ${session.spectators ? html`<span class="badge badge--muted">${icon("eye", { size: 10 })} ${session.spectators}</span>` : ""}
            <span class="code-pill code-pill--sm">${view.roomCode}</span>
          </div>
          <div class="hud__actions">
            ${spectatorControls}
            <button class="btn btn--quiet btn--icon btn--sm" type="button" data-game-share aria-label="Поделиться комнатой" title="Поделиться">${icon("share", { size: 16 })}</button>
            <button class="btn btn--quiet btn--icon btn--sm" type="button" data-game-leave aria-label="Покинуть игру" title="Покинуть">${icon("logout", { size: 16 })}</button>
          </div>
        </div>
      </div>`,
    );
    updateTimer();
  }

  function updateTimer() {
    if (!view || !root()) return;
    const timerNode = qs("[data-game-timer]", root());
    const timeNode = qs("[data-game-time]", root());
    const labelNode = qs("[data-game-timer-label]", root());
    if (!timerNode || !timeNode) return;
    const session = app.session;
    const now = session?.estimatedNow?.() ?? Date.now();
    const endsAt = Number(view.phaseEndsAt) || 0;
    const startedAt = Number(view.phaseStartedAt) || 0;
    if (!endsAt) {
      timerNode.style.setProperty("--timer-progress", "0%");
      timeNode.textContent = view.phase === "ended" ? "—" : "∞";
      timeNode.classList.remove("is-urgent");
      if (labelNode) labelNode.textContent = view.phase === "ended" ? "финал" : "без таймера";
      return;
    }
    const remaining = Math.max(0, endsAt - now);
    const total = Math.max(1, Number(view.phaseDurationMs) || endsAt - startedAt);
    const progress = Math.max(0, Math.min(100, (remaining / total) * 100));
    timerNode.style.setProperty("--timer-progress", `${progress.toFixed(2)}%`);
    timeNode.textContent = formatClock(remaining);
    timeNode.classList.toggle("is-urgent", remaining > 0 && remaining <= 10000);
    if (labelNode) labelNode.textContent = session?.view?.session?.paused ? "пауза" : "до фазы";
  }

  // -----------------------------------------------------------------------
  // Phase spotlight
  // -----------------------------------------------------------------------

  function renderSpotlight() {
    const node = qs("[data-game-spotlight]", root());
    if (!node || !view) return;
    const lastNight = view.lastNight;
    if (view.phase === "dawn" && lastNight) {
      const deaths = lastNight.deaths ?? [];
      const byId = new Map((view.players ?? []).map((player) => [player.id, player]));
      mountStable(
        node,
        html`<div class="phase-banner phase-banner--dawn">
          <span class="phase-banner__icon">${icon(deaths.length ? "skull" : "sun", { size: 22 })}</span>
          <div class="phase-banner__body">
            <span class="eyebrow">Рассвет · день ${view.day}</span>
            <strong>${deaths.length ? `Ночью погибли: ${deaths.map((death) => death.name).join(", ")}` : "Ночь прошла без жертв"}</strong>
            <span class="phase-banner__text">
              ${lastNight.saved ? "Доктор успел спасти одного из горожан." : deaths.length ? "Город просыпается с новыми вопросами." : "Мафия промахнулась или город спал слишком тихо."}
            </span>
          </div>
          ${deaths.length
            ? html`<div class="phase-banner__people">
                ${deaths.map((death) => {
                  const player = byId.get(death.id);
                  return html`<span class="phase-banner__person">
                    ${avatar(player ?? { name: death.name }, { size: "xs", dead: true })}
                    <span>${death.name}</span>
                    ${player?.roleId ? roleChip(player.roleId) : ""}
                  </span>`;
                })}
              </div>`
            : ""}
        </div>`,
      );
      return;
    }

    if (view.phase === "verdict" && view.votes?.revealed) {
      const result = view.votes.revealed;
      mountStable(
        node,
        html`<div class="phase-banner phase-banner--verdict">
          <span class="phase-banner__icon">${icon("gavel", { size: 22 })}</span>
          <div class="phase-banner__body">
            <span class="eyebrow">Приговор</span>
            <strong>${result.eliminatedName ? `Город повесил ${result.eliminatedName}` : result.tie ? "Голоса разделились" : "Никто не повешен"}</strong>
            <span class="phase-banner__text">${result.topCount ? `Максимум: ${pluralVotes(result.topCount)} · проголосовали ${result.totalVoters}` : `Проголосовали ${result.totalVoters} из ${result.aliveCount}`}</span>
          </div>
          <div class="phase-banner__result">${voteBars(result, view.players)}</div>
        </div>`,
      );
      return;
    }

    if (view.phase === "lastWords" && view.lastWords) {
      mountStable(
        node,
        html`<div class="phase-banner phase-banner--last">
          <span class="phase-banner__icon">${icon("scroll", { size: 22 })}</span>
          <div class="phase-banner__body">
            <span class="eyebrow">Последнее слово</span>
            <strong>${view.lastWords.canSpeak ? "Город слушает вас" : `Говорит ${view.lastWords.name}`}</strong>
            <span class="phase-banner__text">
              ${view.lastWords.spoken ? "Последнее слово уже сказано. Петля затягивается." : view.lastWords.canSpeak ? "Одно сообщение в общий чат. Используйте его мудро." : "Он ещё может сказать последнее."}
            </span>
          </div>
        </div>`,
      );
      return;
    }

    if (view.phase === "ended" && view.winner) {
      mountStable(
        node,
        html`<div class="phase-banner phase-banner--end phase-banner--${view.winner.team}">
          <span class="phase-banner__icon">${icon(view.winner.team === "mafia" ? "blade" : view.winner.team === "neutral" ? "joker" : "crown", { size: 22 })}</span>
          <div class="phase-banner__body">
            <span class="eyebrow">Финал</span>
            <strong>${view.winner.title}</strong>
            <span class="phase-banner__text">${view.winner.subtitle}</span>
          </div>
          <button class="btn btn--gold-ghost btn--sm" type="button" data-game-end>${icon("scroll", { size: 14 })} Итоги</button>
        </div>`,
      );
      return;
    }

    mountStable(node, "");
  }

  // -----------------------------------------------------------------------
  // Players
  // -----------------------------------------------------------------------

  function signature() {
    if (!view) return "";
    const players = (view.players ?? [])
      .map((player) => `${player.id}:${player.alive ? 1 : 0}:${player.roleId ?? ""}:${player.voted ? 1 : 0}:${player.ready ? 1 : 0}:${player.connected === false ? 0 : 1}`)
      .join("|");
    return `${view.phase}:${view.phaseSerial}:${view.day}:${selected ?? ""}:${mode ?? ""}:${view.votes?.myVote ?? ""}:${players}`;
  }

  function renderPlayers(force = false) {
    if (!root() || !view) return;
    const next = signature();
    if (!force && next === playersSignature) return;
    playersSignature = next;
    const active = config();
    const options = new Set(active?.options ?? []);
    const blocked = new Set(active?.blocked ?? []);
    const queued = active?.queued;
    const isVoting = view.phase === "voting";
    const isNight = view.phase === "night";

    mountStable(
      qs("[data-game-players]", root()),
      html`${(view.players ?? []).map((player) => {
        const self = isSelf(view, player);
        const selectable = options.has(player.id) && !blocked.has(player.id);
        const isSelected = selected === player.id;
        const isQueued = queued === player.id;
        const role = visibleRole(player);
        const dead = !player.alive;
        const tags = [
          player.isBot ? "AI" : "",
          player.isHost ? "хост" : "",
          self ? "вы" : "",
          player.connected === false ? "offline" : "",
        ].filter(Boolean);
        return html`<button
          class="player-card ${dead ? "is-dead" : ""} ${self ? "is-self" : ""} ${selectable ? "is-targetable" : ""} ${isSelected ? "is-selected" : ""} ${isQueued ? "is-queued" : ""} ${blocked.has(player.id) ? "is-blocked" : ""}"
          type="button"
          data-game-player="${player.id}"
          aria-pressed="${isSelected ? "true" : "false"}"
          aria-label="${player.name}${dead ? ", мёртв" : ""}${selectable ? ", доступен как цель" : ""}"
          style="--player-color:${playerColor(player)}"
        >
          <span class="player-card__seat">${player.seat + 1}</span>
          <span class="player-card__avatar">
            ${avatar(player, { size: "md", dead, host: player.isHost, you: self })}
            ${dead ? html`<span class="player-card__skull">${icon("skull", { size: 14 })}</span>` : ""}
          </span>
          <span class="player-card__body">
            <span class="player-card__name truncate">${player.name}</span>
            <span class="player-card__sub">
              ${role ? roleChip(role.id) : html`<span class="player-card__muted">${isNight ? "спит" : "роль скрыта"}</span>`}
            </span>
            <span class="player-card__tags">
              ${tags.map((tag) => html`<span class="player-card__tag">${tag}</span>`)}
              ${isVoting && player.voted ? html`<span class="player-card__tag player-card__tag--vote">${icon("vote", { size: 10 })} голос</span>` : ""}
              ${isQueued ? html`<span class="player-card__tag player-card__tag--queued">${icon("check", { size: 10 })} выбрано</span>` : ""}
            </span>
          </span>
          <span class="player-card__mark">
            ${isSelected ? icon("target", { size: 18 }) : selectable ? icon("plus", { size: 15 }) : blocked.has(player.id) ? icon("lock", { size: 14 }) : ""}
          </span>
        </button>`;
      })}`,
    );
    const count = qs("[data-game-count]", root());
    if (count) {
      const alive = (view.players ?? []).filter((player) => player.alive).length;
      count.textContent = `${playersLabel(alive)} живых из ${view.players.length}`;
    }
  }

  // -----------------------------------------------------------------------
  // Action dock
  // -----------------------------------------------------------------------

  function actionIcon(action, size = 20) {
    const map = {
      heal: "heart",
      check: "search",
      contract: "blade",
      drink: "coffee",
      block: "music",
      puppet: "key",
      reveal: "eye",
      judge: "gavel",
      guard: "shield",
      cure: "heart",
      vote: "vote",
      kill: "target",
    };
    return icon(map[action] ?? "target", { size });
  }

  function dayActionButtons() {
    const day = view?.dayActions;
    if (!day || !view?.self?.alive) return "";
    const items = [];
    if (day.spy?.available) {
      items.push(html`<button class="action-toggle__btn ${mode === "reveal" ? "is-active" : ""}" type="button" data-game-mode="reveal">
        ${icon("eye", { size: 13 })} Узнать роль
      </button>`);
    }
    if (day.judge?.available) {
      items.push(html`<button class="action-toggle__btn ${mode === "judge" ? "is-active" : ""}" type="button" data-game-mode="judge">
        ${icon("gavel", { size: 13 })} Приговор
      </button>`);
    }
    if (day.bodyguard?.available) {
      items.push(html`<button class="action-toggle__btn ${mode === "guard" ? "is-active" : ""}" type="button" data-game-mode="guard">
        ${icon("shield", { size: 13 })} Защитить
      </button>`);
    }
    if (day.cure?.available) {
      items.push(html`<button class="action-toggle__btn ${mode === "cure" ? "is-active" : ""}" type="button" data-game-mode="cure">
        ${icon("heart", { size: 13 })} Излечить · ${day.cure.left}
      </button>`);
    }
    if (!items.length) return "";
    return html`<div class="action-toggle" role="group" aria-label="Дневное действие">${items}</div>`;
  }

  function renderActions() {
    const node = qs("[data-game-actions]", root());
    if (!node || !view) return;
    const self = view.self ?? {};
    const active = config();
    const action = view.night?.action;

    if (view.spectator) {
      mountStable(
        node,
        html`<section class="action-dock action-dock--spectator">
          <div class="action-dock__icon">${icon("eye", { size: 20 })}</div>
          <div class="action-dock__copy">
            <strong>Наблюдение</strong>
            <span>Все роли открыты. Вы можете ускорять время и ставить игру на паузу.</span>
          </div>
          <div class="action-dock__side">
            <span class="badge badge--violet">${icon("bot", { size: 10 })} ИИ-город</span>
          </div>
        </section>`,
      );
      return;
    }

    if (view.phase === "ended") {
      mountStable(
        node,
        html`<section class="action-dock action-dock--end">
          <div class="action-dock__icon">${icon("crown", { size: 20 })}</div>
          <div class="action-dock__copy">
            <strong>${view.winner?.title ?? "Игра окончена"}</strong>
            <span>${view.winner?.subtitle ?? "Город дописал свою историю."}</span>
          </div>
          <div class="action-dock__side">
            <button class="btn btn--primary btn--sm" type="button" data-game-end>${icon("scroll", { size: 15 })} Итоги</button>
            ${view.isHost ? html`<button class="btn btn--gold-ghost btn--sm" type="button" data-game-rematch>${icon("refresh", { size: 15 })} Ещё раз</button>` : ""}
          </div>
        </section>`,
      );
      return;
    }

    if (view.phase === "voting") {
      const myVote = view.votes?.myVote;
      const votedName = myVote && myVote !== "skip" ? targetName(view, myVote) : null;
      const blocked = Boolean(view.dayActions?.blocked);
      const drunk = Boolean(self.drunk);
      const cannotVote = blocked || drunk;
      mountStable(
        node,
        html`<section class="action-dock action-dock--vote ${!self.alive ? "is-disabled" : ""}">
          <div class="action-dock__icon">${icon("vote", { size: 20 })}</div>
          <div class="action-dock__copy">
            <strong>${self.alive ? (cannotVote ? "Голос заблокирован" : "Голосование") : "Мёртвые не голосуют"}</strong>
            <span>
              ${myVote
                ? myVote === "skip"
                  ? "Вы пропустили голосование."
                  : `Ваш голос: ${votedName}. Голос уже нельзя изменить.`
                : self.alive
                  ? drunk
                    ? "Вы слишком пьяны, чтобы голосовать. Бармен постарался."
                    : blocked
                      ? "Музыкант играл всю ночь: сегодня вы не голосуете."
                      : ACTION_HINT.vote
                  : "Город решает без вас. Слушайте и запоминайте."}
            </span>
          </div>
          <div class="action-dock__side">
            ${dayActionButtons()}
            <span class="badge badge--muted">${view.votes?.allVoted ? "все голоса" : `${view.votes?.votedIds?.length ?? 0}/${view.votes?.totalAlive ?? 0}`}</span>
            ${self.alive && !myVote && !cannotVote
              ? html`<button class="btn btn--ghost btn--sm" type="button" data-game-skip>${icon("coffee", { size: 15 })} Пропустить</button>`
              : ""}
          </div>
        </section>`,
      );
      return;
    }

    if (view.phase === "night") {
      if (!self.alive) {
        mountStable(
          node,
          html`<section class="action-dock action-dock--dead">
            <div class="action-dock__icon">${icon("skull", { size: 20 })}</div>
            <div class="action-dock__copy"><strong>Вы мертвы</strong><span>Ночь проходит без вас. Наблюдайте, слушайте, запоминайте.</span></div>
          </section>`,
        );
        return;
      }
      if (!action) {
        mountStable(
          node,
          html`<section class="action-dock action-dock--sleep">
            <div class="action-dock__icon">${icon("moon", { size: 20 })}</div>
            <div class="action-dock__copy"><strong>Ночь ${view.day}</strong><span>У вашей роли нет ночного действия. Отдохните и доживите до утра.</span></div>
          </section>`,
        );
        return;
      }
      const contract = view.night?.contract;
      const showContract = view.self?.roleId === "assassin";
      const selectedName = active?.queued ? targetName(view, active.queued) : null;
      const puppetName = action.type === "puppet" && action.chosenTargetId ? targetName(view, action.chosenTargetId) : null;
      mountStable(
        node,
        html`<section class="action-dock action-dock--night">
          <div class="action-dock__icon">${actionIcon(action.type)}</div>
          <div class="action-dock__copy">
            <strong>${ACTION_LABEL[active?.action] ?? "Ночь"}</strong>
            <span>
              ${ACTION_HINT[active?.action] ?? "Город спит."}
              ${puppetName
                ? `Марионетка: ${puppetName}.`
                : selectedName
                  ? `Цель: ${selectedName}.`
                  : active?.options?.length
                    ? "Выберите цель на карте."
                    : "Выбор уже сделан."}
            </span>
          </div>
          <div class="action-dock__side">
            ${showContract
              ? html`<div class="action-toggle" role="group" aria-label="Тип действия">
                  <button class="action-toggle__btn ${mode !== "contract" ? "is-active" : ""}" type="button" data-game-mode="kill">${icon("blade", { size: 13 })} Убийство</button>
                  <button class="action-toggle__btn ${mode === "contract" ? "is-active" : ""}" type="button" data-game-mode="contract" ${contract?.available ? "" : "disabled"} title="${contract?.used ? "Контракт уже использован" : contract?.available ? "Доступен со 2-й ночи" : "Недоступен"}">
                    ${icon("target", { size: 13 })} Контракт${contract?.used ? " · использован" : ""}
                  </button>
                </div>`
              : ""}
            ${action.selected || puppetName
              ? html`<span class="badge badge--town">${icon("check", { size: 10 })} действие принято</span>`
              : html`<span class="badge badge--muted">${icon("clock", { size: 10 })} ждём выбора</span>`}
          </div>
        </section>`,
      );
      return;
    }

    if (view.phase === "lastWords") {
      mountStable(
        node,
        html`<section class="action-dock action-dock--last">
          <div class="action-dock__icon">${icon("scroll", { size: 20 })}</div>
          <div class="action-dock__copy">
            <strong>${view.lastWords?.canSpeak ? "Ваше последнее слово" : `Последнее слово: ${view.lastWords?.name ?? "—"}`}</strong>
            <span>${view.lastWords?.spoken ? "Слово сказано. Город запомнит." : view.lastWords?.canSpeak ? "Напишите одно сообщение в общий чат." : "Осталось несколько секунд тишины."}</span>
          </div>
        </section>`,
      );
      return;
    }

    if (view.phase === "dawn" || view.phase === "verdict") {
      mountStable(
        node,
        html`<section class="action-dock action-dock--wait">
          <div class="action-dock__icon">${icon("clock", { size: 20 })}</div>
          <div class="action-dock__copy"><strong>${view.phase === "dawn" ? "Город просыпается" : "Приговор объявлен"}</strong><span>Следующая фаза начнётся автоматически.</span></div>
        </section>`,
      );
      return;
    }

    const dayBlocked = Boolean(view.dayActions?.blocked);
    const drunk = Boolean(self.drunk);
    mountStable(
      node,
      html`<section class="action-dock action-dock--day">
        <div class="action-dock__icon">${icon(drunk ? "coffee" : dayBlocked ? "lock" : "chat", { size: 20 })}</div>
        <div class="action-dock__copy">
          <strong>${drunk ? "Вы пьяны" : dayBlocked ? "Действия заблокированы" : "Обсуждение"}</strong>
          <span>
            ${drunk
              ? "Бармен постарался: сегодня город услышит от вас только бессмысленные символы."
              : dayBlocked
                ? "Музыкант играл всю ночь. Сегодня вы не голосуете и не используете способности."
                : "Слушайте, задавайте вопросы и ищите несостыковки. Голосование начнётся по таймеру."}
          </span>
        </div>
        <div class="action-dock__side">
          ${dayActionButtons()}
          <span class="badge badge--muted">${view.votes?.totalAlive ?? 0} живых</span>
        </div>
      </section>`,
    );
  }

  // -----------------------------------------------------------------------
  // Role, notes, log
  // -----------------------------------------------------------------------

  function renderRole() {
    const node = qs("[data-game-role]", root());
    if (!node || !view) return;
    const self = view.self ?? {};
    if (view.spectator) {
      mountStable(
        node,
        html`<div class="role-panel role-panel--spectator">
          <div class="role-panel__head">
            <span class="role-art role-art--md"><img src="${asset("assets/img/brand/icon-192.png")}" alt="" width="192" height="192" /></span>
            <div>
              <span class="eyebrow">Режим наблюдателя</span>
              <h2 class="role-panel__name">Весь город как на ладони</h2>
              <p class="muted">Роли открыты. Вы не участвуете в голосованиях и не пишете в чат.</p>
            </div>
          </div>
        </div>`,
      );
      return;
    }
    const role = self.roleId ? ROLES[self.roleId] : null;
    if (!role) {
      mountStable(node, html`<div class="role-panel role-panel--empty"><p class="muted">Роль появится после старта.</p></div>`);
      return;
    }
    const team = TEAMS[role.team];
    mountStable(
      node,
      html`<div class="role-panel" style="--role-color:${role.color};--team-color:${team?.color ?? role.color}">
        <div class="role-panel__head">
          ${roleArt(role.id, { size: "md" })}
          <div class="role-panel__copy">
            <span class="eyebrow">${self.alive ? "Ваша роль" : "Ваша роль · вы мертвы"}</span>
            <h2 class="role-panel__name">${role.name}</h2>
            <div class="row wrap">${teamChip(role.team)} ${self.alive ? "" : html`<span class="badge badge--muted">${icon("skull", { size: 10 })} мёртв</span>`}</div>
          </div>
          <button class="icon-btn role-panel__info" type="button" data-game-role-info aria-label="Описание роли">${icon("info", { size: 17 })}</button>
        </div>
        <p class="role-panel__short">${role.short}</p>
        <div class="role-panel__facts">
          <span>${icon("moon", { size: 13 })} ${role.night ? "ночная роль" : "дневная роль"}</span>
          <span>${icon("target", { size: 13 })} победа: ${team?.short?.toLowerCase() ?? "город"}</span>
          ${self.roleId === "assassin"
            ? html`<span class="${self.contractUsed ? "muted" : "gold"}">${icon("blade", { size: 13 })} контракт ${self.contractUsed ? "использован" : "готов"}</span>`
            : ""}
          ${self.roleId === "doctor"
            ? html`<span>${icon("heart", { size: 13 })} самолечение ${self.selfHeals ? "использовано" : "доступно"}</span>`
            : ""}
          ${self.roleId === "judge"
            ? html`<span class="${self.judgeUsed ? "muted" : "gold"}">${icon("gavel", { size: 13 })} приговор ${self.judgeUsed ? "вынесен" : "готов"}</span>`
            : ""}
          ${self.roleId === "spy"
            ? html`<span>${icon("eye", { size: 13 })} днём ${view.dayActions?.spy?.usedToday ? "роль уже узнана" : "можно узнать роль"}</span>`
            : ""}
          ${self.roleId === "puppeteer"
            ? html`<span>${icon("key", { size: 13 })} марионетка ${self.puppetTargetName ? `— ${self.puppetTargetName}` : "не выбрана"}</span>`
            : ""}
        </div>
        ${self.drunk ? html`<p class="notice notice--town">${icon("coffee", { size: 14 })} Вы пьяны: сегодня ваши сообщения превращаются в символы.</p>` : ""}
        ${self.blocked ? html`<p class="notice notice--danger">${icon("music", { size: 14 })} Музыкант заблокировал ваши действия и голос на сегодня.</p>` : ""}
        ${self.muted ? html`<p class="notice notice--danger">${icon("lock", { size: 14 })} Вы заглушены хостом до конца игры.</p>` : ""}
      </div>`,
    );
  }

  function renderNotes() {
    const node = qs("[data-game-notes]", root());
    if (!node || !view) return;
    const self = view.self ?? {};
    const notes = self.notes ?? [];
    const investigations = self.investigations ?? [];
    if (!notes.length && !investigations.length) {
      mountStable(node, html`<p class="game-empty">${icon("edit", { size: 17 })}<span>${view.spectator ? "Наблюдателям записи не нужны — роли уже открыты." : "Здесь появятся проверки шерифа, лечение доктора и другие личные заметки."}</span></p>`);
      return;
    }
    mountStable(
      node,
      html`${investigations.length
        ? html`<div class="notes-block">
            <span class="notes-block__label">${icon("search", { size: 12 })} Проверки</span>
            ${investigations.map(
              (entry) => html`<div class="note-row note-row--${entry.result === "mafia" ? "danger" : "town"}">
                <span>${entry.name}</span>
                <span class="badge ${entry.result === "mafia" ? "badge--danger" : "badge--town"}">${entry.result === "mafia" ? "мафия" : "не мафия"}</span>
                <time>${entry.day ? `д. ${entry.day}` : ""}</time>
              </div>`,
            )}
          </div>`
        : ""}
      ${notes.length
        ? html`<div class="notes-block">
            <span class="notes-block__label">${icon("edit", { size: 12 })} Заметки</span>
            ${notes.map(
              (note) => html`<div class="note-row note-row--${note.tone ?? "muted"}">
                <span>${note.text}</span>
                <time>${note.day ? `д. ${note.day}` : ""}</time>
              </div>`,
            )}
          </div>`
        : ""}`,
    );
  }

  function renderLog() {
    const node = qs("[data-game-log]", root());
    if (!node || !view) return;
    const entries = (view.log ?? []).slice(-14);
    if (!entries.length) {
      mountStable(node, html`<p class="game-empty">${icon("scroll", { size: 17 })}<span>Хроника начнётся с первым событием.</span></p>`);
      return;
    }
    mountStable(
      node,
      html`${entries.map(
        (entry) => html`<div class="log-row log-row--${entry.tone ?? "muted"}">
          <span class="log-row__dot"></span>
          <span class="log-row__text">${entry.text}</span>
          <time class="log-row__time">${entry.day ? `д.${entry.day}` : ""} ${formatShortTime(entry.at)}</time>
        </div>`,
      )}`,
    );
    node.scrollTop = node.scrollHeight;
  }

  // -----------------------------------------------------------------------
  // Target bar
  // -----------------------------------------------------------------------

  function renderTargetBar() {
    const node = qs("[data-game-target-bar]", root());
    if (!node || !view) return;
    const active = config();
    if (!active || !selected || !active.options.includes(selected)) {
      mountStable(node, "");
      node.classList.add("is-empty");
      return;
    }
    const player = (view.players ?? []).find((entry) => entry.id === selected);
    if (!player) {
      selected = null;
      mountStable(node, "");
      node.classList.add("is-empty");
      return;
    }
    node.classList.remove("is-empty");
    mountStable(
      node,
      html`<div class="target-bar__inner">
        ${avatar(player, { size: "sm", dead: !player.alive })}
        <div class="target-bar__copy">
          <span class="target-bar__label">${ACTION_LABEL[active.action] ?? "Действие"}</span>
          <strong class="truncate">${player.name}</strong>
        </div>
        <div class="target-bar__actions">
          <button class="btn btn--quiet btn--sm" type="button" data-game-cancel>Отмена</button>
          <button class="btn btn--primary btn--sm" type="button" data-game-confirm>
            ${actionIcon(active.action, 15)}
            ${active.action === "vote" ? "Подтвердить голос" : active.action === "judge" ? "Вынести приговор" : "Подтвердить"}
          </button>
        </div>
      </div>`,
    );
  }

  // -----------------------------------------------------------------------
  // End modal
  // -----------------------------------------------------------------------

  function showEndModal(nextView = view) {
    if (!nextView?.winner) return;
    const key = endKey(nextView);
    if (!key) return;
    shownEnd = key;
    const winner = nextView.winner;
    const mvp = (nextView.players ?? []).find((player) => player.id === winner.mvpId);
    const sorted = [...(nextView.players ?? [])].sort((a, b) => a.seat - b.seat);
    const self = nextView.self ?? {};
    const title = winner.title;
    const tone = resultTone(nextView);
    const handle = openModal({
      title,
      subtitle: `${winner.subtitle} · ${playersLabel((nextView.players ?? []).length)} · ${dayLabel(nextView.day)}`,
      wide: true,
      className: `modal--end modal--end-${winner.team}`,
      body: html`<div class="end-modal">
        <div class="end-hero end-hero--${winner.team}">
          <span class="end-hero__icon">${icon(winner.team === "mafia" ? "blade" : winner.team === "neutral" ? "joker" : "crown", { size: 32 })}</span>
          <div>
            <span class="eyebrow">${winner.teamName}</span>
            <h3>${winner.title}</h3>
            <p>${winner.subtitle}</p>
          </div>
        </div>
        ${mvp
          ? html`<div class="mvp-card">
              ${avatar(mvp, { size: "lg", dead: mvp.alive === false })}
              <div>
                <span class="eyebrow">${icon("star", { size: 12 })} MVP города</span>
                <strong>${mvp.name}</strong>
                <span class="muted">${mvp.roleId ? ROLES[mvp.roleId]?.name : "роль скрыта"} · ${mvp.alive ? "выжил" : "погиб"}</span>
              </div>
              <span class="mvp-card__mark">${icon("crown", { size: 20 })}</span>
            </div>`
          : ""}
        <div class="end-roles">
          <div class="end-roles__head">
            <span class="field__label">Роли города</span>
            <span class="muted">${nextView.spectator ? "наблюдение" : (winner.winnerIds ?? []).includes(nextView.selfId) ? "победа" : "проигрыш"}</span>
          </div>
          ${sorted.map(
            (player) => {
              const won = (winner.winnerIds ?? []).includes(player.id);
              return html`<div class="end-role-row ${player.alive ? "" : "is-dead"} ${player.id === winner.mvpId ? "is-mvp" : ""} ${player.id === nextView.selfId ? "is-self" : ""}">
                ${avatar(player, { size: "xs", dead: player.alive === false })}
                <span class="end-role-row__name truncate">${player.name}${player.id === nextView.selfId ? " · вы" : ""}${player.id === winner.mvpId ? " · MVP" : ""}</span>
                ${player.roleId ? roleChip(player.roleId) : html`<span class="badge badge--muted">роль скрыта</span>`}
                <span class="end-role-row__state ${won ? "is-win" : "is-loss"}">${player.alive ? "жив" : "мёртв"} · ${won ? "победа" : "проигрыш"}</span>
              </div>`;
            },
          )}
        </div>
        <p class="end-note">${icon("shield", { size: 14 })} <span>Итоги живут только в памяти комнаты. Чат и роли не сохраняются на сервере.</span></p>
      </div>`,
      footer: html`<button class="btn btn--quiet btn--sm" type="button" data-game-copy-result>${icon("copy", { size: 14 })} Копировать итоги</button>
        <button class="btn btn--ghost" type="button" data-game-leave>Выйти</button>
        ${nextView.isHost
          ? html`<button class="btn btn--primary" type="button" data-game-rematch>${icon("refresh", { size: 16 })} Ещё раз</button>`
          : html`<span class="end-wait">${icon("clock", { size: 14 })} Ждём хоста</span>`}`,
    });
    endModal = handle;
    handle?.footer?.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("[data-game-rematch]")) {
        closeModal("rematch");
        app.rematch();
        return;
      }
      if (target.closest("[data-game-leave]")) {
        closeModal("leave");
        void app.leaveSession({ go: "/" });
        return;
      }
      if (target.closest("[data-game-copy-result]")) {
        app.copyText(nextView.winner?.summary ?? nextView.winner?.title ?? "", "Итоги скопированы.");
      }
    });
    if (handle) {
      const close = handle.close;
      handle.close = ((original) => (reason) => {
        if (endModal === handle) endModal = null;
        original(reason);
      })(close);
    }
    if (tone === "win") app.playSfx("win");
    else if (tone === "lose") app.playSfx("lose");
    else if (winner.team === "neutral") app.playSfx("jester");
    else app.playSfx("win");
  }

  function maybeRevealRole() {
    if (!view || view.spectator || !view.self?.roleId) return;
    if (!view.startedAt || revealedStart === view.startedAt) return;
    revealedStart = view.startedAt;
    const role = ROLES[view.self.roleId];
    if (!role) return;
    const teammates = role.team === "mafia"
      ? (view.players ?? []).filter((player) => player.id !== view.selfId && player.team === "mafia")
      : [];
    openModal({
      title: role.name,
      subtitle: `Ваша роль · ${TEAMS[role.team]?.name ?? "город"}`,
      role: true,
      className: "modal--reveal",
      body: html`<div class="role-reveal">
        <p class="role-reveal__lead">${icon("eye", { size: 16 })} Запомните: эту карточку видите только вы.</p>
        ${roleModalBody(role.id)}
        ${teammates.length
          ? html`<div class="role-reveal__team">
              <span class="role-detail__label">Ваша команда</span>
              <div class="role-reveal__people">
                ${teammates.map((player) => html`<span class="role-reveal__person">${avatar(player, { size: "xs" })}<span>${player.name}</span>${player.roleId ? roleChip(player.roleId) : ""}</span>`)}
              </div>
            </div>`
          : ""}
      </div>`,
      footer: html`<button class="btn btn--primary" type="button" data-modal-close>${icon("play", { size: 15 })} Начать ночь</button>`,
    });
    app.playSfx("start");
  }

  // -----------------------------------------------------------------------
  // Update + events
  // -----------------------------------------------------------------------

  function update(nextView, { force = false } = {}) {
    if (!nextView) return;
    const previous = view;
    view = nextView;
    const signature = viewSignatureOf(view);
    // Hosts and guests receive a state payload every few seconds even when
    // nothing changed. Re-mounting the panels restarts their entry animations,
    // which read as flicker, so identical views are ignored.
    if (!force && signature === viewSignature) return;
    viewSignature = signature;
    if (previous && previous.phaseSerial !== view.phaseSerial) {
      selected = null;
      if (mode === "contract" && !view.night?.contract?.available) mode = null;
      if (mode === "reveal" && !view.dayActions?.spy?.available) mode = null;
      if (mode === "judge" && !view.dayActions?.judge?.available) mode = null;
      if (mode === "guard" && !view.dayActions?.bodyguard?.available) mode = null;
      if (mode === "cure" && !view.dayActions?.cure?.available) mode = null;
      if (mode === "drink" || mode === "block" || mode === "puppet") mode = null;
      playersSignature = "";
    }
    if (lastPhaseSerial === null) lastPhaseSerial = view.phaseSerial;
    if (lastStartedAt === null) lastStartedAt = view.startedAt;
    if (previous && previous.phaseSerial !== view.phaseSerial) {
      if (view.phase === "night") app.playSfx("night");
      else if (view.phase === "dawn") app.playSfx(view.lastNight?.deaths?.length ? "death" : "dawn");
      else if (view.phase === "voting") app.playSfx("gavel");
      else if (view.phase === "verdict") app.playSfx("gavel");
      else if (view.phase === "lastWords") app.playSfx("back");
    }
    if (!previous) lastChatSeq = Math.max(0, ...(view.chat ?? []).map((message) => message.seq ?? 0));
    const maxChat = Math.max(0, ...(view.chat ?? []).map((message) => message.seq ?? 0));
    if (previous && maxChat > lastChatSeq) {
      const fresh = (view.chat ?? []).filter((message) => message.seq > lastChatSeq && message.playerId !== view.selfId);
      if (fresh.length && Date.now() - lastMessageSfx > 1600) {
        lastMessageSfx = Date.now();
        app.playSfx("message");
      }
    }
    lastChatSeq = Math.max(lastChatSeq, maxChat);

    if (playersSignature && (previous?.phase !== view.phase || previous?.phaseSerial !== view.phaseSerial)) playersSignature = "";
    renderHud();
    renderSpotlight();
    renderPlayers(force);
    renderActions();
    renderRole();
    renderNotes();
    renderLog();
    renderTargetBar();
    chat?.update(view, { force });

    const meta = qs("[data-game-chat-meta]", root());
    if (meta) {
      const writable = Array.isArray(view.self?.chatWriteChannels) ? view.self.chatWriteChannels.length > 0 : view.self?.canChat;
      meta.textContent = view.spectator
        ? "наблюдение"
        : writable
          ? (view.self.chatCount != null ? `${view.self.chatCount}/${view.self.chatLimit} за 10 с` : "")
          : view.self?.chatChannels?.length
            ? "только чтение"
            : "чат закрыт";
    }

    maybeRevealRole();
    if (view.winner && shownEnd !== endKey(view)) showEndModal(view);
    const session = view.session;
    if (session) {
      const phaseForAudio = view.phase === "lobby" ? "lobby" : view.phase;
      app.setAudioScene?.(phaseForAudio);
    }
  }

  const screen = {
    title: "Игра",
    html: htmlScreen,
    update,
    mount(rootNode) {
      rootRef = rootNode;
      chat = createChat({
        view,
        onSend: (payload) => app.sendChat(payload),
        getTargets,
        emptyText: "Город пока молчит. Скажите первое слово.",
      });
      chat.mountInto(qs("[data-game-chat]", rootNode));
      update(view, { force: true });
      timer = setInterval(updateTimer, 250);

      // `#screen` outlives a single game, so the listener is removed in
      // destroy(). Otherwise every rematch leaves a stale handler behind and
      // one tap produces N toasts.
      clickHandler = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const speed = target.closest("[data-game-speed]");
        if (speed) {
          app.setSpeed(Number(speed.dataset.gameSpeed) || 1);
          return;
        }
        if (target.closest("[data-game-pause]")) {
          app.setPaused(!view?.session?.paused);
          return;
        }
        if (target.closest("[data-game-end]")) {
          showEndModal();
          return;
        }
        if (target.closest("[data-game-rematch]")) {
          app.rematch();
          return;
        }
        if (target.closest("[data-game-share]")) {
          app.openShare();
          return;
        }
        if (target.closest("[data-game-leave]")) {
          void app.leaveSession({ go: "/" });
          return;
        }
        if (target.closest("[data-game-role-info]")) {
          if (view?.self?.roleId) {
            openModal({
              title: ROLES[view.self.roleId]?.name ?? "Роль",
              subtitle: "Ваша роль в этой партии",
              role: true,
              body: roleModalBody(view.self.roleId),
              footer: html`<button class="btn btn--primary" type="button" data-modal-close>Понятно</button>`,
            });
          }
          return;
        }
        const modeButton = target.closest("[data-game-mode]");
        if (modeButton) {
          const nextMode = modeButton.dataset.gameMode;
          if (nextMode === "contract" && !view?.night?.contract?.available) return;
          if (nextMode === "reveal" && !view?.dayActions?.spy?.available) return;
          if (nextMode === "judge" && !view?.dayActions?.judge?.available) return;
          if (nextMode === "guard" && !view?.dayActions?.bodyguard?.available) return;
          mode = nextMode === "kill" || nextMode === "vote" ? null : nextMode;
          selected = null;
          app.playSfx("select");
          playersSignature = "";
          renderActions();
          renderPlayers(true);
          renderTargetBar();
          return;
        }
        if (target.closest("[data-game-skip]")) {
          app.vote("skip");
          return;
        }
        if (target.closest("[data-game-cancel]")) {
          selected = null;
          app.playSfx("back");
          renderPlayers(true);
          renderTargetBar();
          return;
        }
        if (target.closest("[data-game-confirm]")) {
          const active = config();
          if (!active || !selected) return;
          const targetId = selected;
          const run = () => {
            const result = active.action === "vote"
              ? app.vote(targetId)
              : active.kind === "day"
                ? app.dayAction(active.action, targetId)
                : app.nightAction(active.action, targetId);
            if (result?.ok !== false) {
              app.playSfx(active.action === "vote" ? "vote" : "select");
              selected = null;
              if (active.kind === "day") mode = null;
              renderActions();
              renderPlayers(true);
              renderTargetBar();
              app.toast(
                active.action === "vote"
                  ? "Голос учтён."
                  : active.action === "reveal"
                    ? "Роль известна. Запись добавлена."
                    : active.action === "judge"
                      ? "Приговор вынесен."
                      : "Действие принято.",
                { tone: "town" },
              );
            } else if (result?.error) {
              app.toast(result.error, { tone: "warn" });
            }
          };
          if (active.action === "judge") {
            confirmModal({
              title: `Приговор: ${targetName(view, targetId)}?`,
              message: "Если это мафия — погибнет цель. Если нет — погибнете вы. Отменить приговор будет нельзя.",
              confirmLabel: "Вынести приговор",
              cancelLabel: "Отмена",
              tone: "danger",
            }).then((confirmed) => {
              if (confirmed) run();
            });
          } else {
            run();
          }
          return;
        }
        const playerButton = target.closest("[data-game-player]");
        if (playerButton) {
          const playerId = playerButton.dataset.gamePlayer;
          const active = config();
          const blocked = new Set(active?.blocked ?? []);
          if (active && active.options.includes(playerId) && !blocked.has(playerId)) {
            selected = selected === playerId ? null : playerId;
            app.playSfx(selected ? "select" : "back");
            renderPlayers(true);
            renderTargetBar();
            return;
          }
          const player = (view?.players ?? []).find((entry) => entry.id === playerId);
          if (player) {
            if (blocked.has(playerId)) {
              app.toast(playerId === view?.selfId ? "Себя можно спасти только один раз за игру." : "Этого игрока нельзя выбрать сейчас.", { tone: "warn" });
              return;
            }
            showPlayerModal(player, view);
          }
        }
      };
      rootNode.addEventListener("click", clickHandler);
    },
    destroy() {
      clearInterval(timer);
      timer = null;
      if (rootRef && clickHandler) rootRef.removeEventListener("click", clickHandler);
      clickHandler = null;
      if (endModal) {
        closeModal("route");
        endModal = null;
      }
      chat = null;
      rootRef = null;
    },
  };
  return screen;
}
