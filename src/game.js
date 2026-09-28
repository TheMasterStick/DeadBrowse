import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import {
  register,
  snapshot,
  action,
  upgradeWorld,
  GameError,
} from "../cloud/game.js";
import { emptyWorld } from "../cloud/store.js";
export { GameError } from "../cloud/game.js";
const scrypt = promisify(scryptCallback);
const requireThat = (ok, message, status = 400) => {
  if (!ok) throw new GameError(message, status);
};
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
export function createGame(path, { clock = Date.now } = {}) {
  const db = new DatabaseSync(path);
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 2) {
    db.close();
    throw new Error("Database schema is newer than this application.");
  }
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  const q = (sql, ...args) => db.prepare(sql).get(...args),
    run = (sql, ...args) => db.prepare(sql).run(...args),
    all = (sql, ...args) => db.prepare(sql).all(...args);
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,password TEXT NOT NULL,salt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS world_state(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);`);
    if (!q("SELECT id FROM world_state WHERE id=1")) {
      let world = emptyWorld();
      const exists = (name) =>
        !!q(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          name,
        );
      if (version === 1 && exists("players")) {
        world = { players: {}, encounters: {}, enemies: {} };
        for (const p of all(
          "SELECT p.*,u.name FROM players p JOIN users u ON u.id=p.id",
        ))
          world.players[p.id] = {
            ...p,
            csrf: randomUUID(),
            travel: null,
            events: exists("events")
              ? all(
                  "SELECT at,message FROM events WHERE player_id=? ORDER BY id DESC LIMIT 100",
                  p.id,
                )
              : [],
            commands: {},
          };
        if (exists("encounters"))
          for (const c of all("SELECT * FROM encounters"))
            world.encounters[c.player_id] = { ...c, name: "Wandering dead" };
        if (exists("enemies"))
          for (const e of all("SELECT * FROM enemies"))
            world.enemies[e.id] = e.available_at;
        upgradeWorld(world, clock());
      }
      run("INSERT INTO world_state VALUES(1,?)", JSON.stringify(world));
    }
    db.exec("PRAGMA user_version=2");
  });
  function mutate(fn) {
    const row = q("SELECT payload FROM world_state WHERE id=1"),
      w = JSON.parse(row.payload);
    const result = fn(w);
    const text = JSON.stringify(w);
    if (text !== row.payload)
      run("UPDATE world_state SET payload=? WHERE id=1", text);
    return result;
  }
  async function authenticate(mode, name, password) {
    requireThat(
      typeof name === "string" && /^[A-Za-z0-9_]{3,20}$/.test(name),
      "Use 3–20 letters, numbers or underscores for your name.",
    );
    requireThat(
      typeof password === "string" &&
        password.length >= 10 &&
        password.length <= 128,
      "Use a password between 10 and 128 characters.",
    );
    const existing = q("SELECT * FROM users WHERE name=?", name),
      salt = existing?.salt || randomBytes(16).toString("hex");
    const derived = Buffer.from(await scrypt(password, salt, 64));
    if (mode === "login")
      requireThat(
        existing &&
          timingSafeEqual(derived, Buffer.from(existing.password, "hex")),
        "Incorrect name or password.",
        401,
      );
    return transaction(() => {
      let id = existing?.id;
      if (mode === "register") {
        requireThat(
          !q("SELECT id FROM users WHERE name=?", name),
          "That survivor name is already in use.",
          409,
        );
        id = randomUUID();
        run(
          "INSERT INTO users VALUES(?,?,?,?)",
          id,
          name,
          derived.toString("hex"),
          salt,
        );
        mutate((w) => register(w, id, name, clock()));
      }
      const token = randomBytes(32).toString("hex"),
        csrf = randomBytes(24).toString("hex");
      run("DELETE FROM sessions WHERE expires<=?", clock());
      run(
        "INSERT INTO sessions VALUES(?,?,?,?)",
        hashToken(token),
        id,
        csrf,
        clock() + 7 * 86400000,
      );
      return { id, token, csrf };
    });
  }
  return {
    db,
    authenticate,
    session: (token) =>
      token
        ? q(
            "SELECT user_id,csrf FROM sessions WHERE token=? AND expires>?",
            hashToken(token),
            clock(),
          )
        : undefined,
    logout: (token) => {
      if (token) run("DELETE FROM sessions WHERE token=?", hashToken(token));
    },
    state: (id) => transaction(() => mutate((w) => snapshot(w, id, clock()))),
    act: (id, input) =>
      transaction(() => mutate((w) => action(w, id, input, clock()))),
    close: () => db.close(),
  };
}
