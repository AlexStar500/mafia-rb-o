import assert from "node:assert/strict";
import test from "node:test";
import handler, { __rooms } from "../api/index.mjs";

let lastStatus = 200;

function call(method, path, body = null) {
  const [pathname, search = ""] = path.split("?");
  const parts = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const query = search ? `?${search}` : "";
  const req = { method, url: `/api/${parts.join("/")}${query}`, body, query: { path: parts } };
  let payload = null;
  const res = {
    statusCode: 200,
    setHeader() {},
    end(text) {
      lastStatus = this.statusCode;
      payload = text ? JSON.parse(text) : null;
    },
  };
  return handler(req, res).then(() => ({ status: lastStatus, body: payload }));
}

test.beforeEach(() => {
  __rooms.clear();
});

test("HTTP relay creates a room, joins a guest and moves frames both ways", async () => {
  const created = await call("POST", "/api/rooms", {
    code: "ABC234",
    hostName: "Хост",
    meta: { name: "Тест", maxPlayers: 8, minStart: 4, players: 1, humans: 1 },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.equal(created.body.code, "ABC234");
  assert.match(created.body.hostId, /^h_/);
  assert.match(created.body.token, /^t_/);

  const joined = await call("POST", "/api/rooms/ABC234/join", {
    name: "Гость",
    color: "#ff0000",
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.ok, true);
  assert.equal(joined.body.hostId, created.body.hostId);
  assert.match(joined.body.peerId, /^p_/);

  const hostEvents = await call(
    "GET",
    `/api/rooms/ABC234/events?peerId=${created.body.hostId}&token=${created.body.token}&since=0`,
  );
  assert.equal(hostEvents.status, 200);
  const joinEvent = hostEvents.body.events.find((event) => event.type === "peer-join");
  assert.ok(joinEvent);
  assert.equal(joinEvent.peer.name, "Гость");

  const welcomePayload = { type: "welcome", view: { phase: "lobby" }, chat: [] };
  const sent = await call("POST", "/api/rooms/ABC234/events", {
    peerId: created.body.hostId,
    token: created.body.token,
    to: joined.body.peerId,
    payload: welcomePayload,
  });
  assert.equal(sent.body.ok, true);

  const guestEvents = await call(
    "GET",
    `/api/rooms/ABC234/events?peerId=${joined.body.peerId}&token=${joined.body.token}&since=0`,
  );
  const relayToGuest = guestEvents.body.events.find((event) => event.type === "relay");
  assert.ok(relayToGuest);
  assert.equal(relayToGuest.from, created.body.hostId);
  assert.deepEqual(relayToGuest.payload, welcomePayload);

  const action = { type: "action", kind: "ready", ready: true };
  const guestSent = await call("POST", "/api/rooms/ABC234/events", {
    peerId: joined.body.peerId,
    token: joined.body.token,
    payload: action,
  });
  assert.equal(guestSent.body.ok, true);

  const hostEvents2 = await call(
    "GET",
    `/api/rooms/ABC234/events?peerId=${created.body.hostId}&token=${created.body.token}&since=${hostEvents.body.cursor}`,
  );
  const relayToHost = hostEvents2.body.events.find((event) => event.type === "relay");
  assert.ok(relayToHost);
  assert.equal(relayToHost.from, joined.body.peerId);
  assert.deepEqual(relayToHost.payload, action);
});

test("HTTP relay rejects bad tokens and closes the room for guests", async () => {
  const created = await call("POST", "/api/rooms", {
    code: "XYZ789",
    hostName: "Хост",
    meta: { name: "Тест", maxPlayers: 8, minStart: 4 },
  });
  const joined = await call("POST", "/api/rooms/XYZ789/join", { name: "Гость" });

  const denied = await call(
    "GET",
    `/api/rooms/XYZ789/events?peerId=${joined.body.peerId}&token=wrong&since=0`,
  );
  assert.equal(denied.status, 403);

  const closed = await call("POST", "/api/rooms/XYZ789/close", {
    peerId: created.body.hostId,
    token: created.body.token,
    reason: "Конец",
  });
  assert.equal(closed.body.ok, true);

  const guestEvents = await call(
    "GET",
    `/api/rooms/XYZ789/events?peerId=${joined.body.peerId}&token=${joined.body.token}&since=0`,
  );
  const closedEvent = guestEvents.body.events.find((event) => event.type === "closed");
  assert.ok(closedEvent);
  assert.equal(closedEvent.reason, "Конец");
});

test("HTTP relay lists only public live rooms", async () => {
  await call("POST", "/api/rooms", {
    code: "PUB234",
    hostName: "Хост",
    meta: { name: "Публичная", public: true, players: 1, humans: 1 },
  });
  await call("POST", "/api/rooms", {
    code: "PRV234",
    hostName: "Хост",
    meta: { name: "Приватная", public: false, players: 1, humans: 1 },
  });
  const list = await call("GET", "/api/rooms");
  assert.equal(list.status, 200);
  assert.equal(list.body.rooms.length, 1);
  assert.equal(list.body.rooms[0].code, "PUB234");
});

test("HTTP relay health reports the protocol", async () => {
  const health = await call("GET", "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, "mafia-relay");
  assert.equal(health.body.http, true);
  assert.equal(health.body.protocol, 2);
});
