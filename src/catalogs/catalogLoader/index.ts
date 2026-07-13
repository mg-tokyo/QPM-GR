// Runtime catalog capture system using Object.* method interception.
// Public entry — only this barrel may be imported from outside the subfolder.

export { getCosmeticOwnership, isCosmeticOwned, isCosmeticAvailable } from './ownership';
export { startCatalogsDiagnostics, stopCatalogsDiagnostics } from './diagnostics';
export { getCatalogs, areCatalogsReady, waitForCatalogs, onCatalogsReady } from './readyState';
export { initCatalogLoader, cleanupCatalogLoader } from './lifecycle';
export { forceWeatherCatalogRefresh, diagnoseCatalogs } from './debug';
