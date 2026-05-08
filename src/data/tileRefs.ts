export const tileRefsPlants: Record<string, number> = {
  DirtPatch: 1,
  SproutFlower: 2,
  SproutVegetable: 3,
  SproutFruit: 4,
  SproutVine: 5,
  StemFlower: 6,
  Trellis: 7,

  Daffodil: 11,
  Tulip: 12,
  Sunflower: 13,
  Lily: 14,
  Starweaver: 15,
  Chrysanthemum: 16,
  AloePlant: 17,
  Aloe: 18,

  Blueberry: 21,
  Banana: 22,
  Strawberry: 23,
  Mango: 24,
  Grape: 25,
  Watermelon: 26,
  Lemon: 27,
  Apple: 28,
  Pear: 29,
  Pineapple: 30,
  Pepper: 31,
  Tomato: 32,
  BabyCarrot: 33,
  Carrot: 34,
  Pumpkin: 35,
  Corn: 36,
  FavaBean: 37,
  Cacao: 38,
  CacaoBean: 38, // Alias for "Cacao Bean" (same as Cacao)

  PalmTreeTop: 39,
  BushyTree: 40,
  Coconut: 41,
  MushroomPlant: 42,
  PassionFruit: 43,
  DragonFruit: 44,
  Lychee: 45,
  Mushroom: 46,
  BurrosTail: 47,

  Echeveria: 49,
  Delphinium: 50,
  DawnCelestialCrop: 51,
  Dawnbinder: 51, // Alias for "Dawnbinder" (DawnCelestial)
  DawnCelestial: 51, // Explicit alias
  MoonCelestialCrop: 52,
  Moonbinder: 52, // Alias for "Moonbinder" (MoonCelestial)
  MoonCelestial: 52, // Explicit alias

  Camellia: 57,
  Hedge: 58,
  FlowerBush: 59,
  Squash: 60,

  // Dawn content (PR-2644)
  // Integer tile indices here are for the garden overlay (gardenData.ts) only.
  // Sprite rendering uses string keys (e.g. 'sprite/plant/Daisy') via sprite-v2.
  // These indices require runtime inspection of the game's internal tile map.
  Daisy: -1,              // TODO(dawn): confirm garden overlay tile index
  DaisyPurple: -1,        // TODO(dawn): confirm garden overlay tile index
  Lavender: -1,           // TODO(dawn): confirm garden overlay tile index
  Ube: -1,                // TODO(dawn): confirm garden overlay tile index
  BabyUbe: -1,            // TODO(dawn): confirm garden overlay tile index
  Dawnbreaker: -1,        // TODO(dawn): confirm garden overlay tile index
  BabyDawnbreaker: -1,    // TODO(dawn): confirm garden overlay tile index
};

export const tileRefsTallPlants: Record<string, number> = {
  Bamboo: 1,
  PalmTree: 2,

  DawnCelestialPlatform: 3,
  DawnCelestialPlant: 4,
  Dawnbinder: 4, // Alias for "Dawnbinder" tall plant
  DawnCelestialPlantActive: 5,
  DawnCelestialPlatformTopmostLayer: 6,

  Cactus: 7,
  Tree: 8,

  MoonCelestialPlatform: 9,
  MoonCelestialPlant: 10,
  Moonbinder: 10, // Alias for "Moonbinder" tall plant
  MoonCelestialPlantActive: 11,

  StarweaverPlatform: 13,
  StarweaverPlant: 14,

  CacaoTree: 15,
  CacaoBeanTree: 15, // Alias for "Cacao Bean" tall plant
};

export const tileRefsSeeds: Record<string, number> = {
  Daffodil: 1,
  Tulip: 2,
  Sunflower: 3,

  Starweaver: 6,
  DawnCelestial: 7,
  Dawnbinder: 7, // Alias for "Dawnbinder" seed
  MoonCelestial: 8,
  Moonbinder: 8, // Alias for "Moonbinder" seed

  Blueberry: 11,
  Banana: 12,
  Strawberry: 13,
  Mango: 14,
  Grape: 15,
  Watermelon: 16,
  Lemon: 17,
  Apple: 18,
  Pear: 19,
  Lily: 20,
  Pepper: 21,
  Tomato: 22,
  Carrot: 23,
  Pumpkin: 25,
  Corn: 26,
  Peach: 27,
  FavaBean: 28,
  Cacao: 29,
  CacaoBean: 29, // Alias for "Cacao Bean" seed
  Delphinium: 30,

  Coconut: 31,
  Mushroom: 32,
  PassionFruit: 33,
  DragonFruit: 34,
  Lychee: 35,
  BurrosTail: 37,

  Aloe: 39,
  Echeveria: 40,
  Bamboo: 41,
  Cactus: 42,

  Camellia: 48,
  Chrysanthemum: 49,
  Squash: 50,

  // Dawn content (PR-2644) — garden overlay indices, not sprite-v2 string keys
  Daisy: -1,              // TODO(dawn): confirm garden overlay tile index
  Lavender: -1,           // TODO(dawn): confirm garden overlay tile index
  Ube: -1,                // TODO(dawn): confirm garden overlay tile index
  Dawnbreaker: -1,        // TODO(dawn): confirm garden overlay tile index
};

export const tileRefsItems: Record<string, number> = {
  Coin: 1,
  Shovel: 2,
  PlanterPot: 6,
  InventoryBag: 7,

  WateringCan: 9,
  MoneyBag: 11,

  RainbowPotion: 14,
  GoldPotion: 15,
  WetPotion: 16,
  ChilledPotion: 17,
  FrozenPotion: 18,
  DawnlitPotion: 19,
  AmberlitPotion: 20,

  JournalStamp: 22,
  Donut: 23,
  ToolsRestocked: 24,
  SeedsRestocked: 25,
  EggsRestocked: 26,
  DecorRestocked: 27,
  Leaderboard: 28,
  Stats: 29,
  ActivityLog: 30,

  ChatBubble: 39,
  ArrowKeys: 41,
  Touchpad: 42,

  // Dawn content (PR-2644) — garden overlay indices, not sprite-v2 string keys
  DawnCapsule: -1,        // TODO(dawn): confirm garden overlay tile index
};

export const tileRefsPets: Record<string, number> = {
  Bee: 1,
  Chicken: 2,
  Bunny: 3,
  Turtle: 4,
  Capybara: 5,
  Cow: 6,
  Pig: 7,
  Butterfly: 8,
  Snail: 9,
  Worm: 10,
  CommonEgg: 11,
  UncommonEgg: 12,
  RareEgg: 13,
  LegendaryEgg: 14,
  MythicalEgg: 15,
  DivineEgg: 16,
  CelestialEgg: 17,
  Squirrel: 18,
  Goat: 19,
  Dragonfly: 20,
  Turkey: 29,
  Peacock: 30,

  // Dawn content (PR-2644) — garden overlay indices, not sprite-v2 string keys
  Sheep: -1,              // TODO(dawn): confirm garden overlay tile index
  Horse: -1,              // TODO(dawn): confirm garden overlay tile index
  Hedgehog: -1,           // TODO(dawn): confirm garden overlay tile index
  Pony: -1,               // TODO(dawn): confirm garden overlay tile index
  FireHorse: -1,          // TODO(dawn): confirm garden overlay tile index
  FireHorseActive: -1,    // TODO(dawn): confirm garden overlay tile index
  DawnEgg: -1,            // TODO(dawn): confirm garden overlay tile index
  HorseEgg: -1,           // TODO(dawn): confirm garden overlay tile index
};
