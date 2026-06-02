# QPM-GR Architecture Reference

This is reference material — read when investigating specific systems, not loaded every session.

## Repo map

```
src/
├── main.ts                      # Userscript entry point
├── websocket/api.ts             # sendRoomAction(type, payload, opts)
├── core/
│   ├── atomRegistry.ts          # Typed atom reads (shop/weather)
│   ├── jotaiBridge.ts           # getAtomByLabel, subscribeAtom
│   ├── notifications.ts         # notify({ feature, level, message })
│   └── pageContext.ts           # shareGlobal, dispatchCustomEventAll
├── catalogs/
│   ├── catalogLoader.ts         # Object.* hook for runtime capture
│   ├── gameCatalogs.ts          # Typed access: getPetCatalog, getPlantSpecies
│   ├── types.ts                 # Catalog type definitions
│   └── logic/                   # abilityColors, bundleParser, weatherCatalog
├── sprite-v2/                   # PIXI sprite system (init, compat, atlas, cache, renderer, ktx2/)
├── features/                    # Domain-grouped feature modules (pets/, garden/, economy/, shop/, mutations/, etc.)
├── store/                       # Reactive state: stats, inventory, pets, petTeams, abilityLogs, shopStock, weatherHub, etc.
├── ui/                          # Domain-grouped windows/panels (core/, hub/, pets/, shop/, garden/, economy/, locker/, stats/, standalone/)
├── data/                        # Shared game constants (gameInfo, weatherEvents)
├── services/                    # Aries API clients
├── integrations/                # ariesBridge.ts (QPM_ARIES_BRIDGE global)
├── utils/                       # Grouped helpers: scheduling/, dom/, game/, restock/, rendering/ + root (storage, logger, formatters)
├── debug/                       # debugApi.ts, inspectJournal.ts
└── types/                       # gameAtoms.ts, shops.ts, publicRooms.ts, petTeams.ts
```

## Initialization sequence (src/main.ts)

| Phase | Steps |
|-------|-------|
| **0 – Immediate** | `initCatalogLoader()`, `initializeAutoReconnect()`, `initSpriteSystem()` (async) |
| **Wait** | `waitForGame()` — polls for game HUD |
| **Pre-stores** | `initializeAntiAfk()`, `startInventoryStore()`, `startPetInfoStore()`, `startAbilityTriggerStore()` |
| **Phase 1** | `initializeStatsStore()`, `initializePetXpTracker()` |
| **Phase 2** | `initializeXpTracker()`, `initializeMutationValueTracking()`, `initHatchStatsStore()`, `startPetHatchingTracker()` |
| **Phase 3** | `initializeAutoFavorite()`, `startBulkFavorite()`, `startSellSnapshotWatcher()` |
| **Phase 3b** | `initPetTeamsLogs()`, `initPetTeamsStore()` |
| **Phase 4** | `startGardenBridge()`, `initializeGardenFilters()` |
| **Phase 5–7** | Harvest reminder, turtle timer, mutation reminder/tracker |
| **Phase 8** | Crop boost tracker, tooltip injection (journal badges + tile value), native feed intercept, controller |
| **Phase 9** | `exposeAriesBridge()` |
| **Phase 10** | `initPublicRooms()` |
| **UI** | `createOriginalUI()`, `initPetsWindow()` |
| **Finish** | Version checker, tutorial, sprite warmup |

Each phase separated by `await yieldToBrowser()`.

## Key subsystem details

### WebSocket
- All sends via `sendRoomAction(type: RoomActionType, payload, opts)` in `src/websocket/api.ts`
- Returns `{ ok, reason? }` — bad payloads return `{ ok: false, reason: 'invalid_payload' }` silently
- 11 valid types: FeedPet, SwapPet, StorePet, RetrieveItemFromStorage, PutItemInStorage, PlacePet, ToggleFavoriteItem, ToggleLockItem, PickupPet, SellPet, PlayerPosition

### Atom labels
- `myPrimitivePetSlotsAtom` → active pets (ActivePetInfo[])
- `myPetHutchPetItemsAtom` → hutch storage
- `myPetInventoryAtom` → pet inventory
- `myInventoryAtom` → general inventory (has `.storages[]`)
- `myCropInventoryAtom` → crop inventory (separate)
- `weatherAtom`, `shopsAtom`, `myShopPurchasesAtom`

### ActivePetInfo fields
- `slotId` = item UUID (used as `petInventoryId` in SwapPet, `itemId` in StorePet/PlacePet/ToggleFavoriteItem)
- `petId` = entity UUID (used as `petItemId` in FeedPet, `petId` in PickupPet)
- Also: hungerPct, hungerValue, hungerMax, targetScale, mutations[], abilities[], xp, level, position

### Timers
- `visibleInterval(id, cb, ms)` — pauses when tab hidden (most features)
- `criticalInterval(id, cb, ms)` — runs always (anti-AFK, reconnect)
- Always `timerManager.destroy(id)` in cleanup

### UI system
- `toggleWindow(id, title, render)` / `registerLazyWindow(id, title, render)` from modalWindow/lazyWindow
- `invalidateWindow(id)` to force re-render on next open
- Theme: bg `rgba(18,20,26,0.96)`, accent `#8f82ff`, border `rgba(143,130,255,0.5)`, text `#e8e0ff`

### Performance rendering
- `domBatcher` — batch reads/writes
- `VirtualScroll` — 100+ item lists (call `.destroy()` in cleanup)
- `BatchRenderer` / `JobQueue` — frame-budget work
