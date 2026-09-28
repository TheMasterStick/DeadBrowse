import { WORLD, RULES, adjacent } from "../src/world.js";
export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const check = (ok, message, status = 400) => {
  if (!ok) throw new GameError(message, status);
};
function event(p, message, now) {
  p.events.unshift({ at: now, message });
  p.events = p.events.slice(0, 100);
}
export function register(w, id, name, now) {
  if (w.players[id]) return snapshot(w, id, now);
  check(
    typeof name === "string" && /^[A-Za-z0-9_]{3,20}$/.test(name),
    "Use 3–20 letters, numbers or underscores for your name.",
  );
  check(
    !Object.values(w.players).some(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    ),
    "That survivor name is already in use.",
    409,
  );
  w.players[id] = {
    id,
    name,
    location: 12,
    hp: 100,
    energy: 100,
    energy_at: now,
    scrap: 20,
    medkits: 2,
    xp: 0,
    kills: 0,
    level: 1,
    production_at: now,
    search_at: 0,
    version: 0,
    csrf: crypto.randomUUID(),
    events: [],
    commands: {},
  };
  event(
    w.players[id],
    "You reached the refuge. A room, a workbench, and a chance to start again.",
    now,
  );
  return snapshot(w, id, now);
}
function settle(w, id, now) {
  const p = w.players[id];
  check(p, "Choose a survivor name to begin.", 401);
  for (const [owner, c] of Object.entries(w.encounters))
    if (c.updated_at + RULES.encounterTimeout <= now) {
      delete w.encounters[owner];
      w.players[owner].version++;
      event(
        w.players[owner],
        "The encounter ended after 15 minutes of inactivity. The target escaped.",
        now,
      );
    }
  const ticks = Math.max(
    0,
    Math.floor((now - p.energy_at) / RULES.energyInterval),
  );
  if (p.energy === RULES.maxEnergy) p.energy_at = now;
  else if (ticks) {
    p.energy = Math.min(RULES.maxEnergy, p.energy + ticks);
    p.energy_at =
      p.energy === RULES.maxEnergy
        ? now
        : p.energy_at + ticks * RULES.energyInterval;
  }
  const production = Math.max(
    0,
    Math.floor((now - p.production_at) / RULES.productionInterval),
  );
  if (production) {
    p.scrap += Math.min(production, RULES.maxOfflineProduction) * p.level;
    p.production_at += production * RULES.productionInterval;
  }
  return p;
}
function enemy(w, location) {
  return {
    id: `walker-${location}`,
    location,
    name:
      WORLD[location].type === "industrial"
        ? "Workyard walker"
        : "Wandering dead",
    hp: 45,
    available_at: w.enemies[`walker-${location}`] || 0,
  };
}
export function snapshot(w, id, now) {
  const p = settle(w, id, now),
    c = w.encounters[id] || null;
  const { csrf, events, commands, ...player } = p;
  const enemies =
    p.location === 12
      ? []
      : [enemy(w, p.location)].map((e) => {
          const other = Object.values(w.encounters).find(
            (c) => c.enemy_id === e.id,
          );
          return {
            ...e,
            engaged_by: other?.player_id || null,
            available: e.available_at <= now && !other,
          };
        });
  return {
    player,
    world: WORLD.map((loc) => ({
      ...loc,
      players: Object.values(w.players).filter((p) => p.location === loc.id)
        .length,
    })),
    occupants: Object.values(w.players)
      .filter((o) => o.id !== id && o.location === p.location)
      .map((o) => ({ id: o.id, name: o.name })),
    enemies,
    encounter: c,
    events: events.slice(0, 30),
    rules: RULES,
    serverTime: now,
  };
}
export function action(w, id, input, now) {
  check(
    input && typeof input === "object" && !Array.isArray(input),
    "Invalid command.",
  );
  check(
    typeof input.key === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(input.key),
    "A valid command key is required.",
  );
  const p = settle(w, id, now);
  if (p.commands[input.key]) return snapshot(w, id, now);
  check(
    Number.isInteger(input.version) && input.version === p.version,
    "Your survivor state changed. Try again.",
    409,
  );
  const c = w.encounters[id];
  check(
    !c || ["strike", "guard", "flee", "heal"].includes(input.type),
    "Finish your encounter before doing that.",
    409,
  );
  if (c) c.updated_at = now;
  let message;
  if (input.type === "move") {
    check(
      Number.isInteger(input.target) &&
        WORLD[input.target] &&
        adjacent(p.location, input.target),
      "Choose an adjacent block.",
    );
    p.location = input.target;
    message = `Travelled to ${WORLD[p.location].name}.`;
  } else if (input.type === "search") {
    check(
      p.location !== 12,
      "The refuge supplies are managed at your workbench.",
    );
    check(now >= p.search_at, "You need a moment before searching again.", 409);
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
    check(
      p.location !== 12 && input.target === `walker-${p.location}`,
      "That target is not in your block.",
    );
    const e = enemy(w, p.location);
    check(
      e.available_at <= now &&
        !Object.values(w.encounters).some((c) => c.enemy_id === e.id),
      "Another survivor has engaged this target, or it has not returned.",
      409,
    );
    check(
      p.energy >= RULES.attackEnergy,
      "Not enough energy to initiate an attack.",
    );
    p.energy -= RULES.attackEnergy;
    w.encounters[id] = {
      id: crypto.randomUUID(),
      player_id: id,
      enemy_id: e.id,
      name: e.name,
      enemy_hp: 45,
      round: 0,
      updated_at: now,
    };
    message = `Engaged ${e.name}. ${RULES.attackEnergy} energy spent. Combat actions cost no further energy.`;
  } else if (["strike", "guard", "flee"].includes(input.type)) {
    check(c, "You are not in combat.");
    if (input.type === "flee") {
      p.hp = Math.max(1, p.hp - 8);
      delete w.encounters[id];
      w.enemies[c.enemy_id] = now + 10_000;
      message = "Withdrew from the encounter, taking 8 damage.";
    } else {
      const damage = input.type === "strike" ? 16 + Math.floor(p.xp / 50) : 7;
      c.enemy_hp = Math.max(0, c.enemy_hp - damage);
      if (c.enemy_hp === 0) {
        p.xp += 20;
        p.kills++;
        p.scrap += 12;
        delete w.encounters[id];
        w.enemies[c.enemy_id] = now + RULES.enemyRespawn;
        message = "Target defeated. Gained 20 XP and 12 scrap.";
      } else {
        const received = input.type === "guard" ? 3 : 11;
        p.hp -= received;
        c.round++;
        message = `${input.type === "guard" ? "Braced and countered" : "Struck"} for ${damage} damage. Took ${received} damage.`;
      }
    }
  } else if (input.type === "heal") {
    check(p.medkits > 0 && p.hp < 100, "You need an injury and a medical kit.");
    p.medkits--;
    p.hp = Math.min(100, p.hp + 35);
    message = "Used a medical kit. Restored up to 35 health.";
    if (c) {
      p.hp -= 6;
      c.round++;
      message += " The enemy struck for 6 damage.";
    }
  } else if (input.type === "upgrade") {
    check(p.location === 12, "Return to the refuge to upgrade your workbench.");
    check(p.level < 5, "Workbench is already at maximum level.");
    check(p.scrap >= p.level * 40, `You need ${p.level * 40} scrap.`);
    p.scrap -= p.level * 40;
    p.level++;
    p.production_at = now;
    message = `Workbench upgraded to level ${p.level}. Production is now ${p.level} scrap per minute.`;
  } else throw new GameError("Unknown action.");
  if (p.hp <= 0) {
    p.hp = 50;
    p.location = 12;
    delete w.encounters[id];
    if (c) w.enemies[c.enemy_id] = now + RULES.enemyRespawn;
    message +=
      " A refuge patrol recovered you. You wake at the refuge with 50 health.";
  }
  p.version++;
  event(p, message, now);
  p.commands[input.key] = now;
  for (const [key, time] of Object.entries(p.commands))
    if (time < now - 86400_000) delete p.commands[key];
  // Old commands remain blocked by the strictly increasing character version.
  const keys = Object.keys(p.commands);
  for (const key of keys.slice(0, Math.max(0, keys.length - 200)))
    delete p.commands[key];
  return snapshot(w, id, now);
}
