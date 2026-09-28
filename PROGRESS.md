# DeadBrowse progress

## Milestone 1 — persistent playable foundation

Implemented:

- Responsive dark olive interface with an interactive authored 25-block district.
- Registration, sign-in/out, independent survivors, protected session cookies.
- Persistent server-owned characters, supplies, progression, events, and encounters.
- Shared location presence and exclusive enemy ownership across accounts.
- Adjacent movement, scavenging cooldowns, location-based supplies, medical kits.
- Energy charged only when initiating combat; strike, guard, heal, and withdraw actions.
- Defeat/recovery, rewards, enemy respawn, and abandoned-encounter expiry.
- Personal refuge production and upgrades driven by server elapsed time.
- Versioned commands, duplicate-action protection, and atomic resource changes.
- Setup instructions, design decision record, architecture, and regression tests.

Validation:

- `npm run check`: passes.
- `npm test`: 12 tests pass, including restart persistence and HTTP security boundaries.
- Chromium browser smoke: passed at desktop and 390px mobile widths, including two independent accounts, target contention, movement, search, combat, energy, reload persistence, refuge upgrades, healing, mobile navigation, and logout. No browser JavaScript errors.

Not included: public deployment, PvP, chat, player trading, factions, territory ownership, or final setting/balance approval. Provisional choices are explicitly recorded in `docs/DESIGN.md`.

## Hosted browser access

- Added a Worker deployment target with durable D1 saves and ChatGPT identity.
- Hosted onboarding asks only for a survivor callsign; no separate game password.
- Added atomic compare-and-swap commits across simultaneous Worker requests.
- Verified hosted identity, account separation, CSRF/origin checks, contested targets, idempotent combat/rewards, persisted state, and parity with the local rule set.
- Private publication is managed through `.openai/hosting.json`; the original Node target remains available for development.

## Milestone 2 — expanded city and classic browser-game presentation

- Original illustrated location tiles, olive and parchment panels, persistent sidebar, overview tables, refuge scene, and a dedicated two-sided encounter screen.
- 100 × 100 deterministic city with a 3 × 3 local viewport; central named blocks retained.
- Server-timed travel: 20 seconds cardinal, 28 diagonal; reload and offline completion supported.
- Finite shared search stock, one replenishment per 30 minutes up to capacity, plus the personal search cooldown.
- Automatic hosted and local save migrations preserve existing survivor progress.
- One shared gameplay engine across Node/SQLite and Worker/D1.
- Validation: 13 Node tests, built-Worker concurrency and migration checks, and a two-account Chromium smoke at desktop and mobile widths. Includes concurrent final-stock consumption, delayed arrival, reload persistence, combat initiation-only energy, and shared enemy ownership.
