// Runtime catalog capture system using Object.* method interception.
// Public entry — only this barrel may be imported from outside the subfolder.

export { getCosmeticOwnership, isCosmeticOwned, isCosmeticAvailable } from './ownership';
export { startCatalogsDiagnostics, stopCatalogsDiagnostics } from './diagnostics';
export { getCatalogs, areCatalogsReady, waitForCatalogs, onCatalogsReady, arePetAbilitiesCaptured, onPetAbilitiesCaptured, waitForPetAbilities } from './readyState';
export { ensurePetAbilitiesCatalog, mergePetAbilitiesIfIncomplete, mergeCatalogIfIncomplete, runDexCompletenessAudit } from './fallback';
export { getHookEnvironment } from './hooks';
export { initCatalogLoader, initCatalogHooksEarly, cleanupCatalogLoader } from './lifecycle';
export { forceWeatherCatalogRefresh, diagnoseCatalogs } from './debug';
