import { initPixiHooks } from './sprite-v2/index';
import { bootstrap } from './main/init';

// Install PIXI capture hooks at document-start, before the game's __PIXI_APP_INIT__.
// Was a module-scope side effect in sprite-v2/index.ts; now an explicit call so
// the lifecycle is auditable.
initPixiHooks();

bootstrap().catch(error => {
  console.error('[QuinoaPetMgr] Initialization failed:', error);
});
