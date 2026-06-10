# QPM Documentation Hub

> Consolidated reference for QPM-GR features, guides, and developer documentation.
> **v3.1.25 — ALPHA** | Credits: TOKYO.#6464

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Installation & Setup](#installation--setup)
3. [Key Features](#key-features)
4. [Feature Guides](#feature-guides)
5. [Developer Documentation](#developer-documentation)
6. [Version History](#version-history)

---

## Project Overview

**QPM-GR** (Quinoa Pet Manager — General Release) is a TypeScript userscript that enhances **Magic Garden** with analytics, automation helpers, tracking utilities, and UI improvements. The project is currently in **ALPHA** — expect frequent updates.

**Current Version:** 3.1.25

**Compatible URLs:**
- `https://magiccircle.gg/r/*`
- `https://magicgarden.gg/r/*`
- `https://starweaver.org/r/*`
- `https://1227719606223765687.discordsays.com/*`

### Focus Areas

- **Pet Management**: Teams, hutch browser, optimizer, comparison, feeding automation
- **Garden & Crops**: Mutation tracking, harvest reminders, crop boost tracker, filters
- **Shop & Economy**: Restock predictions, mutation value analytics, XP tracking
- **Automation**: Auto-favorite, bulk operations, controller/gamepad support, anti-AFK
- **Analytics**: Ability logs, activity log, weather tracking, hatch statistics

---

## Installation & Setup

### Requirements
- Tampermonkey or Violetmonkey browser extension

### Install
1. Open your userscript manager dashboard
2. Install `dist/QPM.user.js` (drag/drop or paste URL)
3. Reload Magic Garden — QPM initializes automatically
4. Verify the QPM panel appears (version shows **3.1.25**)

### First Launch
On first launch, a guided tour walks through the main features step by step. Each window also has a `?` replay button in its header to re-run the tour at any time.

---

## Key Features

### 🐾 Pet Hub & Analytics
View, compare, and manage active pets with real-time ability tracking.

### 🏠 Pet Hutch Browser
Browse hutch pets, swap them into active slots, retrieve from storage.

### 👥 Pet Teams
Named teams with one-click apply, keybind shortcuts, and Aries Mod preset import.

### 🔬 Pet Comparison Hub
Side-by-side stat comparison with ability effectiveness analysis.

### 🎮 Controller / Gamepad Automation
Gamepad and keyboard binding system for in-game navigation and actions.

### ⭐ Auto Favourite
Smart auto-favoriting for pets and crops based on configurable rules.

### 🧺 Bulk Favourite (Crop-Type Locking)
Instantly favorite all crops of a given type to prevent accidental selling.

### 📘 Journal Checker
Track journal completion progress with smart planting/hatching recommendations.

### 🌈 Ability Tracker
Real-time logging of pet ability triggers with proc rates and contribution stats.

### 🌿 Garden Filters
Filter the garden view by plant species and mutations.

### 🔔 Mutation Reminder
Notifications when valuable mutations are ready to harvest.

### 🐢 Turtle Timer
Track and display time until turtle (size) thresholds are met.

### 🌦️ Weather Mutation Tracking
Track which weather events have occurred and their associated mutations.

### 📈 Crop Boost Tracker
Monitor active crop boosts and their expiry times.

### 🌱 Crop Size Indicator
Hover overlay showing crop size and growth progress.

### 🛒 Shop Restock Tracker
Predicted restock times with appearance rate history.

### 📊 XP Tracker
Track experience gains over time per pet and session.

### 🔄 Auto-Reconnect
Automatically reconnects when disconnected from the game server.

### 🛡️ Anti-AFK
Prevents automatic AFK disconnects.

### 📋 Activity Log Enhancer
Enriches the native activity feed with additional context and statistics.

### 🌍 Public Rooms Inspector
Browse and inspect public game rooms.

### 🥚 Pet Hatching Tracker
Track pet hatch events and statistics by species.

### 💰 Sell All Pets
Batch-sell pets from the hutch based on configurable filters.

### 🧮 Mutation Value Analytics
Track and analyze the coin value of mutations across your crops.

---

## Feature Guides

### Pet Hub

Open via the **Pet Hub** button in the QPM panel. Contains tabs:

- **Overview** — Active pet cards with species, level, hunger, and abilities
- **Ability Tracker** — Real-time ability proc log with rates per pet
- **Compare** — Select two pets for side-by-side stat comparison
- **3v3 Compare** — Full 3-slot team comparison; imports presets from Aries Mod when available
- **Optimizer** — Suggests optimal team composition based on ability synergy

### Pet Hutch Window

Open via **Pet Hutch** button. Browse all hutch pets with search/filter. Click a hutch pet to swap it into an active slot (or select the target slot first).

### Pet Teams

Open via **Pets** button. Features:
- Create named teams (up to 3 pets per team)
- One-click **Apply** swaps current active pets to match the team
- **Keybind** shortcuts for each team (configurable)
- **Import from Aries** — reads Aries Mod preset data from localStorage
- Swap log shows recent team apply history

### Auto-Favourite

Configurable rules in the **Auto-Favourite** panel section:
- Favorite by rarity (Rainbow, Gold, etc.)
- Favorite by ability type
- Runs on inventory change events

### Bulk Favourite

In the **Bulk Favourite** section: select a crop type from the dropdown and click **Favourite All** to toggle-favorite every matching item in inventory.

### Garden Filters

In the **Garden Filters** section: enable/disable per-species and per-mutation filters. The garden view hides non-matching plants using PIXI label matching.

### Mutation Reminder

Configured in the **Mutation Reminder** section:
- Select which mutations trigger reminders (Rainbow, Gold, Frozen, etc.)
- Notifications appear as toasts when the mutation is detected on a ready-to-harvest crop

### Turtle Timer

In the **Turtle Timer** section:
- Shows time until each active pet's hunger drops to the configured threshold
- Configurable: include/exclude Boardwalk, min hunger %, fallback target scale, focus mode (latest/earliest)

### Shop Restock Tracker

Open via **Shop Restock** button:
- Predicted next restock time per item
- Average interval and appearance rate from historical data
- Data sourced from `restockDataService.ts`

### Journal Checker

In the **Journal** section:
- Visual progress: which crops and pets have been collected
- Smart Tip: recommends the next species to target
- Sprite icons for all 11 crop types and pet species

### Activity Log Enhancer

Enriches the native feed with:
- Feed/ability event timestamps
- Aggregated summaries visible via toggle
- Export entries: `QPM_ACTIVITY_LOG.export()`
- API: `QPM_ACTIVITY_LOG.list()`, `.clear()`, `.verify()`, `.status()`

### Controller / Gamepad

Open the **Controller** section in the **Utility Hub**:
- Bind gamepad buttons or keyboard keys to in-game actions
- Configurable profiles stored in storage (`qpm.controller.*`)
- `startController()` / `stopController()` called from `src/main.ts`

### Public Rooms Inspector

Open via **Public Rooms** button (debug globals required for full access):
- Browse active public game rooms
- Inspect individual player gardens
- Uses `QPM_INSPECT_PLAYER(playerId)` console helper

---

## Developer Documentation

### Repo Layout

```
src/
  main.ts            Entry point + initialization phases
  websocket/api.ts   WS send layer (sendRoomAction)
  core/              Jotai bridge, atom registry, page context
  catalogs/          Runtime catalog capture + typed access
  sprite-v2/         PIXI sprite hook + atlas extraction + KTX2 decoder
  features/          Feature modules (single-file; controller/ is subfolder exception)
  store/             Derived state modules
  ui/                All panel and window rendering
    sections/        Panel section builders
  data/              Static data tables
  services/          Aries API clients
  integrations/      Aries bridge
  utils/             Cross-cutting helpers
  debug/             Debug API
  types/             Shared TypeScript types
scripts/
  build-userscript.js    Wraps IIFE with Tampermonkey header
docs/product/
  DOCUMENTATION.md   This file
dist/
  QPM.user.js        Built userscript (tracked in git)
```

### Build Commands

```bash
npm run build                # Full build: sync-version + bundle + userscript (recommended)
npm run sync-version         # Sync version from CHANGELOG[0] to other files
npm run build:bundle         # Vite IIFE output only
npm run build:userscript     # Wrap bundle → dist/QPM.user.js
npm run dev                  # Watch mode
npm run typecheck            # (if available) Type-check without building
```

### Version Sync Procedure

Only update the changelog — bump `CHANGELOG[0]` version + notes in `src/ui/sections/statsHeaderSection.ts`.

`npm run build` automatically syncs the version to `package.json`, `src/utils/versionChecker.ts`, and `scripts/build-userscript.js` via `scripts/sync-version.js`. The build still validates all files match and fails on mismatch as a safety net.

### Storage Keys

- Prefix: `qpm.` (new keys) or `quinoa` (legacy keys)
- Wrapper: `src/utils/storage.ts` — use `storage.get()` / `storage.set()` everywhere
- Register new keys in the `QPM_STORAGE_KEYS` array

### WebSocket Sends

All WS sends go through `sendRoomAction()` in `src/websocket/api.ts`:

```ts
import { sendRoomAction } from '../websocket/api';

function sendMyAction(itemId: string) {
  return sendRoomAction('ToggleFavoriteItem', { itemId }, { throttleMs: 90 });
}
```

**Never** call `MagicCircle_RoomConnection.sendMessage()` directly. Never send at module scope.

### Confirmed WS Message Types

| Type | Key Fields |
|------|-----------|
| `ToggleLockItem` | `itemId` |
| `ToggleFavoriteItem` | `itemId` |
| `FeedPet` | `petItemId`, `cropItemId` |
| `StorePet` | `itemId` |
| `PickupPet` | `petId` |
| `PlacePet` | `itemId`, `position`, `tileType`, `localTileIndex` |
| `SellPet` | `itemId` |
| `PlayerPosition` | *(position fields)* |
| `RetrieveItemFromStorage` | `itemId`, `storageId` |
| `PutItemInStorage` | `itemId`, `storageId` |
| `SwapPet` | `petSlotId`, `petInventoryId` |

### Debug API

Run `QPM_BOOT.enableDebug()` from the browser console and reload to enable `QPM_DEBUG_API` on window.

Key methods:
```
QPM_DEBUG_API.debugPets()        — active pet info + raw data
QPM_DEBUG_API.feedAllPets(40)    — feed pets below 40% hunger
QPM_DEBUG_API.getCatalogs()      — raw captured game catalogs
QPM_DEBUG_API.diagnoseCatalogs() — catalog capture timing report
QPM_DEBUG_API.spriteProbe([...]) — test sprite lookup
QPM_DEBUG_API.activityLogList()  — activity log entries
```

Developer probe commands, when debug globals are enabled:
```js
QPM_DEBUG_API.probe.scan()
QPM_DEBUG_API.probe.overlay(true)
QPM_DEBUG_API.probe.pickOnce()
QPM_DEBUG_API.probe.findTargets('inventory')
QPM_DEBUG_API.probe.resolve('inventory.grid')
```

Console shortcuts: `QPM_ACTIVITY_LOG.list()`, `QPM_ACTIVITY_LOG.export()`

---

## Version History

### v3.1.x (current series)
- Pet Teams system: named teams, apply, keybinds, Aries Mod import
- Pet Hutch browser + swap into active slot
- Pet Comparison Hub (side-by-side + 3v3)
- Pet Optimizer (ability-based team suggestions)
- Controller / gamepad automation system
- Activity Log Enhancer (native hook)
- Crop Boost Tracker
- Weather Mutation Tracking
- Crop Mutation Analytics
- Pet Hatching Tracker + Hatch Statistics
- Sell All Pets
- Hub Windows: Stats, Trackers, Tools, Utility (tab aggregators)
- Public Rooms Inspector
- Anti-AFK + Auto-Reconnect
- restockDataService with camelCase normalization
- Version sync enforcement in build pipeline
- PIXI.js sprite-v2 system with KTX2 decoder

### Earlier versions (v2.x — v3.0.x)
Core features established: Auto-Favourite, Bulk Favourite, Mutation Reminder, Turtle Timer, Garden Filters, Journal Checker, Ability Tracker, Shop Restock, XP Tracker, Pet Hub (overview + compare), Aries Mod bridge.
