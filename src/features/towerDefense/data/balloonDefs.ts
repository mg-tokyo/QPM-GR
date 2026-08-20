import type { BalloonId, DamageType } from '../types';

export interface BalloonDef {
  readonly id: BalloonId;
  readonly displayName: string;
  readonly hp: number;
  readonly speed: number;
  readonly popReward: number;
  readonly armorDR?: number;
  readonly children: readonly BalloonId[];
  readonly immunities: readonly DamageType[];
  readonly spriteName: string;
  readonly mutationOverlay?: string;
  readonly tint?: string;
  // Rainbow elites (spec 2026-08-19 §5.1): applyStatus and boss-stun both no-op.
  readonly statusImmune?: boolean;
  // Render-only sprite scale; unset = 1.0. Capybara elites read bigger than base.
  readonly scale?: number;
}

const DEFS: Record<BalloonId, BalloonDef> = {
  redWorm:     { id: 'redWorm',     displayName: 'Red Worm',     hp: 1,  speed: 1.0, popReward: 1,   children: [],                                                            immunities: [],       spriteName: 'Worm',  tint: '#e64545' },
  blueWorm:    { id: 'blueWorm',    displayName: 'Blue Worm',    hp: 1,  speed: 1.4, popReward: 2,   children: ['redWorm'],                                                   immunities: [],       spriteName: 'Worm',  tint: '#4589ff' },
  greenWorm:   { id: 'greenWorm',   displayName: 'Green Worm',   hp: 2,  speed: 1.7, popReward: 3,   children: ['blueWorm', 'blueWorm'],                                      immunities: [],       spriteName: 'Worm',  tint: '#3fbf5f' },
  yellowBee:   { id: 'yellowBee',   displayName: 'Yellow Bee',   hp: 3,  speed: 3.0, popReward: 5,   children: ['greenWorm'],                                                 immunities: [],       spriteName: 'Bee' },
  rainbowWorm: { id: 'rainbowWorm', displayName: 'Rainbow Worm', hp: 5,  speed: 2.2, popReward: 12,  children: ['yellowBee', 'yellowBee', 'greenWorm'],                       immunities: ['cold'], spriteName: 'Worm',  mutationOverlay: 'Rainbow' },
  stoneTurtle:    { id: 'stoneTurtle',    displayName: 'Stone Turtle',    hp: 12,  speed: 0.8, popReward: 25,  armorDR: 0.5, children: ['greenWorm', 'greenWorm', 'greenWorm'],                immunities: [],       spriteName: 'Turtle',   tint: '#8a8a8a' },
  bronzeCapybara: { id: 'bronzeCapybara', displayName: 'Bronze Capybara', hp: 40,  speed: 1.1, popReward: 80,  armorDR: 0.5, children: ['stoneTurtle', 'stoneTurtle'],                         immunities: [],       spriteName: 'Capybara', tint: '#b87333' },
  goldMoab:       { id: 'goldMoab',       displayName: 'Gold MOAB',       hp: 150, speed: 0.7, popReward: 200, armorDR: 0.3, children: ['bronzeCapybara', 'bronzeCapybara', 'bronzeCapybara'], immunities: [],       spriteName: 'Snail',    mutationOverlay: 'Gold' },
  // Elite blimps — docs/superpowers/specs/2026-08-19-td-elite-blimps-design.md §4.
  // Rainbow = uncontrollable (cold + status + stun immune, faster); Gold = fortified (DR 0.7, slower, 2× pop).
  rainbowTurtle:   { id: 'rainbowTurtle',   displayName: 'Rainbow Turtle',   hp: 20,  speed: 1.3, popReward: 45,  armorDR: 0.3, children: ['rainbowWorm', 'rainbowWorm', 'rainbowWorm'],           immunities: ['cold'], spriteName: 'Turtle',   mutationOverlay: 'Rainbow', statusImmune: true },
  goldTurtle:      { id: 'goldTurtle',      displayName: 'Gold Turtle',      hp: 30,  speed: 0.7, popReward: 60,  armorDR: 0.7, children: ['stoneTurtle', 'stoneTurtle'],                         immunities: [],       spriteName: 'Turtle',   mutationOverlay: 'Gold' },
  rainbowCapybara: { id: 'rainbowCapybara', displayName: 'Rainbow Capybara', hp: 70,  speed: 1.5, popReward: 150, armorDR: 0.3, children: ['rainbowTurtle', 'rainbowTurtle'],                     immunities: ['cold'], spriteName: 'Capybara', mutationOverlay: 'Rainbow', statusImmune: true, scale: 1.15 },
  goldCapybara:    { id: 'goldCapybara',    displayName: 'Gold Capybara',    hp: 110, speed: 0.9, popReward: 220, armorDR: 0.7, children: ['goldTurtle', 'goldTurtle', 'bronzeCapybara'],         immunities: [],       spriteName: 'Capybara', mutationOverlay: 'Gold',    scale: 1.15 },
};

export function getBalloonDef(id: BalloonId): BalloonDef {
  return DEFS[id];
}

export const ALL_BALLOON_IDS: readonly BalloonId[] = Object.keys(DEFS) as readonly BalloonId[];

// Elite capybaras are boss-class (bossDamageBonus / bossStunMs / dotBossMult); elite turtles are not.
export const BOSS_KINDS: readonly BalloonId[] = ['bronzeCapybara', 'goldMoab', 'rainbowCapybara', 'goldCapybara'];
