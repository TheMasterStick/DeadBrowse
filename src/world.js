// Provisional setting and balance. Confirmed design constraints live in docs/DESIGN.md.
export const RULES = Object.freeze({
  maxEnergy: 100,
  attackEnergy: 10,
  energyInterval: 60_000,
  searchCooldown: 30_000,
  enemyRespawn: 60_000,
  encounterTimeout: 900_000,
  productionInterval: 60_000,
  maxOfflineProduction: 480,
});
const cells = [
  [
    "North checkpoint",
    "checkpoint",
    "The highway ends at a line of abandoned concrete barriers.",
  ],
  [
    "Ashwood apartments",
    "residential",
    "Curtains stir behind shattered windows.",
  ],
  [
    "St. Agnes hospital",
    "medical",
    "An emergency generator has long since fallen silent.",
  ],
  [
    "Signal tower",
    "utility",
    "A mast rises above the rooftops. Someone is still transmitting.",
  ],
  ["Rail depot", "industrial", "Freight cars sit open on the rusting sidings."],
  [
    "Mercer street",
    "residential",
    "A narrow street runs between shuttered shops.",
  ],
  [
    "Old pharmacy",
    "medical",
    "There may still be supplies behind the counter.",
  ],
  [
    "Market square",
    "market",
    "Faded awnings shelter the remains of a trading post.",
  ],
  [
    "Canal crossing",
    "checkpoint",
    "The bridge funnels all traffic through one exposed crossing.",
  ],
  [
    "Foundry works",
    "industrial",
    "Cold furnaces and machine parts fill this old factory.",
  ],
  ["West gardens", "park", "The city is slowly giving way to the trees."],
  ["Row houses", "residential", "A few doors have fresh barricades."],
  [
    "The refuge",
    "safehouse",
    "A fortified service station. Your room is upstairs; the gates stay watched.",
  ],
  [
    "Civic archives",
    "utility",
    "Old maps and water-stained records cover the floor.",
  ],
  ["East tenements", "residential", "Footsteps echo somewhere above you."],
  [
    "Freight terminal",
    "industrial",
    "Stacked containers form a maze of narrow corridors.",
  ],
  ["Riverside clinic", "medical", "A red cross is painted on the steel door."],
  ["South arcade", "market", "Shopfronts line a covered pedestrian walkway."],
  [
    "Water station",
    "utility",
    "The pumps are quiet, but the storage tanks remain intact.",
  ],
  [
    "East checkpoint",
    "checkpoint",
    "A watch post overlooks the road out of the district.",
  ],
  [
    "Railway cottages",
    "residential",
    "Small homes stand beneath the railway embankment.",
  ],
  [
    "Overgrown common",
    "park",
    "Tall grass conceals the paths through the common.",
  ],
  ["Bus interchange", "checkpoint", "Empty buses block the southern approach."],
  [
    "Scrap yard",
    "industrial",
    "A promising collection of salvage, if you can reach it.",
  ],
  [
    "Memorial park",
    "park",
    "The names on the stone have almost disappeared beneath the ivy.",
  ],
];
export const WORLD = cells.map(([name, type, description], id) => ({
  id,
  name,
  type,
  description,
  x: id % 5,
  y: Math.floor(id / 5),
}));
export const adjacent = (a, b) =>
  Math.abs(WORLD[a].x - WORLD[b].x) + Math.abs(WORLD[a].y - WORLD[b].y) === 1;
