import { html, raw, esc } from "./dom.js";
import { icon } from "./icons.js";
import { openModal } from "./modal.js";
import { initials } from "../core/format.js";
import { asset } from "../core/assets.js";
import { BOT_BY_ID } from "../data/bots.js";
import { ROLES, TEAMS, getTeam } from "../data/roles.js";

const AVATAR_SIZES = new Set(["xs", "sm", "md", "lg", "xl", "2xl"]);

function safeBotId(player) {
  const candidate = player?.botId ?? player?.avatar;
  return typeof candidate === "string" && BOT_BY_ID[candidate] ? candidate : null;
}

export function avatarUrl(player) {
  const botId = safeBotId(player);
  return botId ? asset(`assets/img/bots/${botId}.png`) : "";
}

export function playerColor(player) {
  const color = String(player?.color ?? "");
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#d9b36c";
}

/**
 * Pixel-art portrait for bots, a coloured monogram for humans. All paths come
 * from a fixed allowlist, never from user input.
 */
export function avatar(
  player,
  { size = "md", dead = false, host = false, you = false, className = "", duplicateBadges = true } = {},
) {
  const person = player ?? { name: "?", color: "#d9b36c" };
  const sizeClass = AVATAR_SIZES.has(size) ? `avatar--${size}` : "avatar--md";
  const src = avatarUrl(person);
  const color = playerColor(person);
  const isDead = dead || person.alive === false;
  const label = `${person.name ?? "Игрок"}${isDead ? " — мёртв" : ""}`;
  return html`<span
    class="avatar ${sizeClass} ${isDead ? "avatar--dead" : ""} ${className}"
    style="--avatar-accent: ${color}"
    role="img"
    aria-label="${label}"
  >
    <span class="avatar__inner">
      ${src
        ? html`<img src="${src}" alt="" width="192" height="192" decoding="async" />`
        : html`<span class="avatar__monogram" aria-hidden="true">${initials(person.name)}</span>`}
    </span>
    ${host ? html`<span class="avatar__crown" title="Хост">${icon("crown", { size: 12 })}</span>` : ""}
    ${duplicateBadges && safeBotId(person) ? html`<span class="avatar__bot" aria-hidden="true">AI</span>` : ""}
    ${duplicateBadges && you ? html`<span class="avatar__you" aria-hidden="true">вы</span>` : ""}
  </span>`;
}

export function roleChip(roleId, { short = false, className = "" } = {}) {
  const role = ROLES[roleId];
  if (!role) return html`<span class="badge badge--muted ${className}">${icon("lock", { size: 10 })} роль скрыта</span>`;
  const team = getTeam(role.team);
  return html`<span
    class="badge badge--role ${className}"
    style="--role-color: ${role.color}; --role-glow: ${team?.glow ?? "transparent"}"
  >
    <img src="${asset(role.icon)}" alt="" width="18" height="18" />
    ${short ? role.name : role.name}
  </span>`;
}

export function teamChip(teamId, { className = "" } = {}) {
  const team = getTeam(teamId);
  if (!team) return html`<span class="badge badge--muted ${className}">?</span>`;
  return html`<span class="badge badge--team ${className}" style="--team-color: ${team.color}">${team.name}</span>`;
}

export function roleArt(roleId, { size = "md", className = "" } = {}) {
  const role = ROLES[roleId];
  if (!role) {
    return html`<span class="role-art role-art--unknown ${className}" aria-hidden="true">${icon("mask", { size: 32 })}</span>`;
  }
  return html`<span class="role-art role-art--${size} ${className}" style="--role-color: ${role.color}">
    <img src="${asset(role.icon)}" alt="" width="192" height="192" loading="lazy" decoding="async" />
  </span>`;
}

export function phaseInfo(phase, day = 0) {
  switch (phase) {
    case "lobby":
      return {
        label: "Лобби",
        kicker: "Сбор города",
        icon: "users",
        tone: "gold",
        hint: "Пригласите игроков или заполните комнату ботами.",
      };
    case "night":
      return {
        label: `Ночь ${day || 1}`,
        kicker: "Город спит",
        icon: "moon",
        tone: "night",
        hint: "Улицы пусты. Только шёпот и тени.",
      };
    case "dawn":
      return {
        label: `Рассвет ${day || 1}`,
        kicker: "День начинается",
        icon: "sun",
        tone: "dawn",
        hint: "Город узнаёт, кто не пережил ночь.",
      };
    case "discussion":
      return {
        label: `День ${day || 1}`,
        kicker: "Обсуждение",
        icon: "chat",
        tone: "day",
        hint: "Слушайте, спорьте, ищите несостыковки.",
      };
    case "voting":
      return {
        label: `День ${day || 1}`,
        kicker: "Голосование",
        icon: "vote",
        tone: "danger",
        hint: "Один голос. Никаких переголосований.",
      };
    case "verdict":
      return {
        label: "Приговор",
        kicker: "Город решил",
        icon: "skull",
        tone: "danger",
        hint: "Приговор вступает в силу немедленно.",
      };
    case "lastWords":
      return {
        label: "Последнее слово",
        kicker: "Петля и тишина",
        icon: "scroll",
        tone: "muted",
        hint: "У повешенного есть несколько секунд.",
      };
    case "ended":
      return {
        label: "Игра окончена",
        kicker: "Финал",
        icon: "crown",
        tone: "gold",
        hint: "История города дописана.",
      };
    default:
      return { label: "Игра", kicker: "Ночной город", icon: "mask", tone: "gold", hint: "" };
  }
}

export function phaseIcon(phase) {
  return phaseInfo(phase).icon;
}

export function emptyState({ iconName = "mask", title = "Пусто", text = "", action = null } = {}) {
  return html`<div class="empty">
    <span class="empty__icon">${icon(iconName, { size: 26 })}</span>
    <span class="empty__title">${title}</span>
    ${text ? html`<span class="empty__text">${text}</span>` : ""}
    ${action ?? ""}
  </div>`;
}

export function codePill(code, { copy = true } = {}) {
  return html`<span class="code-pill" title="Код комнаты">
    <span>${code}</span>
    ${copy
      ? html`<button class="code-pill__copy" type="button" data-copy="${code}" aria-label="Скопировать код комнаты">
          ${icon("copy", { size: 13 })}
        </button>`
      : ""}
  </span>`;
}

export function roleModalBody(roleId) {
  const role = ROLES[roleId];
  if (!role) return html`<p class="muted">Роль не найдена.</p>`;
  const team = TEAMS[role.team];
  return html`<div class="role-detail">
    <div class="role-detail__head" style="--role-color: ${role.color}">
      ${roleArt(role.id, { size: "lg" })}
      <div>
        <div class="row wrap">
          ${teamChip(role.team)}
          ${role.alias ? html`<span class="badge badge--muted">${role.alias}</span>` : ""}
        </div>
        <p class="role-detail__tagline">${role.tagline}</p>
      </div>
    </div>
    <p class="role-detail__text">${role.description}</p>
    <div class="role-detail__section">
      <span class="role-detail__label">Способности</span>
      <ul class="role-abilities">
        ${role.abilities.map((line) => html`<li>${icon("check", { size: 14 })}<span>${line}</span></li>`)}
      </ul>
    </div>
    <div class="role-detail__tip">${icon("spark", { size: 15 })}<span>${role.tips}</span></div>
    <div class="role-detail__win">
      <span class="role-detail__label">Победа</span>
      <p>${team?.win ?? ""}</p>
    </div>
  </div>`;
}

export function showRoleModal(roleId, { footerExtra = null } = {}) {
  const role = ROLES[roleId];
  if (!role) return null;
  return openModal({
    title: role.name,
    subtitle: "Роль в Ночном городе",
    role: true,
    body: roleModalBody(roleId),
    footer: html`${footerExtra ?? ""}<button class="btn btn--primary" type="button" data-modal-close>Понятно</button>`,
  });
}

function deathText(death) {
  if (!death) return "";
  if (death.cause === "vote") return "Повешен городом";
  if (death.cause === "assassin") return "Убит по контракту";
  if (death.cause === "mafia") return "Убит мафией";
  return "Погиб";
}

export function showPlayerModal(player, view = null) {
  if (!player) return null;
  const role = player.roleId ? ROLES[player.roleId] : null;
  const stats = player.stats;
  return openModal({
    title: player.name,
    subtitle: [player.isBot ? "ИИ-горожанин" : "Игрок", player.isHost ? "хост" : ""].filter(Boolean).join(" · "),
    role: true,
    body: html`<div class="player-detail">
      <div class="player-detail__head">
        ${avatar(player, { size: "xl", host: player.isHost, you: player.id === view?.selfId, dead: player.alive === false })}
        <div class="player-detail__badges">
          ${player.alive === false
            ? html`<span class="badge badge--muted">${icon("skull", { size: 11 })} мёртв</span>`
            : html`<span class="badge badge--town badge--dot">жив</span>`}
          ${player.id === view?.selfId ? html`<span class="badge">это вы</span>` : ""}
          ${player.voted ? html`<span class="badge badge--danger">голос отдан</span>` : ""}
          ${player.connected === false ? html`<span class="badge badge--muted">отключён</span>` : ""}
        </div>
      </div>
      ${player.alive === false && player.death
        ? html`<p class="player-detail__death">${icon("skull", { size: 15 })} ${deathText(player.death)} · день ${player.death.day}</p>`
        : ""}
      <div class="player-detail__role">
        <span class="role-detail__label">Роль</span>
        ${role
          ? html`<div class="row wrap">${roleChip(role.id)} ${teamChip(role.team)}</div>
              <p class="muted">${role.short}</p>`
          : html`<p class="muted row">${icon("lock", { size: 14 })} Роль скрыта. Возможно, это к лучшему.</p>`}
      </div>
      ${stats
        ? html`<div class="stat-grid">
            <div class="stat"><span class="stat__value">${stats.votesCast}</span><span class="stat__label">голосов</span></div>
            <div class="stat"><span class="stat__value">${stats.votesReceived}</span><span class="stat__label">против</span></div>
            <div class="stat"><span class="stat__value">${stats.messages}</span><span class="stat__label">сообщений</span></div>
            <div class="stat"><span class="stat__value">${stats.nightActions}</span><span class="stat__label">ночей</span></div>
          </div>`
        : ""}
    </div>`,
    footer: html`<button class="btn btn--ghost" type="button" data-modal-close>Закрыть</button>`,
  });
}

export function voteBars(result, players = []) {
  if (!result) return "";
  const byId = new Map(players.map((player) => [player.id, player]));
  const max = Math.max(1, ...(result.counts ?? []).map((entry) => entry.count));
  return html`<div class="vote-result">
    ${(result.counts ?? []).length
      ? result.counts.map((entry) => {
          const person = byId.get(entry.targetId);
          return html`<div class="vote-result__row ${entry.targetId === result.eliminatedId ? "is-eliminated" : ""}">
            ${avatar(person ?? { name: entry.name }, { size: "xs", dead: person?.alive === false })}
            <span class="vote-result__name truncate">${entry.name}</span>
            <span class="vote-result__bar"><span style="width:${Math.round((entry.count / max) * 100)}%"></span></span>
            <span class="vote-result__count">${entry.count}</span>
          </div>`;
        })
      : html`<p class="muted vote-result__empty">Никто не получил голосов.</p>`}
    ${result.skipped ? html`<p class="vote-result__skip">Пропустили: ${result.skipped}</p>` : ""}
  </div>`;
}

export function winnerSummary(winner) {
  if (!winner) return "";
  return html`<div class="winner-summary winner-summary--${winner.team}">
    <span class="winner-summary__kicker">${winner.team === "mafia" ? "Мафия" : winner.team === "town" ? "Город" : winner.team === "neutral" ? "Шут" : "Финал"}</span>
    <strong>${winner.title}</strong>
    <p>${winner.subtitle}</p>
  </div>`;
}

export function useRaw(value) {
  return raw(esc(value));
}
