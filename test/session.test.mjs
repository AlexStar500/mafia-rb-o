import test from "node:test";
import assert from "node:assert/strict";
import { Emitter } from "../js/core/events.js";
import { createId } from "../js/core/security.js";
import { seededRng } from "../js/core/random.js";
import { ROLES } from "../js/data/roles.js";
import { GuestSession, HostSession, createSoloSession } from "../js/net/session.js";

class MemoryHostAdapter extends Emitter {
  constructor() {
    super();
    this.online = false;
    this.mode = "local";
    this.outbox = [];
    this.meta = null;
    this.kicked = [];
    this.closed = false;
    this.denied = [];
  }

  send(peerId, payload) {
    this.outbox.push({ peerId, payload });
    return true;
  }

  updateMeta(meta) {
    this.meta = meta;
  }

  deny(peerId, reason) {
    this.denied.push({ peerId, reason });
  }

  kick(peerId, reason) {
    this.kicked.push({ peerId, reason });
  }

  join(peer) {
    this.emit("join", { peer });
  }

  message(from, payload) {
    this.emit("message", { from, payload });
  }

  close() {
    this.closed = true;
  }
}

class MemoryGuestAdapter extends Emitter {
  constructor() {
    super();
    this.online = false;
    this.mode = "local";
    this.code = "ABC234";
    this.sent = [];
    this.closed = false;
  }

  send(payload) {
    this.sent.push(payload);
    return true;
  }

  close() {
    this.closed = true;
  }

  deliver(payload) {
    this.emit("message", { from: "h_host", payload });
  }
}

test("solo session starts with bots and hides roles correctly", async (t) => {
  const self = { id: createId("p"), name: "Тестер", color: "#d9b36c" };
  const session = await createSoloSession({
    self,
    config: { maxPlayers: 7, minStart: 5, timers: { night: 12, discussion: 20, voting: 12 } },
    botFill: 7,
    rng: seededRng("solo-test"),
  });
  t.after(() => session.close());

  assert.equal(session.engine.players.length, 7);
  assert.equal(session.engine.players.filter((player) => player.isBot).length, 6);
  assert.equal(session.view.phase, "lobby");
  assert.equal(session.view.self.roleId, null);

  const result = session.start();
  assert.equal(result.ok, true);
  const view = session.view;
  assert.equal(view.phase, "night");
  assert.equal(view.players.length, 7);
  assert.ok(view.self.roleId in ROLES);
  assert.equal(view.self.team, ROLES[view.self.roleId].team);

  const others = view.players.filter((player) => player.id !== self.id);
  const mafiaViewer = view.self.team === "mafia";
  for (const other of others) {
    if (mafiaViewer && other.team === "mafia") continue;
    assert.equal(other.roleId, null, "roles must stay hidden during the night");
  }

  const action = view.night?.action;
  if (action) {
    const target = action.options?.[0];
    if (target) {
      const acted = session.nightAction(action.type, target);
      assert.equal(acted.ok, true);
    }
  }

  const chat = session.sendChat({ text: "Проверка связи" });
  assert.equal(chat.ok, false, "night public chat is closed");
});

test("host session accepts a guest, sends a welcome and applies ready actions", async (t) => {
  const self = { id: createId("p"), name: "Хозяин", color: "#d9b36c" };
  const adapter = new MemoryHostAdapter();
  const session = new HostSession({
    roomCode: "ABC234",
    self,
    config: { maxPlayers: 6, minStart: 4, name: "Тест" },
    adapter,
    mode: "local",
    botFill: 0,
  });
  t.after(() => session.close());

  const guestId = createId("p");
  adapter.join({ id: guestId, name: "Гость", color: "#4fb477", spectate: false });
  assert.equal(session.engine.players.length, 2);
  const welcome = adapter.outbox.find((item) => item.peerId === guestId && item.payload.type === "welcome");
  assert.ok(welcome);
  assert.equal(welcome.payload.playerId, guestId);
  assert.equal(welcome.payload.view.phase, "lobby");
  assert.equal(welcome.payload.view.players.length, 2);
  assert.equal(adapter.meta.players, 2);

  adapter.message(guestId, { type: "action", kind: "ready", ready: true });
  assert.equal(session.engine.getPlayer(guestId).ready, true);

  adapter.message(guestId, { type: "action", kind: "chat", text: "Привет" });
  const chatView = session.view;
  assert.equal(chatView.chat.at(-1).text, "Привет");

  const stateFrames = adapter.outbox.filter((item) => item.peerId === guestId && item.payload.type === "state");
  assert.ok(stateFrames.length >= 1);

  session.kick(guestId);
  assert.equal(session.engine.getPlayer(guestId), null);
  assert.equal(adapter.kicked.length, 1);
});

test("spectator host reveals all roles and supports pause/speed", async (t) => {
  const self = { id: createId("p"), name: "Зритель" };
  const adapter = new MemoryHostAdapter();
  const session = new HostSession({
    roomCode: "ABC234",
    self,
    config: { maxPlayers: 6, minStart: 4, timers: { night: 12, discussion: 20, voting: 12 } },
    adapter,
    mode: "solo",
    spectatorOnly: true,
    botFill: 6,
    autoStart: true,
    speed: 2,
  });
  t.after(() => session.close());

  await new Promise((resolve) => setTimeout(resolve, 30));
  const view = session.view;
  assert.equal(view.spectator, true);
  assert.equal(view.phase, "night");
  assert.equal(view.players.length, 6);
  assert.ok(view.players.every((player) => player.roleId && player.team));
  assert.equal(view.session.speed, 2);
  assert.equal(view.session.paused, false);

  session.setPaused(true);
  assert.equal(session.view.session.paused, true);
  session.setSpeed(4);
  session.setPaused(false);
  assert.equal(session.view.session.speed, 4);
});

test("guest session merges state and chat, tracks time, and sends actions", () => {
  const adapter = new MemoryGuestAdapter();
  const self = { id: createId("p"), name: "Гость" };
  const guest = new GuestSession({ adapter, self, mode: "local" });
  const hostNow = 1_000_000;
  adapter.deliver({
    type: "welcome",
    selfId: self.id,
    playerId: self.id,
    spectator: false,
    roomCode: "ABC234",
    hostId: "h_host",
    hostName: "Хост",
    speed: 1,
    paused: false,
    chatEpoch: 1,
    view: {
      phase: "discussion",
      day: 2,
      now: hostNow,
      version: 3,
      selfId: self.id,
      players: [],
      self: { id: self.id, roleId: "civilian", team: "town" },
      chat: undefined,
    },
    chat: [{ seq: 1, text: "Привет", playerId: "p_other" }],
  });

  assert.ok(guest.view);
  assert.equal(guest.view.phase, "discussion");
  assert.equal(guest.chat.length, 1);
  assert.equal(guest.hostName, "Хост");

  adapter.deliver({
    type: "chat",
    chatEpoch: 1,
    messages: [
      { seq: 2, text: "Второе", playerId: "p_other" },
      { seq: 1, text: "Привет", playerId: "p_other" },
    ],
  });
  assert.equal(guest.chat.length, 2);
  assert.equal(guest.chat[1].text, "Второе");

  adapter.deliver({
    type: "state",
    chatEpoch: 1,
    speed: 2,
    paused: false,
    view: { phase: "voting", now: hostNow + 5000, version: 4, players: [], self: {} },
  });
  assert.equal(guest.view.phase, "voting");
  assert.ok(guest.estimatedNow() >= hostNow + 5000);

  guest.vote("p_other");
  guest.sendChat({ text: "Голосую" });
  guest.setReady(true);
  const kinds = adapter.sent.map((payload) => payload.kind);
  assert.deepEqual(kinds, ["vote", "chat", "ready"]);

  guest.close("тест");
  assert.equal(guest.closed, true);
  assert.equal(adapter.closed, true);
});
