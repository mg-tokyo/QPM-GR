import type { DamageType, Point, StatusEffect, TowerId } from '../types';

export interface TowerStats {
  readonly range: number;
  readonly damage: number;
  readonly fireIntervalMs: number;
  readonly pierce: number;
  readonly projectileSpeed: number;
  readonly damageType: DamageType;
  readonly splashRadius: number;
  readonly appliesStatus?: StatusEffect;
  readonly incomePerRound: number;
  readonly ignoresArmor?: boolean;
  readonly bossDamageBonus?: number;
  readonly chilledDamageBonus?: number;
  readonly camoAuraDamageBonus?: number;
  readonly suppressCamoRegen?: boolean;
  readonly bombsPerShot?: number;
  readonly doubleFireChance?: number;
  // Multi-shot: engine fires this many Projectile records per fire event, fanned
  // symmetrically around the aim direction with `projectileSpreadRad` radians
  // between adjacent shots. 1 (or undefined) = classic single-shot.
  readonly projectilesPerShot?: number;
  readonly projectileSpreadRad?: number;
  readonly adjacencyDamageBonus?: number;
  readonly adjacencyRangeBonus?: number;
  readonly armorBonusMult?: number;
  readonly chillDurationBonus?: number;
  readonly chillOverride?: { readonly speedMultiplier: number; readonly durationMs: number };
  readonly selfDetectsCamo?: boolean;
  // T4 additions.
  readonly procEveryNthShot?: number;
  readonly procNukeDamage?: number;
  readonly procNukeSplash?: number;
  readonly procNukePierce?: number;
  readonly statusDurationMs?: number;
  readonly statusDoTPerSec?: number;
  readonly wiltDamageBonus?: number;
  readonly stickySpeedMultiplier?: number;
  readonly shattersFrozen?: boolean;
  readonly bossStunMs?: number;
  readonly rotatingElements?: readonly DamageType[];
  readonly pullOnImpactChance?: number;
  readonly pullRadius?: number;
  readonly pullDurationMs?: number;
  readonly adjacencyFireRateBonus?: number;
  readonly adjacencyDoubleShotChance?: number;
  readonly globalAura?: boolean;
  readonly globalAuraScale?: number;
  readonly cashOnWaveComplete?: number;
  readonly fireRateCapOverride?: number;
  readonly extraLeafCountBonus?: number;
  // Storm Lantern chain: extra targets, hop radius (tiles), per-hop multiplier.
  readonly chainCount?: number;
  readonly chainRange?: number;
  readonly chainDecay?: number;
  // Fairy Forge: while a balloon burns from this tower, its armorDR is reduced
  // by this fraction for ALL towers; DoT ticks on bosses are multiplied.
  readonly burnArmorStrip?: number;
  readonly burnBossMult?: number;
}

export interface UpgradeDef {
  readonly name: string;
  readonly cost: number;
  readonly description: string;
  readonly apply: (stats: TowerStats) => TowerStats;
}

export type SpriteRef =
  | { readonly kind: 'plant'; readonly key: string; readonly mutations?: readonly string[] }
  | { readonly kind: 'decor'; readonly key: string; readonly mutations?: readonly string[] };

export interface TowerDef {
  readonly id: TowerId;
  readonly displayName: string;
  readonly description: string;
  readonly baseCost: number;
  readonly baseStats: TowerStats;
  readonly pathA: readonly UpgradeDef[];
  readonly pathB: readonly UpgradeDef[];
  readonly baseSprite: SpriteRef;
  readonly renderScale?: number;
  // Tile-space offset from tower.pixel to where shots/effects emerge. Default
  // (see engine/tower.ts towerMuzzle) is { x: 0, y: -0.5 }.
  readonly muzzleOffset?: Point;
}

const DEFS: Record<TowerId, TowerDef> = {
  sproutSlinger: {
    id: 'sproutSlinger',
    displayName: 'Sprout Slinger',
    description: 'Cheap starter tower. Flings baby carrots at the first worm in range.',
    baseCost: 200,
    baseStats: {
      range: 3.0, damage: 1, fireIntervalMs: 700, pierce: 1,
      projectileSpeed: 9, damageType: 'standard', splashRadius: 0,
      incomePerRound: 0,
    },
    pathA: [
      { name: 'Twin Vines',      cost: 150,  description: 'Fires 2 shots, pierce 2',        apply: (s) => ({ ...s, pierce: 2, projectilesPerShot: 2, projectileSpreadRad: 0.24 }) },
      { name: 'Rainbow Volley',  cost: 500,  description: 'Pierce 4',                       apply: (s) => ({ ...s, pierce: 4 }) },
      { name: 'Pumpkin Slinger', cost: 1400, description: 'Pierce 8, damage +1, splash 0.5', apply: (s) => ({ ...s, pierce: 8, damage: s.damage + 1, splashRadius: 0.5 }) },
      { name: 'Rainbow Overlord', cost: 6000, description: '3 shots, pierce 15, dmg 4, splash 0.8. Every 5th volley spawns a mini-nuke (splash 2.0, dmg 15).', apply: (s) => ({ ...s, projectilesPerShot: 3, pierce: 15, damage: 4, splashRadius: 0.8, procEveryNthShot: 5, procNukeDamage: 15, procNukeSplash: 2.0 }) },
    ],
    pathB: [
      { name: 'Long Reach',       cost: 150,  description: 'Range +40%',                                apply: (s) => ({ ...s, range: s.range * 1.4 }) },
      { name: 'Sharp Sprouts',    cost: 500,  description: 'Damage 3, range +20%',                      apply: (s) => ({ ...s, damage: 3, range: s.range * 1.2 }) },
      { name: 'Sunflower Sniper', cost: 1400, description: 'Range +60%, damage 8, fire rate +20%',      apply: (s) => ({ ...s, range: s.range * 1.6, damage: 8, fireIntervalMs: s.fireIntervalMs * 0.8 }) },
      { name: 'Solar Ascendant', cost: 6000, description: 'Damage 24, range +40%, fire rate +40%. Every hit applies Wilt (3s, +25% dmg from all towers).', apply: (s) => ({ ...s, damage: 24, range: s.range * 1.4, fireIntervalMs: s.fireIntervalMs * 0.6, appliesStatus: 'wilt', statusDurationMs: 3000, wiltDamageBonus: 0.25 }) },
    ],
    baseSprite: { kind: 'plant', key: 'Carrot' },
  },

  witchsCauldron: {
    id: 'witchsCauldron',
    displayName: "Witch's Cauldron",
    description: 'Lobs pumpkin bombs that explode on impact. Great for clumped worms.',
    baseCost: 400,
    // Native Cauldron sprite bleeds ~1.5 tiles wide at T4 (TIER_SCALE_MULT
    // 1.30 stacks on top). 0.85 pulls it back inside its own tile so adjacent
    // placements stop overlapping.
    renderScale: 0.85,
    baseStats: {
      range: 3.2, damage: 2, fireIntervalMs: 1600, pierce: 1,
      projectileSpeed: 5, damageType: 'explosive', splashRadius: 1.5,
      incomePerRound: 0,
    },
    pathA: [
      { name: 'Bigger Bombs',    cost: 300,  description: 'Splash +40%',                    apply: (s) => ({ ...s, splashRadius: s.splashRadius * 1.4 }) },
      { name: 'Heavier Brew',    cost: 1000, description: 'Damage 5',                       apply: (s) => ({ ...s, damage: 5 }) },
      { name: 'Amber Fury',      cost: 2800, description: 'Splash 3.0, damage 7',           apply: (s) => ({ ...s, splashRadius: 3.0, damage: 7 }) },
      { name: 'Doomsday Brew',   cost: 12000, description: 'Splash 5.0, damage 20. Applies Sticky (50% slow, 2s). 25% chance to spawn a black-hole pull (0.5s).', apply: (s) => ({ ...s, splashRadius: 5.0, damage: 20, appliesStatus: 'sticky', statusDurationMs: 2000, stickySpeedMultiplier: 0.5, pullOnImpactChance: 0.25, pullRadius: 1.5, pullDurationMs: 500 }) },
    ],
    pathB: [
      { name: 'Fast Boil',       cost: 300,  description: 'Fire rate +30%',                 apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * 0.7 }) },
      { name: 'Extended Cauldron', cost: 1000, description: 'Range +40%, projectile speed +40%', apply: (s) => ({ ...s, range: s.range * 1.4, projectileSpeed: s.projectileSpeed * 1.4 }) },
      { name: 'Cauldron Sisters', cost: 2800, description: 'Fire rate +60%, 2 bombs/shot',  apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * 0.4, bombsPerShot: 2 }) },
      { name: "Witches' Coven",  cost: 12000, description: '4 bombs/shot, fire rate +50%, dmg 12. Bombs rotate elements (explosive→cold→standard→explosive).', apply: (s) => ({ ...s, bombsPerShot: 4, fireIntervalMs: s.fireIntervalMs * (1 / 1.5), damage: 12, rotatingElements: ['explosive', 'cold', 'standard', 'explosive'] }) },
    ],
    baseSprite: { kind: 'decor', key: 'sprite/decor/Cauldron' },
  },

  frostWizard: {
    id: 'frostWizard',
    displayName: 'Frost Wizard Tower',
    description: 'Hurls snowballs that chill enemies. Rainbow worms shrug it off.',
    baseCost: 325,
    baseStats: {
      range: 3.5, damage: 1, fireIntervalMs: 900, pierce: 2,
      projectileSpeed: 6, damageType: 'cold', splashRadius: 0,
      appliesStatus: 'chilled', incomePerRound: 0,
    },
    pathA: [
      { name: 'Faster Frost',    cost: 245,  description: 'Fire rate +30%',                 apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * 0.7 }) },
      { name: 'Blizzard',        cost: 815,  description: 'Splash 1.5, chill duration +50%', apply: (s) => ({ ...s, splashRadius: 1.5, chillDurationBonus: (s.chillDurationBonus ?? 0) + 0.5 }) },
      { name: 'Absolute Zero',   cost: 2275, description: 'Freezes balloons (0 speed 1s), damage 3, splash 2.0', apply: (s) => ({ ...s, damage: 3, splashRadius: 2.0, chillOverride: { speedMultiplier: 0, durationMs: 1000 } }) },
      { name: 'Eternal Winter',  cost: 9750, description: 'Freeze 2s, damage 10, splash 3.0. Frozen non-bosses shatter on next hit (2× dmg). Chill also deals 5 dmg/s (Frostbite).', apply: (s) => ({ ...s, damage: 10, splashRadius: 3.0, chillOverride: { speedMultiplier: 0, durationMs: 2000 }, shattersFrozen: true, statusDoTPerSec: 5 }) },
    ],
    pathB: [
      { name: 'Ice Shards',      cost: 245,  description: 'Pierce 4',                       apply: (s) => ({ ...s, pierce: 4 }) },
      { name: 'Deep Freeze',     cost: 815,  description: 'Damage 3, chill duration +100%',  apply: (s) => ({ ...s, damage: 3, chillDurationBonus: (s.chillDurationBonus ?? 0) + 1.0 }) },
      { name: 'Glacial Lance',   cost: 2275, description: 'Damage 6, pierce 6, range +40%, 2× dmg vs chilled', apply: (s) => ({ ...s, damage: 6, pierce: 6, range: s.range * 1.4, chilledDamageBonus: 1.0 }) },
      { name: 'Frozen Heart',    cost: 9750, description: 'Damage 20, pierce 12, range +60%, 3× dmg vs chilled.', apply: (s) => ({ ...s, damage: 20, pierce: 12, range: s.range * 1.4, chilledDamageBonus: 2.0 }) },
    ],
    baseSprite: { kind: 'decor', key: 'sprite/decor/MiniWizardTower' },
  },

  marbleKnight: {
    id: 'marbleKnight',
    displayName: 'Marble Knight',
    description: 'Short-range cactus thrower with high pierce. Punishes tight lines.',
    baseCost: 250,
    // MarbleKnight sprite is tall — 0.9 keeps the silhouette readable while
    // reducing vertical bleed into the tile in front.
    renderScale: 0.9,
    baseStats: {
      range: 2.5, damage: 1, fireIntervalMs: 500, pierce: 3,
      projectileSpeed: 12, damageType: 'standard', splashRadius: 0,
      incomePerRound: 0,
    },
    pathA: [
      { name: 'Twin Thorns',     cost: 190,  description: 'Fires 2 shots, pierce 5',        apply: (s) => ({ ...s, pierce: 5, projectilesPerShot: 2, projectileSpreadRad: 0.24 }) },
      { name: 'Storm of Thorns', cost: 625,  description: 'Pierce 7, damage 2',             apply: (s) => ({ ...s, pierce: 7, damage: 2 }) },
      { name: 'Cactus Rain',     cost: 1750, description: 'Pierce 12, damage 2, splash 0.5', apply: (s) => ({ ...s, pierce: 12, damage: 2, splashRadius: 0.5 }) },
      { name: 'Verdant Colossus', cost: 7500, description: '4 shots, pierce 20, dmg 6, splash 1.0. Every 3rd volley → mega-thorn (dmg 40, pierce ∞).', apply: (s) => ({ ...s, projectilesPerShot: 4, pierce: 20, damage: 6, splashRadius: 1.0, procEveryNthShot: 3, procNukeDamage: 40, procNukePierce: 999 }) },
    ],
    pathB: [
      { name: 'Heavy Thorns',    cost: 190,  description: 'Damage 2',                       apply: (s) => ({ ...s, damage: 2 }) },
      { name: 'Armor Pierce',    cost: 625,  description: 'Damage 5, pierce 5, +50% dmg vs armor', apply: (s) => ({ ...s, damage: 5, pierce: 5, armorBonusMult: 0.5 }) },
      { name: 'Marble Charge',   cost: 1750, description: 'Damage 11, projectile speed +100%, ignores armor', apply: (s) => ({ ...s, damage: 11, projectileSpeed: s.projectileSpeed * 2, ignoresArmor: true, armorBonusMult: 0 }) },
      { name: 'Adamant Lance',   cost: 7500, description: 'Damage 40, proj speed +150%, ignores armor, +100% dmg vs bosses, pierce 3.', apply: (s) => ({ ...s, damage: 40, projectileSpeed: s.projectileSpeed * 2.5, ignoresArmor: true, bossDamageBonus: 1.0, pierce: 3 }) },
    ],
    baseSprite: { kind: 'decor', key: 'sprite/decor/MarbleKnight' },
  },

  strawScarecrow: {
    id: 'strawScarecrow',
    displayName: 'Straw Scarecrow',
    description: 'Global-range sniper. Slow fire rate but hits anywhere on the map instantly.',
    baseCost: 550,
    baseStats: {
      range: 999, damage: 4, fireIntervalMs: 2500, pierce: 1,
      projectileSpeed: 40, damageType: 'standard', splashRadius: 0,
      incomePerRound: 0,
    },
    pathA: [
      { name: 'Hollow-Point',    cost: 415,  description: 'Damage 8',                       apply: (s) => ({ ...s, damage: 8 }) },
      { name: 'Marksman',        cost: 1375, description: 'Damage 14, fire rate +20%, projectile speed +50%', apply: (s) => ({ ...s, damage: 14, fireIntervalMs: s.fireIntervalMs * 0.8, projectileSpeed: s.projectileSpeed * 1.5 }) },
      { name: 'Boss Buster',     cost: 3850, description: 'Damage 34, splash 1.0, +50% dmg vs bosses', apply: (s) => ({ ...s, damage: 34, splashRadius: 1.0, bossDamageBonus: 0.5 }) },
      { name: 'Doomshot',        cost: 16500, description: 'Damage 120, splash 2.0, +150% dmg vs bosses, +50% dmg vs armored. Stuns bosses 0.5s.', apply: (s) => ({ ...s, damage: 120, splashRadius: 2.0, bossDamageBonus: 1.5, armorBonusMult: 0.5, bossStunMs: 500 }) },
    ],
    pathB: [
      { name: 'Quick Reload',    cost: 415,  description: 'Fire rate +40%',                 apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * 0.6 }) },
      { name: 'Semi-Auto',       cost: 1375, description: 'Fire rate +50%, pierce 2, damage 6', apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * 0.5, pierce: 2, damage: 6 }) },
      { name: 'Full-Auto',       cost: 3850, description: 'Fire rate +50%, pierce 3, damage 7, 20% double-fire proc', apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * 0.5, pierce: 3, damage: 7, doubleFireChance: 0.2 }) },
      { name: 'Storm Barrage',   cost: 16500, description: 'Fire rate +80%, pierce 5, dmg 20, 40% double-fire. Every 10th shot fires a mega-shot (dmg 50, splash 1.5, pierce 10).', apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * (1 / 1.8), pierce: 5, damage: 20, doubleFireChance: 0.4, procEveryNthShot: 10, procNukeDamage: 50, procNukeSplash: 1.5, procNukePierce: 10 }) },
    ],
    baseSprite: { kind: 'decor', key: 'sprite/decor/StrawScarecrow' },
  },

  bananaGrove: {
    id: 'bananaGrove',
    displayName: 'Banana Grove',
    description: 'Farms cash between rounds. Does no damage — grows more bananas as you upgrade.',
    baseCost: 650,
    renderScale: 1.4,
    baseStats: {
      range: 0, damage: 0, fireIntervalMs: Number.POSITIVE_INFINITY, pierce: 0,
      projectileSpeed: 0, damageType: 'standard', splashRadius: 0,
      incomePerRound: 60,
    },
    pathA: [
      { name: 'Fertile Soil',    cost: 485,  description: '+$40/round ($100 total)',       apply: (s) => ({ ...s, incomePerRound: 100 }) },
      { name: 'Rainbow Grove',   cost: 1625, description: '+$100/round ($200 total)',      apply: (s) => ({ ...s, incomePerRound: 200 }) },
      { name: 'Golden Grove',    cost: 4550, description: '+$300/round ($500 total)',      apply: (s) => ({ ...s, incomePerRound: 500 }) },
      { name: 'Diamond Grove',   cost: 19500, description: '+$1500/round. +$50 bonus per wave completed.', apply: (s) => ({ ...s, incomePerRound: 1500, cashOnWaveComplete: 50, extraLeafCountBonus: 2 }) },
    ],
    pathB: [
      { name: 'Grove Bounty',    cost: 485,  description: '+$30/round ($90 total)',        apply: (s) => ({ ...s, incomePerRound: 90 }) },
      { name: 'Grove Aura',      cost: 1625, description: '+$60/round ($150 total), adjacent towers +5% damage', apply: (s) => ({ ...s, incomePerRound: 150, adjacencyDamageBonus: 0.05 }) },
      { name: 'Grove Sanctuary', cost: 4550, description: '+$120/round ($270 total), adjacent towers +15% dmg, +10% range', apply: (s) => ({ ...s, incomePerRound: 270, adjacencyDamageBonus: 0.15, adjacencyRangeBonus: 0.10 }) },
      { name: 'Grove Godhead',   cost: 19500, description: '+$500/round. Adjacent towers +40% dmg, +25% range, +20% fire rate.', apply: (s) => ({ ...s, incomePerRound: 500, adjacencyDamageBonus: 0.40, adjacencyRangeBonus: 0.25, adjacencyFireRateBonus: 0.20 }) },
    ],
    baseSprite: { kind: 'plant', key: 'Banana' },
  },

  owlPerch: {
    id: 'owlPerch',
    displayName: 'Owl Perch',
    description: 'Reveals camo balloons within its range. Light single-target damage.',
    baseCost: 500,
    baseStats: {
      range: 3.5, damage: 1, fireIntervalMs: 1200, pierce: 1,
      projectileSpeed: 10, damageType: 'standard', splashRadius: 0,
      incomePerRound: 0,
    },
    pathA: [
      { name: 'Sharp Eyes',   cost: 375,  description: 'Detection radius +50%',                                    apply: (s) => ({ ...s, range: s.range * 1.5 }) },
      { name: 'Owl Cry',      cost: 1250, description: 'Camo balloons in aura take +50% dmg from all towers',      apply: (s) => ({ ...s, camoAuraDamageBonus: 0.5 }) },
      // Night Hunter sets an ABSOLUTE detection radius (spec §6.2.5), so it
      // overrides any Sharp Eyes multiplier applied earlier in the fold.
      { name: 'Night Hunter', cost: 3500, description: 'Detection 8.0, camo take +100% dmg, camo in aura cannot regen', apply: (s) => ({ ...s, range: 8.0, camoAuraDamageBonus: 1.0, suppressCamoRegen: true }) },
      { name: 'Moonlit Terror', cost: 15000, description: 'Detection 12.0, camo take +200% dmg from all towers, camo cannot regen.', apply: (s) => ({ ...s, range: 12.0, camoAuraDamageBonus: 2.0, suppressCamoRegen: true }) },
    ],
    pathB: [
      { name: 'Quicker Talons', cost: 375,  description: 'Fire rate +40%',                                            apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * 0.6 }) },
      { name: 'Barn Owl',       cost: 1250, description: 'Damage 3, pierce 3',                                        apply: (s) => ({ ...s, damage: 3, pierce: 3 }) },
      { name: 'Eagle Talons',   cost: 3500, description: 'Damage 6, fire rate +50%, pierce 4, self-detects camo',    apply: (s) => ({ ...s, damage: 6, fireIntervalMs: s.fireIntervalMs * 0.5, pierce: 4, selfDetectsCamo: true }) },
      { name: 'Phoenix Owl',    cost: 15000, description: 'Damage 20, fire rate +80%, pierce 8, self-detects camo. Applies Burn (5 dmg/s, 3s).', apply: (s) => ({ ...s, damage: 20, fireIntervalMs: s.fireIntervalMs * (1 / 1.8), pierce: 8, selfDetectsCamo: true, appliesStatus: 'burn', statusDurationMs: 3000, statusDoTPerSec: 5 }) },
    ],
    baseSprite: { kind: 'decor', key: 'sprite/decor/WoodOwl' },
  },

  gnomeAlchemist: {
    id: 'gnomeAlchemist',
    displayName: 'Gnome Alchemist',
    description: 'No damage — passively buffs +10% fire rate and +5% range to towers within its 2.0-tile aura. Aura cap: +25% fire rate per target.',
    baseCost: 700,
    baseStats: {
      range: 2.0, damage: 0, fireIntervalMs: Number.POSITIVE_INFINITY, pierce: 0,
      projectileSpeed: 0, damageType: 'standard', splashRadius: 0,
      incomePerRound: 0,
    },
    pathA: [
      { name: 'Potent Brew',   cost: 525,  description: '+15% fire rate, +8% range to towers in aura',            apply: (s) => s },
      { name: 'Amber Elixir',  cost: 1750, description: '+20% fire rate, +12% range, +1 pierce',                  apply: (s) => s },
      { name: 'Grand Alchemy', cost: 4900, description: '+25% fire rate (cap), +20% range, +2 pierce, +1 damage', apply: (s) => s },
      { name: 'Master Alchemist', cost: 21000, description: '+40% fire rate (cap raised), +30% range, +3 pierce, +3 dmg to towers in aura. Adjacent towers gain 10% double-shot.', apply: (s) => ({ ...s, fireRateCapOverride: 0.40, adjacencyDoubleShotChance: 0.10 }) },
    ],
    pathB: [
      { name: 'Louder Bell',   cost: 525,  description: 'Aura 3.0',                                                apply: (s) => ({ ...s, range: 3.0 }) },
      { name: 'Village Elder', cost: 1750, description: 'Aura 5.4, +3% additional fire rate to towers in aura (still respects +25% cap)', apply: (s) => ({ ...s, range: 5.4 }) },
      { name: 'Master Elder',  cost: 4900, description: 'Aura 7.5',                                                apply: (s) => ({ ...s, range: 7.5 }) },
      { name: 'Cosmic Sage',   cost: 21000, description: 'Aura covers the entire map at 60% strength.', apply: (s) => ({ ...s, range: 999, globalAura: true, globalAuraScale: 0.6 }) },
    ],
    baseSprite: { kind: 'decor', key: 'sprite/decor/StoneGnome' },
  },

  stormLantern: {
    id: 'stormLantern',
    displayName: 'Storm Lantern',
    description: 'Calls lightning that arcs from worm to worm. Metal armour conducts.',
    baseCost: 540,
    // WoodLampPost is 344px wide natively; 0.85 keeps it inside its tile.
    renderScale: 0.85,
    baseStats: {
      range: 3.0, damage: 3, fireIntervalMs: 1100, pierce: 1,
      projectileSpeed: 40, damageType: 'standard', splashRadius: 0,
      incomePerRound: 0,
      chainCount: 2, chainRange: 1.5, chainDecay: 0.7,
    },
    // Both paths set damage with Math.max so the fold order (A then B) never
    // lets a low-tier B purchase undo a higher A damage value.
    pathA: [
      { name: 'Forked Bolt',  cost: 410,   description: 'Chains to 4 targets, weaker decay',                                  apply: (s) => ({ ...s, chainCount: 4, chainDecay: 0.8 }) },
      { name: 'Thunderclap',  cost: 1350,  description: 'Damage 6, fire rate +22%, chains to 6 targets within 2.0 tiles',      apply: (s) => ({ ...s, damage: Math.max(s.damage, 6), fireIntervalMs: s.fireIntervalMs * 0.82, chainCount: 6, chainRange: 2.0, chainDecay: 0.85 }) },
      { name: 'Tempest',      cost: 3780,  description: 'Fire rate +12%, chains to 10 targets, no decay',                      apply: (s) => ({ ...s, fireIntervalMs: s.fireIntervalMs * 0.89, chainCount: 10, chainDecay: 1 }) },
      { name: 'Sky Sunder',   cost: 16200, description: 'Damage 14, fire rate +14%, chains to 20 within 2.5. Every 4th bolt is a Thunderstrike (splash 2.0, dmg 40).', apply: (s) => ({ ...s, damage: Math.max(s.damage, 14), fireIntervalMs: s.fireIntervalMs * 0.875, chainCount: 20, chainRange: 2.5, procEveryNthShot: 4, procNukeDamage: 40, procNukeSplash: 2.0 }) },
    ],
    pathB: [
      { name: 'Capacitor',      cost: 410,   description: 'Damage 5, fire rate +10%',                                                       apply: (s) => ({ ...s, damage: Math.max(s.damage, 5), fireIntervalMs: s.fireIntervalMs * 0.91 }) },
      { name: 'Ion Lance',      cost: 1350,  description: 'Damage 12, fire rate +11%, +50% dmg vs armored',                                 apply: (s) => ({ ...s, damage: Math.max(s.damage, 12), fireIntervalMs: s.fireIntervalMs * 0.9, armorBonusMult: 0.5 }) },
      { name: 'Superconductor', cost: 3780,  description: 'Damage 24, fire rate +28%, +100% dmg vs armored',                                apply: (s) => ({ ...s, damage: Math.max(s.damage, 24), fireIntervalMs: s.fireIntervalMs * 0.78, armorBonusMult: 1.0 }) },
      { name: 'Godbolt',        cost: 16200, description: 'Damage 70, fire rate +16%, +100% vs armored, +75% vs bosses. Applies Static (+20% dmg taken, 2s).', apply: (s) => ({ ...s, damage: Math.max(s.damage, 70), fireIntervalMs: s.fireIntervalMs * 0.86, armorBonusMult: 1.0, bossDamageBonus: 0.75, appliesStatus: 'static', statusDurationMs: 2000, wiltDamageBonus: 0.2 }) },
    ],
    baseSprite: { kind: 'decor', key: 'sprite/decor/WoodLampPost' },
  },

  fairyForge: {
    id: 'fairyForge',
    displayName: 'Fairy Forge',
    description: 'Sets worms ablaze. Burning worms cannot regenerate — Smithing melts their armour.',
    baseCost: 420,
    renderScale: 0.9,
    // Fire from the sprite centre; default { x: 0, y: -0.5 } would fire from the top edge.
    muzzleOffset: { x: 0, y: 0 },
    baseStats: {
      range: 2.4, damage: 1, fireIntervalMs: 400, pierce: 2,
      projectileSpeed: 9, damageType: 'standard', splashRadius: 0,
      incomePerRound: 0,
      appliesStatus: 'burn', statusDurationMs: 2000, statusDoTPerSec: 2,
    },
    // Path A from T2 is the "flame lick": splash cone (no pierce), instant
    // projectile (speed 40) so the visual can be a persistent flame effect.
    pathA: [
      { name: 'Bellows',        cost: 318,   description: 'Burn 3/s for 3s, range +15%',                                          apply: (s) => ({ ...s, statusDoTPerSec: 3, statusDurationMs: 3000, range: s.range * 1.15 }) },
      { name: 'Cinder Cloud',   cost: 1050,  description: 'Flame lick: splash 0.8, damage 2, burn 4/s',                            apply: (s) => ({ ...s, splashRadius: 0.8, damage: Math.max(s.damage, 2), statusDoTPerSec: 4, projectileSpeed: 40 }) },
      { name: 'Wildfire',       cost: 2940,  description: 'Splash 1.3, damage 4, fire rate +14%, burn 6/s for 4s',                 apply: (s) => ({ ...s, splashRadius: 1.3, damage: Math.max(s.damage, 4), fireIntervalMs: s.fireIntervalMs * 0.875, statusDoTPerSec: 6, statusDurationMs: 4000 }) },
      { name: 'Solar Crucible', cost: 12600, description: 'Splash 2.2, damage 10, fire rate +17%, burn 14/s. Burning worms take +25% dmg from all towers.', apply: (s) => ({ ...s, splashRadius: 2.2, damage: Math.max(s.damage, 10), fireIntervalMs: s.fireIntervalMs * 0.857, statusDoTPerSec: 14, wiltDamageBonus: 0.25 }) },
    ],
    pathB: [
      { name: 'Tempered',    cost: 318,   description: 'Damage 2, range +25%',                                                                 apply: (s) => ({ ...s, damage: Math.max(s.damage, 2), range: s.range * 1.25 }) },
      { name: 'Molten Slag', cost: 1050,  description: 'Damage 3, pierce 3. Burning worms lose half their armour (for all towers).',           apply: (s) => ({ ...s, damage: Math.max(s.damage, 3), pierce: Math.max(s.pierce, 3), burnArmorStrip: 0.5 }) },
      { name: 'White-Hot',   cost: 2940,  description: 'Damage 7, pierce 4, fire rate +14%, burn 5/s. Burning worms lose all armour.',        apply: (s) => ({ ...s, damage: Math.max(s.damage, 7), pierce: Math.max(s.pierce, 4), fireIntervalMs: s.fireIntervalMs * 0.875, statusDoTPerSec: Math.max(s.statusDoTPerSec ?? 0, 5), burnArmorStrip: 1 }) },
      { name: 'Star-Forge',  cost: 12600, description: 'Damage 18, pierce 6, fire rate +17%, burn 10/s, burn ticks ×2 on bosses.',            apply: (s) => ({ ...s, damage: Math.max(s.damage, 18), pierce: Math.max(s.pierce, 6), fireIntervalMs: s.fireIntervalMs * 0.857, statusDoTPerSec: Math.max(s.statusDoTPerSec ?? 0, 10), burnArmorStrip: 1, burnBossMult: 2 }) },
    ],
    baseSprite: { kind: 'decor', key: 'sprite/decor/MiniFairyForge' },
  },
};

export function getTowerDef(id: TowerId): TowerDef {
  return DEFS[id];
}

export const ALL_TOWER_IDS: readonly TowerId[] = Object.keys(DEFS) as readonly TowerId[];
