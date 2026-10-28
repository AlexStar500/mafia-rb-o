import test from "node:test";
import assert from "node:assert/strict";

import { GameEngine, PHASE } from "../js/game/engine.js";
import { computeRoleSetup, normalizeRoomConfig, ROLES } from "../js/data/roles.js";
import { mulberry32 } from "../js/core/random.js";
import {
  RateLimiter,
  WindowLimiter,
  isValidRoomCode,
  normalizeRelayUrl,
  sanitizeChat,
  sanitizeNick,
} from "../js/core/security.js";

function setupEngine({ count = 8, roles = {}, config = {}, now = 1_000_000 } = {}) {
  const clock = { value: now };
  const engine = new GameEngine({
    roomCode: "ABC234",
    hostId: "p_self000001",
    config: { maxPlayers: count, minStart: 4, roles, ...config },
    now: () => clock.value,
    rng: mulberry32(42),
  });
  for (let i = 0; i < count; i += 1) {
    engine.addPlayer({
      id: i === 0 ? "p_self000001" : `p_player${String(i).padStart(3, "0")}`,
      name: `Игрок ${i + 1}`,
      ready: true,
    });
  }
  return { engine, clock };
}

function setRoles(engine, roleIds) {
  const roles = [...roleIds];
  const mafia = new Set(["mafia", "assassin", "bartender", "spy"]);
  const neutral = new Set(["jester", "puppeteer", "twin"]);
  for (const player of engine.players) {
    player.roleId = roles.shift() ?? "civilian";
    player.team = mafia.has(player.roleId) ? "mafia" : neutral.has(player.roleId) ? "neutral" : "town";
  }
}

function findRole(engine, roleId) {
  return engine.players.filter((player) => player.roleId === roleId);
}

function setPhase(engine, phase, seconds = 30) {
  engine._setPhase(phase, seconds, "test", engine.clock());
}

test("role balance always totals the player count", () => {
  for (let count = 4; count <= 20; count += 1) {
    for (const options of [
      { doctor: 1, assassin: 0, jester: 0 },
      { doctor: 2, assassin: 1, jester: 1 },
      { doctor: 0, assassin: 0, jester: 0 },
      { doctor: 1, bartender: 1, spy: 1, musician: 1, judge: 1, puppeteer: 1, jester: 2, twin: 1 },
    ]) {
      const setup = computeRoleSetup(count, options);
      assert.equal(setup.ids.length, count);
      assert.equal(setup.counts.sheriff, 1);
      assert.ok(setup.counts.mafia >= 1);
      assert.ok(setup.counts.civilian >= 0);
      assert.equal(
        Object.values(setup.counts).reduce((sum, value) => sum + value, 0),
        count,
      );
    }
  }
});

test("per-role counts are honoured and trimmed only for balance", () => {
  const withAssassin = computeRoleSetup(7, { assassin: 1 });
  assert.equal(withAssassin.counts.assassin, 1);
  assert.ok(withAssassin.counts.mafia >= 1);

  const manyDoctors = computeRoleSetup(10, { doctor: 3 });
  assert.equal(manyDoctors.counts.doctor, 3);

  const twins = computeRoleSetup(10, { twin: 1 });
  assert.equal(twins.counts.twin, 2, "twins always come as a pair");
  assert.equal(twins.ids.filter((id) => id === "twin").length, 2);

  const tooManyMafia = computeRoleSetup(5, { assassin: 4, bartender: 3, spy: 2 });
  assert.ok(tooManyMafia.counts.mafia >= 1, "at least one plain mafia survives");
  assert.ok(tooManyMafia.counts.civilian >= 0, "civilians may be zero when the host fills every seat");
  assert.ok(tooManyMafia.warnings.length > 0);
});

test("twins are never left as a lone pair when the roster overflows", () => {
  // Force heavy trimming: a small city with far more roles than seats.
  const setup = computeRoleSetup(4, { twin: 1, doctor: 3, judge: 3, musician: 3, jester: 3, puppeteer: 3 });
  assert.ok(setup.counts.twin === 0 || setup.counts.twin === 2, "twin is always 0 or 2, never 1");
  assert.equal(setup.ids.filter((id) => id === "twin").length, setup.counts.twin);
  assert.equal(setup.ids.length, 4);
});

test("room config clamps hostile values", () => {
  const config = normalizeRoomConfig({
    maxPlayers: 999,
    minStart: -5,
    timers: { night: -4, discussion: "x", voting: 10000 },
    roles: { doctor: "yes", assassin: 1, jester: null },
    botChat: "evil",
  });
  assert.equal(config.maxPlayers, 25);
  assert.equal(config.minStart, 4);
  assert.equal(config.timers.night, 12);
  assert.equal(config.timers.voting, 90);
  assert.equal(config.botChat, "normal");
  assert.equal(config.roles.assassin, 1);
  assert.equal(config.roles.doctor, 1);
});

test("engine does not leak roles to town, but shows them to mafia", () => {
  const { engine } = setupEngine({ count: 8 });
  engine.start(true);
  const mafia = findRole(engine, "mafia")[0] ?? findRole(engine, "assassin")[0];
  const town = findRole(engine, "civilian")[0];
  assert.ok(mafia && town);

  const townView = engine.getView(town.id);
  const mafiaView = engine.getView(mafia.id);
  const spectatorView = engine.getView("spectator");

  const townOther = townView.players.find((player) => player.id === mafia.id);
  assert.equal(townOther.roleId, null);
  assert.equal(mafiaView.players.find((player) => player.id === town.id).roleId, null);
  assert.equal(mafiaView.players.find((player) => player.id === mafia.id).roleId, mafia.roleId);
  assert.ok(spectatorView.players.every((player) => player.roleId));
});

test("revealOnDeath exposes only dead roles to every viewer", () => {
  const { engine } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["mafia", "sheriff", "doctor", "civilian", "civilian", "civilian"]);
  const [, , doctor, deadTown, livingTown] = engine.players;
  deadTown.alive = false;
  deadTown.death = { cause: "mafia", day: 1 };

  const livingView = engine.getView(livingTown.id);
  const deadView = engine.getView(deadTown.id);

  assert.equal(livingView.players.find((player) => player.id === deadTown.id).roleId, "civilian");
  assert.equal(livingView.players.find((player) => player.id === doctor.id).roleId, null);
  assert.equal(deadView.players.find((player) => player.id === doctor.id).roleId, null);
  assert.equal(deadView.players.find((player) => player.id === deadTown.id).roleId, "civilian");

  engine.config.revealOnDeath = false;
  const hiddenView = engine.getView(livingTown.id);
  assert.equal(hiddenView.players.find((player) => player.id === deadTown.id).roleId, null);
});

test("doctor save prevents the mafia kill", () => {
  const { engine, clock } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["mafia", "doctor", "sheriff", "civilian", "civilian", "civilian"]);
  const [mafia, doctor, , victim] = engine.players;

  assert.equal(engine.setNightAction(mafia.id, "kill", victim.id).ok, true);
  assert.equal(engine.setNightAction(doctor.id, "heal", victim.id).ok, true);
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(victim.alive, true);
  assert.equal(engine.lastNight.saved, true);
  assert.equal(engine.lastNight.deaths.length, 0);
});

test("assassin contract kills through healing and no longer costs the assassin his life", () => {
  const first = setupEngine({ count: 8 });
  first.engine.start(true);
  setRoles(first.engine, [
    "mafia",
    "assassin",
    "doctor",
    "sheriff",
    "civilian",
    "civilian",
    "civilian",
    "civilian",
  ]);
  const [mafia, assassin, doctor, target] = first.engine.players;
  first.engine.day = 2;
  assert.equal(first.engine.setNightAction(assassin.id, "contract", target.id).ok, true);
  // The doctor is busy elsewhere, so the contract takes the assassin too.
  assert.equal(first.engine.setNightAction(doctor.id, "heal", mafia.id).ok, true);
  assert.equal(first.engine.setNightAction(mafia.id, "kill", first.engine.players[4].id).ok, true);
  first.clock.value = first.engine.phaseEndsAt + 1;
  first.engine.tick(first.clock.value);
  assert.equal(target.alive, false, "contract target dies through healing");
  assert.equal(assassin.alive, true, "the contract no longer kills the assassin");

  const second = setupEngine({ count: 8 });
  second.engine.start(true);
  setRoles(second.engine, [
    "mafia",
    "assassin",
    "doctor",
    "sheriff",
    "civilian",
    "civilian",
    "civilian",
    "civilian",
  ]);
  const [mafia2, assassin2, doctor2, target2] = second.engine.players;
  second.engine.day = 2;
  assert.equal(second.engine.setNightAction(assassin2.id, "contract", target2.id).ok, true);
  assert.equal(second.engine.setNightAction(doctor2.id, "heal", assassin2.id).ok, true);
  second.clock.value = second.engine.phaseEndsAt + 1;
  second.engine.tick(second.clock.value);
  assert.equal(target2.alive, false);
  assert.equal(assassin2.alive, true, "a healed assassin survives the contract");
});

test("bartender turns the guest's daytime chat into symbols", () => {
  const { engine, clock } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["bartender", "mafia", "sheriff", "civilian", "civilian", "civilian"]);
  const [bartender, , , guest] = engine.players;
  assert.equal(engine.setNightAction(bartender.id, "drink", guest.id).ok, true);
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  setPhase(engine, PHASE.DISCUSSION, 30);
  const result = engine.addChat(guest.id, "Слушайте меня внимательно, я мирный.", { channel: "public" });
  assert.equal(result.ok, true);
  assert.equal(result.message.drunk, true);
  assert.doesNotMatch(result.message.text, /[а-яa-z]/i);
  assert.ok(result.message.text.length >= 4);

  const view = engine.getView(guest.id);
  assert.equal(view.self.drunk, true);
});

test("spy reveals an exact role once per day", () => {
  const { engine } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["spy", "mafia", "sheriff", "doctor", "civilian", "civilian"]);
  const [spy, mafia] = engine.players;
  setPhase(engine, PHASE.DISCUSSION, 30);

  const result = engine.setDayAction(spy.id, "reveal", mafia.id);
  assert.equal(result.ok, true);
  assert.equal(result.reveal.roleId, "mafia");
  assert.equal(result.reveal.roleName, ROLES.mafia.name);

  const again = engine.setDayAction(spy.id, "reveal", engine.players[2].id);
  assert.equal(again.ok, false, "one reveal per day");

  const view = engine.getView(spy.id);
  assert.equal(view.day, 1, "day stays a number");
  assert.equal(view.dayActions.spy.usedToday, true);
  assert.equal(view.self.reveals.at(-1).roleId, "mafia");
});

test("public view keeps the day number apart from day actions", () => {
  const { engine } = setupEngine({ count: 6 });
  engine.start(true);
  setPhase(engine, PHASE.DISCUSSION, 30);
  const view = engine.getView(engine.players[0].id);
  assert.equal(typeof view.day, "number");
  assert.equal(view.day, 1);
  assert.equal(typeof view.dayActions, "object");
  assert.ok(view.dayActions, "day actions are exposed under their own key");
  assert.ok(!String(view.day).includes("[object Object]"));
});

test("judge kills mafia but dies on a wrong verdict", () => {
  const { engine } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["mafia", "judge", "sheriff", "civilian", "civilian", "civilian"]);
  const [mafia, judge] = engine.players;
  setPhase(engine, PHASE.DISCUSSION, 30);
  const hit = engine.setDayAction(judge.id, "judge", mafia.id);
  assert.equal(hit.ok, true);
  assert.equal(hit.hit, true);
  assert.equal(mafia.alive, false);
  assert.equal(judge.alive, true);

  const second = setupEngine({ count: 6 });
  second.engine.start(true);
  setRoles(second.engine, ["mafia", "judge", "sheriff", "civilian", "civilian", "civilian"]);
  const [mafia2, judge2, , innocent] = second.engine.players;
  setPhase(second.engine, PHASE.DISCUSSION, 30);
  const miss = second.engine.setDayAction(judge2.id, "judge", innocent.id);
  assert.equal(miss.ok, true);
  assert.equal(miss.hit, false);
  assert.equal(judge2.alive, false, "a wrong verdict kills the judge");
  assert.equal(innocent.alive, true);
  assert.equal(mafia2.alive, true);
});

test("musician blocks the night action and the next vote", () => {
  const { engine, clock } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["mafia", "musician", "sheriff", "doctor", "civilian", "civilian"]);
  const [mafia, musician, , , victim] = engine.players;
  engine.setNightAction(mafia.id, "kill", victim.id);
  assert.equal(engine.setNightAction(musician.id, "block", mafia.id).ok, true);
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(victim.alive, true, "the blocked mafia cannot kill");
  assert.equal(mafia.blockedDay, engine.day);

  setPhase(engine, PHASE.VOTING, 30);
  const blockedVote = engine.castVote(mafia.id, victim.id);
  assert.equal(blockedVote.ok, false);
  assert.match(blockedVote.error, /Музыкант/);
});

test("a hanged twin hands the win to the survivor", () => {
  const { engine, clock } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["twin", "twin", "mafia", "sheriff", "civilian", "civilian"]);
  const [first, second] = engine.players;
  setPhase(engine, PHASE.VOTING, 30);
  for (const player of engine.players) {
    if (player.alive) engine.castVote(player.id, first.id);
  }
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(engine.phase, PHASE.ENDED);
  assert.equal(engine.winner.team, "neutral");
  assert.equal(engine.winner.reason, "twin");
  assert.equal(engine.winner.playerId, second.id);
  assert.equal(second.alive, true, "the survivor does not die on a vote");
});

test("a killed twin drags the other one along, without a win", () => {
  const { engine, clock } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["mafia", "twin", "twin", "sheriff", "civilian", "doctor"]);
  const [mafia, firstTwin, secondTwin] = engine.players;
  engine.setNightAction(mafia.id, "kill", firstTwin.id);
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(firstTwin.alive, false);
  assert.equal(secondTwin.alive, false, "the second twin dies of grief");
  assert.notEqual(engine.winner?.reason, "twin");
});

test("puppeteer co-wins with the puppet's team", () => {
  const { engine } = setupEngine({ count: 7 });
  engine.start(true);
  setRoles(engine, ["puppeteer", "mafia", "sheriff", "doctor", "civilian", "civilian", "civilian"]);
  const [puppeteer, mafia] = engine.players;
  puppeteer.puppetTargetId = mafia.id;

  engine.endGame("mafia", { reason: "parity" });
  assert.equal(engine.winner.team, "mafia");
  assert.ok(engine.winner.winnerIds.includes(puppeteer.id));
  assert.equal(engine.winner.coWinners[0].targetId, mafia.id);
});

test("mafia vote majority eliminates the jester and ends the game", () => {
  const { engine, clock } = setupEngine({ count: 7, roles: { jester: true } });
  engine.start(true);
  setRoles(engine, ["jester", "mafia", "sheriff", "doctor", "civilian", "civilian", "civilian"]);
  const jester = engine.players[0];
  setPhase(engine, PHASE.VOTING, 30);
  for (const player of engine.players) {
    if (player.alive) engine.castVote(player.id, jester.id);
  }
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(engine.phase, PHASE.ENDED);
  assert.equal(engine.winner.team, "neutral");
  assert.equal(engine.winner.playerId, jester.id);
});

test("a tied vote hangs nobody", () => {
  const { engine, clock } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["mafia", "sheriff", "doctor", "civilian", "civilian", "civilian"]);
  setPhase(engine, PHASE.VOTING, 30);
  engine.castVote(engine.players[1].id, engine.players[0].id);
  engine.castVote(engine.players[2].id, engine.players[1].id);
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(engine.voteResult.eliminatedId, null);
  assert.equal(engine.voteResult.tie, true);
  assert.equal(engine.phase, PHASE.VERDICT);
});

test("town wins when the last mafia is voted out", () => {
  const { engine, clock } = setupEngine({ count: 5 });
  engine.start(true);
  setRoles(engine, ["mafia", "sheriff", "doctor", "civilian", "civilian"]);
  const mafia = engine.players[0];
  setPhase(engine, PHASE.VOTING, 30);
  for (const player of engine.players) {
    if (player.alive) engine.castVote(player.id, mafia.id);
  }
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(engine.phase, PHASE.ENDED);
  assert.equal(engine.winner.team, "town");
});

test("mafia wins at parity", () => {
  const { engine, clock } = setupEngine({ count: 4 });
  engine.start(true);
  setRoles(engine, ["mafia", "sheriff", "civilian", "civilian"]);
  const [mafia, sheriff, victim] = engine.players;
  engine.setNightAction(mafia.id, "kill", victim.id);
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);
  // 1 mafia vs 2 town — not parity yet.
  assert.notEqual(engine.winner?.team, "mafia");

  // Continue to the next night directly for the parity check.
  engine.day = 2;
  engine._enterNight(clock.value);
  engine.setNightAction(mafia.id, "kill", sheriff.id);
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(engine.phase, PHASE.ENDED);
  assert.equal(engine.winner.team, "mafia");
});

test("chat is filtered by channel", () => {
  const { engine } = setupEngine({ count: 6 });
  engine.start(true);
  setRoles(engine, ["mafia", "sheriff", "doctor", "civilian", "civilian", "civilian"]);
  const mafia = engine.players[0];
  const town = engine.players[3];
  const result = engine.addChat(mafia.id, "Берём шерифа.", { channel: "mafia", intent: "mafia-night" });
  assert.equal(result.ok, true);

  const mafiaView = engine.getView(mafia.id);
  const townView = engine.getView(town.id);
  assert.equal(mafiaView.chat.some((message) => message.channel === "mafia"), true);
  assert.equal(townView.chat.some((message) => message.channel === "mafia"), false);

  // The dead watch the living: they read the mafia feed but cannot write to it.
  const dead = engine.players[1];
  dead.alive = false;
  const deadView = engine.getView(dead.id);
  assert.equal(deadView.chat.some((message) => message.channel === "mafia"), true);
  assert.equal(deadView.self.chatChannels.includes("mafia"), true);
  assert.equal(deadView.self.chatWriteChannels.includes("mafia"), false);
  assert.equal(deadView.self.chatWriteChannels.includes("dead"), true);
  assert.equal(engine.addChat(dead.id, "Я всё вижу.", { channel: "mafia" }).ok, false);
});

test("rate limiter and window limiter enforce limits", () => {
  let now = 0;
  const limiter = new RateLimiter({ capacity: 2, refillPerSec: 1, now: () => now });
  assert.equal(limiter.take().ok, true);
  assert.equal(limiter.take().ok, true);
  assert.equal(limiter.take().ok, false);
  now = 1000;
  assert.equal(limiter.take().ok, true);

  const window = new WindowLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(window.take().ok, true);
  assert.equal(window.take().ok, true);
  assert.equal(window.take().ok, false);
});

test("sanitizers remove markup, bidi tricks and links", () => {
  assert.equal(sanitizeNick("<b>Admin</b>"), "");
  assert.equal(sanitizeNick("Ночной <b>Лис</b>"), "Ночной Лис");
  assert.equal(sanitizeNick("Л\u202eиса"), "Лиса");
  assert.match(sanitizeChat("<script>alert(1)</script> https://evil.example"), /^‹script›/);
  assert.doesNotMatch(sanitizeChat("https://evil.example"), /https?:/);
  assert.equal(isValidRoomCode("ABC234"), true);
  assert.equal(isValidRoomCode("ABC23"), false);
});

test("relay URLs reject dangerous protocols and credentials", () => {
  assert.equal(normalizeRelayUrl("javascript:alert(1)"), "");
  assert.equal(normalizeRelayUrl("https://example.com"), "https://example.com/api");
  assert.equal(normalizeRelayUrl("https://example.com/api"), "https://example.com/api");
  assert.equal(normalizeRelayUrl("ws://localhost:8787/ws"), "ws://localhost:8787/ws");
  assert.equal(normalizeRelayUrl("wss://user:pass@example.com/ws"), "");
});
