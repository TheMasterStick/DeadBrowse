import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { WORLD, RULES, adjacent } from "./world.js";
const scrypt = promisify(scryptCallback);
export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const requireThat = (ok, message, status = 400) => {
  if (!ok) throw new GameError(message, status);
};
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
export function createGame(path, { clock = Date.now } = {}) {
  const db = new DatabaseSync(path);
  if (db.prepare("PRAGMA user_version").get().user_version > 1) {
    db.close();
    throw new Error("Database schema is newer than this application.");
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,password TEXT NOT NULL,salt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY REFERENCES users(id),location INTEGER NOT NULL DEFAULT 12,hp INTEGER NOT NULL DEFAULT 100,energy INTEGER NOT NULL DEFAULT 100,energy_at INTEGER NOT NULL,scrap INTEGER NOT NULL DEFAULT 20,medkits INTEGER NOT NULL DEFAULT 2,xp INTEGER NOT NULL DEFAULT 0,kills INTEGER NOT NULL DEFAULT 0,level INTEGER NOT NULL DEFAULT 1,production_at INTEGER NOT NULL,search_at INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS enemies(id TEXT PRIMARY KEY,location INTEGER NOT NULL,name TEXT NOT NULL,hp INTEGER NOT NULL DEFAULT 45,available_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS encounters(id TEXT PRIMARY KEY,player_id TEXT NOT NULL UNIQUE REFERENCES users(id),enemy_id TEXT NOT NULL UNIQUE REFERENCES enemies(id),enemy_hp INTEGER NOT NULL,round INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,player_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,message TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS commands(player_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(player_id,key));
 PRAGMA user_version=1;`);
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  for (const loc of WORLD.filter((x) => x.type !== "safehouse"))
    run(
      "INSERT OR IGNORE INTO enemies(id,location,name) VALUES(?,?,?)",
      `walker-${loc.id}`,
      loc.id,
      loc.type === "industrial" ? "Workyard walker" : "Wandering dead",
    );
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function log(id, message) {
    run(
      "INSERT INTO events(player_id,at,message) VALUES(?,?,?)",
      id,
      clock(),
      message,
    );
  }
  function refresh(id) {
    const p = q("SELECT * FROM players WHERE id=?", id),
      now = clock();
    const ticks = Math.max(
      0,
      Math.floor((now - p.energy_at) / RULES.energyInterval),
    );
    if (p.energy >= RULES.maxEnergy) p.energy_at = now;
    else if (ticks) {
      p.energy = Math.min(RULES.maxEnergy, p.energy + ticks);
      p.energy_at =
        p.energy === RULES.maxEnergy
          ? now
          : p.energy_at + ticks * RULES.energyInterval;
    }
    const produced = Math.max(
      0,
      Math.floor((now - p.production_at) / RULES.productionInterval),
    );
    if (produced) {
      p.scrap += Math.min(produced, RULES.maxOfflineProduction) * p.level;
      p.production_at += produced * RULES.productionInterval;
    }
    run(
      "UPDATE players SET energy=?,energy_at=?,scrap=?,production_at=? WHERE id=?",
      p.energy,
      p.energy_at,
      p.scrap,
      p.production_at,
      id,
    );
    return p;
  }
  function expireEncounters() {
    for (const encounter of all(
      "SELECT player_id FROM encounters WHERE updated_at<=?",
      clock() - RULES.encounterTimeout,
    )) {
      run("DELETE FROM encounters WHERE player_id=?", encounter.player_id);
      run(
        "UPDATE players SET version=version+1 WHERE id=?",
        encounter.player_id,
      );
      log(
        encounter.player_id,
        "The encounter ended after 15 minutes of inactivity. The target escaped.",
      );
    }
  }
  function stateInTransaction(id) {
    expireEncounters();
    const p = refresh(id),
      now = clock();
    const encounter =
      q(
        "SELECT c.*,e.name FROM encounters c JOIN enemies e ON e.id=c.enemy_id WHERE c.player_id=?",
        id,
      ) || null;
    return {
      player: { ...p, name: q("SELECT name FROM users WHERE id=?", id).name },
      world: WORLD.map((loc) => ({
        ...loc,
        players: q("SELECT count(*) AS n FROM players WHERE location=?", loc.id)
          .n,
      })),
      occupants: all(
        "SELECT u.name,p.id FROM players p JOIN users u ON u.id=p.id WHERE p.location=? AND p.id!=?",
        p.location,
        id,
      ),
      enemies: all(
        "SELECT e.*,c.player_id AS engaged_by FROM enemies e LEFT JOIN encounters c ON c.enemy_id=e.id WHERE e.location=?",
        p.location,
      ).map((e) => ({
        ...e,
        available: e.available_at <= now && !e.engaged_by,
      })),
      encounter,
      events: all(
        "SELECT at,message FROM events WHERE player_id=? ORDER BY id DESC LIMIT 30",
        id,
      ),
      rules: RULES,
      serverTime: now,
    };
  }
  function state(id) {
    return transaction(() => stateInTransaction(id));
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
    const existing = q("SELECT * FROM users WHERE name=?", name);
    const salt = existing?.salt || randomBytes(16).toString("hex");
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
        run(
          "INSERT INTO players(id,energy_at,production_at) VALUES(?,?,?)",
          id,
          clock(),
          clock(),
        );
        log(
          id,
          "You reached the refuge. A room, a workbench, and a chance to start again.",
        );
      }
      const token = randomBytes(32).toString("hex"),
        csrf = randomBytes(24).toString("hex");
      run("DELETE FROM sessions WHERE expires<=?", clock());
      run(
        "INSERT INTO sessions VALUES(?,?,?,?)",
        hashToken(token),
        id,
        csrf,
        clock() + 7 * 86400_000,
      );
      return { token, csrf, id };
    });
  }
  function session(token) {
    return token
      ? q(
          "SELECT user_id,csrf FROM sessions WHERE token=? AND expires>?",
          hashToken(token),
          clock(),
        )
      : undefined;
  }
  function logout(token) {
    if (token) run("DELETE FROM sessions WHERE token=?", hashToken(token));
  }
  function act(id, input) {
    return transaction(() => {
      requireThat(
        input && typeof input === "object" && !Array.isArray(input),
        "Invalid command.",
      );
      requireThat(
        typeof input.key === "string" &&
          /^[a-zA-Z0-9-]{16,80}$/.test(input.key),
        "A valid command key is required.",
      );
      if (
        q("SELECT 1 FROM commands WHERE player_id=? AND key=?", id, input.key)
      )
        return stateInTransaction(id);
      expireEncounters();
      const p = refresh(id),
        now = clock();
      requireThat(
        Number.isInteger(input.version) && input.version === p.version,
        "Your survivor state changed. Try again.",
        409,
      );
      const encounter = q("SELECT * FROM encounters WHERE player_id=?", id);
      const active = ["strike", "guard", "flee", "heal"];
      requireThat(
        !encounter || active.includes(input.type),
        "Finish your encounter before doing that.",
        409,
      );
      if (encounter)
        run("UPDATE encounters SET updated_at=? WHERE id=?", now, encounter.id);
      let message;
      if (input.type === "move") {
        requireThat(
          Number.isInteger(input.target) &&
            WORLD[input.target] &&
            adjacent(p.location, input.target),
          "Choose an adjacent block.",
        );
        p.location = input.target;
        message = `Travelled to ${WORLD[p.location].name}.`;
      } else if (input.type === "search") {
        requireThat(
          p.location !== 12,
          "The refuge supplies are managed at your workbench.",
        );
        requireThat(
          now >= p.search_at,
          "You need a moment before searching again.",
          409,
        );
        p.search_at = now + RULES.searchCooldown;
        if (WORLD[p.location].type === "medical") {
          p.medkits++;
          message = "Found a sealed medical kit.";
        } else {
          const found = WORLD[p.location].type === "industrial" ? 8 : 4;
          p.scrap += found;
          message = `Recovered ${found} scrap from ${WORLD[p.location].name}.`;
        }
        p.xp += 2;
      } else if (input.type === "attack") {
        requireThat(typeof input.target === "string", "Choose a target.");
        const enemy = q("SELECT * FROM enemies WHERE id=?", input.target);
        requireThat(
          enemy && enemy.location === p.location,
          "That target is not in your block.",
        );
        requireThat(
          enemy.available_at <= now &&
            !q("SELECT 1 FROM encounters WHERE enemy_id=?", enemy.id),
          "Another survivor has engaged this target, or it has not returned.",
          409,
        );
        requireThat(
          p.energy >= RULES.attackEnergy,
          "Not enough energy to initiate an attack.",
        );
        p.energy -= RULES.attackEnergy;
        run(
          "INSERT INTO encounters(id,player_id,enemy_id,enemy_hp,updated_at) VALUES(?,?,?,?,?)",
          randomUUID(),
          id,
          enemy.id,
          enemy.hp,
          now,
        );
        message = `Engaged ${enemy.name}. ${RULES.attackEnergy} energy spent. Combat actions cost no further energy.`;
      } else if (["strike", "guard", "flee"].includes(input.type)) {
        requireThat(encounter, "You are not in combat.");
        if (input.type === "flee") {
          p.hp = Math.max(1, p.hp - 8);
          run("DELETE FROM encounters WHERE id=?", encounter.id);
          run(
            "UPDATE enemies SET available_at=? WHERE id=?",
            now + 10_000,
            encounter.enemy_id,
          );
          message = "Withdrew from the encounter, taking 8 damage.";
        } else {
          const damage =
            input.type === "strike" ? 16 + Math.floor(p.xp / 50) : 7;
          const remaining = Math.max(0, encounter.enemy_hp - damage);
          if (remaining === 0) {
            p.xp += 20;
            p.kills++;
            p.scrap += 12;
            run("DELETE FROM encounters WHERE id=?", encounter.id);
            run(
              "UPDATE enemies SET available_at=? WHERE id=?",
              now + RULES.enemyRespawn,
              encounter.enemy_id,
            );
            message = `Target defeated. Gained 20 XP and 12 scrap.`;
          } else {
            const received = input.type === "guard" ? 3 : 11;
            p.hp -= received;
            run(
              "UPDATE encounters SET enemy_hp=?,round=round+1 WHERE id=?",
              remaining,
              encounter.id,
            );
            message = `${input.type === "guard" ? "Braced and countered" : "Struck"} for ${damage} damage. Took ${received} damage.`;
          }
        }
      } else if (input.type === "heal") {
        requireThat(
          p.medkits > 0 && p.hp < 100,
          "You need an injury and a medical kit.",
        );
        p.medkits--;
        p.hp = Math.min(100, p.hp + 35);
        message = "Used a medical kit. Restored up to 35 health.";
        if (encounter) {
          p.hp -= 6;
          run("UPDATE encounters SET round=round+1 WHERE id=?", encounter.id);
          message += " The enemy struck for 6 damage.";
        }
      } else if (input.type === "upgrade") {
        requireThat(
          p.location === 12,
          "Return to the refuge to upgrade your workbench.",
        );
        requireThat(p.level < 5, "Workbench is already at maximum level.");
        const cost = p.level * 40;
        requireThat(p.scrap >= cost, `You need ${cost} scrap.`);
        p.scrap -= cost;
        p.level++;
        p.production_at = now;
        message = `Workbench upgraded to level ${p.level}. Production is now ${p.level} scrap per minute.`;
      } else throw new GameError("Unknown action.");
      if (p.hp <= 0) {
        p.hp = 50;
        p.location = 12;
        run("DELETE FROM encounters WHERE player_id=?", id);
        if (encounter)
          run(
            "UPDATE enemies SET available_at=? WHERE id=?",
            now + RULES.enemyRespawn,
            encounter.enemy_id,
          );
        message +=
          " A refuge patrol recovered you. You wake at the refuge with 50 health.";
      }
      run(
        "UPDATE players SET location=?,hp=?,energy=?,energy_at=?,scrap=?,medkits=?,xp=?,kills=?,level=?,production_at=?,search_at=?,version=version+1 WHERE id=?",
        p.location,
        p.hp,
        p.energy,
        p.energy_at,
        p.scrap,
        p.medkits,
        p.xp,
        p.kills,
        p.level,
        p.production_at,
        p.search_at,
        id,
      );
      log(id, message);
      run("INSERT INTO commands VALUES(?,?,?)", id, input.key, now);
      // Keep bounded history; clients must always provide the current version too.
      run(
        "DELETE FROM commands WHERE player_id=? AND at<?",
        id,
        now - 86400_000,
      );
      run(
        "DELETE FROM events WHERE player_id=? AND id NOT IN (SELECT id FROM events WHERE player_id=? ORDER BY id DESC LIMIT 100)",
        id,
        id,
      );
      return stateInTransaction(id);
    });
  }
  return {
    db,
    authenticate,
    session,
    logout,
    state,
    act,
    close: () => db.close(),
  };
}
