// src/features/dawnCapsule/constants.ts
// Expected Dawn Capsule drop rates from beta toolsDex.

export const DAWN_CAPSULE_RATES: Record<string, number> = {
  Daisy: 0.40,
  Lavender: 0.30,
  Saffron: 0.20,
  Eggplant: 0.07,
  Ube: 0.025,
  Dawnbreaker: 0.005,
};

/** Activity log action for capsule opening (single or stacked). */
export const CAPSULE_OPEN_ACTION = 'openDawnCapsule';

/** Activity log action for DawnCapture ability activation. */
export const DAWN_CAPTURE_ACTION = 'dawnCapture';

/** Storage key for persisted capsule pull history. */
export const CAPSULE_PULLS_STORAGE_KEY = 'qpm.capsulePulls.v1';

/** Maximum number of pull records to persist. */
export const MAX_PULL_RECORDS = 500;
