# Translation Manifest

Tracks per-surface translation progress for each language.
Updated by the `/language` skill after each surface is completed.

## Status Legend

- `pending` — not yet translated
- `done` — translated and verified (check:i18n + typecheck + build pass)
- `shell` — completed during shell migration (Slices 1–11)

## Visual Review

Visual review runs as a single pass after all feature surfaces are `done` for a language.
Trigger: `/language [lang] review`

| Language | Status |
|----------|--------|
| es | in progress — review fixes applied, awaiting re-check |

## Shell UI (completed)

These surfaces were migrated during the initial shell rollout and are **done** for `es`.

| Surface | Files | es |
|---------|-------|----|
| Modal Window Chrome | `modalWindow.ts` | shell |
| Lazy Window States | `lazyWindow.ts` | shell |
| Panel Footer | `panel/panelFooter.ts` | shell |
| Panel Nav | `panel/panelNav.ts` | shell |
| Original Panel | `originalPanel.ts` | shell |
| Card Chrome | `hubWindow/cards/expandableCard.ts`, `launcherCard.ts` | shell |
| Hub: Garden Group | `hubWindow/groups/gardenGroup.ts` | shell |
| Hub: Tools Group | `hubWindow/groups/toolsGroup.ts` | shell |
| Hub: Items Group | `hubWindow/groups/itemsGroup.ts` | shell |
| Hub: Trackers Group | `hubWindow/groups/trackersGroup.ts` | shell |
| Hub: Config Group | `hubWindow/groups/configGroup.ts` | shell |
| Tile Registry + Grid | `panel/tileRegistry.ts`, `panel/tileGrid.ts` | shell |

## Feature Surfaces

Ordered by string count (smallest → largest). Each invocation of `/language` processes one row.

| # | Surface | Files | ~Strings | es |
|---|---------|-------|----------|----|
| 1 | Protection Section | `sections/protectionSection.ts` | ~4 | done |
| 2 | Changelog | `sections/changelog.ts` | ~5 | done |
| 3 | Auto Reconnect Section | `sections/autoReconnectSection.ts` | ~8 | done |
| 4 | ~~Shop History Window~~ | ~~`shopHistoryWindow.ts`~~ | — | deleted (dead code) |
| 5 | Inventory Capacity Section | `sections/inventoryCapacitySection.ts` | ~10 | done |
| 6 | Activity Log Section | `sections/activityLogSection.ts` | ~12 | done |
| 7 | Shop Keybinds Section | `sections/shopKeybindsSection.ts` | ~8 | done |
| 8 | Auto Favorite Section | `sections/autoFavoriteSection.ts` | ~15 | done |
| 9 | Favorites Section | `sections/favoritesSection.ts` | ~15 | done |
| 10 | Bulk Favorite Section | `sections/bulkFavoriteSection.ts` | ~15 | done |
| 11 | Garden Filters Section | `sections/gardenFiltersSection.ts` | ~15 | done |
| 12 | Storage Value Window | `storageValueWindow.ts` | ~16 | done |
| 13 | Turtle Timer Window | `turtleTimerWindow.ts` | ~16 | done |
| 14 | Mutation Value Section | `sections/mutationValueSection.ts` | ~10 | done |
| 15 | Controller Section | `sections/controllerSection.ts` | ~20 | done |
| 16 | Guide Section | `sections/guideSection.ts` | ~20 | done |
| 17 | Stats Header Section | `sections/statsHeaderSection.ts` | ~20 | done |
| 18 | Stats Overview Section | `sections/statsOverviewSection.ts` | ~15 | done |
| 19 | Stats Section | `sections/statsSection.ts` | ~10 | done |
| 20 | Dashboard Modules | `sections/dashboardModules.ts` | ~15 | done |
| 21 | Trackers Section | `sections/trackersSection.ts` | ~10 | done |
| 22 | Turtle Timer Section | `sections/turtleTimerSection.ts` | ~25 | done |
| 23 | Locker Section | `sections/lockerSection.ts`, `lockerCustomRules.ts`, `lockerPlantPicker.ts`, `lockerPrimitives.ts`, `lockerTabPanels.ts` | ~25 | done |
| 24 | Crop Boost Tracker | `cropBoostTrackerWindow.ts` | ~20 | done |
| 25 | Journal Checker | `journalCheckerSection.ts` | ~15 | done |
| 26 | Pet Hub Window | `petHubWindow.ts`, `petHutchWindow.ts` | ~15 | done |
| 27 | Shop Restock Window | `shopRestockWindow.ts`, `shopRestockWindowConstants.ts`, `shopRestockWindowFormatters.ts`, `shopRestockWindowMeta.ts`, `shopRestockWindowRows.ts` | ~30 | done |
| 28 | Item Restock Detail | `itemRestockDetailWindow.ts` | ~20 | done |
| 29 | Crop Calculator Window | `cropCalculatorWindow.ts` | ~40 | done |
| 30 | XP Tracker Window | `xpTrackerWindow.ts` | ~40 | done |
| 31 | Ability Tracker Window | `trackerWindow.ts` | ~35 | done |
| 32 | Texture Swapper Window | `textureSwapperWindow.ts` | ~25 | done |
| 33 | Stats Hub Window | `statsHubWindow/mainWindow.ts`, `gardenTab.ts`, `eggsTab.ts`, `economyTab.ts`, `tileHelpers.ts` | ~40 | done |
| 34 | Pets Window | `petsWindow/mainWindow.ts`, `managerTab.ts`, `teamEditor.ts`, `teamList.ts`, `teamSummary.ts`, `comparisonPanel.ts`, `helpers.ts` | ~50 | done |
| 35 | Pet Optimizer Window | `petOptimizerWindow/window.ts`, `card.ts`, `filters.ts`, `results.ts`, `sell.ts`, `actions.ts`, `summary.ts`, `statusSection.ts`, `familyGroups.ts`, `familyNav.ts` | ~50 | done |
| 36 | Public Rooms Window | `publicRoomsWindow/mainWindow.ts`, `roomsList.ts`, `gardenPane.ts`, `inspectorShell.ts`, `inspectorPanes.ts` | ~30 | done |
