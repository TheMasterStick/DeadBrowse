import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../dist/server/index.js";
import { createGame } from "../src/game.js";
import { emptyWorld } from "../cloud/store.js";
import { register, action } from "../cloud/game.js";

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
  assert.equal(
    (
      await request(
        "alpha",
        "action",
        { key: crypto.randomUUID(), version: 0, type: "move", target: 11 },
        b.csrf,
      )
    ).status,
    403,
  );
  const command = {
    key: crypto.randomUUID(),
    version: 0,
    type: "move",
    target: 11,
  };
  const race = await Promise.all([
    request("alpha", "action", command, a.csrf),
    request(
      "alpha",
      "action",
      { ...command, key: crypto.randomUUID(), target: 13 },
      a.csrf,
    ),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const alphaState = await request("alpha", "state");
  const location = alphaState.state.player.location;
  await request(
    "bravo",
    "action",
    { key: crypto.randomUUID(), version: 0, type: "move", target: location },
    b.csrf,
  );
  const claims = await Promise.all([
    request(
      "alpha",
      "action",
      {
        key: crypto.randomUUID(),
        version: 1,
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
        version: 1,
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
    const s = await request(winner, "state");
    const strike = {
      key: crypto.randomUUID(),
      version: s.state.player.version,
      type: "strike",
    };
    const hit = await request(winner, "action", strike, token);
    const replay = await request(winner, "action", strike, token);
    assert.equal(hit.state.player.energy, 90);
    assert.deepEqual(replay.state.player, hit.state.player);
  }
  const won = await request(winner, "state");
  assert.equal(won.state.player.kills, 1);
  assert.equal(won.state.player.scrap, 32);
  assert.equal(won.state.encounter, null);
  const freshWorker = await import("../dist/server/index.js?restart");
  const persisted = await freshWorker.default.fetch(
    new Request(origin + "/api/state", {
      headers: { "oai-authenticated-user-id": winner },
    }),
    { DB },
  );
  assert.equal((await persisted.json()).state.player.kills, 1);
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
  const html = await worker.fetch(new Request(origin), { DB });
  assert.match(await html.text(), /DeadBrowse/);
  // Keep the hosted rule adapter in parity with the original local game.
  let now = Date.now();
  const local = createGame(":memory:", { clock: () => now });
  try {
    const auth = await local.authenticate(
      "register",
      "Parity",
      "test-only-password",
    );
    const world = emptyWorld();
    register(world, auth.id, "Parity", now);
    for (const [type, target, advance] of [
      ["move", 11, 0],
      ["search", undefined, 0],
      ["attack", "walker-11", 0],
      ["strike", undefined, 0],
      ["guard", undefined, 0],
      ["heal", undefined, 0],
      ["strike", undefined, 0],
      ["strike", undefined, 0],
      ["move", 12, 0],
      ["upgrade", undefined, 300000],
    ]) {
      now += advance;
      const before = local.state(auth.id);
      const input = {
        type,
        target,
        key: crypto.randomUUID(),
        version: before.player.version,
      };
      const expected = local.act(auth.id, input).player;
      const actual = action(world, auth.id, input, now).player;
      for (const key of [
        "location",
        "hp",
        "energy",
        "scrap",
        "medkits",
        "xp",
        "kills",
        "level",
        "version",
      ])
        assert.equal(actual[key], expected[key], `${type}: ${key}`);
    }
  } finally {
    local.close();
  }
  console.log(
    "Hosted checks passed: dispatch identity, onboarding, CSRF/origin protection, simultaneous commands, contested targets, idempotent combat/rewards, persistence, and parity with local gameplay.",
  );
} finally {
  database.close();
}
