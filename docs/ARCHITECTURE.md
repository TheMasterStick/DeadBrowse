# Architecture

## First deployment

Node.js 24 serves static HTML/CSS/JavaScript and a same-origin JSON API. `node:sqlite` owns persistent game state; no browser storage is treated as authoritative. There are no runtime npm dependencies. The browser polls state every three seconds while visible and submits explicit commands for mutations.

- `src/world.js`: deterministic 10,000-block city, preserved central district, local visibility, and tunable rules.
- `src/game.js`: Node authentication, SQLite persistence, and transactional adapter for the shared engine.
- `cloud/game.js`: shared authoritative rules, save migration, time settlement, snapshots, and command validation.
- `src/server.js`: HTTP boundary, sessions, input limits, origin/CSRF checks, static allowlist, security headers.
- `public/`: responsive browser UI with district, survivor, refuge, and journal screens.
- `test/game.test.js`: domain and real HTTP regression tests.
- `scripts/browser-smoke.mjs`: isolated two-player browser regression and responsive screenshots.

## Persistence and command safety

SQLite uses WAL, foreign keys, and a busy timeout. Every gameplay mutation runs in `BEGIN IMMEDIATE` with validation, resource costs, encounter changes, rewards, events, and command receipt committed together. Failure rolls everything back.

The client supplies a unique command key plus its last known character version. Repeating a committed key returns current state without reapplying the action; competing distinct commands at an old version fail with HTTP 409. Receipts are retained for one day, and version checks prevent old commands from replaying after receipt cleanup. Events are limited to 100 per survivor. The API returns the most recent 30.

The shared engine enforces one encounter per player and one owner per enemy inside atomic world commits. The server checks location, energy, cooldown, target availability, and inventory. Client-provided amounts, stats, player IDs, and rewards are never used to select an acting character or calculate outcomes.

Inactive encounters are expired lazily inside transactions. No browser tab or interval is required to maintain timers: the next relevant server read/action settles elapsed time. Production is settled at the previous upgrade level before an upgrade takes effect. Full energy does not accumulate recovery credit for later spending.

## Authentication boundary

Passwords are salted and hashed using Node's scrypt. Session tokens are generated from 32 random bytes; only their SHA-256 hashes are persisted. Sessions expire after seven days, use HttpOnly and SameSite=Strict cookies, and become Secure cookies in production. Authenticated writes require a per-session CSRF token. All POST requests require the configured origin and JSON content type. Bodies are limited to 4 KiB. Static file serving uses an explicit file allowlist. Client text is escaped before HTML insertion.

The initial sign-in throttle is process-local and keyed by socket IP. Behind a reverse proxy, it conservatively applies to the proxy address; do not blindly trust forwarded IP headers. Configure trusted-proxy-aware edge rate limits before a public launch. Never share sessions or use a hard-coded account as the multiplayer identity.

## API

| Route           | Method | Purpose                                                       |
| --------------- | ------ | ------------------------------------------------------------- |
| `/api/register` | POST   | Create account and session                                    |
| `/api/login`    | POST   | Verify credentials and create session                         |
| `/api/state`    | GET    | Settle time and return private character + shared world state |
| `/api/action`   | POST   | Execute a validated, versioned, idempotent command            |
| `/api/logout`   | POST   | Revoke current session                                        |

This API intentionally has no arbitrary player lookup, resource grant, client clock override, or public administrative endpoint.

## Limits and upgrade path

Use one application process and one local persistent SQLite database initially. Synchronous transactions make correctness straightforward for a small shared world, but are not a claim of MMO-scale capacity. The state endpoint returns only the player’s 3 × 3 neighbourhood, while filtering presence from server-owned players. Optimize with spatial indexes as concurrency grows. No distributed state, WebSockets, public chat, PvP, or autonomous faction simulation is claimed.

Before scaling: extend the existing versioned migrations, PostgreSQL transactions as concurrency/load warrants, distributed command/rate-limit storage, migrations/backups/restore verification, observability, account recovery, and load tests. Preserve the server authority and command semantics through that transition. Separate public deployment approval from code review.

## Hosted target

`cloud/worker.js` runs the same UI and game rules without a local installation. Private Sites supplies verified ChatGPT identity; no passwords are collected by the hosted game. The first visit chooses a callsign, and the authenticated identity is the server-only owner key. All writes still check same-origin requests; gameplay additionally checks the survivor's CSRF token.

D1 stores one versioned world snapshot containing player state and sparse mutations to the deterministic city. `cloud/store.js` reads a revision, applies an operation to an isolated copy, and uses an atomic conditional UPDATE to commit only if the revision has not changed. Conflicts reload and revalidate, so different Workers cannot spend the same resources or award the same target twice. This is intentionally a small-world storage adapter, not an MMO-scale data model. Command receipts and journals are bounded. A future larger deployment should partition state with a deliberate transaction strategy.

Drizzle-generated schema-only migrations own the hosted table. There is no runtime DDL. Hosted and local save files are separate stores; this initial deployment does not copy any development accounts. `scripts/hosted-check.mjs` tests the built Worker against a D1-compatible SQLite test adapter, including simultaneous requests and rule parity with the local engine. Real cloud deployment status verifies publication; it is not a substitute for future load testing.

Optional WebMCP provides read-only inspection of visible game state. A supported WebMCP preview context was unavailable; it is feature-detected and does not affect normal play.

## Expanded city migration

World payload version 2 maps legacy 5 × 5 location IDs into the central area of the 100 × 100 city, including players, enemies, and encounters. It preserves resources, progression, health, sessions, and journals. The local SQLite schema upgrades to version 2 by importing existing gameplay rows into `world_state`; old tables are retained. Hosted D1 keeps the same schema and upgrades the JSON payload atomically on the next operation.

Both adapters execute `cloud/game.js`, avoiding divergent gameplay rules. Arrivals use server timestamps and settle once. Stock records are sparse: untouched blocks derive full capacity from their type, and restored full stocks drop their override. Compare-and-swap retries revalidate the last remaining supply as well as shared targets. This model is suitable for a small multiplayer prototype; a large map does not imply support for large concurrent populations.
