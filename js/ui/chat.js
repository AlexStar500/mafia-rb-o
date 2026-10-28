import { html, mount, qs, qsa } from "./dom.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";
import { openModal, closeModal } from "./modal.js";
import { avatar } from "./components.js";
import { ROLE_ORDER, ROLES } from "../data/roles.js";
import { QUICK_CATEGORIES, QUICK_BY_CAT, quickPreview } from "../data/quickChat.js";
import { formatShortTime, textOf } from "../core/format.js";
import { asset } from "../core/assets.js";

const CHANNEL_META = Object.freeze({
  public: { name: "Общий", icon: "chat" },
  mafia: { name: "Мафия", icon: "blade" },
  dead: { name: "Мёртвые", icon: "skull" },
  all: { name: "Весь эфир", icon: "eye" },
});

function channelFor(view) {
  const channels = Array.isArray(view?.self?.chatChannels) ? view.self.chatChannels.filter((id) => CHANNEL_META[id]) : [];
  if (channels.length) return channels;
  if (view?.spectator) return ["all"];
  return [];
}

function writeChannelsFor(view, readable) {
  const writable = Array.isArray(view?.self?.chatWriteChannels)
    ? view.self.chatWriteChannels
    : readable;
  return writable.filter((id) => CHANNEL_META[id] && readable.includes(id));
}

function safeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value ?? "")) ? String(value) : "#d9b36c";
}

/**
 * Chat panel with keyed message nodes. It never re-renders the composer, so
 * typing and focus survive incoming state frames and bot chatter.
 */
export class ChatUI {
  constructor({ view, onSend, getTargets = null, compact = false, emptyText = "Пока тихо. Начните разговор." }) {
    this.view = view;
    this.onSend = onSend;
    this.getTargets = getTargets;
    this.compact = compact;
    this.emptyText = emptyText;
    this.epoch = null;
    this.channel = null;
    this.channels = [];
    this.writeChannels = [];
    this.messages = [];
    this.known = new Map();
    this.lastSeen = new Map();
    this.lastDay = null;
    this.players = new Map();
    this.selfId = view?.selfId ?? null;
    this.stick = true;
    this.unread = 0;
    this.el = document.createElement("div");
    this.el.className = `chat ${compact ? "chat--compact" : ""}`;
    this.el.innerHTML = html`<div class="chat__head">
        <div class="chat__tabs" data-chat-tabs role="tablist" aria-label="Каналы чата"></div>
        <button class="chat__quick" type="button" data-chat-quick title="Быстрые фразы">
          ${icon("spark", { size: 15 })}<span>Быстро</span>
        </button>
      </div>
      <div class="chat__body">
        <div class="chat__list" data-chat-list role="log" aria-live="polite" aria-relevant="additions"></div>
        <button class="chat__jump hidden" type="button" data-chat-jump>
          ${icon("chevron", { size: 14 })}<span>Новые сообщения</span>
        </button>
      </div>
      <div class="chat__foot">
        <p class="chat__status" data-chat-status></p>
        <form class="chat__composer" data-chat-form autocomplete="off">
          <input
            class="input chat__input"
            data-chat-input
            type="text"
            maxlength="160"
            placeholder="Сообщение…"
            aria-label="Сообщение в чат"
            autocomplete="off"
          />
          <button class="btn btn--primary chat__send" type="submit" aria-label="Отправить">
            ${icon("send", { size: 18 })}
          </button>
        </form>
      </div>`.value;

    this.list = qs("[data-chat-list]", this.el);
    this.tabs = qs("[data-chat-tabs]", this.el);
    this.status = qs("[data-chat-status]", this.el);
    this.form = qs("[data-chat-form]", this.el);
    this.input = qs("[data-chat-input]", this.el);
    this.jump = qs("[data-chat-jump]", this.el);
    this.quickBtn = qs("[data-chat-quick]", this.el);

    this._bind();
    this.update(view, { force: true });
  }

  mountInto(target) {
    target.replaceChildren(this.el);
    requestAnimationFrame(() => this.scrollToBottom(false));
    return this;
  }

  _bind() {
    this.el.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const tab = target?.closest("[data-chat-channel]");
      if (tab) {
        this.setChannel(tab.dataset.chatChannel);
        return;
      }
      if (target?.closest("[data-chat-quick]")) {
        this.openQuickChat();
        return;
      }
      if (target?.closest("[data-chat-jump]")) {
        this.stick = true;
        this.unread = 0;
        this.jump.classList.add("hidden");
        this.scrollToBottom(true);
      }
    });

    this.list.addEventListener("scroll", () => {
      const distance = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight;
      this.stick = distance < 56;
      if (this.stick && this.unread) {
        this.unread = 0;
        this.jump.classList.add("hidden");
      }
    });

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.sendText();
    });

    this.input.addEventListener("input", () => this.updateComposerMeta());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.sendText();
      }
    });
  }

  update(view, { force = false } = {}) {
    if (!view) return;
    this.view = view;
    this.selfId = view.selfId ?? this.selfId;
    this.players = new Map((view.players ?? []).map((player) => [player.id, player]));
    const nextChannels = channelFor(view);
    const nextWriteChannels = writeChannelsFor(view, nextChannels);
    const changedChannels =
      nextChannels.length !== this.channels.length ||
      nextChannels.some((id, index) => id !== this.channels[index]) ||
      nextWriteChannels.length !== this.writeChannels.length ||
      nextWriteChannels.some((id, index) => id !== this.writeChannels[index]);
    this.channels = nextChannels;
    this.writeChannels = nextWriteChannels;
    if (!this.channel || !this.channels.includes(this.channel)) {
      this.channel = this.channels[0] ?? null;
    }
    if (changedChannels || force) {
      this.renderTabs();
      this.renderComposer();
    } else {
      this.updateComposerMeta();
    }
    this.setMessages(Array.isArray(view.chat) ? view.chat : [], view.session?.chatEpoch ?? 0, { force });
  }

  setChannel(channel) {
    if (!this.channels.includes(channel) || channel === this.channel) return;
    this.channel = channel;
    this.known.clear();
    this.lastSeen.set(channel, this.maxSeq(this.messages));
    this.unread = 0;
    this.renderTabs();
    this.renderComposer();
    this.rebuild();
    this.stick = true;
    requestAnimationFrame(() => this.scrollToBottom(false));
  }

  renderTabs() {
    if (!this.channels.length) {
      mount(this.tabs, "");
      return;
    }
    mount(
      this.tabs,
      html`${this.channels.map((id) => {
        const meta = CHANNEL_META[id] ?? CHANNEL_META.public;
        const unseen = this.unseenCount(id);
        const writable = this.writeChannels.includes(id);
        return html`<button
          class="chat__tab ${id === this.channel ? "is-active" : ""} ${writable ? "" : "chat__tab--readonly"}"
          type="button"
          role="tab"
          aria-selected="${id === this.channel ? "true" : "false"}"
          title="${writable ? meta.name : `${meta.name} — только чтение`}"
          data-chat-channel="${id}"
        >
          ${icon(meta.icon, { size: 14 })}<span>${meta.name}</span>
          ${unseen ? html`<span class="chat__unread">${unseen > 9 ? "9+" : unseen}</span>` : ""}
        </button>`;
      })}`,
    );
    this.lastSeen.set(this.channel, this.maxSeq(this.messages));
  }

  renderComposer() {
    const canWrite = this.writeChannels.includes(this.channel);
    this.quickBtn.classList.toggle("hidden", !canWrite);
    this.form.classList.toggle("hidden", !canWrite);
    this.updateComposerMeta();
  }

  updateComposerMeta() {
    if (!this.channels.length) {
      const spectator = this.view?.spectator;
      this.status.textContent = spectator
        ? "Наблюдение: читайте город, но не вмешивайтесь."
        : "Сейчас писать нельзя.";
      return;
    }
    if (!this.writeChannels.includes(this.channel)) {
      const self = this.view?.self ?? {};
      if (this.view?.spectator) {
        this.status.textContent = "Наблюдение: читайте город, но не вмешивайтесь.";
      } else if (this.view?.phase === "lastWords") {
        this.status.textContent = "Сейчас говорит только повешенный.";
      } else if (!self.alive && this.writeChannels.includes("dead")) {
        this.status.textContent = "Общий чат — только чтение. Писать можно в «Мёртвые».";
      } else {
        this.status.textContent = "Этот канал сейчас только для чтения.";
      }
      return;
    }
    const self = this.view?.self ?? {};
    const count = Number(self.chatCount) || 0;
    const limit = Number(self.chatLimit) || 6;
    const windowSec = Math.max(1, Math.round((Number(self.chatWindowMs) || 10_000) / 1000));
    const channel = CHANNEL_META[this.channel]?.name ?? "чат";
    const length = this.input.value.length;
    const parts = [channel, `${count}/${limit} за ${windowSec} с`];
    if (length > 0) parts.push(`${length}/160`);
    if (this.view?.phase === "lastWords") parts.push("последнее слово");
    this.status.textContent = parts.join(" · ");
  }

  maxSeq(messages) {
    return messages.reduce((max, message) => Math.max(max, Number(message.seq) || 0), 0);
  }

  unseenCount(channel) {
    const since = this.lastSeen.get(channel) ?? 0;
    return (this.messages ?? []).filter((message) => message.channel === channel && message.seq > since).length;
  }

  visibleMessages() {
    if (!this.messages.length) return [];
    if (this.channel === "all") return this.messages;
    return this.messages.filter((message) => message.channel === this.channel);
  }

  setMessages(messages, epoch, { force = false } = {}) {
    const epochValue = Number(epoch) || 0;
    if (this.epoch !== null && epochValue !== this.epoch) {
      this.known.clear();
      this.lastSeen.clear();
      this.messages = [];
      this.lastDay = null;
      this.stick = true;
      this.unread = 0;
      this.jump.classList.add("hidden");
    }
    this.epoch = epochValue;
    this.messages = messages;

    if (!this.channel) {
      mount(this.list, html`<div class="chat__empty">${icon("chat", { size: 20 })}<span>${this.emptyText}</span></div>`);
      return;
    }
    if (this.channel !== "all") {
      this.lastSeen.set(this.channel, this.maxSeq(this.messages));
    }

    const shouldRebuild =
      force ||
      this.known.size === 0 ||
      this.known.size > this.visibleMessages().length ||
      [...this.known.keys()].some((seq) => !this.visibleMessages().some((message) => message.seq === seq));

    if (shouldRebuild) {
      this.rebuild();
      return;
    }

    const knownMax = Math.max(0, ...this.known.keys());
    const fresh = this.visibleMessages().filter((message) => message.seq > knownMax);
    if (!fresh.length) {
      this.renderTabs();
      return;
    }

    const nearBottom = this.stick;
    const fragment = document.createDocumentFragment();
    for (const message of fresh) {
      if (this.lastDay !== message.day) {
        this.lastDay = message.day;
        const day = document.createElement("div");
        day.className = "chat__day";
        day.textContent = message.day ? `День ${message.day}` : "Лобби";
        fragment.append(day);
      }
      const node = this.messageNode(message);
      fragment.append(node);
      this.known.set(message.seq, node);
    }
    this.list.append(fragment);
    if (nearBottom) {
      this.scrollToBottom(true);
    } else {
      this.unread += fresh.filter((message) => message.playerId !== this.selfId).length;
      if (this.unread) {
        qs("span", this.jump).textContent = `Новые сообщения · ${this.unread}`;
        this.jump.classList.remove("hidden");
      }
    }
    this.renderTabs();
  }

  rebuild() {
    this.known.clear();
    this.lastDay = null;
    const messages = this.visibleMessages();
    if (!messages.length) {
      mount(
        this.list,
        html`<div class="chat__empty">${icon("chat", { size: 20 })}<span>${this.emptyText}</span></div>`,
      );
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const message of messages) {
      if (this.lastDay !== message.day) {
        this.lastDay = message.day;
        const day = document.createElement("div");
        day.className = "chat__day";
        day.textContent = message.day ? `День ${message.day}` : "Лобби";
        fragment.append(day);
      }
      const node = this.messageNode(message);
      fragment.append(node);
      this.known.set(message.seq, node);
    }
    this.list.replaceChildren(fragment);
  }

  messageNode(message) {
    const person = this.players.get(message.playerId);
    const name = person?.name ?? message.name ?? "Кто-то";
    const playerForAvatar = person ?? { name, color: message.color, alive: true };
    const target = message.targetId ? this.players.get(message.targetId) : null;
    const targetInText = target && String(message.text ?? "").toLowerCase().includes(String(target.name ?? "").toLowerCase());
    const channel = message.channel && this.channel === "all" ? CHANNEL_META[message.channel]?.name : "";
    const isSelf = message.playerId === this.selfId;
    const node = document.createElement("article");
    node.className = `chat__msg ${isSelf ? "is-self" : ""} ${message.channel === "mafia" ? "chat__msg--mafia" : ""} ${message.channel === "dead" ? "chat__msg--dead" : ""}`;
    node.dataset.seq = String(message.seq);
    node.innerHTML = html`${avatar(playerForAvatar, { size: "xs" })}
      <div class="chat__msg-main">
        <div class="chat__msg-meta">
          <span class="chat__msg-name" style="--chat-color:${safeColor(message.color)}">${name}</span>
          ${isSelf ? html`<span class="chat__you">вы</span>` : ""}
          ${channel ? html`<span class="chat__channel-tag">${channel}</span>` : ""}
          <time class="chat__time" datetime="${new Date(Number(message.at) || Date.now()).toISOString()}">${formatShortTime(message.at)}</time>
        </div>
        <p class="chat__msg-text">${textOf(message.text)}</p>
        ${target && !targetInText
          ? html`<span class="chat__target">${icon("target", { size: 11 })} ${target.name}</span>`
          : ""}
        ${message.roleId
          ? html`<span class="chat__role">${message.roleId === "mafia" || message.roleId === "assassin" ? "мафия" : message.roleId}</span>`
          : ""}
      </div>`.value;
    return node;
  }

  scrollToBottom(smooth = true) {
    if (!this.list) return;
    this.list.scrollTo?.({ top: this.list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    this.jump.classList.add("hidden");
    this.unread = 0;
  }

  sendText() {
    const text = this.input.value.trim();
    if (!text) return;
    if (!this.channels.length) return;
    if (!this.writeChannels.includes(this.channel)) {
      toast(this.channel === "public" ? "Общий чат сейчас только для чтения." : "Этот канал только для чтения.", {
        tone: "warn",
      });
      return;
    }
    const result = this.onSend?.({
      text,
      channel: this.channel === "all" ? "public" : this.channel,
    });
    if (result && result.ok === false) {
      toast(result.error ?? "Сообщение не отправлено.", { tone: "warn" });
      this.input.focus({ preventScroll: true });
      return;
    }
    this.input.value = "";
    this.updateComposerMeta();
    this.stick = true;
    requestAnimationFrame(() => {
      this.scrollToBottom(true);
      this.input.focus({ preventScroll: true });
    });
  }

  sendQuick(phrase, targetId = null, quickRoleId = null) {
    if (!this.writeChannels.includes(this.channel)) {
      toast("Сейчас этот канал только для чтения.", { tone: "warn" });
      return false;
    }
    const result = this.onSend?.({
      quickId: phrase.id,
      targetId,
      quickRoleId,
      channel: this.channel === "all" ? "public" : this.channel,
    });
    if (result && result.ok === false) {
      toast(result.error ?? "Фраза не отправлена.", { tone: "warn" });
      return false;
    }
    this.stick = true;
    return true;
  }

  openQuickChat() {
    if (!this.channels.length) return;
    if (!this.writeChannels.includes(this.channel)) {
      toast("Сейчас этот канал только для чтения.", { tone: "warn" });
      return;
    }
    const targetsForChannel = () =>
      (this.getTargets?.(this.channel) ?? []).filter((player) => player && player.id && player.id !== this.selfId);
    const categories = QUICK_CATEGORIES.filter((cat) => cat.id !== "dead" || this.channel === "dead");
    const category = this.channel === "dead" ? "dead" : categories[0]?.id ?? "quick";

    const state = { category, pending: null, targets: targetsForChannel(), targetId: null };

    const handle = openModal({
      title: "Быстрая фраза",
      subtitle: "Канонические фразы. Боты понимают их смысл и адресата.",
      className: "modal--quick",
      body: html`<div class="quick-chat" data-quick-root>
        <div class="quick-chat__cats" data-quick-cats role="tablist" aria-label="Категории фраз"></div>
        <div class="quick-chat__panel" data-quick-panel></div>
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-modal-close>Закрыть</button>`,
    });
    if (!handle) return;

    const root = qs("[data-quick-root]", handle.body);
    const cats = qs("[data-quick-cats]", root);
    const panel = qs("[data-quick-panel]", root);

    const send = (phrase, targetId = null, quickRoleId = null) => {
      if (this.sendQuick(phrase, targetId, quickRoleId)) closeModal("sent");
    };

    const renderRoles = (phrase) => {
      const roles = ROLE_ORDER.map((id) => ROLES[id]).filter(Boolean);
      mount(
        panel,
        html`<div class="quick-target">
          <button class="btn btn--quiet btn--sm" type="button" data-quick-back>
            ${icon("back", { size: 15 })} Назад
          </button>
          <p class="quick-target__phrase">«${quickPreview(phrase)}»</p>
          <p class="quick-target__hint">Какую роль вы имеете в виду? Выберите одну — город услышит ровно её.</p>
          <div class="quick-target__grid">
            ${roles.map(
              (role) => html`<button class="quick-target__person" type="button" data-quick-role="${role.id}">
                <img src="${asset(role.icon)}" alt="" width="32" height="32" loading="lazy" />
                <span>${role.name}</span>
              </button>`,
            )}
          </div>
        </div>`,
      );
    };

    const renderTargets = (phrase) => {
      state.pending = phrase;
      state.targetId = null;
      state.targets = targetsForChannel();
      mount(
        panel,
        html`<div class="quick-target">
          <button class="btn btn--quiet btn--sm" type="button" data-quick-back>
            ${icon("back", { size: 15 })} Назад
          </button>
          <p class="quick-target__phrase">«${quickPreview(phrase)}»</p>
          <p class="quick-target__hint">Кому это адресовано? Выберите игрока — без него фраза потеряет смысл.</p>
          ${state.targets.length
            ? html`<div class="quick-target__grid">
                ${state.targets.map(
                  (player) => html`<button class="quick-target__person" type="button" data-quick-target="${player.id}">
                    ${avatar(player, { size: "sm", dead: player.alive === false })}
                    <span>${player.name}</span>
                  </button>`,
                )}
              </div>`
            : html`<p class="notice">${icon("info", { size: 16 })} Сейчас некого выбрать: других игроков нет. Вернитесь назад и возьмите фразу без адресата.</p>`}
        </div>`,
      );
    };

    const renderPanel = () => {
      if (state.pending) {
        renderTargets(state.pending);
        return;
      }
      mount(cats, html`${categories.map(
        (cat) => html`<button
          class="quick-chat__cat ${cat.id === state.category ? "is-active" : ""}"
          type="button"
          data-quick-cat="${cat.id}"
          role="tab"
          aria-selected="${cat.id === state.category ? "true" : "false"}"
        >
          ${icon(cat.icon, { size: 14 })}<span>${cat.name}</span>
        </button>`,
      )}`);
      const phrases = QUICK_BY_CAT[state.category] ?? [];
      mount(
        panel,
        html`<div class="quick-chat__list">
          ${phrases.map(
            (phrase) => html`<button class="quick-chat__phrase" type="button" data-quick-phrase="${phrase.id}">
              <span>${quickPreview(phrase)}</span>
              ${phrase.needsTarget ? html`<span class="quick-chat__target-icon">${icon("target", { size: 13 })}</span>` : ""}
              ${phrase.needsRole ? html`<span class="quick-chat__target-icon">${icon("mask", { size: 13 })}</span>` : ""}
            </button>`,
          )}
        </div>`,
      );
    };

    handle.body.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const cat = target.closest("[data-quick-cat]");
      if (cat) {
        state.category = cat.dataset.quickCat;
        state.pending = null;
        state.targetId = null;
        renderPanel();
        return;
      }
      const back = target.closest("[data-quick-back]");
      if (back) {
        state.pending = null;
        state.targetId = null;
        renderPanel();
        return;
      }
      const phraseButton = target.closest("[data-quick-phrase]");
      if (phraseButton) {
        const phrase = (QUICK_BY_CAT[state.category] ?? []).find((item) => item.id === phraseButton.dataset.quickPhrase);
        if (!phrase) return;
        if (phrase.needsTarget) {
          renderTargets(phrase);
        } else if (phrase.needsRole) {
          state.pending = phrase;
          renderRoles(phrase);
        } else {
          send(phrase, null);
        }
        return;
      }
      const person = target.closest("[data-quick-target]");
      if (person && state.pending) {
        state.targetId = person.dataset.quickTarget;
        if (state.pending.needsRole) {
          renderRoles(state.pending);
        } else {
          send(state.pending, state.targetId);
        }
        return;
      }
      const roleButton = target.closest("[data-quick-role]");
      if (roleButton && state.pending) {
        send(state.pending, state.targetId, roleButton.dataset.quickRole);
      }
    });

    renderPanel();
  }
}

export function createChat(options) {
  return new ChatUI(options);
}

export function chatChannelName(channel) {
  return CHANNEL_META[channel]?.name ?? channel;
}

export function chatChannelIcon(channel) {
  return CHANNEL_META[channel]?.icon ?? "chat";
}

// Re-export to make the small helper discoverable to callers that only need it.
export { qsa };
