/**
 * Activity-log action for opening a capsule, e.g. `openDawnCapsule` → tool id `DawnCapsule`.
 * The log entry carries no tool id; the action name is the only identifier.
 */
export const CAPSULE_OPEN_ACTION_RE = /^open([A-Z]\w*Capsule)$/;

/** Any `open<ToolId>` action whose tool has capsule drop weights also counts, whatever the naming. */
export const OPEN_ACTION_PREFIX_RE = /^open([A-Z]\w*)$/;

export const DAWN_CAPTURE_ACTION = 'dawnCapture';

export const CAPSULE_PULLS_STORAGE_KEY = 'qpm.capsulePulls.v1';

export const MAX_PULL_RECORDS = 500;

/** Species whose expected rate is below this are tracked as "pulls since last". */
export const RARE_PULL_RATE_THRESHOLD = 0.05;
