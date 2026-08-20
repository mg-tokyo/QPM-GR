export type TowerId =
  | 'sproutSlinger'
  | 'witchsCauldron'
  | 'frostWizard'
  | 'marbleKnight'
  | 'strawScarecrow'
  | 'bananaGrove'
  | 'owlPerch'
  | 'gnomeAlchemist'
  | 'stormLantern'
  | 'fairyForge'
  | 'pineconeGrove';

export type BalloonId =
  | 'redWorm'
  | 'blueWorm'
  | 'greenWorm'
  | 'yellowBee'
  | 'rainbowWorm'
  | 'stoneTurtle'
  | 'bronzeCapybara'
  | 'goldMoab'
  | 'rainbowTurtle'
  | 'goldTurtle'
  | 'rainbowCapybara'
  | 'goldCapybara';

export type Phase = 'idle' | 'preRound' | 'inRound' | 'ended';
export type Speed = 1 | 2 | 3;
export type TargetPriority = 'first' | 'last' | 'close' | 'strong' | 'lastTrack';
export type UpgradePath = 'a' | 'b';
export type UpgradeTier = 0 | 1 | 2 | 3 | 4;
export type DamageType = 'standard' | 'explosive' | 'cold';
export type StatusEffect = 'chilled' | 'wilt' | 'frostbite' | 'burn' | 'sticky' | 'pulled' | 'static';
export type BalloonModifier = 'camo' | 'regen';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Tower {
  readonly id: string;
  readonly kind: TowerId;
  readonly tile: Point;
  readonly pixel: Point;
  fireCooldownMs: number;
  targetPriority: TargetPriority;
  upgradesA: UpgradeTier;
  upgradesB: UpgradeTier;
  totalSpent: number;
  shotCounter?: number;
  nextElementIdx?: number;
}

export interface StatusEffectState {
  readonly kind: StatusEffect;
  remainingMs: number;
  readonly speedMultiplier: number;
  dotPerSec?: number;
  dmgTakenBonus?: number;
  // Fraction of the victim's armorDR removed while this status is active (0-1).
  armorStrip?: number;
  // DoT tick multiplier applied when the victim is a BOSS_KINDS balloon.
  dotBossMult?: number;
}

export interface Balloon {
  readonly id: string;
  readonly kind: BalloonId;
  distance: number;
  hp: number;
  readonly maxHp: number;
  readonly baseSpeed: number;
  readonly armorDR: number;
  statuses: StatusEffectState[];
  readonly immunities: readonly DamageType[];
  readonly modifiers: readonly BalloonModifier[];
  // Rainbow elites: no status effect or boss stun ever attaches (spec §5.1).
  readonly statusImmune: boolean;
  msSinceDamage: number;
  stunRemainingMs?: number;
}

export interface Projectile {
  readonly id: string;
  readonly ownerId: string;
  readonly damageType: DamageType;
  readonly damage: number;
  position: Point;
  readonly velocity: Point;
  pierceRemaining: number;
  readonly initialPierce: number;
  readonly isPathDrop?: boolean;
  readonly hitBalloonIds: Set<string>;
  aliveMs: number;
  readonly maxLifetimeMs: number;
  readonly splashRadius: number;
  readonly appliesStatus?: StatusEffect;
  readonly ignoresArmor: boolean;
  readonly bossDamageBonus: number;
  readonly chilledDamageBonus: number;
  readonly armorBonusMult: number;
  readonly chillDurationBonus: number;
  readonly chillSpeedMultiplier: number;
  readonly chillDurationMs: number;
  readonly shattersFrozen?: boolean;
  readonly bossStunMs?: number;
  readonly pullOnImpactChance?: number;
  readonly pullRadius?: number;
  readonly pullDurationMs?: number;
  readonly statusDurationMs?: number;
  readonly statusDoTPerSec?: number;
  readonly statusDmgTakenBonus?: number;
  readonly statusSpeedMultiplier?: number;
  readonly statusArmorStrip?: number;
  readonly statusDotBossMult?: number;
  // Chain lightning: extra targets after the first impact, hop radius (tiles),
  // per-hop damage multiplier. Only resolved for splashRadius === 0.
  readonly chainCount?: number;
  readonly chainRange?: number;
  readonly chainDecay?: number;
}

export interface SpawnGroup {
  readonly kind: BalloonId;
  readonly count: number;
  readonly spacingMs: number;
  readonly startDelayMs: number;
  readonly modifiers?: readonly BalloonModifier[] | undefined;
}

export interface WaveDef {
  readonly round: number;
  readonly groups: readonly SpawnGroup[];
}

export interface PendingPlacement {
  readonly kind: TowerId;
  hoverTile: Point | null;
  isValid: boolean;
}

export interface MatchSnapshot {
  readonly phase: Phase;
  readonly trackId: string;
  readonly round: number;
  readonly isEndless: boolean;
  readonly cash: number;
  readonly lives: number;
  readonly speed: Speed;
  readonly paused: boolean;
  readonly autoStart: boolean;
  readonly towers: readonly Tower[];
  readonly balloons: readonly Balloon[];
  readonly projectiles: readonly Projectile[];
  readonly selectedTowerId: string | null;
  readonly pendingPlacement: PendingPlacement | null;
  readonly startedAt: number;
}
