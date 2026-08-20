export const TICK_HZ = 30;
export const SIM_STEP_MS = 1000 / TICK_HZ;

export const STARTING_CASH = 500;
export const STARTING_LIVES = 100;

// 23×12 = boardwalk perimeter (1) + two 10×10 dirt plots + boardwalk gap col.
// Boardwalk lives at rows 0/PLOT_ROWS-1, cols 0/PLOT_COLS-1, and col 11 (gap).
export const PLOT_COLS = 23;
export const PLOT_ROWS = 12;

export const SELL_REFUND_RATIO = 0.6;
export const PRESCRIPTED_ROUNDS = 20;

export const MAX_SIM_STEPS_PER_FRAME = 5;

export const CHILLED_DURATION_MS = 2000;
export const CHILLED_SPEED_MULTIPLIER = 0.5;

// Regen modifier: idle-time before HP starts ticking back, and rate (per spec §4.2).
export const REGEN_DELAY_MS = 2000;
export const REGEN_HP_PER_SEC = 1;

// Bump when balance changes ship. saves/store.ts initTdSaves() drops entries whose stored
// version differs from this — see docs/superpowers/specs/2026-08-13-tower-defense-rebalance-design.md §9.1.
// v6: T4 upgrades introduced (types.UpgradeTier widened to 0-4).
// v7: Storm Lantern + Fairy Forge added (new TowerId members; old saves may
// reference tiles now occupied differently — wipe is the safe migration).
// v8: Layer 7a endless HP curve rewrite — max(steppedFloor, 1.05^cycle) past
// R20 makes late-endless HP diverge from stored balloon snapshots.
// v9: Layer 8 windowed endless generator + speed ramp + pop-income tax —
// stored runs' balloon speeds/cash curves no longer match.
export const TD_BALANCE_VERSION = 9;

// Owl Perch shipped in Layer 3, so scripted [C] groups and endless camo rolls
// are now live. Flip back to false if a regression requires reverting Owl
// coverage — resolveScriptedModifiers() and endlessCamoEnabled() both consult
// this flag.
export const CAMO_IN_SCRIPTED_ROUNDS = true;
