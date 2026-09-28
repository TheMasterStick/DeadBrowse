import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../dist/server/index.js";
const database = new DatabaseSync(":memory:");
for (const name of readdirSync("drizzle").filter((n) => n.endsWith(".sql")))
  database.exec(readFileSync(`drizzle/${name}`, "utf8"));
const DB = {
  prepare(sql) {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async first() {
        return database.prepare(sql).get(...args) || null;
      },
      async run() {
        const result = database.prepare(sql).run(...args);
        return { meta: { changes: result.changes } };
      },
    };
  },
};
const origin = "https://deadbrowse.example";
const realNow = Date.now;
let time = realNow();
Date.now = () => time;
async function request(user, path, data, csrf) {
  const response = await worker.fetch(
    new Request(origin + "/api/" + path, {
      method: data ? "POST" : "GET",
      headers: {
        ...(user ? { "oai-authenticated-user-id": user } : {}),
        ...(data
          ? {
              Origin: origin,
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf || "",
            }
          : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
    { DB },
  );
  return { status: response.status, ...(await response.json()) };
}
try {
  assert.equal((await request(null, "state")).status, 401);
  assert.equal((await request("alpha", "state")).needsProfile, true);
  const a = await request("alpha", "register", { name: "Alpha" }),
    b = await request("bravo", "register", { name: "Bravo" });
  assert.equal(a.status, 200);
  assert.notEqual(a.state.player.id, b.state.player.id);
  assert.equal(a.state.world.length, 9);
  const cmd = {
    key: crypto.randomUUID(),
    version: 0,
    type: "move",
    target: 5049,
  };
  assert.equal((await request("alpha", "action", cmd, b.csrf)).status, 403);
  const race = await Promise.all([
    request("alpha", "action", cmd, a.csrf),
    request(
      "alpha",
      "action",
      { ...cmd, key: crypto.randomUUID(), target: 5051 },
      a.csrf,
    ),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const onRoad = await request("alpha", "state");
  assert.equal(onRoad.state.player.location, 5050);
  const location = onRoad.state.player.travel.to;
  assert.equal(
    (
      await request(
        "alpha",
        "action",
        { key: crypto.randomUUID(), version: 1, type: "search" },
        a.csrf,
      )
    ).status,
    409,
  );
  await request(
    "bravo",
    "action",
    { key: crypto.randomUUID(), version: 0, type: "move", target: location },
    b.csrf,
  );
  time += 20000;
  const av = (await request("alpha", "state")).state.player.version,
    bv = (await request("bravo", "state")).state.player.version;
  const claims = await Promise.all([
    request(
      "alpha",
      "action",
      {
        key: crypto.randomUUID(),
        version: av,
        type: "attack",
        target: `walker-${location}`,
      },
      a.csrf,
    ),
    request(
      "bravo",
      "action",
      {
        key: crypto.randomUUID(),
        version: bv,
        type: "attack",
        target: `walker-${location}`,
      },
      b.csrf,
    ),
  ]);
  assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409]);
  const winner = claims[0].status === 200 ? "alpha" : "bravo",
    token = winner === "alpha" ? a.csrf : b.csrf;
  for (let i = 0; i < 3; i++) {
    const s = await request(winner, "state"),
      strike = {
        key: crypto.randomUUID(),
        version: s.state.player.version,
        type: "strike",
      };
    const hit = await request(winner, "action", strike, token),
      replay = await request(winner, "action", strike, token);
    assert.equal(hit.state.player.energy, 90);
    assert.equal(replay.state.player.version, hit.state.player.version);
  }
  assert.equal((await request(winner, "state")).state.player.kills, 1);
  let world = JSON.parse(
    database.prepare("SELECT payload FROM hosted_world").get().payload,
  );
  world.supplies[location] = { remaining: 1, at: time };
  database
    .prepare("UPDATE hosted_world SET payload=?")
    .run(JSON.stringify(world));
  const search = async (user, token) => {
    const s = await request(user, "state");
    return request(
      user,
      "action",
      {
        key: crypto.randomUUID(),
        version: s.state.player.version,
        type: "search",
      },
      token,
    );
  };
  const searches = await Promise.all([
    search("alpha", a.csrf),
    search("bravo", b.csrf),
  ]);
  assert.deepEqual(searches.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await request("alpha", "state")).state.world.find((l) => l.id === location)
      .supply.remaining,
    0,
  );
  const freshWorker = await import("../dist/server/index.js?restart");
  const persisted = await freshWorker.default.fetch(
    new Request(origin + "/api/state", {
      headers: { "oai-authenticated-user-id": winner },
    }),
    { DB },
  );
  assert.equal((await persisted.json()).state.player.kills, 1);
  world = JSON.parse(
    database.prepare("SELECT payload FROM hosted_world").get().payload,
  );
  delete world.schemaVersion;
  delete world.supplies;
  world.encounters = {};
  world.enemies = { "walker-11": time + 1000 };
  for (const p of Object.values(world.players)) {
    p.location = 11;
    p.travel = null;
  }
  const preserved = world.players[a.state.player.id].scrap;
  database
    .prepare("UPDATE hosted_world SET payload=?")
    .run(JSON.stringify(world));
  const migrated = await request("alpha", "state");
  assert.equal(migrated.state.player.location, 5049);
  assert.equal(migrated.state.player.scrap, preserved);
  assert.equal(migrated.state.world.length, 9);
  const rejected = await worker.fetch(
    new Request(origin + "/api/register", {
      method: "POST",
      headers: {
        "oai-authenticated-user-id": "evil",
        Origin: "https://other.example",
        "Content-Type": "application/json",
      },
      body: '{"name":"Evil"}',
    }),
    { DB },
  );
  assert.equal(rejected.status, 403);
  const art = await worker.fetch(new Request(origin + "/art/city-atlas.webp"), {
    DB,
  });
  assert.equal(art.headers.get("content-type"), "image/webp");
  assert.ok((await art.arrayBuffer()).byteLength > 10000);
  console.log(
    "Hosted checks passed: identity, migration without loss, local visibility, authoritative travel, contested targets, last-stock race, idempotent combat, saved state, CSRF/origin checks, and artwork delivery.",
  );
} finally {
  Date.now = realNow;
  database.close();
}
