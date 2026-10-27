import test from "node:test";
import assert from "node:assert/strict";

import { GameEngine, PHASE } from "../js/game/engine.js";
import { computeRoleSetup, normalizeRoomConfig } from "../js/data/roles.js";
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
  for (const player of engine.players) {
    player.roleId = roles.shift() ?? "civilian";
    player.team = player.roleId === "mafia" || player.roleId === "assassin" ? "mafia" : player.roleId === "jester" ? "neutral" : "town";
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
      { doctor: true, assassin: false, jester: false },
      { doctor: true, assassin: true, jester: true },
      { doctor: false, assassin: false, jester: false },
    ]) {
      const setup = computeRoleSetup(count, options);
      assert.equal(setup.ids.length, count);
      assert.equal(setup.counts.sheriff, 1);
      assert.ok(setup.counts.mafia + setup.counts.assassin >= 1);
      assert.ok(setup.counts.civilian >= 1);
      assert.ok(setup.counts.jester <= 1);
      assert.equal(
        Object.values(setup.counts).reduce((sum, value) => sum + value, 0),
        count,
      );
    }
  }
});

test("assassin is only enabled from 8 players", () => {
  const small = computeRoleSetup(7, { doctor: true, assassin: true, jester: false });
  assert.equal(small.counts.assassin, 0);
  assert.ok(small.warnings.some((warning) => warning.includes("Ассасин")));
  const big = computeRoleSetup(8, { doctor: true, assassin: true, jester: false });
  assert.equal(big.counts.assassin, 1);
});

test("room config clamps hostile values", () => {
  const config = normalizeRoomConfig({
    maxPlayers: 999,
    minStart: -5,
    timers: { night: -4, discussion: "x", voting: 10000 },
    roles: { doctor: "yes", assassin: 1, jester: null },
    botChat: "evil",
  });
  assert.equal(config.maxPlayers, 20);
  assert.equal(config.minStart, 4);
  assert.equal(config.timers.night, 12);
  assert.equal(config.timers.voting, 90);
  assert.equal(config.botChat, "normal");
  assert.equal(config.roles.assassin, true);
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

test("assassin contract pierces doctor healing", () => {
  const { engine, clock } = setupEngine({ count: 8 });
  engine.start(true);
  setRoles(engine, ["mafia", "assassin", "doctor", "sheriff", "civilian", "civilian", "civilian", "civilian"]);
  const [mafia, assassin, doctor, target] = engine.players;
  engine.day = 2;

  assert.equal(engine.setNightAction(assassin.id, "contract", target.id).ok, true);
  assert.equal(engine.setNightAction(doctor.id, "heal", target.id).ok, true);
  assert.equal(engine.setNightAction(mafia.id, "kill", engine.players[4].id).ok, true);
  clock.value = engine.phaseEndsAt + 1;
  engine.tick(clock.value);

  assert.equal(target.alive, false);
  assert.equal(engine.lastNight.deaths.some((death) => death.id === target.id && death.cause === "assassin"), true);
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
  assert.equal(normalizeRelayUrl("https://example.com"), "");
  assert.equal(normalizeRelayUrl("ws://localhost:8787/ws"), "ws://localhost:8787/ws");
  assert.equal(normalizeRelayUrl("wss://user:pass@example.com/ws"), "");
});
