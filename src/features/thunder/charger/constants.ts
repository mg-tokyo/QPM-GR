// Thundercharger ability constants (mirrors DawnCapture pattern).

/** Activity log action name written by the server when Thundercharger fires. */
export const THUNDERCHARGER_ACTION = 'thundercharge';

/** Base cooldown in ms (300 s), from beta faunaAbilitiesDex Thundercharger.baseParameters.cooldownSeconds. */
export const THUNDERCHARGER_COOLDOWN_MS = 300_000;

/** Ability ID that gets written into PetSlot.abilityCooldowns after first fire. */
export const THUNDERCHARGER_ABILITY_ID = 'Thundercharger';
