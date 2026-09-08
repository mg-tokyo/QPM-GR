import { initPixiHooks } from './sprite-v2/index';
import { bootstrap } from './main/init';
import { claimQpmInstance } from './core/instanceGuard';
import { getCurrentVersion } from './utils/versionChecker';
import { shareGlobal } from './core/pageContext';

// Install PIXI capture hooks at document-start, before the game's __PIXI_APP_INIT__.
// Was a module-scope side effect in sprite-v2/index.ts; now an explicit call so
// the lifecycle is auditable.

const claim = claimQpmInstance(getCurrentVersion());
if (!claim.first) {
  // Duplicate install (ALPHA+private, or two copies of the same script) doubles
  // every per-frame cost and stacks send wrappers the sequencer refuses (spec F6).
  // Signal the first instance so its copy report carries `dup:X` in the Env line.
  console.warn(
    `[QPM] another QPM instance (${claim.existing.version}) already owns this page — ` +
    `this copy (${getCurrentVersion()}) will not start. Remove one of the two installs.`,
  );
  try {
    shareGlobal('__QPM_DUPLICATE__', { version: getCurrentVersion(), at: Date.now() });
  } catch { /* signal is best-effort */ }
} else {
  initPixiHooks();

  bootstrap().catch(error => {
    console.error('[QuinoaPetMgr] Initialization failed:', error);
  });
}
