import { html, mount, qs, qsa } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { roleArt, roleChip, showRoleModal } from "../ui/components.js";
import { BOT_ROSTER } from "../data/bots.js";
import { ROLES, ROLE_ORDER, TEAMS, computeRoleSetup } from "../data/roles.js";
import { asset } from "../core/assets.js";

const TEAM_COPY = Object.freeze({
  mafia: "Убивают ночью, лгут днём и побеждают, когда город им больше не мешает.",
  town: "Ищут мафию, спорят, голосуют и пытаются дожить до утра.",
  neutral: "Играют за себя. У каждого нейтрала своя странная цель.",
});

function roleCard(role) {
  const team = TEAMS[role.team];
  return html`<button class="role-card" type="button" data-role="${role.id}" style="--role-color:${role.color};--team-color:${team?.color ?? role.color}">
    <span class="role-card__glow"></span>
    ${roleArt(role.id, { size: "md" })}
    <span class="role-card__body">
      <span class="role-card__top">
        <strong>${role.name}</strong>
        <span class="role-card__team">${team?.short ?? ""}</span>
      </span>
      <span class="role-card__short">${role.short}</span>
      <span class="role-card__tags">
        ${role.alias ? html`<span class="badge badge--muted">${role.alias}</span>` : ""}
        <span class="badge ${role.night ? "badge--violet" : "badge--muted"}">${icon(role.night ? "moon" : "sun", { size: 10 })} ${role.night ? "ночь" : "день"}</span>
      </span>
    </span>
    <span class="role-card__arrow">${icon("forward", { size: 18 })}</span>
  </button>`;
}

function setupPreview(playerCount, roles) {
  const setup = computeRoleSetup(playerCount, roles);
  return html`<div class="balance-result" data-balance-result>
    <div class="balance-result__headline">
      <span class="balance-result__count">${playerCount}</span>
      <span><b>игроков</b><br /><span class="muted">мафия: ${setup.mafiaTeam}</span></span>
    </div>
    <div class="balance-result__roles">
      ${ROLE_ORDER.map((roleId) => {
        const role = ROLES[roleId];
        const count = setup.counts[roleId] ?? 0;
        return html`<span class="balance-role ${count ? "" : "is-off"}" style="--role-color:${role.color}" title="${role.name} × ${count}">
          <img src="${asset(role.icon)}" alt="" width="32" height="32" loading="lazy" />
          <span>${role.name}</span>
          <b>${count}</b>
        </span>`;
      })}
    </div>
    ${setup.warnings.length
      ? html`<div class="balance-result__warnings">
          ${setup.warnings.map((warning) => html`<span>${icon("alert", { size: 13 })} ${warning}</span>`)}
        </div>`
      : html`<p class="balance-result__ok">${icon("check", { size: 14 })} Состав сбалансирован. Роли раздаются случайно.</p>`}
    <p class="balance-result__note">Автобаланс: мафия ≈ четверть города, шериф всегда один, доктор с 5 игроков, ассасин с 8, шут с 7.</p>
  </div>`;
}

export function createRolesScreen(ctx) {
  const app = ctx.app;
  const settings = app.settings;
  let players = Math.max(4, Math.min(20, Number(settings.lastPlayerCount) || 8));
  let roles = { doctor: true, assassin: false, jester: false };

  const htmlScreen = html`<div class="screen">
    <div class="page roles-page">
      <header class="page-head roles-head">
        <span class="eyebrow">${icon("mask", { size: 13 })} Кодекс ночного города</span>
        <h1 class="page-title">Шесть ролей. Одна правда.</h1>
        <p class="page-sub">Кто-то убивает, кто-то лечит, кто-то ищет, а кто-то просто очень хочет, чтобы его повесили. Изучите роли и соберите сбалансированный город.</p>
      </header>

      <section class="panel panel--gold balance-panel">
        <div class="panel__head">
          <span class="panel__title">${icon("grid", { size: 15 })} Симулятор состава</span>
          <span class="muted">настройте город до старта</span>
        </div>
        <div class="panel__body balance-panel__body">
          <div class="balance-controls">
            <div class="balance-stepper">
              <span class="setting-row__title">Игроков</span>
              <div class="stepper" role="group" aria-label="Количество игроков">
                <button type="button" data-balance-step="-1" aria-label="Меньше" ${players <= 4 ? html`disabled` : ""}>${icon("minus", { size: 15 })}</button>
                <output data-balance-count>${players}</output>
                <button type="button" data-balance-step="1" aria-label="Больше" ${players >= 20 ? html`disabled` : ""}>${icon("plus", { size: 15 })}</button>
              </div>
            </div>
            <div class="balance-toggles">
              ${["doctor", "assassin", "jester"].map(
                (roleId) => html`<label class="chip balance-chip ${roles[roleId] ? "is-active" : ""}" for="balance-${roleId}" style="--role-color:${ROLES[roleId].color}">
                  <input id="balance-${roleId}" type="checkbox" data-balance-role="${roleId}" ${roles[roleId] ? html`checked` : ""} />
                  ${ROLES[roleId].name}
                </label>`,
              )}
            </div>
          </div>
          <div data-balance-slot>${setupPreview(players, roles)}</div>
        </div>
      </section>

      <section class="roles-teams">
        ${["mafia", "town", "neutral"].map((teamId) => {
          const team = TEAMS[teamId];
          const roleIds = ROLE_ORDER.filter((roleId) => ROLES[roleId].team === teamId);
          return html`<div class="team-section" style="--team-color:${team.color}">
            <div class="section-title">
              <span>${icon(teamId === "mafia" ? "blade" : teamId === "neutral" ? "joker" : "shield", { size: 14 })} ${team.name}</span>
            </div>
            <p class="team-section__copy">${TEAM_COPY[teamId]}</p>
            <div class="role-card-grid">${roleIds.map((roleId) => roleCard(ROLES[roleId]))}</div>
          </div>`;
        })}
      </section>

      <section class="panel roles-bots">
        <div class="panel__head">
          <span class="panel__title">${icon("bot", { size: 15 })} ИИ-горожане</span>
          <span class="muted">20 характеров · пиксельные портреты</span>
        </div>
        <div class="panel__body">
          <p class="roles-bots__lead">Боты играют по своим наблюдениям, помнят прошлые реплики и не видят чужие роли. Это не декорация — они спорят, ошибаются и меняют мнение.</p>
          <div class="bot-grid">
            ${BOT_ROSTER.map(
              (bot) => html`<button class="bot-tile" type="button" data-bot="${bot.id}" title="${bot.name}">
                <span class="role-art role-art--xs"><img src="${asset(bot.avatar)}" alt="" width="96" height="96" loading="lazy" /></span>
                <span class="bot-tile__name">${bot.name}</span>
                <span class="bot-tile__style">${bot.style}</span>
              </button>`,
            )}
          </div>
        </div>
      </section>

      <div class="roles-cta">
        <div>
          <strong>Готовы примерить роль?</strong>
          <p class="muted">Соберите комнату или запустите тренировку с ботами.</p>
        </div>
        <div class="row wrap">
          <button class="btn btn--primary" type="button" data-go-quick>${icon("play", { size: 16 })} Быстрый старт</button>
          <button class="btn btn--ghost" type="button" data-go-create>${icon("plus", { size: 16 })} Создать комнату</button>
        </div>
      </div>
    </div>
  </div>`;

  return {
    title: "Роли и баланс",
    html: htmlScreen,
    mount(root) {
      const rerender = () => {
        mount(qs("[data-balance-slot]", root), setupPreview(players, roles));
        qs("[data-balance-count]", root).textContent = String(players);
        for (const button of qsa("[data-balance-step]", root)) {
          const next = players + Number(button.dataset.balanceStep);
          button.disabled = next < 4 || next > 20;
        }
        for (const input of qsa("[data-balance-role]", root)) {
          input.checked = Boolean(roles[input.dataset.balanceRole]);
          input.closest(".balance-chip")?.classList.toggle("is-active", input.checked);
        }
        qs("[data-balance-count]", root)?.scrollIntoView?.({ block: "nearest" });
      };

      root.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const step = target.closest("[data-balance-step]");
        if (step) {
          players = Math.max(4, Math.min(20, players + Number(step.dataset.balanceStep)));
          rerender();
          return;
        }
        const roleButton = target.closest("[data-role]");
        if (roleButton) {
          showRoleModal(roleButton.dataset.role);
          return;
        }
        const botButton = target.closest("[data-bot]");
        if (botButton) {
          const bot = BOT_ROSTER.find((entry) => entry.id === botButton.dataset.bot);
          if (bot) {
            const traits = Object.entries({ Логика: bot.traits.logic, Агрессия: bot.traits.aggression, Разговорчивость: bot.traits.chattiness, Хитрость: bot.traits.deception });
            import("../ui/modal.js").then(({ openModal }) => {
              openModal({
                title: bot.name,
                subtitle: "ИИ-горожанин",
                role: true,
                body: html`<div class="bot-detail">
                  <div class="bot-detail__head">
                    <span class="role-art role-art--lg"><img src="${asset(bot.avatar)}" alt="" width="192" height="192" /></span>
                    <div><p class="bot-detail__tagline">${bot.tagline}</p><span class="badge badge--muted">${bot.style}</span></div>
                  </div>
                  <div class="trait-list">
                    ${traits.map(([label, value]) => html`<div class="trait"><span>${label}</span><span class="trait__bar"><span style="width:${Math.round(value * 100)}%"></span></span><b>${Math.round(value * 100)}</b></div>`)}
                  </div>
                </div>`,
                footer: html`<button class="btn btn--primary" type="button" data-modal-close>Закрыть</button>`,
              });
            });
          }
          return;
        }
        if (target.closest("[data-go-quick]")) app.navigate("/quick");
        else if (target.closest("[data-go-create]")) app.navigate("/create");
      });

      root.addEventListener("change", (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        const roleId = input.dataset.balanceRole;
        if (!roleId) return;
        roles = { ...roles, [roleId]: input.checked };
        rerender();
      });
    },
    destroy() {},
  };
}
