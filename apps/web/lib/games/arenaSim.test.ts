import { test } from "node:test";
import assert from "node:assert/strict";
import { ARENA, WAVE_COUNT } from "./arenaTypes";
import { circleHitsRect, moveWithCollisions, resolveCircleRect } from "./geom";
import {
  adoptSnapshot,
  applyHit,
  createHostState,
  snapshotFrom,
  startRound,
  stepHost,
} from "./arenaSim";


const roster = [{ id: "u1", handle: "Alice" }, { id: "u2", handle: "Bob" }];
const rnd = () => 0.5;

test("startRound arms a countdown with an empty arena", () => {
  const s = createHostState(roster);
  startRound(s);
  assert.equal(s.phase, "countdown");
  assert.equal(s.wave, 0);
  assert.ok(s.clock > 0);
  assert.equal(s.bots.length, 0);
  assert.equal(s.coreHp, 60);
  for (const p of Object.values(s.players)) {
    assert.equal(p.alive, true);
    assert.equal(p.hp, 6);
    assert.equal(p.score, 0);
  }
});

test("countdown elapses into wave 1 and spawns bots", () => {
  const s = createHostState(roster);
  startRound(s);
  // Run past the countdown.
  for (let i = 0; i < 40; i++) stepHost(s, 0.1, i * 100, rnd);
  assert.equal(s.phase, "wave");
  assert.equal(s.wave, 1);
  assert.ok(s.bots.length >= 3, `expected bots, got ${s.bots.length}`);
});

test("finishing a bot scores the shooter and removes it", () => {
  const s = createHostState(roster);
  startRound(s);
  for (let i = 0; i < 60; i++) stepHost(s, 0.1, i * 100, rnd);
  const bot = s.bots[0];
  assert.ok(bot, "bots should exist in wave 1");
  const shooter = s.players["u1"];
  const scoreBefore = shooter.score;
  let guard = 0;
  while (s.bots.some((b) => b.id === bot.id) && guard++ < 10) {
    applyHit(s, "u1", bot.id); // bots have 2–3 HP
  }
  assert.equal(shooter.score, scoreBefore + 10);
  assert.ok(!s.bots.some((b) => b.id === bot.id), "killed bot removed");
});

test("clearing every wave reaches victory at WAVE_COUNT", () => {
  const s = createHostState(roster);
  startRound(s);
  let t = 0;
  while (s.phase !== "victory" && t < 2000) {
    stepHost(s, 0.1, t * 100, rnd);
    // Test "host" shoots every bot the moment a wave spawns.
    if (s.phase === "wave") {
      for (const b of [...s.bots]) {
        let guard = 0;
        while (s.bots.some((x) => x.id === b.id) && guard++ < 10) applyHit(s, "u1", b.id);
      }
    }
    t += 1;
  }
  assert.equal(s.phase, "victory");
  assert.equal(s.wave, WAVE_COUNT);
  const snap = snapshotFrom(s, s.seq); // nothing newer
  assert.equal(snap.feed.length, 0);
  const snap2 = snapshotFrom(s, 0); // full history
  assert.ok(snap2.feed.length > 0);
});

test("adoptSnapshot rebuilds an equivalent host state mid-round", () => {
  const s = createHostState(roster);
  startRound(s);
  for (let i = 0; i < 90; i++) stepHost(s, 0.1, i * 100, rnd);
  const snap = snapshotFrom(s, 0);
  const next = adoptSnapshot(snap, roster);
  assert.equal(next.phase, s.phase);
  assert.equal(next.bots.length, s.bots.length);
  assert.equal(next.coreHp, s.coreHp);
  assert.ok(next.nextBotId > Math.max(0, ...s.bots.map((b) => b.id)));
});

test("geometry: circles resolve out of buildings and respect bounds", () => {
  const building = { x: 100, y: 100, w: 60, h: 60 };
  // Centre overlap pushes out along the shallowest axis (top).
  const out = resolveCircleRect(120, 115, 10, building);
  assert.equal(out.y, 90); // y=100 - r
  assert.ok(circleHitsRect(130, 140, 8, building));
  assert.ok(!circleHitsRect(200, 200, 8, building));

  // Sliding along a wall keeps x, clamps inside the world.
  const moved = moveWithCollisions(200, 200, 1, 0, 12, [building], ARENA.w, ARENA.h);
  assert.ok(Math.abs(moved.x - 201) < 1e-6);
});
