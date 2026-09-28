const app = document.querySelector("#app"),
  toast = document.querySelector("#toast");
let state = null,
  csrf = "",
  hosted = false,
  busy = false,
  page = "district",
  selected = null,
  authMode = "register",
  draftName = "",
  error = "",
  online = true,
  receivedAt = 0,
  toastTimer,
  polling = false;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  district: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  survivor:
    '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  refuge: '<path d="M3 11 12 3l9 8v10H3Z M9 21v-8h6v8"/>',
  journal: '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>',
  energy: '<path d="m13 2-8 12h6l-1 8 9-13h-7z"/>',
  health: '<path d="M12 21 3 12C-3 5 7-2 12 6c5-8 15-1 9 6Z"/>',
  scrap: '<path d="m12 3 9 5v9l-9 5-9-5V8Z M3 8l9 5 9-5M12 13v9"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  exit: '<path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4"/>',
  medical: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  home: '<path d="M3 11 12 3l9 8M5 10v11h14V10M9 21v-8h6v8"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.district}</svg>`;
const now = () =>
  state ? state.serverTime + Date.now() - receivedAt : Date.now();
const seconds = (t) => Math.max(0, Math.ceil((t - now()) / 1000));
const duration = (s) =>
  s >= 60
    ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
    : `${s}s`;
const coords = (loc) => `${loc.x}, ${loc.y}`;
const current = () => state.location;
const disabled = (condition = false) => (busy || condition ? "disabled" : "");
const art = (type) => `art art-${type}`;
function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
}
async function api(path, data) {
  const r = await fetch(`/api/${path}`, {
    method: data ? "POST" : "GET",
    headers: data
      ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
      : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await r.json();
  if (!r.ok) {
    const e = new Error(result.error || "Request failed");
    e.status = r.status;
    throw e;
  }
  return result;
}
function accept(result) {
  if (result.hosted) {
    hosted = true;
    authMode = "register";
  }
  if (result.csrf) csrf = result.csrf;
  if (result.state && (!state || result.state.serverTime >= state.serverTime)) {
    const old = state?.player.location;
    state = result.state;
    receivedAt = Date.now();
    if (
      selected === null ||
      old !== state.player.location ||
      !state.world.some((l) => l.id === selected)
    )
      selected = state.player.location;
  }
  online = true;
}
function brand() {
  return '<div class="brand"><span class="brand-logo">D</span><div>DEADBROWSE<small>WESTBRIDGE · PERSISTENT WORLD</small></div></div>';
}
function auth() {
  app.innerHTML = `<div class="auth-shell"><header>${brand()}<span>Survival is a long game.</span></header><main class="auth-card"><div class="auth-art ${art("safehouse")}"></div><section><span class="eyebrow">THE REFUGE</span><h1>${authMode === "register" ? "Make your way inside." : "Welcome back."}</h1><p>${hosted ? "You’re signed in with ChatGPT. Choose the name your survivor will use in Westbridge." : "Enter a shared city, search for supplies, and build a place to return to."}</p><form id="auth-form"><label for="name">Survivor name</label><input id="name" name="name" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" value="${esc(draftName)}" required placeholder="Your callsign">${hosted ? "" : `<label for="password">Password</label><input id="password" name="password" type="password" minlength="10" maxlength="128" autocomplete="${authMode === "register" ? "new-password" : "current-password"}" placeholder="At least 10 characters" required>`}<p class="form-error" role="alert">${esc(error)}</p><button class="primary full" ${disabled()}>${busy ? "Connecting…" : "Enter the district"} ${icon("arrow")}</button></form>${hosted ? "" : `<button class="text-button" id="toggle-auth">${authMode === "register" ? "Already have a survivor? Sign in" : "Create a new survivor"}</button>`}<p class="muted small">Your progress is saved online. Return whenever you’re ready.</p></section></main></div>`;
  document.querySelector("#toggle-auth")?.addEventListener("click", () => {
    authMode = authMode === "register" ? "login" : "register";
    error = "";
    auth();
  });
  document.querySelector("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    draftName = String(form.get("name"));
    busy = true;
    const button = e.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      accept(
        await api(authMode, {
          name: draftName,
          password: form.get("password"),
        }),
      );
      error = "";
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      render();
    }
  };
}
const bar = (value, max, cls = "") =>
  `<progress class="${cls}" value="${value}" max="${max}"></progress>`;
function sidebar() {
  const p = state.player;
  return `<aside class="sidebar"><section class="profile"><div class="profile-title">Survivor information</div><div class="profile-name">${icon("survivor")}<strong>${esc(p.name)}</strong></div><dl><dt>Scrap</dt><dd class="resource">${p.scrap.toLocaleString()}</dd><dt>Experience</dt><dd>${p.xp} XP</dd><dt>Medical kits</dt><dd>${p.medkits}</dd><dt>Workbench</dt><dd>Level ${p.level}</dd></dl><div class="meter-label"><strong>Energy</strong><span>${p.energy} / 100</span></div>${bar(p.energy, 100, "energy")}<div class="meter-label"><strong>Health</strong><span>${p.hp} / 100</span></div>${bar(p.hp, 100, "health")}<small>Energy recovers +1 / minute</small></section><div class="nav-title">Westbridge</div><nav aria-label="Main navigation">${[["home", "Overview"], ["district", "Local area"], ["refuge", "My refuge"], ["survivor", "Survivor"], ["journal", "Field journal"], ...(state.encounter ? [["combat", "Encounter"]] : [])].map(([id, name]) => `<button data-page="${id}" aria-label="${name}" class="nav-item ${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>${icon(id === "combat" ? "target" : id)}<span>${name}</span></button>`).join("")}</nav><div class="sidebar-location"><span class="eyebrow">YOUR LOCATION</span><strong>${esc(current().name)}</strong><span>(${coords(current())})</span><small>${p.travel ? "On the move" : state.encounter ? "In combat" : "On foot"}</small></div><button class="signout" id="logout">${icon("exit")} Sign out</button></aside>`;
}
function panel(title, body, extra = "", cls = "") {
  return `<section class="panel ${cls}"><div class="panel-heading"><h2>${title}</h2>${extra}</div>${body}</section>`;
}
function table(rows) {
  return `<dl class="info-table">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}
function travelBanner() {
  const t = state.player.travel;
  if (!t) return "";
  return `<section class="travel-banner" aria-label="Journey in progress"><div>${icon("clock")}<span><strong>Travelling to ${esc(state.travelDestination.name)}</strong><small>(${coords(current())}) → (${coords(state.travelDestination)}) · arrival <span data-countdown="${t.arrivesAt}">${duration(seconds(t.arrivesAt))}</span></small></span><strong class="travel-time" data-countdown="${t.arrivesAt}">${duration(seconds(t.arrivesAt))}</strong></div><progress data-journey="true" value="${now() - t.departedAt}" max="${t.arrivesAt - t.departedAt}"></progress></section>`;
}
function cityMap() {
  const center = current(),
    p = state.player;
  let tiles = "";
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const loc = state.world.find(
        (l) => l.x === center.x + dx && l.y === center.y + dy,
      );
      tiles += loc
        ? `<button class="map-tile ${loc.id === p.location ? "current" : ""} ${loc.id === selected ? "selected" : ""}" data-location="${loc.id}" aria-label="${esc(loc.name)} (${coords(loc)})${loc.id === p.location ? ", your location" : ""}" aria-pressed="${loc.id === selected}"><span class="tile-coordinate">${coords(loc)}</span><span class="${art(loc.type)}" aria-hidden="true"></span>${loc.id === p.location ? `<span class="you-marker">${p.travel ? "DEPARTING" : "YOU ARE HERE"}</span>` : ""}<span class="tile-name">${esc(loc.name)}</span><span class="tile-detail">${loc.type === "safehouse" ? "Refuge" : `${loc.supply.remaining}/${loc.supply.capacity} searches`}${loc.players > 1 ? ` · ${loc.players} survivors` : ""}</span></button>`
        : '<div class="map-edge">City boundary</div>';
    }
  return panel(
    "Local area",
    `<div class="map-toolbar"><span>Westbridge · ${esc(center.district)}</span><strong>(${coords(center)})</strong></div><div class="city-map" role="group" aria-label="Your position and eight surrounding blocks">${tiles}</div><div class="map-key"><span><i></i>Your position</span><span>3 × 3 local view</span><span>North ↑</span></div><div class="map-help">Select a neighbouring block to inspect it and start travelling. The view follows your survivor.</div>`,
    `<span class="badge">100 × 100 city</span>`,
    "map-panel",
  );
}
function locationPanel() {
  const p = state.player,
    loc = state.world.find((l) => l.id === selected) || current(),
    here = loc.id === p.location,
    stock = loc.supply || state.world.find((l) => l.id === p.location).supply;
  return panel(
    here ? "Current block" : "Selected block",
    `<div class="location-body"><div class="location-title"><span class="mini-art ${art(loc.type)}"></span><div><h3>${esc(loc.name)}</h3><span class="muted">${esc(loc.type)} · (${coords(loc)})</span></div></div><p>${esc(loc.description)}</p>${table([["Survivors", loc.players], ["Supplies", loc.type === "safehouse" ? "Personal workbench" : `${stock.remaining} / ${stock.capacity} searches remaining`], ...(!here ? [["Travel time", `${loc.travelSeconds} seconds`]] : [])])}${loc.type !== "safehouse" ? `<div class="stock-bar">${bar(stock.remaining, stock.capacity)}</div><p class="small muted">Shared by all survivors. One search uses one supply stock. Replenishes 1 stock every 30 minutes${stock.nextRefillAt ? `; next in <span data-countdown="${stock.nextRefillAt}">${duration(seconds(stock.nextRefillAt))}</span>` : ""}.</p>` : ""}${!here ? `<button class="primary full" data-action="move" data-target="${loc.id}" ${disabled(p.travel || state.encounter)}>Travel here · ${loc.travelSeconds}s ${icon("arrow")}</button>` : loc.type === "safehouse" ? '<button class="primary full" data-page="refuge">Enter your refuge</button>' : `<button class="primary full" data-action="search" ${disabled(p.travel || state.encounter || stock.remaining === 0 || seconds(p.search_at) > 0)}>${stock.remaining === 0 ? "Block picked clean" : "Search for supplies"}</button><p class="small muted">${seconds(p.search_at) > 0 ? `Next search in <span data-countdown="${p.search_at}">${duration(seconds(p.search_at))}</span>` : "No energy cost. 30 seconds between searches."}</p>`}</div>`,
  );
}
function threats() {
  const p = state.player;
  if (state.encounter)
    return panel(
      "Encounter in progress",
      `<div class="panel-body"><strong>${esc(state.encounter.name)}</strong><p>You have already paid the attack energy cost.</p><button class="danger full" data-page="combat">Continue encounter</button></div>`,
    );
  return panel(
    "People & threats",
    `<div class="panel-body">${p.travel ? "<p>You can inspect the destination after you arrive.</p>" : state.enemies.length ? state.enemies.map((e) => `<div class="threat-row">${icon("target")}<div><strong>${esc(e.name)}</strong><small>${e.available ? "Hostile · 45 health" : e.engaged_by ? "Engaged by another survivor" : "Area clear · target returning"}</small></div></div><button class="danger full" data-action="attack" data-target="${esc(e.id)}" ${disabled(!e.available || p.energy < state.rules.attackEnergy)}>Initiate attack <span>⚡ ${state.rules.attackEnergy}</span></button>`).join("") : "<p>The refuge perimeter is secure.</p>"}${state.occupants.length ? `<div class="occupants"><strong>Also here</strong>${state.occupants.map((o) => `<p>${icon("survivor")} ${esc(o.name)}</p>`).join("")}</div>` : ""}</div>`,
  );
}
function journal(full = false) {
  return panel(
    full ? "Field journal" : "Recent activity",
    `<div class="journal-entries">${state.events
      .slice(0, full ? 30 : 5)
      .map(
        (e) =>
          `<div class="journal-entry"><time>${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><p>${esc(e.message)}</p></div>`,
      )
      .join("")}</div>`,
    full
      ? ""
      : '<button class="text-button" data-page="journal">All reports →</button>',
  );
}
function overview() {
  const p = state.player;
  return `<div class="overview-grid"><div>${panel(
    "General information",
    table([
      ["Name", esc(p.name)],
      ["Location", `${esc(current().name)} (${coords(current())})`],
      ["Experience", `${p.xp} XP`],
      ["Threats defeated", p.kills],
      [
        "Condition",
        p.travel ? "Travelling" : state.encounter ? "In combat" : "Ready",
      ],
      ["Medical supplies", `${p.medkits} kits`],
    ]),
  )}${panel(
    "Combat readiness",
    table([
      ["Health", `${p.hp} / 100`],
      ["Energy", `${p.energy} / 100`],
      ["Strike damage", 16 + Math.floor(p.xp / 50)],
      ["Guard damage", 7],
      ["Attack initiation", `${state.rules.attackEnergy} energy`],
    ]),
  )}</div><div>${panel(
    "Your refuge",
    `<button class="refuge-preview ${art("safehouse")}" data-page="refuge" aria-label="Open your refuge"></button>${table(
      [
        ["Workbench", `Level ${p.level} / 5`],
        ["Production", `${p.level} scrap per minute`],
        ["Stockpile", `${p.scrap.toLocaleString()} scrap`],
      ],
    )}`,
  )}${journal()}</div></div>`;
}
function refuge() {
  const p = state.player,
    home = p.location === state.city.home;
  return `<div class="refuge-layout">${panel("The refuge", `<div class="settlement-scene"><div class="${art("safehouse")}"></div><span class="building-label">Salvage workbench · Level ${p.level}</span></div><div class="refuge-caption">Your foothold in Westbridge · (50, 50)<span>Production continues while you are away.</span></div>`)}<div>${panel(
    "Workbench",
    `<div class="panel-body"><p>A steady supply of reclaimed materials for your next expedition.</p>${table(
      [
        ["Current level", `${p.level} / 5`],
        ["Production", `${p.level} scrap / minute`],
        ["Stockpile", `${p.scrap} scrap`],
        [
          "Next upgrade",
          p.level === 5 ? "Maximum level" : `${p.level * 40} scrap`,
        ],
      ],
    )}<button class="primary full" data-action="upgrade" ${disabled(!home || p.travel || state.encounter || p.level === 5 || p.scrap < p.level * 40)}>${p.level === 5 ? "Fully upgraded" : "Upgrade workbench"}</button><p class="small muted">${home ? "Each upgrade adds 1 scrap per minute. Offline production is capped at 8 hours." : "Return to the refuge to build. Your current location is " + coords(current()) + "."}</p></div>`,
  )}${panel(
    "Refuge inventory",
    table([
      ["Salvaged materials", `${p.scrap} scrap`],
      ["Medical kits", p.medkits],
      ["Protection", "Secure perimeter"],
    ]),
  )}</div></div>`;
}
function survivor() {
  const p = state.player;
  return `<div class="overview-grid">${panel(
    "Survivor profile",
    `<div class="survivor-heading">${icon("survivor")}<div><h2>${esc(p.name)}</h2><span>Westbridge survivor</span></div></div>${table(
      [
        ["Location", `${esc(current().name)} (${coords(current())})`],
        ["Experience", `${p.xp} XP`],
        ["Threats defeated", p.kills],
        ["Strike damage", 16 + Math.floor(p.xp / 50)],
      ],
    )}`,
  )}${panel("Inventory", `<div class="panel-body"><div class="inventory-item">${icon("scrap")}<div><strong>Salvaged scrap</strong><span>Construction material</span></div><b>${p.scrap}</b></div><div class="inventory-item">${icon("medical")}<div><strong>Medical kit</strong><span>Restores up to 35 health</span></div><b>${p.medkits}</b></div><button class="primary full" data-action="heal" ${disabled(p.hp === 100 || !p.medkits)}>Use a medical kit</button><p class="small muted">${state.encounter ? "An enemy can counterattack while you heal." : "No energy cost."}</p></div>`)}</div>`;
}
function combat() {
  const p = state.player,
    c = state.encounter;
  if (!c)
    return `${panel("Encounter complete", `<div class="panel-body"><h3>The fight is over.</h3><p>${esc(state.events[0]?.message || "Return to the local area to continue.")}</p><button class="primary" data-page="district">Return to local area</button></div>`)}${journal()}`;
  return `<div class="combat-notice">${icon("target")} <strong>Attacking ${esc(c.name)}</strong><span>Round ${c.round + 1} · entry energy paid</span></div><div class="combat-grid">${panel(esc(p.name), `<div class="combat-health">${bar(p.hp, 100, "health")}<span>${p.hp} / 100 HP</span></div><div class="fighter-layout"><div class="fighter-avatar ally">${icon("survivor")}<span>SURVIVOR</span></div><div class="equipment-actions"><button data-action="strike" ${disabled()}><span>Strike</span>${icon("target")}<strong>${16 + Math.floor(p.xp / 50)} damage</strong></button><button data-action="guard" ${disabled()}><span>Guard</span>${icon("refuge")}<strong>7 damage · 3 received</strong></button><button data-action="heal" ${disabled(p.medkits === 0 || p.hp === 100)}><span>Medical kit</span>${icon("medical")}<strong>${p.medkits} available</strong></button></div></div><div class="fighter-footer">Actions within this fight cost no further energy.</div>`, '<span class="badge">YOU</span>', "fighter-card")}${panel(
    esc(c.name),
    `<div class="combat-health">${bar(c.enemy_hp, 45, "enemy-health")}<span>${c.enemy_hp} / 45 HP</span></div><div class="fighter-layout"><div class="fighter-avatar enemy">${icon("survivor")}<span>WALKER</span></div><div class="enemy-stats">${table(
      [
        ["Counterattack", "11 damage"],
        ["Against guard", "3 damage"],
        ["While healing", "6 damage"],
        ["Reward", "20 XP · 12 scrap"],
      ],
    )}</div></div><div class="fighter-footer">${esc(current().name)} · (${coords(current())})</div>`,
    '<span class="badge danger-badge">HOSTILE</span>',
    "fighter-card",
  )}</div><div class="combat-bottom">${journal()}${panel("Withdraw", `<div class="panel-body"><p>Break away from the encounter. You will take 8 damage.</p><button class="secondary full" data-action="flee" ${disabled()}>Withdraw</button></div>`)}</div>`;
}
function render() {
  if (!state) {
    auth();
    return;
  }
  const titles = {
    home: "Overview",
    district: "Local area",
    refuge: "My refuge",
    survivor: "Survivor",
    journal: "Field journal",
    combat: "Attacking",
  };
  const focus = document.activeElement?.dataset;
  const oldFocus = focus
    ? { page: focus.page, action: focus.action, location: focus.location }
    : null;
  app.innerHTML = `<header class="topbar">${brand()}<div class="topbar-location">Westbridge <span>100 × 100 blocks</span></div><div class="connection ${online ? "" : "offline"}">${online ? "Connected" : "Reconnecting"}<small>${esc(state.player.name)}</small></div></header><div class="shell">${sidebar()}<main class="content"><div class="page-heading"><div><span class="eyebrow">WESTBRIDGE</span><h1>${titles[page]}</h1></div><span class="page-coordinates">${icon("district")} (${coords(current())})</span></div>${travelBanner()}${page === "district" ? `<div class="district-layout"><div>${cityMap()}${journal()}</div><div class="action-column">${locationPanel()}${threats()}</div></div>` : page === "home" ? overview() : page === "refuge" ? refuge() : page === "survivor" ? survivor() : page === "combat" ? combat() : journal(true)}<footer>DEADBROWSE <span>Shared world · Progress saved online</span></footer></main></div>`;
  app.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.page;
        render();
      }),
  );
  app.querySelectorAll("[data-location]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = Number(b.dataset.location);
        render();
      }),
  );
  app
    .querySelectorAll("[data-action]")
    .forEach(
      (b) => (b.onclick = () => act(b.dataset.action, b.dataset.target)),
    );
  document.querySelector("#logout").onclick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await api("logout", {});
      if (result.redirect === "/signout-with-chatgpt?return_to=/") {
        window.location.assign(result.redirect);
        return;
      }
      state = null;
      csrf = "";
      authMode = "login";
    } catch (e) {
      notify(e.message);
    } finally {
      busy = false;
      render();
    }
  };
  if (oldFocus) {
    const selector = oldFocus.action
      ? `[data-action="${oldFocus.action}"]`
      : oldFocus.location
        ? `[data-location="${oldFocus.location}"]`
        : oldFocus.page
          ? `[data-page="${oldFocus.page}"]`
          : null;
    if (selector) app.querySelector(selector)?.focus({ preventScroll: true });
  }
}
async function act(type, target) {
  if (busy) return;
  busy = true;
  render();
  try {
    const input = {
      type,
      key: crypto.randomUUID(),
      version: state.player.version,
    };
    if (target !== undefined)
      input.target = type === "move" ? Number(target) : target;
    accept(await api("action", input));
    if (type === "attack") page = "combat";
    notify(state.events[0].message);
  } catch (e) {
    notify(e.message);
    if (e.status === 401) {
      state = null;
      csrf = "";
    } else if (e.status === 409) {
      try {
        accept(await api("state"));
      } catch {
        online = false;
      }
    }
  } finally {
    busy = false;
    render();
  }
}
async function refresh() {
  if (busy || polling || document.hidden || !state) return;
  polling = true;
  try {
    const result = await api("state");
    if (!busy && state) {
      accept(result);
      render();
    }
  } catch (e) {
    if (e.status === 401) {
      state = null;
      csrf = "";
    }
    online = false;
    if (!busy) render();
  } finally {
    polling = false;
  }
}
try {
  accept(await api("state"));
} catch (e) {
  if (e.status !== 401) error = "Unable to reach the city. Please try again.";
}
render();
setInterval(() => {
  if (!state) return;
  document
    .querySelectorAll("[data-countdown]")
    .forEach(
      (el) =>
        (el.textContent = duration(seconds(Number(el.dataset.countdown)))),
    );
  const journey = document.querySelector("[data-journey]");
  if (journey && state.player.travel)
    journey.value = now() - state.player.travel.departedAt;
  if (state.player.travel && seconds(state.player.travel.arrivesAt) === 0)
    refresh();
}, 250);
setInterval(refresh, 3000);
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(
      document.modelContext.registerTool({
        name: "inspect_survivor",
        description:
          "Read your visible survivor state and local neighbourhood without taking a game action.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (
            !input ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            Object.keys(input).length
          )
            throw new Error("No arguments expected.");
          if (!state) throw new Error("Enter the district first.");
          return {
            player: { ...state.player },
            location: { ...state.location },
            neighbourhood: state.world,
            encounter: state.encounter,
          };
        },
      }),
    ).catch(() => {});
  } catch {}
}
