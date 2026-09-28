# Design record

## Confirmed by the project owner

- Draw themes, systems, and concrete rules from Torn, Travian, and Urban Dead. Do not assign each influence to a rigid, isolated layer.
- Persistent multiplayer is a requirement from the beginning, even when initially played by one person.
- Not every action consumes action points.
- Starting an attack consumes a configurable amount of energy. Subsequent actions in that encounter do not consume further energy.

## Provisional choices in milestone 1

These are implementation defaults that make the first slice playable, not decisions asserted on behalf of the owner.

| Area          | Current prototype choice                                                 |
| ------------- | ------------------------------------------------------------------------ |
| Setting       | Fictional abandoned city of Westbridge, with zombie NPC threats          |
| World         | One authored 5 × 5 district; four-direction adjacency                    |
| Movement      | Immediate travel between adjacent blocks, no energy cost                 |
| Combat        | Player-selected turns against NPCs; automatic enemy counterattack        |
| Costs         | 10 energy per initiated encounter; max 100; recover 1/minute             |
| Competition   | One active encounter per survivor and per shared enemy                   |
| Abandonment   | Encounter ends after 15 minutes without a combat action                  |
| Defeat        | Rescue to the refuge with 50 health, no item loss                        |
| Scavenging    | Global 30-second personal cooldown; deterministic location-based loot    |
| Refuge        | Personal workbench at a shared refuge, up to level 5                     |
| Economy       | Scrap production 1–5/minute, at most eight hours credited between checks |
| Progression   | +20 XP per kill; each 50 XP adds one strike damage                       |
| Communication | Presence and private action journal only; no player messaging yet        |

Movement, scavenging, healing, and management do not consume energy. Combat still involves tactical health/item costs. Reading the interface never advances combat.

## Scope of multiplayer support

Two authenticated players share the same map and enemies, see other occupants, and compete for targets. Their characters, inventories, workbench production, private journals, and sessions are independent. Progress and unfinished encounters survive restarts. The server clock controls regeneration, cooldowns, production, and enemy return.

Player-versus-player combat, trading, shared property ownership, factions, alliances, construction queues, territory control, and a simulated NPC economy are **not implemented**. The starter refuge is a personal progression feature, not territorial ownership. No offline PvP rule has been selected.

## Next design decisions

1. Confirm the setting and whether zombie survival is central or temporary test content.
2. Decide the intended combat depth, PvP consent/rules, and offline defence.
3. Define inventory/equipment, resource types, travel pacing, and economic sinks.
4. Choose the first shared social system: trade, factions, or territory.

Expand these rules only with the owner's direction; retain the confirmed energy and persistence requirements.
