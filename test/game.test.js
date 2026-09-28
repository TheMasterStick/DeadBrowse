import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGame } from "../src/game.js";
import { createServer } from "../src/server.js";
const password = "correct horse battery";
async function setup(t) {
  let now = 1_800_000_000_000;
  const game = createGame(":memory:", { clock: () => now });
  t.after(() => game.close());
  const alice = await game.authenticate("register", "Alice", password);
  const bob = await game.authenticate("register", "Bob", password);
  const act = (id, type, target, extra = {}) =>
    game.act(id, {
      key: randomUUID(),
      version: game.state(id).player.version,
      type,
      target,
      ...extra,
    });
  return { game, alice, bob, act, tick: (ms) => (now += ms) };
}
test("accounts are independent and passwords / sessions are verified", async (t) => {
  const { game, alice, bob, act } = await setup(t);
  assert.equal(game.session(alice.token).user_id, alice.id);
  assert.equal(game.session("wrong"), undefined);
  act(alice.id, "move", 11);
  assert.equal(game.state(bob.id).player.location, 12);
  await assert.rejects(
    game.authenticate("login", "Alice", "bad password value"),
    /Incorrect/,
  );
  await assert.rejects(
    game.authenticate("register", "ALICE", password),
    /already in use/,
  );
  assert.equal(
    (await game.authenticate("login", "alice", password)).id,
    alice.id,
  );
  game.logout(alice.token);
  assert.equal(game.session(alice.token), undefined);
});
test("movement is adjacent, validated and does not charge energy", async (t) => {
  const { game, alice, act } = await setup(t);
  assert.throws(() => act(alice.id, "move", 0), /adjacent/);
  assert.throws(() => act(alice.id, "move", "11"), /adjacent/);
  const state = act(alice.id, "move", 11, { energy: 9999, scrap: 9999 });
  assert.equal(state.player.location, 11);
  assert.equal(state.player.energy, 100);
  assert.equal(state.player.scrap, 20);
});
test("combat charges only initiation and pays rewards once", async (t) => {
  const { game, alice, act } = await setup(t);
  act(alice.id, "move", 11);
  let state = act(alice.id, "attack", "walker-11");
  assert.equal(state.player.energy, 90);
  assert.ok(state.encounter);
  assert.throws(() => act(alice.id, "move", 12), /Finish your encounter/);
  const command = {
    key: randomUUID(),
    version: state.player.version,
    type: "strike",
  };
  state = game.act(alice.id, command);
  assert.equal(state.encounter.enemy_hp, 29);
  assert.equal(game.act(alice.id, command).encounter.enemy_hp, 29);
  assert.equal(state.player.energy, 90);
  state = act(alice.id, "strike");
  state = act(alice.id, "strike");
  assert.equal(state.encounter, null);
  assert.equal(state.player.energy, 90);
  assert.equal(state.player.kills, 1);
  assert.equal(state.player.xp, 20);
  assert.equal(state.player.scrap, 32);
  assert.throws(() => act(alice.id, "strike"), /not in combat/);
  assert.throws(() => act(alice.id, "attack", "walker-11"), /not returned/);
});
test("shared targets cannot be claimed twice; rejected actions roll back energy", async (t) => {
  const { game, alice, bob, act, tick } = await setup(t);
  act(alice.id, "move", 11);
  act(bob.id, "move", 11);
  act(alice.id, "attack", "walker-11");
  assert.throws(() => act(bob.id, "attack", "walker-11"), /Another survivor/);
  assert.equal(game.state(bob.id).player.energy, 100);
  tick(900_001);
  const b = act(bob.id, "attack", "walker-11");
  assert.ok(b.encounter);
  assert.equal(game.state(alice.id).encounter, null);
});
test("stale and simultaneous commands cannot spend or reward twice", async (t) => {
  const { game, alice } = await setup(t);
  const version = game.state(alice.id).player.version;
  const command = { key: randomUUID(), version, type: "move", target: 11 };
  game.act(alice.id, command);
  assert.throws(
    () => game.act(alice.id, { ...command, key: randomUUID(), target: 13 }),
    /state changed/,
  );
  assert.equal(game.act(alice.id, command).player.location, 11);
  assert.throws(() => game.act(alice.id, { type: "search" }), /command key/);
});
test("energy recovery uses server time and cannot bank recovery while full", async (t) => {
  const { game, alice, act, tick } = await setup(t);
  tick(3_600_000);
  act(alice.id, "move", 11);
  act(alice.id, "attack", "walker-11");
  tick(59_999);
  assert.equal(game.state(alice.id).player.energy, 90);
  tick(1);
  assert.equal(game.state(alice.id).player.energy, 91);
  tick(600_000);
  assert.equal(game.state(alice.id).player.energy, 100);
});
test("scavenging has a server cooldown and medical loot is usable without energy", async (t) => {
  const { game, alice, act, tick } = await setup(t);
  act(alice.id, "move", 7);
  act(alice.id, "move", 6);
  let s = act(alice.id, "search");
  assert.equal(s.player.medkits, 3);
  assert.equal(s.player.energy, 100);
  assert.throws(() => act(alice.id, "search"), /moment/);
  assert.throws(() => act(alice.id, "heal"), /injury/);
  act(alice.id, "attack", "walker-6");
  s = act(alice.id, "strike");
  s = act(alice.id, "heal");
  assert.equal(s.player.medkits, 2);
  assert.equal(s.player.hp, 94);
  assert.equal(s.player.energy, 90);
  act(alice.id, "flee");
  tick(30_000);
  s = act(alice.id, "search");
  assert.equal(s.player.medkits, 3);
});
test("production is persistent, capped, and upgrades settle old production first", async (t) => {
  const { game, alice, act, tick } = await setup(t);
  tick(20 * 60_000);
  let s = game.state(alice.id);
  assert.equal(s.player.scrap, 40);
  assert.equal(game.state(alice.id).player.scrap, 40);
  s = act(alice.id, "upgrade");
  assert.equal(s.player.scrap, 0);
  assert.equal(s.player.level, 2);
  tick(60_000);
  assert.equal(game.state(alice.id).player.scrap, 2);
  tick(1000 * 60_000);
  assert.equal(game.state(alice.id).player.scrap, 962);
  assert.equal(game.state(alice.id).player.scrap, 962);
});
test("not enough energy rejects attack without claiming the target", async (t) => {
  const { game, alice, act } = await setup(t);
  act(alice.id, "move", 11);
  game.db.prepare("UPDATE players SET energy=0 WHERE id=?").run(alice.id);
  assert.throws(
    () => act(alice.id, "attack", "walker-11"),
    /Not enough energy/,
  );
  assert.equal(game.state(alice.id).encounter, null);
  assert.equal(game.state(alice.id).enemies[0].available, true);
});
test("defeat returns survivor to refuge and releases the encounter", async (t) => {
  const { game, alice, act } = await setup(t);
  act(alice.id, "move", 11);
  act(alice.id, "attack", "walker-11");
  game.db.prepare("UPDATE players SET hp=5 WHERE id=?").run(alice.id);
  const s = act(alice.id, "strike");
  assert.equal(s.player.hp, 50);
  assert.equal(s.player.location, 12);
  assert.equal(s.encounter, null);
  assert.equal(s.player.energy, 90);
});
test("characters, inventory, sessions and encounters survive a server restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deadbrowse-"));
  const path = join(dir, "world.sqlite");
  let game;
  try {
    game = createGame(path);
    const auth = await game.authenticate("register", "Persistent", password);
    game.act(auth.id, {
      key: randomUUID(),
      version: 0,
      type: "move",
      target: 11,
    });
    game.act(auth.id, {
      key: randomUUID(),
      version: 1,
      type: "attack",
      target: "walker-11",
    });
    game.close();
    game = createGame(path);
    const s = game.state(auth.id);
    assert.equal(s.player.location, 11);
    assert.equal(s.player.energy, 90);
    assert.ok(s.encounter);
    assert.equal(game.session(auth.token).user_id, auth.id);
  } finally {
    game?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP authentication, CSRF, same-origin enforcement and state isolation", async (t) => {
  const { server, game } = createServer({ dbPath: ":memory:" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    game.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body = {}, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(base + "/api/state")).status, 401);
  assert.equal(
    (
      await post(
        "/api/register",
        { name: "WebUser", password },
        { Origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  const response = await post("/api/register", { name: "WebUser", password });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const data = await response.json(),
    headers = { Cookie: cookie.split(";")[0] };
  assert.equal((await fetch(base + "/api/state", { headers })).status, 200);
  assert.equal(
    (
      await post(
        "/api/action",
        { type: "move", target: 11, key: randomUUID(), version: 0 },
        headers,
      )
    ).status,
    403,
  );
  headers["X-CSRF-Token"] = data.csrf;
  const moved = await post(
    "/api/action",
    { type: "move", target: 11, key: randomUUID(), version: 0 },
    headers,
  );
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).state.player.location, 11);
  assert.equal((await post("/api/action", null, headers)).status, 400);
  assert.equal(
    (await post("/api/action", { blob: "a".repeat(5000) }, headers)).status,
    413,
  );
  assert.equal((await fetch(base + "/src/game.js")).status, 404);
  assert.match(
    (await fetch(base + "/")).headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal((await post("/api/logout", {}, headers)).status, 200);
  assert.equal((await fetch(base + "/api/state", { headers })).status, 401);
});
