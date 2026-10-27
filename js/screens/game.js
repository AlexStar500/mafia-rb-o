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
import { openModal, closeModal } from "../ui/modal.js";
import { ROLES, TEAMS } from "../data/roles.js";
import { formatClock, formatShortTime, playersLabel, pluralRu } from "../core/format.js";
import { asset } from "../core/assets.js";

const ACTION_LABEL = Object.freeze({
  kill: "Убить",
  heal: "Лечить",
  check: "Проверить",
  contract: "Контракт",
  vote: "Повесить",
});

const ACTION_HINT = Object.freeze({
  kill: "Мафия выбирает жертву вместе. Голос команды учитывается при равенстве.",
  heal: "Лечение не повторяется две ночи подряд. Себя можно спасти один раз за игру.",
  check: "Результат проверки появится в ваших записях. Ассасин выглядит как мафия.",
  contract: "Контракт ассасина пробивает лечение доктора. Один раз за игру.",
  vote: "Один голос за фазу, без переголосования. Ничья означает, что никто не повешен.",
});

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
  if (view.phase === "voting") {
    if (view.spectator || !self.alive) return null;
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
    const modeBadge = session.mode === "online"
      ? html`<span class="badge badge--town">${icon("wifi", { size: 10 })} онлайн</span>`
      : session.spectatorOnly
        ? html`<span class="badge badge--violet">${icon("eye", { size: 10 })} наблюдение</span>`
        : session.mode === "local"
          ? html`<span class="badge badge--muted">${icon("monitor", { size: 10 })} порты</span>`
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

    mount(
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
      mount(
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
      mount(
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
      mount(
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
      mount(
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

    mount(node, "");
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

    mount(
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

  function renderActions() {
    const node = qs("[data-game-actions]", root());
    if (!node || !view) return;
    const self = view.self ?? {};
    const active = config();
    const action = view.night?.action;

    if (view.spectator) {
      mount(
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
      mount(
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
      mount(
        node,
        html`<section class="action-dock action-dock--vote ${!self.alive ? "is-disabled" : ""}">
          <div class="action-dock__icon">${icon("vote", { size: 20 })}</div>
          <div class="action-dock__copy">
            <strong>${self.alive ? "Голосование" : "Мёртвые не голосуют"}</strong>
            <span>
              ${myVote
                ? myVote === "skip"
                  ? "Вы пропустили голосование."
                  : `Ваш голос: ${votedName}. Голос уже нельзя изменить.`
                : self.alive
                  ? ACTION_HINT.vote
                  : "Город решает без вас. Слушайте и запоминайте."}
            </span>
          </div>
          <div class="action-dock__side">
            <span class="badge badge--muted">${view.votes?.allVoted ? "все голоса" : `${view.votes?.votedIds?.length ?? 0}/${view.votes?.totalAlive ?? 0}`}</span>
            ${self.alive && !myVote
              ? html`<button class="btn btn--ghost btn--sm" type="button" data-game-skip>${icon("coffee", { size: 15 })} Пропустить</button>`
              : ""}
          </div>
        </section>`,
      );
      return;
    }

    if (view.phase === "night") {
      if (!self.alive) {
        mount(
          node,
          html`<section class="action-dock action-dock--dead">
            <div class="action-dock__icon">${icon("skull", { size: 20 })}</div>
            <div class="action-dock__copy"><strong>Вы мертвы</strong><span>Ночь проходит без вас. Наблюдайте, слушайте, запоминайте.</span></div>
          </section>`,
        );
        return;
      }
      if (!action) {
        mount(
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
      mount(
        node,
        html`<section class="action-dock action-dock--night">
          <div class="action-dock__icon">${icon(action.type === "heal" ? "heart" : action.type === "check" ? "search" : action.type === "contract" ? "blade" : "target", { size: 20 })}</div>
          <div class="action-dock__copy">
            <strong>${ACTION_LABEL[active?.action] ?? "Ночь"}</strong>
            <span>${ACTION_HINT[active?.action] ?? "Город спит."} ${selectedName ? `Цель: ${selectedName}.` : "Выберите цель на карте."}</span>
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
            ${action.selected
              ? html`<span class="badge badge--town">${icon("check", { size: 10 })} действие принято</span>`
              : html`<span class="badge badge--muted">${icon("clock", { size: 10 })} ждём выбора</span>`}
          </div>
        </section>`,
      );
      return;
    }

    if (view.phase === "lastWords") {
      mount(
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
      mount(
        node,
        html`<section class="action-dock action-dock--wait">
          <div class="action-dock__icon">${icon("clock", { size: 20 })}</div>
          <div class="action-dock__copy"><strong>${view.phase === "dawn" ? "Город просыпается" : "Приговор объявлен"}</strong><span>Следующая фаза начнётся автоматически.</span></div>
        </section>`,
      );
      return;
    }

    mount(
      node,
      html`<section class="action-dock action-dock--day">
        <div class="action-dock__icon">${icon("chat", { size: 20 })}</div>
        <div class="action-dock__copy">
          <strong>Обсуждение</strong>
          <span>Слушайте, задавайте вопросы и ищите несостыковки. Голосование начнётся по таймеру.</span>
        </div>
        <div class="action-dock__side">
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
      mount(
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
      mount(node, html`<div class="role-panel role-panel--empty"><p class="muted">Роль появится после старта.</p></div>`);
      return;
    }
    const team = TEAMS[role.team];
    mount(
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
        </div>
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
      mount(node, html`<p class="game-empty">${icon("edit", { size: 17 })}<span>${view.spectator ? "Наблюдателям записи не нужны — роли уже открыты." : "Здесь появятся проверки шерифа, лечение доктора и другие личные заметки."}</span></p>`);
      return;
    }
    mount(
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
      mount(node, html`<p class="game-empty">${icon("scroll", { size: 17 })}<span>Хроника начнётся с первым событием.</span></p>`);
      return;
    }
    mount(
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
      mount(node, "");
      node.classList.add("is-empty");
      return;
    }
    const player = (view.players ?? []).find((entry) => entry.id === selected);
    if (!player) {
      selected = null;
      mount(node, "");
      node.classList.add("is-empty");
      return;
    }
    node.classList.remove("is-empty");
    mount(
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
            ${icon(active.action === "vote" ? "vote" : active.action === "heal" ? "heart" : active.action === "check" ? "search" : "target", { size: 15 })}
            ${active.action === "vote" ? "Подтвердить голос" : "Подтвердить"}
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
      subtitle: `${winner.subtitle} · ${playersLabel((nextView.players ?? []).length)} · ${nextView.day} ${pluralRu(nextView.day, ["день", "дня", "дней"])}`,
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
            <span class="muted">${nextView.spectator ? "наблюдение" : self.team === winner.team ? "ваша команда победила" : "ваша команда проиграла"}</span>
          </div>
          ${sorted.map(
            (player) => html`<div class="end-role-row ${player.alive ? "" : "is-dead"} ${player.id === winner.mvpId ? "is-mvp" : ""} ${player.id === nextView.selfId ? "is-self" : ""}">
              ${avatar(player, { size: "xs", dead: player.alive === false })}
              <span class="end-role-row__name truncate">${player.name}${player.id === nextView.selfId ? " · вы" : ""}${player.id === winner.mvpId ? " · MVP" : ""}</span>
              ${player.roleId ? roleChip(player.roleId) : html`<span class="badge badge--muted">роль скрыта</span>`}
              <span class="end-role-row__state">${player.alive ? "жив" : "мёртв"}</span>
            </div>`,
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
    if (previous && previous.phaseSerial !== view.phaseSerial) {
      selected = null;
      if (mode === "contract" && !view.night?.contract?.available) mode = null;
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

      rootNode.addEventListener("click", (event) => {
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
          mode = nextMode === "contract" ? "contract" : null;
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
          const result = active.action === "vote"
            ? app.vote(targetId)
            : app.nightAction(active.action, targetId);
          if (result?.ok !== false) {
            app.playSfx(active.action === "vote" ? "vote" : "select");
            selected = null;
            renderPlayers(true);
            renderTargetBar();
            app.toast(active.action === "vote" ? "Голос учтён." : "Действие принято.", { tone: "town" });
          } else if (result?.error) {
            app.toast(result.error, { tone: "warn" });
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
      });
    },
    destroy() {
      clearInterval(timer);
      timer = null;
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
