import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { attachRelay } from "../server/relay.mjs";
import { OnlineGuestAdapter } from "../js/net/online.js";

// The browser adapter talks to the platform's global WebSocket. Node 20 (the
// CI matrix) does not ship one, so fall back to the `ws` client, which speaks
// the same event API (addEventListener, string event.data).
if (typeof globalThis.WebSocket !== "function") {
  globalThis.WebSocket = WebSocket;
}

function client(ws) {
  const queue = [];
  const waiters = [];
  ws.on("message", (data) => {
    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    const index = waiters.findIndex((waiter) => waiter.match(frame));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    } else {
      queue.push(frame);
    }
  });
  return {
    ws,
    next(match, timeout = 3000) {
      const index = queue.findIndex(match);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const at = waiters.findIndex((item) => item.timer === timer);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error("timeout waiting for frame"));
        }, timeout);
        waiters.push({ match, resolve, reject, timer });
      });
    },
    send(frame) {
      ws.send(JSON.stringify(frame));
    },
    close() {
      ws.close();
    },
  };
}

async function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(client(ws)));
    ws.once("error", reject);
  });
}

async function startRelay() {
  const server = createServer((req, res) => {
    if (relay.handleHttp(req, res)) return;
    res.writeHead(404);
    res.end();
  });
  const relay = attachRelay({ server, path: "/ws", logger: { info() {} } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    server,
    relay,
    url: `ws://127.0.0.1:${port}/ws`,
    http: `http://127.0.0.1:${port}`,
    async close() {
      relay.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("relay: host, guest, relay, meta, rooms, kick and close", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());

  const host = await connect(relay.url);
  t.after(() => host.close());
  host.send({
    type: "create",
    room: "ABC234",
    hostName: "Хозяин",
    meta: { name: "Тестовая", public: true, maxPlayers: 8, minStart: 5, players: 1, humans: 1, bots: 0 },
  });
  const hostWelcome = await host.next((frame) => frame.type === "welcome");
  assert.equal(hostWelcome.host, true);
  assert.equal(hostWelcome.room, "ABC234");
  assert.match(hostWelcome.selfId, /^h_/);

  const guest = await connect(relay.url);
  t.after(() => guest.close());
  guest.send({ type: "join", room: "ABC234", name: "Гость", color: "#4fb477", spectate: false });
  const guestWelcome = await guest.next((frame) => frame.type === "welcome");
  assert.equal(guestWelcome.host, false);
  assert.equal(guestWelcome.room, "ABC234");
  assert.match(guestWelcome.selfId, /^p_/);
  assert.equal(guestWelcome.hostId, hostWelcome.selfId);

  const joined = await host.next((frame) => frame.type === "peer-join");
  assert.equal(joined.peer.name, "Гость");
  assert.equal(joined.peer.spectate, false);

  host.send({ type: "relay", to: guestWelcome.selfId, payload: { type: "state", view: { phase: "lobby" } } });
  const state = await guest.next((frame) => frame.type === "relay");
  assert.equal(state.from, hostWelcome.selfId);
  assert.equal(state.payload.view.phase, "lobby");

  guest.send({ type: "relay", to: guestWelcome.hostId, payload: { type: "action", kind: "ready" } });
  const action = await host.next((frame) => frame.type === "relay");
  assert.equal(action.from, guestWelcome.selfId);
  assert.equal(action.payload.kind, "ready");

  host.send({
    type: "meta",
    meta: {
      name: "Тестовая",
      public: true,
      status: "lobby",
      players: 2,
      humans: 2,
      bots: 0,
      maxPlayers: 8,
      minStart: 5,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const response = await fetch(`${relay.http}/rooms`);
  const data = await response.json();
  const room = data.rooms.find((item) => item.code === "ABC234");
  assert.ok(room);
  assert.equal(room.players, 2);
  assert.equal(room.source, "online");

  host.send({ type: "kick", to: guestWelcome.selfId, reason: "Тестовый кик" });
  const denied = await guest.next((frame) => frame.type === "denied");
  assert.equal(denied.reason, "Тестовый кик");
  const left = await host.next((frame) => frame.type === "peer-leave");
  assert.equal(left.peerId, guestWelcome.selfId);

  const guest2 = await connect(relay.url);
  guest2.send({ type: "join", room: "ABC234", name: "Второй", spectate: true });
  const welcome2 = await guest2.next((frame) => frame.type === "welcome");
  assert.equal(welcome2.spectate, true);
  await host.next((frame) => frame.type === "peer-join");

  host.send({ type: "close", reason: "Конец" });
  const closed = await guest2.next((frame) => frame.type === "closed");
  assert.equal(closed.reason, "Конец");
});

test("relay: dropped guests and hosts resume within the grace window", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());

  const host = await connect(relay.url);
  t.after(() => host.close());
  host.send({ type: "create", hostName: "Хост", meta: { public: false } });
  const hostWelcome = await host.next((frame) => frame.type === "welcome");
  assert.match(hostWelcome.token, /^t_/);

  const guest = await connect(relay.url);
  t.after(() => guest.close());
  guest.send({ type: "join", room: hostWelcome.room, name: "Гость" });
  const guestWelcome = await guest.next((frame) => frame.type === "welcome");
  assert.match(guestWelcome.token, /^t_/);
  await host.next((frame) => frame.type === "peer-join");

  // Drop the guest hard (no close handshake, like a network cut).
  guest.ws.terminate();
  await new Promise((resolve) => setTimeout(resolve, 120));

  // The host must not hear about a leave during the grace window.
  const leaveHeard = await Promise.race([
    host.next((frame) => frame.type === "peer-leave").then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 300)),
  ]);
  assert.equal(leaveHeard, false);

  // The guest resumes its seat on a fresh socket with the original token.
  const guest2 = await connect(relay.url);
  t.after(() => guest2.close());
  guest2.send({ type: "resume", room: hostWelcome.room, peerId: guestWelcome.selfId, token: guestWelcome.token });
  const resumed = await guest2.next((frame) => frame.type === "welcome");
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.selfId, guestWelcome.selfId);

  host.send({ type: "relay", to: guestWelcome.selfId, payload: { type: "state", view: { phase: "day" } } });
  const state = await guest2.next((frame) => frame.type === "relay");
  assert.equal(state.payload.view.phase, "day");

  // Now the host drops hard; the room survives the grace window.
  host.ws.terminate();
  await new Promise((resolve) => setTimeout(resolve, 120));

  const host2 = await connect(relay.url);
  t.after(() => host2.close());
  host2.send({ type: "resume", room: hostWelcome.room, peerId: hostWelcome.selfId, token: hostWelcome.token });
  const hostResumed = await host2.next((frame) => frame.type === "welcome");
  assert.equal(hostResumed.host, true);
  assert.equal(hostResumed.resumed, true);

  guest2.send({ type: "relay", to: hostWelcome.selfId, payload: { type: "action", kind: "ready" } });
  const action = await host2.next((frame) => frame.type === "relay");
  assert.equal(action.from, guestWelcome.selfId);
  assert.equal(action.payload.kind, "ready");
});

test("relay: resume with a wrong token or a dead room is denied", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());

  const host = await connect(relay.url);
  t.after(() => host.close());
  host.send({ type: "create", hostName: "Хост", meta: { public: false } });
  const welcome = await host.next((frame) => frame.type === "welcome");

  const stranger = await connect(relay.url);
  t.after(() => stranger.close());
  stranger.send({ type: "resume", room: welcome.room, peerId: welcome.selfId, token: "t_wrong" });
  const denied = await stranger.next((frame) => frame.type === "denied");
  assert.match(denied.reason, /сессия/i);

  const nobody = await connect(relay.url);
  t.after(() => nobody.close());
  nobody.send({ type: "resume", room: "ZZZ999", peerId: welcome.selfId, token: welcome.token });
  const lost = await nobody.next((frame) => frame.type === "denied");
  assert.match(lost.reason, /не найдена/i);
});

test("relay: prune keeps idle guests connected", async (t) => {
  const app = await startRelay();
  t.after(() => app.close());

  const host = await connect(app.url);
  t.after(() => host.close());
  host.send({ type: "create", hostName: "Хост", meta: { public: false } });
  const hostWelcome = await host.next((frame) => frame.type === "welcome");

  const guest = await connect(app.url);
  t.after(() => guest.close());
  guest.send({ type: "join", room: hostWelcome.room, name: "Гость" });
  const guestWelcome = await guest.next((frame) => frame.type === "welcome");
  await host.next((frame) => frame.type === "peer-join");

  // Two prune cycles: the old loop only pinged the host, so guests were
  // terminated on the second pass even though their sockets were healthy.
  app.relay._prune();
  await new Promise((resolve) => setTimeout(resolve, 60));
  app.relay._prune();
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(guest.ws.readyState, WebSocket.OPEN);
  host.send({
    type: "relay",
    to: guestWelcome.selfId,
    payload: { type: "state", view: { phase: "lobby" } },
  });
  const state = await guest.next((frame) => frame.type === "relay");
  assert.equal(state.payload.view.phase, "lobby");
  assert.equal(guest.ws.readyState, WebSocket.OPEN);
});

test("relay: a browser opening /rooms is left to the app shell", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());

  const json = await fetch(`${relay.http}/rooms`).then((response) => response.json());
  assert.deepEqual(json.rooms, []);

  // Documents navigate with Accept: text/html; the static server must answer
  // with the app (or a redirect), not the relay's JSON room list.
  const page = await fetch(`${relay.http}/rooms`, { headers: { accept: "text/html,application/xhtml+xml" } });
  assert.equal(page.status, 404);
  assert.equal(await page.text(), "");
});

test("relay: guest cannot relay to another guest and bad sizes are rejected", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());

  const host = await connect(relay.url);
  host.send({ type: "create", hostName: "Хост", meta: { public: false } });
  const hostWelcome = await host.next((frame) => frame.type === "welcome");

  const first = await connect(relay.url);
  first.send({ type: "join", room: hostWelcome.room, name: "Первый" });
  const firstWelcome = await first.next((frame) => frame.type === "welcome");

  const second = await connect(relay.url);
  second.send({ type: "join", room: hostWelcome.room, name: "Второй" });
  const secondWelcome = await second.next((frame) => frame.type === "welcome");

  first.send({ type: "relay", to: secondWelcome.selfId, payload: { type: "action" } });
  const denied = await first.next((frame) => frame.type === "denied");
  assert.match(denied.reason, /только хосту/i);

  const rooms = await fetch(`${relay.http}/rooms`).then((response) => response.json());
  assert.equal(rooms.rooms.length, 0, "private rooms are not listed");

  const closed = new Promise((resolve) => second.ws.once("close", (code) => resolve(code)));
  second.ws.send("x".repeat(50_000));
  const code = await closed;
  assert.equal(code, 1009);
  assert.equal(firstWelcome.room, hostWelcome.room);
});

test("relay: a burst of fast messages throttles without killing the socket", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());

  const host = await connect(relay.url);
  t.after(() => host.close());
  host.send({ type: "create", hostName: "Хост", meta: { public: false } });
  const hostWelcome = await host.next((frame) => frame.type === "welcome");

  const guest = await connect(relay.url);
  t.after(() => guest.close());
  guest.send({ type: "join", room: hostWelcome.room, name: "Гость" });
  const guestWelcome = await guest.next((frame) => frame.type === "welcome");
  await host.next((frame) => frame.type === "peer-join");

  // Flood far past the per-socket budget: the relay must answer with a
  // transient throttle frame, never a fatal deny, and keep the socket open.
  const flood = 200;
  for (let i = 0; i < flood; i += 1) {
    guest.send({
      type: "relay",
      to: hostWelcome.selfId,
      payload: { type: "action", kind: "chat", text: `msg ${i}` },
    });
  }
  const throttle = await guest.next((frame) => frame.type === "throttle");
  assert.equal(typeof throttle.retryAfterMs, "number");
  assert.ok(throttle.retryAfterMs > 0);
  assert.equal(guest.ws.readyState, WebSocket.OPEN);

  const denied = await Promise.race([
    guest.next((frame) => frame.type === "denied").then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  assert.equal(denied, false, "a burst of fast messages must never be denied fatally");
  assert.equal(guest.ws.readyState, WebSocket.OPEN);

  // Once the budget refills, frames flow again on the very same socket.
  await new Promise((resolve) => setTimeout(resolve, throttle.retryAfterMs + 150));
  guest.send({
    type: "relay",
    to: hostWelcome.selfId,
    payload: { type: "action", kind: "chat", text: "after pause" },
  });
  const action = await host.next((frame) => frame.type === "relay" && frame.payload.text === "after pause");
  assert.equal(action.from, guestWelcome.selfId);
  assert.equal(guest.ws.readyState, WebSocket.OPEN);
});

test("client adapter: a burst of fast messages is paced and fully delivered", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());

  const host = await connect(relay.url);
  t.after(() => host.close());
  host.send({ type: "create", hostName: "Хост", meta: { public: false } });
  const hostWelcome = await host.next((frame) => frame.type === "welcome");

  const adapter = new OnlineGuestAdapter({ url: relay.url, code: hostWelcome.room, name: "Гость" });
  t.after(() => adapter.close());
  const info = await adapter.connect();
  assert.equal(info.code, hostWelcome.room);
  const peerJoin = await host.next((frame) => frame.type === "peer-join");
  assert.equal(peerJoin.peer.id, info.selfId);

  // Fire far faster than the relay's per-socket budget: the adapter must pace
  // the burst through its own queue so every frame reaches the host, in
  // order, without tripping the relay or dying on a deny.
  const total = 40;
  for (let i = 0; i < total; i += 1) {
    assert.equal(adapter.send({ type: "action", kind: "chat", text: `msg-${i}` }), true);
  }

  const seen = [];
  while (seen.length < total) {
    const frame = await host.next(
      (item) => item.type === "relay" && /^msg-\d+$/.test(item.payload?.text ?? ""),
      8000,
    );
    seen.push(frame.payload.text);
  }
  assert.deepEqual(seen, Array.from({ length: total }, (_, i) => `msg-${i}`));
  assert.equal(adapter.closed, false);
  assert.equal(adapter.connected, true);

  // The connection must still be usable after the burst.
  assert.equal(adapter.send({ type: "action", kind: "chat", text: "still alive" }), true);
  const tail = await host.next((frame) => frame.type === "relay" && frame.payload.text === "still alive");
  assert.equal(tail.from, info.selfId);
});
