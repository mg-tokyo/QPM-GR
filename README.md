# QPM-GR — Quinoa Pet Manager: General Release

**QPM-GR** is a TypeScript userscript that enhances **Magic Garden** with analytics, automation helpers, and tracking utilities.

**Current Version:** 3.2.6 · **Status:** Active development

![QPM Overview](docs/product/QPM_user_guide.jpg)

Compatible with:
- [magiccircle.gg](https://magiccircle.gg/r/*)
- [magicgarden.gg](https://magicgarden.gg/r/*)
- [starweaver.org](https://starweaver.org/r/*)
- Discord Activities (`1227719606223765687.discordsays.com`)

---

## Installation

### Option A — Install pre-built (recommended for users)

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. Install the script directly from the GitHub release:
   - Open `dist/QPM.user.js` in this repo and click **Raw**
   - Tampermonkey will prompt you to install it automatically
3. Navigate to Magic Garden — the QPM panel appears in the game UI

### Option B — Build from source

```bash
git clone https://github.com/mg-tokyo/QPM-GR.git
cd QPM-GR
npm install
npm run build:dist          # outputs dist/QPM.user.js
```

Install `dist/QPM.user.js` into Tampermonkey via Dashboard → Utilities → Import from file.

---

## Features

### 🐾 Pet Hub

Full pet analytics window with multiple tabs:
- **Overview** — all active pets with rarity, level, and abilities; real-time proc rates (procs/min, procs/hour)
- **Comparison** — side-by-side stat comparison with visual highlighting of superior stats
- **Abilities** — detailed breakdown of every pet ability with historical proc data and effectiveness metrics
- Aries Mod preset integration when available

### ⭐ Auto-Favourite

Rule-based auto-favoriting for pets and produce:
- Favourite pets by rarity, level, ability type, or any combination
- Protect valuable crops from accidental selling
- Rules are fully configurable and update in real time as items are acquired

### 🧺 Bulk Favourite (Crop-Type Locking)

Instantly favourite all crops of a given type in your inventory:
- One click to lock every Carrot, Strawberry, or any other crop type
- Prevents accidental selling or discarding of large stacks
- Saves hundreds of manual clicks when cleaning up inventory

### 📘 Journal Checker

Track journal completion with sprite-based display:
- Shows progress for all produce types and pet variants
- Identifies exactly which items are missing
- Smart Tips section recommends what to plant or hatch next
- Rainbow variant indicator when all 11 crop types are completed

### 🌈 Ability Tracker

Real-time pet ability logging and contribution analysis:
- Logs every proc as it happens, including timing and source pet
- Shows total procs, average timing, and per-pet contribution breakdown
- Identify your most effective pet setup over a session

### 🛒 Shop Restock Tracker

Advanced restock analytics with dual prediction system:
- **Live tracking** — detects restocks automatically in real time
- **Discord import** — parse historical restock data from Discord HTML exports (`npm run parse-discord-html`)
- **Time-based predictions** — average interval analysis per item
- **Window-based predictions** — statistical pattern analysis for higher-confidence estimates
- Per-item analytics: appearance rate, average quantity, last seen timestamp
- Countdown timers and alerts for upcoming restocks
- Dashboard quick-view cards for Starweaver, Dawnbinder, Moonbinder, Mythical Eggs, and more
- Export data as HTML or clear history at any time

### 🐢 Turtle Timer

Precision timing utility for Turtle pet mechanics:
- Plant growth timing
- Egg growth countdown
- Food/support schedule tracking
- Configurable focus targets per slot

### 🧠 XP Tracker

Session-based XP efficiency tracking:
- Real-time XP/min and XP/hour
- Cumulative session XP and runtime
- Compare setups by resetting between sessions

### 🔒 Crop Size Indicator

Accurate crop size display injected into the game UI:
- Uses floor calculation to match the game's internal rounding exactly
- Visual tooltip on each crop tile
- Helps time harvests for maximum yield

### 🌦️ Weather Hub

Weather monitoring and mutation opportunity alerts:
- Current weather display and uptime tracking
- Mutation opportunity notifications when weather conditions align
- Weather-dependent ability monitoring

### 🔔 Notifications & Alerts

Centralised notification panel with filterable categories:
- Mutation opportunities
- Shop restock alerts
- Harvest reminders
- Pet ability milestones
- Per-category toggles and detail view

### 🏆 Achievements

Track in-game achievement progress across categories.

### 🔗 Aries Mod Integration

Read-only data bridge for [Aries Mod](https://github.com/ariedam):
- Exposes active pet team and achievement progress via `QPM_ARIES_BRIDGE`
- Allows Aries to read QPM data without requiring write access

---

## Repo layout

```
src/
├── main.ts                  # Entry point — full initialization sequence
├── core/                    # Jotai bridge, page context, atom registry
├── catalogs/                # Runtime game data capture (Object.* hook)
├── sprite-v2/               # Sprite rendering (PIXI hook + atlas extraction)
├── features/                # Feature modules — one file per feature
├── store/                   # Derived state (pets, inventory, stats, XP, weather)
├── ui/                      # Windows, panels, section builders
│   ├── sections/            # Individual panel section components
│   ├── panelHelpers.ts      # Shared UI helpers and formatters
│   ├── panelState.ts        # UIState interface and factory
│   ├── panelStyles.ts       # CSS injection
│   ├── abilityAnalysis.ts   # Ability computation logic
│   ├── turtleTimerLogic.ts  # Turtle timer update logic
│   ├── notificationSection.ts
│   └── shopHistoryWindow.ts
├── data/                    # Static reference tables (abilities, pet metadata)
├── utils/                   # Shared helpers (storage, DOM, scheduling, logger)
├── types/                   # Shared TypeScript types
├── debug/                   # QPM_DEBUG_API global
└── integrations/            # Aries Mod bridge
scripts/
└── build-userscript.js      # Wraps Vite IIFE output with Tampermonkey metadata
docs/
└── product/
    └── DOCUMENTATION.md     # Full feature guides and developer reference
dist/
└── QPM.user.js              # Built userscript (ready to install)
```

---

## Build commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite watch mode — rebuilds on every file change |
| `npm run build` | Production Vite bundle only (`dist/quinoa-pet-manager.iife.js`) |
| `npm run build:dist` | Full build + userscript wrapper → `dist/QPM.user.js` |
| `npm run scrape-game-data` | Scrape latest data from the game runtime |
| `npm run parse-discord-html` | Parse a Discord HTML export for restock history |

---

## Debug API

A global `QPM_DEBUG_API` object is exposed in the browser for in-session debugging:

```js
QPM_DEBUG_API.debugPets()          // log active pet data
QPM_DEBUG_API.listSpriteResources() // list loaded sprite atlases
QPM_DEBUG_API.getCatalogs()        // inspect captured game catalogs
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code conventions, and how to submit changes.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Support

QPM is free and open source, always has been, always will be.

https://github.com/sponsors/mg-tokyo

## License

[MIT](LICENSE) — Copyright (c) 2025 TOKYO.#6464

