import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createGame } from "../src/game.js";
import { createServer } from "../src/server.js";
import { HOME, WORLD, RULES, adjacent, localBlocks } from "../src/world.js";
const password = "correct horse battery";
async function setup(t) {
  let now = 1800000000000;
  const game = createGame(":memory:", { clock: () => now });
  t.after(() => game.close());
  const a = await game.authenticate("register", "Alice", password),
    b = await game.authenticate("register", "Bob", password);
  const act = (id, type, target, extra = {}) =>
    game.act(id, {
      key: randomUUID(),
      version: game.state(id).player.version,
      type,
      target,
      ...extra,
    });
  return {
    game,
    a,
    b,
    act,
    tick: (ms) => (now += ms),
    travel(id, target) {
      const s = act(id, "move", target);
      now = s.player.travel.arrivesAt;
      return game.state(id);
    },
    edit(fn) {
      const w = JSON.parse(
        game.db.prepare("SELECT payload FROM world_state").get().payload,
      );
      fn(w);
      game.db
        .prepare("UPDATE world_state SET payload=?")
        .run(JSON.stringify(w));
    },
  };
}
test("100×100 city returns only the local 3×3 and never wraps edges", async (t) => {
  const { game, a, edit } = await setup(t);
  assert.equal(WORLD.length, 10000);
  const s = game.state(a.id);
  assert.equal(s.world.length, 9);
  assert.equal(s.player.location, HOME);
  assert.equal(s.city.width, 100);
  assert.equal(adjacent(99, 100), false);
  assert.equal(adjacent(0, 101), true);
  edit((w) => (w.players[a.id].location = 0));
  assert.equal(game.state(a.id).world.length, 4);
  assert.equal(localBlocks(9999).length, 4);
});
test("timed travel prevents early arrivals and actions, survives polling, and settles once", async (t) => {
  const { game, a, act, tick } = await setup(t);
  const start = act(a.id, "move", 5049);
  assert.equal(start.player.location, HOME);
  assert.equal(start.player.energy, 100);
  assert.equal(
    start.player.travel.arrivesAt - start.player.travel.departedAt,
    20000,
  );
  assert.throws(() => act(a.id, "search"), /travelling/);
  assert.throws(() => act(a.id, "move", 4950), /travelling/);
  tick(19999);
  assert.equal(game.state(a.id).player.location, HOME);
  tick(1);
  let s = game.state(a.id);
  assert.equal(s.player.location, 5049);
  assert.equal(s.player.travel, null);
  const version = s.player.version;
  s = game.state(a.id);
  assert.equal(s.player.version, version);
  assert.equal(
    s.events.filter((e) => e.message.startsWith("Arrived")).length,
    1,
  );
});
test("diagonal travel takes 28s; non-neighbours and forged timestamps are rejected", async (t) => {
  const { game, a, act } = await setup(t);
  assert.throws(() => act(a.id, "move", 0), /adjacent/);
  const s = act(a.id, "move", 4949, { arrivesAt: 0, energy: 999, scrap: 999 });
  assert.equal(s.player.travel.arrivesAt - s.player.travel.departedAt, 28000);
  assert.equal(s.player.energy, 100);
  assert.equal(s.player.scrap, 20);
});
test("shared scavenging stock depletes and refills slowly without grants from polling", async (t) => {
  const { game, a, b, act, travel, tick, edit } = await setup(t);
  travel(a.id, 5049);
  travel(b.id, 5049);
  edit((w) => (w.supplies[5049] = { remaining: 1, at: 1800000040000 }));
  const s = act(a.id, "search");
  assert.equal(s.world.find((l) => l.id === 5049).supply.remaining, 0);
  assert.throws(() => act(b.id, "search"), /picked clean/);
  assert.equal(game.state(b.id).player.xp, 0);
  tick(RULES.supplyRefillInterval - 1);
  assert.equal(
    game.state(b.id).world.find((l) => l.id === 5049).supply.remaining,
    0,
  );
  tick(1);
  assert.equal(
    game.state(b.id).world.find((l) => l.id === 5049).supply.remaining,
    1,
  );
  act(b.id, "search");
  assert.equal(
    game.state(b.id).world.find((l) => l.id === 5049).supply.remaining,
    0,
  );
});
test("combat costs energy only on initiation and rewards cannot be replayed", async (t) => {
  const { game, a, act, travel } = await setup(t);
  travel(a.id, 5049);
  let s = act(a.id, "attack", "walker-5049");
  assert.equal(s.player.energy, 90);
  assert.throws(() => act(a.id, "move", HOME), /Finish your encounter/);
  for (let i = 0; i < 3; i++) {
    const cmd = {
      key: randomUUID(),
      version: s.player.version,
      type: "strike",
    };
    s = game.act(a.id, cmd);
    assert.equal(game.act(a.id, cmd).player.version, s.player.version);
    assert.equal(s.player.energy, 90);
  }
  assert.equal(s.player.kills, 1);
  assert.equal(s.player.scrap, 32);
  assert.equal(s.encounter, null);
  assert.throws(() => act(a.id, "strike"), /not in combat/);
});
test("shared target contention and inactivity expiry release exactly one claim", async (t) => {
  const { game, a, b, act, travel, tick } = await setup(t);
  travel(a.id, 5049);
  travel(b.id, 5049);
  act(a.id, "attack", "walker-5049");
  assert.throws(() => act(b.id, "attack", "walker-5049"), /Another survivor/);
  assert.equal(game.state(b.id).player.energy, 100);
  tick(900001);
  assert.ok(act(b.id, "attack", "walker-5049").encounter);
  assert.equal(game.state(a.id).encounter, null);
});
test("stale commands roll back and medical healing respects health and inventory", async (t) => {
  const { game, a, act, travel } = await setup(t);
  travel(a.id, 5049);
  const stale = game.state(a.id).player.version;
  act(a.id, "search");
  assert.throws(
    () => act(a.id, "search", undefined, { version: stale }),
    /state changed/,
  );
  act(a.id, "attack", "walker-5049");
  act(a.id, "strike");
  let s = act(a.id, "heal");
  assert.equal(s.player.hp, 94);
  assert.equal(s.player.medkits, 1);
  assert.equal(s.player.energy, 90);
});
test("production settles previous level and caps offline accrual", async (t) => {
  const { game, a, act, tick } = await setup(t);
  tick(1200000);
  assert.equal(game.state(a.id).player.scrap, 40);
  let s = act(a.id, "upgrade");
  assert.equal(s.player.level, 2);
  assert.equal(s.player.scrap, 0);
  tick(60000000);
  s = game.state(a.id);
  assert.equal(s.player.scrap, 960);
  assert.equal(game.state(a.id).player.scrap, 960);
});
test("defeat restores the refuge position and insufficient energy creates no encounter", async (t) => {
  const { game, a, act, travel, edit } = await setup(t);
  travel(a.id, 5049);
  edit((w) => (w.players[a.id].energy = 0));
  assert.throws(() => act(a.id, "attack", "walker-5049"), /Not enough energy/);
  edit((w) => {
    w.players[a.id].energy = 100;
    w.players[a.id].hp = 5;
  });
  act(a.id, "attack", "walker-5049");
  const s = act(a.id, "strike");
  assert.equal(s.player.location, HOME);
  assert.equal(s.player.hp, 50);
  assert.equal(s.encounter, null);
});
test("accounts and authenticated sessions are independent", async (t) => {
  const { game, a, b } = await setup(t);
  assert.equal(game.session(a.token).user_id, a.id);
  await assert.rejects(
    game.authenticate("login", "Alice", "wrong password"),
    /Incorrect/,
  );
  await assert.rejects(
    game.authenticate("register", "ALICE", password),
    /already in use/,
  );
  assert.equal((await game.authenticate("login", "alice", password)).id, a.id);
  game.logout(a.token);
  assert.equal(game.session(a.token), undefined);
  assert.equal(game.state(b.id).player.location, HOME);
});
test("travel and supplies persist through restarting the server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deadbrowse-")),
    path = join(dir, "world.sqlite");
  let game;
  let now = 1800000000000;
  try {
    game = createGame(path, { clock: () => now });
    const a = await game.authenticate("register", "Persistent", password);
    game.act(a.id, {
      key: randomUUID(),
      version: 0,
      type: "move",
      target: 5049,
    });
    game.close();
    game = createGame(path, { clock: () => now });
    assert.ok(game.state(a.id).player.travel);
    now += 20000;
    let s = game.state(a.id);
    assert.equal(s.player.location, 5049);
    s = game.act(a.id, {
      key: randomUUID(),
      version: s.player.version,
      type: "search",
    });
    const stock = s.world.find((l) => l.id === 5049).supply.remaining;
    game.close();
    game = createGame(path, { clock: () => now });
    assert.equal(
      game.state(a.id).world.find((l) => l.id === 5049).supply.remaining,
      stock,
    );
    assert.equal(game.session(a.token).user_id, a.id);
  } finally {
    game?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("legacy local saves migrate into the larger city without losing resources", () => {
  const dir = mkdtempSync(join(tmpdir(), "deadbrowse-migrate-")),
    path = join(dir, "legacy.sqlite");
  let game;
  try {
    const d = new DatabaseSync(path);
    d.exec(
      `CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,password TEXT,salt TEXT); CREATE TABLE players(id TEXT,location INTEGER,hp INTEGER,energy INTEGER,energy_at INTEGER,scrap INTEGER,medkits INTEGER,xp INTEGER,kills INTEGER,level INTEGER,production_at INTEGER,search_at INTEGER,version INTEGER); INSERT INTO users VALUES('old','Veteran','hash','salt'); INSERT INTO players VALUES('old',11,76,81,1800000000000,123,7,40,2,3,1800000000000,0,9); PRAGMA user_version=1;`,
    );
    d.close();
    game = createGame(path, { clock: () => 1800000000000 });
    const s = game.state("old");
    assert.equal(s.player.location, 5049);
    assert.equal(s.player.scrap, 123);
    assert.equal(s.player.hp, 76);
    assert.equal(s.player.medkits, 7);
    assert.equal(s.player.level, 3);
  } finally {
    game?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP identity, CSRF, origin, and input boundaries", async (t) => {
  const { server, game } = createServer({ dbPath: ":memory:" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    game.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
  assert.equal((await fetch(base + "/api/state")).status, 401);
  assert.equal(
    (
      await post(
        "/api/register",
        { name: "Webuser", password },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  const r = await post("/api/register", { name: "Webuser", password });
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  const data = await r.json(),
    headers = { Cookie: cookie.split(";")[0] };
  const cmd = { key: randomUUID(), version: 0, type: "move", target: 5049 };
  assert.equal((await post("/api/action", cmd, headers)).status, 403);
  headers["X-CSRF-Token"] = data.csrf;
  assert.equal((await post("/api/action", cmd, headers)).status, 200);
  assert.equal(
    (await post("/api/action", { x: "x".repeat(5000) }, headers)).status,
    413,
  );
  assert.equal((await fetch(base + "/art/city-atlas.webp")).status, 200);
  assert.equal((await fetch(base + "/src/game.js")).status, 404);
});
