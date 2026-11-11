import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import server from "../api/index.mjs";

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
  };
}

async function connect(url, sockets) {
  const ws = new WebSocket(url);
  sockets.add(ws);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return client(ws);
}

test("api relay: HTTP probes and a full WebSocket flow over /api/ws", async (t) => {
  const sockets = new Set();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const ws of sockets) {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address();
  const http = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/api/ws`;

  const health = await fetch(`${http}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.service, "mafia-relay");
  assert.equal(health.websocket, true);

  // The vercel.json rewrite delivers `/api/health` as `/api?path=health`.
  const rewritten = await fetch(`${http}/api?path=health`).then((response) => response.json());
  assert.equal(rewritten.ok, true);

  const empty = await fetch(`${http}/api/rooms`).then((response) => response.json());
  assert.deepEqual(empty.rooms, []);

  const host = await connect(wsUrl, sockets);
  host.send({
    type: "create",
    room: "VERCEL",
    hostName: "Хост",
    meta: { name: "Тест", public: true, maxPlayers: 8, minStart: 4, players: 1, humans: 1 },
  });
  const hostWelcome = await host.next((frame) => frame.type === "welcome");
  assert.equal(hostWelcome.host, true);
  assert.match(hostWelcome.token, /^t_/);

  const guest = await connect(wsUrl, sockets);
  guest.send({ type: "join", room: "VERCEL", name: "Гость" });
  const guestWelcome = await guest.next((frame) => frame.type === "welcome");
  assert.equal(guestWelcome.hostId, hostWelcome.selfId);
  assert.match(guestWelcome.token, /^t_/);
  await host.next((frame) => frame.type === "peer-join");

  host.send({ type: "relay", to: guestWelcome.selfId, payload: { type: "state", view: { phase: "lobby" } } });
  const state = await guest.next((frame) => frame.type === "relay");
  assert.equal(state.payload.view.phase, "lobby");

  guest.send({ type: "relay", to: hostWelcome.selfId, payload: { type: "action", kind: "ready" } });
  const action = await host.next((frame) => frame.type === "relay");
  assert.equal(action.payload.kind, "ready");

  const listed = await fetch(`${http}/api/rooms`).then((response) => response.json());
  assert.equal(listed.rooms.length, 1);
  assert.equal(listed.rooms[0].code, "VERCEL");

  // A dropped guest resumes its seat with the original token.
  guest.ws.terminate();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const guest2 = await connect(wsUrl, sockets);
  guest2.send({ type: "resume", room: "VERCEL", peerId: guestWelcome.selfId, token: guestWelcome.token });
  const resumed = await guest2.next((frame) => frame.type === "welcome");
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.selfId, guestWelcome.selfId);

  host.send({ type: "relay", to: guestWelcome.selfId, payload: { type: "state", view: { phase: "night" } } });
  const after = await guest2.next((frame) => frame.type === "relay");
  assert.equal(after.payload.view.phase, "night");
});
