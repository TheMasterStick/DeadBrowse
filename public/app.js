const app = document.querySelector("#app"),
  toast = document.querySelector("#toast");
let state = null,
  csrf = "",
  page = "district",
  selected = 12,
  busy = false,
  authMode = "register",
  online = true,
  lastError = "",
  noticeTimer;
const icons = {
  district:
    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  survivor:
    '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  refuge: '<path d="M3 11 12 3l9 8v10H3Z"/><path d="M9 21v-8h6v8"/>',
  journal: '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>',
  energy: '<path d="m13 2-8 12h6l-1 8 9-13h-7z"/>',
  health: '<path d="M12 21 3 12C-3 5 7-2 12 6c5-8 15-1 9 6Z"/>',
  scrap: '<path d="m12 3 9 5v9l-9 5-9-5V8Z M3 8l9 5 9-5M12 13v9"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  radio:
    '<path d="M4 10h16v11H4zM7 10 18 3M7 14h5M7 17h5"/><circle cx="17" cy="16" r="1"/>',
  exit: '<path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4"/>',
  medical: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.district}</svg>`;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clockText = (t) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function notify(message) {
  clearTimeout(noticeTimer);
  toast.textContent = message;
  toast.classList.add("show");
  noticeTimer = setTimeout(() => toast.classList.remove("show"), 5000);
}
async function api(path, data) {
  const response = await fetch(`/api/${path}`, {
    method: data ? "POST" : "GET",
    headers: data
      ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
      : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return result;
}
function accept(result) {
  if (result.csrf) csrf = result.csrf;
  if (result.state && (!state || result.state.serverTime >= state.serverTime))
    state = result.state;
  online = true;
}
function title() {
  return `<a class="brand" href="/" aria-label="DeadBrowse home"><span class="brand-mark">D<span>▪</span></span><span>DEAD<span class="muted-brand">BROWSE</span><small>LIFE AFTER THE FALL</small></span></a>`;
}
function login() {
  app.innerHTML = `<main class="entry"><section class="entry-world">${title()}<div class="entry-copy"><span class="eyebrow"><span class="live-dot"></span> A PERSISTENT WORLD</span><h1>The world ended.<br><em>Your story didn’t.</em></h1><p>Explore the forgotten streets. Build a place to call home.<br>Make something of what remains.</p><div class="entry-skyline" aria-hidden="true">${Array.from({ length: 13 }, (_, i) => `<div class="tower t${i % 5}"><i></i><i></i><i></i></div>`).join("")}</div><div class="entry-caption"><span>QUARANTINE DISTRICT 01</span><span>51° 30′ N / 00° 07′ W · FICTIONAL SECTOR</span></div></div><footer>EXPLORE. ENDURE. REBUILD.<span>FOUNDATION BUILD 0.1</span></footer></section><section class="entry-form"><div><span class="eyebrow">THE REFUGE IS OPEN</span><h2>${authMode === "register" ? "A new beginning." : "Welcome back."}</h2><p class="subtle">${authMode === "register" ? "Create your survivor and enter the district." : "Your corner of the world is waiting."}</p><form id="auth-form"><label for="name">SURVIVOR NAME</label><input id="name" name="name" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" placeholder="Your callsign" required><label for="password">PASSWORD</label><input id="password" name="password" type="password" autocomplete="${authMode === "register" ? "new-password" : "current-password"}" minlength="10" maxlength="128" placeholder="At least 10 characters" required><p class="form-error" role="alert">${esc(lastError)}</p><button class="primary full" ${busy ? "disabled" : ""}>${busy ? "Establishing contact…" : authMode === "register" ? "Enter the district" : "Return to the district"} ${icon("arrow")}</button></form><p class="auth-switch">${authMode === "register" ? "Already have a survivor?" : "New to the refuge?"} <button data-auth-toggle>${authMode === "register" ? "Sign in" : "Create a survivor"}</button></p><div class="entry-note">${icon("radio")}<p>One shared world. Your progress is saved on the server. Come back when you’re ready.</p></div></div></section></main>`;
  document.querySelector("[data-auth-toggle]").onclick = () => {
    authMode = authMode === "register" ? "login" : "register";
    lastError = "";
    login();
  };
  document.querySelector("#auth-form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    busy = true;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Establishing contact…";
    try {
      accept(
        await api(authMode, {
          name: form.get("name"),
          password: form.get("password"),
        }),
      );
      selected = state.player.location;
      lastError = "";
      render();
    } catch (e) {
      lastError = e.message;
      busy = false;
      login();
    } finally {
      busy = false;
      render();
    }
  };
}
function stats() {
  const p = state.player;
  return `<div class="stats"><div class="stat">${icon("health")}<div><span>HEALTH</span><strong>${p.hp}<small> / 100</small></strong><progress value="${p.hp}" max="100" aria-label="Health"></progress></div></div><div class="stat energy">${icon("energy")}<div><span>ENERGY</span><strong>${p.energy}<small> / ${state.rules.maxEnergy}</small></strong><progress value="${p.energy}" max="100" aria-label="Energy"></progress></div><span class="stat-hint">+1 / min</span></div><div class="stat">${icon("scrap")}<div><span>SALVAGED SCRAP</span><strong>${p.scrap.toLocaleString()}<small> units</small></strong><p>+${p.level} per minute at refuge</p></div></div><div class="stat">${icon("survivor")}<div><span>EXPERIENCE</span><strong>${p.xp}<small> XP</small></strong><p>${p.kills} threats eliminated</p></div></div></div>`;
}
const disabled = (condition) => (busy || condition ? "disabled" : "");
function map() {
  const p = state.player;
  return `<section class="panel map-panel"><div class="panel-heading"><div><span class="eyebrow">QUARANTINE DISTRICT 01</span><h2>Westbridge</h2></div><span class="tag">25 BLOCKS</span></div><div class="map-wrap"><div class="map-compass">N ↑</div><div class="city-map" role="group" aria-label="Westbridge district map">${state.world.map((loc) => `<button class="map-tile ${loc.type} ${loc.id === p.location ? "current" : ""} ${loc.id === selected ? "selected" : ""}" data-location="${loc.id}" aria-label="${esc(loc.name)}${loc.id === p.location ? ", your location" : ""}" aria-pressed="${loc.id === selected}"><span class="tile-coordinate">${String.fromCharCode(65 + loc.x)}${loc.y + 1}</span><span class="buildings" aria-hidden="true"><i></i><i></i><i></i></span>${loc.type === "safehouse" ? `<span class="refuge-symbol">${icon("refuge")}</span>` : ""}${loc.type === "medical" ? '<span class="medical-symbol">+</span>' : ""}<span class="tile-name">${esc(loc.name)}</span>${loc.id === p.location ? '<span class="you-marker">YOU</span>' : loc.players ? `<span class="player-marker">${loc.players}</span>` : ""}</button>`).join("")}</div></div><div class="map-legend"><span><i class="legend-you"></i>Your position</span><span><i class="legend-refuge"></i>Refuge</span><span><i class="legend-selected"></i>Selected block</span><span class="map-coords">WESTBRIDGE / SECTOR A</span></div></section>`;
}
function locationPanel() {
  const p = state.player,
    loc = state.world[selected],
    here = selected === p.location,
    near =
      Math.abs(loc.x - (p.location % 5)) +
        Math.abs(loc.y - Math.floor(p.location / 5)) ===
      1;
  const remaining = Math.max(
    0,
    Math.ceil((p.search_at - state.serverTime) / 1000),
  );
  return `<section class="panel location-panel"><div class="location-art ${loc.type}"><span class="eyebrow">${here ? "CURRENT LOCATION" : "BLOCK RECONNAISSANCE"}</span><div class="street-scene" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="location-type">${esc(loc.type.toUpperCase())}</span></div><div class="location-content"><h2>${esc(loc.name)}</h2><p>${esc(loc.description)}</p><div class="location-meta"><span>BLOCK ${String.fromCharCode(65 + loc.x)}${loc.y + 1}</span><span>${loc.players} SURVIVOR${loc.players === 1 ? "" : "S"}</span></div>${!here ? `<button class="primary full" data-action="move" data-target="${loc.id}" ${disabled(!near || state.encounter)}>Travel here ${icon("arrow")}</button><small class="action-note">${near ? "Movement costs no energy." : "Reach an adjacent block to travel here."}</small>` : loc.id === 12 ? `<button class="primary full" data-page="refuge">Manage your refuge ${icon("arrow")}</button><small class="action-note">A place to prepare for your next expedition.</small>` : `<button class="primary full" data-action="search" ${disabled(remaining > 0 || state.encounter)}>Search for supplies ${icon("scrap")}</button><small class="action-note">${remaining ? `Search available in ${remaining}s` : "No energy cost · 30s between searches"}</small>`}</div></section>`;
}
function encounterPanel() {
  const c = state.encounter,
    p = state.player;
  if (c)
    return `<section class="panel threat-panel"><div class="panel-heading"><h3>${icon("target")} In combat</h3><span class="danger-tag">ROUND ${c.round + 1}</span></div><h2>${esc(c.name)}</h2><div class="enemy-health"><progress value="${c.enemy_hp}" max="45" aria-label="Enemy health"></progress><span>${c.enemy_hp} / 45 HP</span></div><p class="subtle">Entry energy paid. Every choice from here costs no energy.</p><div class="combat-actions"><button class="primary" data-action="strike" ${disabled(false)}>Strike</button><button class="secondary" data-action="guard" ${disabled(false)}>Guard</button><button class="secondary" data-action="heal" ${disabled(!p.medkits || p.hp === 100)}>Medkit (${p.medkits})</button><button class="secondary" data-action="flee" ${disabled(false)}>Withdraw</button></div><small class="action-note">Guard reduces incoming damage. Withdrawing costs 8 health.</small></section>`;
  return `<section class="panel threat-panel"><div class="panel-heading"><h3>${icon("target")} Nearby threats</h3><span class="tag">${state.enemies.filter((e) => e.available).length}</span></div>${state.enemies.length ? state.enemies.map((e) => `<div class="enemy-row"><div class="enemy-avatar">${icon("target")}</div><div><strong>${esc(e.name)}</strong><small>${e.available ? "45 HP · Hostile" : e.engaged_by ? "Engaged by another survivor" : "Area clear · target returning"}</small></div></div><button class="secondary full" data-action="attack" data-target="${esc(e.id)}" ${disabled(!e.available || p.energy < state.rules.attackEnergy)}>Initiate attack <span>${icon("energy")} ${state.rules.attackEnergy}</span></button>`).join("") : '<p class="subtle">The refuge perimeter is secure. Head into the district to find supplies and encounters.</p>'}</section>`;
}
function journal(full = false) {
  return `<section class="panel journal-panel"><div class="panel-heading"><h3>Field journal</h3>${full ? '<span class="tag">LATEST 30 ENTRIES</span>' : '<button class="text-button" data-page="journal">View all ↗</button>'}</div><div class="journal-entries">${state.events
    .slice(0, full ? 30 : 4)
    .map(
      (e) =>
        `<div class="journal-entry"><time>${clockText(e.at)}</time><span></span><p>${esc(e.message)}</p></div>`,
    )
    .join("")}</div></section>`;
}
function refuge() {
  const p = state.player;
  return `<div class="refuge-layout"><section class="panel refuge-overview"><span class="eyebrow">YOUR FOOTHOLD IN WESTBRIDGE</span><h2>A little order.<br>In a world without it.</h2><p>Your room at the refuge comes with a salvage workbench. Improve it to build a steady supply of materials for the road ahead.</p><div class="refuge-illustration" aria-hidden="true">${icon("refuge")}</div><div class="refuge-facts"><div><span>WORKBENCH</span><strong>Level ${p.level} / 5</strong></div><div><span>PRODUCTION</span><strong>${p.level} scrap / min</strong></div><div><span>OFFLINE CAP</span><strong>8 hours</strong></div></div></section><section class="panel upgrade-panel"><span class="eyebrow">INVEST IN TOMORROW</span><h2>${p.level === 5 ? "Fully equipped" : "Upgrade your workbench"}</h2><p class="subtle">${p.level === 5 ? "Your workbench is operating at maximum capacity." : `Level ${p.level + 1} increases production to ${p.level + 1} scrap per minute. Resources continue accumulating while you are away.`}</p><div class="upgrade-cost"><span>Materials required</span><strong>${p.level === 5 ? "—" : `${p.level * 40} scrap`}</strong></div><button class="primary full" data-action="upgrade" ${disabled(p.location !== 12 || p.level === 5 || p.scrap < p.level * 40 || state.encounter)}>Upgrade workbench ${icon("arrow")}</button><small class="action-note">${p.location !== 12 ? "Return to the refuge to build." : "Production is credited automatically. No collection needed."}</small><button class="secondary full spaced" data-page="district">Back to district</button></section></div>`;
}
function survivor() {
  const p = state.player;
  return `<div class="refuge-layout"><section class="panel survivor-card"><div class="profile-avatar">${icon("survivor")}</div><span class="eyebrow">WESTBRIDGE SURVIVOR</span><h2>${esc(p.name)}</h2><p class="subtle">Currently at ${esc(state.world[p.location].name)}</p><div class="refuge-facts"><div><span>EXPERIENCE</span><strong>${p.xp} XP</strong></div><div><span>CONFIRMED KILLS</span><strong>${p.kills}</strong></div><div><span>STRIKE DAMAGE</span><strong>${16 + Math.floor(p.xp / 50)}</strong></div></div></section><section class="panel upgrade-panel"><span class="eyebrow">YOUR INVENTORY</span><h2>Travel light. Stay ready.</h2><div class="inventory-item">${icon("scrap")}<div><strong>Salvaged scrap</strong><small>Building material</small></div><b>${p.scrap}</b></div><div class="inventory-item">${icon("medical")}<div><strong>Medical kit</strong><small>Restores up to 35 health</small></div><b>${p.medkits}</b></div><button class="primary full" data-action="heal" ${disabled(p.hp === 100 || !p.medkits)}>Use a medical kit</button><small class="action-note">${state.encounter ? "Using a kit in combat allows an enemy counterattack." : "Healing costs no energy."}</small></section></div>`;
}
function render() {
  if (!state) {
    login();
    return;
  }
  const p = state.player;
  const headings = {
    district: ["The district", "Every block has a story. Find yours."],
    refuge: ["Your refuge", "Build a foothold. Make it last."],
    survivor: [
      "Your survivor",
      "Everything you’ve carried. Everything you’ve survived.",
    ],
    journal: ["Field journal", "A record of life after the fall."],
  };
  app.innerHTML = `<div class="shell"><aside class="sidebar">${title()}<div class="sidebar-section-label">SURVIVAL</div><nav aria-label="Main navigation">${[
    ["district", "The district"],
    ["survivor", "Survivor"],
    ["refuge", "My refuge"],
    ["journal", "Field journal"],
  ]
    .map(
      ([id, name]) =>
        `<button data-page="${id}" aria-label="${name}" class="nav-item ${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>${icon(id)}<span>${name}</span>${id === "district" ? '<span class="nav-number" aria-hidden="true">01</span>' : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-radio">${icon("radio")}<span class="eyebrow">REFUGE FREQUENCY</span><p>“Gates are open.<br>Keep your radio on.”</p><small>104.8 FM · WESTBRIDGE</small></div><div class="sidebar-bottom"><span class="status"><i class="${online ? "" : "offline"}"></i>${online ? "WORLD CONNECTED" : "RECONNECTING"}</span><small>FOUNDATION BUILD 0.1</small></div></aside><div class="main-shell"><header class="topbar"><div><span class="breadcrumb">WORLD</span><span>/</span><strong>WESTBRIDGE</strong><span class="prototype-tag">ALPHA</span></div><div class="account"><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span><span>${esc(p.name)}<small>Survivor</small></span><button class="icon-button" id="logout" aria-label="Sign out">${icon("exit")}</button></div></header><main class="content"><div class="page-heading"><div><span class="eyebrow">LIFE AFTER THE FALL</span><h1>${headings[page][0]}</h1><p>${headings[page][1]}</p></div><div class="world-clock"><span class="live-dot"></span><span>SHARED WORLD<small>${clockText(state.serverTime)} LOCAL TIME</small></span></div></div>${stats()}${page === "district" ? `<div class="district-layout"><div class="map-column">${map()}${journal()}</div><div class="action-column">${locationPanel()}${encounterPanel()}${state.occupants.length ? `<section class="panel nearby"><span class="eyebrow">ALSO IN YOUR BLOCK</span>${state.occupants.map((o) => `<p>${icon("survivor")} ${esc(o.name)}</p>`).join("")}</section>` : ""}</div></div>` : page === "refuge" ? refuge() : page === "survivor" ? survivor() : journal(true)}<footer class="content-footer"><span>YOUR NEXT CHAPTER IS OUT THERE.</span><span>Persistent world · Server-saved progress</span></footer></main></div></div>`;
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
      await api("logout", {});
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
}
async function act(type, target) {
  if (busy) return;
  busy = true;
  render();
  try {
    const data = {
      type,
      key: crypto.randomUUID(),
      version: state.player.version,
    };
    if (target !== undefined)
      data.target = type === "move" ? Number(target) : target;
    accept(await api("action", data));
    if (type === "move" || state.player.location === 12)
      selected = state.player.location;
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
  if (busy || document.hidden) return;
  try {
    const result = await api("state");
    if (busy || !state) return;
    accept(result);
    render();
  } catch (e) {
    if (e.status === 401) {
      state = null;
      csrf = "";
    }
    online = false;
    if (!busy) render();
  }
}
try {
  accept(await api("state"));
  selected = state.player.location;
} catch (e) {
  if (e.status !== 401)
    lastError = "Unable to reach the world server. Please try again.";
}
render();
setInterval(() => {
  if (state) refresh();
}, 5000);
