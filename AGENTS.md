# Working on DeadBrowse

Read `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, and `PROGRESS.md` before making changes.

- Treat confirmed owner requirements separately from provisional implementation choices.
- Multiplayer persistence and server-authoritative state are foundational requirements.
- Charge energy once when initiating an attack, never per subsequent combat action.
- Never trust browser-supplied character identities, stats, rewards, clocks, or balances.
- Keep state mutations atomic, versioned, and safe against duplicate requests.
- Do not commit player databases, passwords, session tokens, or `.env` files.
- Keep documentation and progress accurate. Do not claim unimplemented systems.
- Run `npm run check` and `npm test` for gameplay/server changes. Use a real browser for UI changes when available.
- Future schema changes require migrations; never erase a player's world as an upgrade strategy.
