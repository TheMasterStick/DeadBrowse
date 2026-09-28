export const CITY_SIZE = 100;
export const HOME = 5050;
export const RULES = Object.freeze({
  maxEnergy: 100,
  attackEnergy: 10,
  energyInterval: 60000,
  searchCooldown: 30000,
  enemyRespawn: 60000,
  encounterTimeout: 900000,
  productionInterval: 60000,
  maxOfflineProduction: 480,
  travelDuration: 20000,
  diagonalTravelDuration: 28000,
  supplyRefillInterval: 1800000,
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

export const migrateLocation = (id) =>
  (Math.floor(id / 5) + 48) * 100 + (id % 5) + 48;
const oldBlocks = new Map(
  cells.map(([name, type, description], id) => [
    migrateLocation(id),
    { name, type, description },
  ]),
);
const kinds = [
  "residential",
  "residential",
  "medical",
  "industrial",
  "park",
  "market",
  "checkpoint",
  "utility",
  "apartments",
];
const streets = [
  "Ashwood",
  "Mercer",
  "Greyhaven",
  "Riverside",
  "Kingsway",
  "Briar",
  "Northgate",
  "Cedar",
  "Eastbank",
  "Stonebridge",
];
const nouns = {
  residential: "row houses",
  medical: "clinic",
  industrial: "works",
  park: "gardens",
  market: "market",
  checkpoint: "crossing",
  utility: "water station",
  apartments: "apartments",
};
const descriptions = {
  residential: "Boarded windows overlook an overgrown residential street.",
  medical: "A deserted clinic. Sealed medical supplies may remain inside.",
  industrial: "Rusting machinery and abandoned stores offer useful salvage.",
  park: "Trees grow through the old footpaths. Supplies are scarce here.",
  market: "Shuttered shops surround an abandoned trading square.",
  checkpoint:
    "Concrete barriers and guard booths funnel the road into a narrow passage.",
  utility: "Old pumps, pipes, and service buildings stand behind the fence.",
  apartments:
    "The upper floors are silent. There may be supplies in the empty flats.",
};
export const WORLD = Array.from({ length: CITY_SIZE * CITY_SIZE }, (_, id) => {
  const x = id % 100,
    y = Math.floor(id / 100),
    hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const type = kinds[hash % kinds.length],
    old = oldBlocks.get(id);
  return {
    id,
    x,
    y,
    name: `${streets[Math.floor(x / 10)]} ${nouns[type]}`,
    type,
    description: descriptions[type],
    district: `${streets[Math.floor(x / 10)]} ${Math.floor(y / 10) + 1}`,
    ...old,
  };
});
export function adjacent(a, b) {
  return (
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    WORLD[a] &&
    WORLD[b] &&
    a !== b &&
    Math.max(
      Math.abs(WORLD[a].x - WORLD[b].x),
      Math.abs(WORLD[a].y - WORLD[b].y),
    ) === 1
  );
}
export function localBlocks(id) {
  const { x, y } = WORLD[id],
    result = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (x + dx >= 0 && x + dx < 100 && y + dy >= 0 && y + dy < 100)
        result.push(WORLD[(y + dy) * 100 + x + dx]);
  return result;
}
export function travelTime(a, b) {
  return WORLD[a].x !== WORLD[b].x && WORLD[a].y !== WORLD[b].y
    ? RULES.diagonalTravelDuration
    : RULES.travelDuration;
}
export function capacity(id) {
  return {
    safehouse: 0,
    medical: 3,
    industrial: 6,
    residential: 4,
    apartments: 5,
    market: 5,
    checkpoint: 3,
    utility: 4,
    park: 2,
  }[WORLD[id].type];
}
