// src/ui/sections/changelog.ts — Changelog data + rendering

import { t } from '../../i18n';

// ---------------------------------------------------------------------------
// Changelog (hardcoded — most practical for userscript)
// ---------------------------------------------------------------------------

export const CHANGELOG: Array<{ version: string; date: string; notes: string[] }> = [
  {
    version: "3.2.0",
    date: "2026-05",
    notes: [
      "UI Redesign: Replaced Trackers Hub, Utility Hub, and Tools Hub with a unified QPM Hub",
      "Features organized into task-based groups: Trackers, Items, Garden, Config, Tools",
      "Cards show live summaries and expand in-place with accordion behavior",
      "Auto-Favorite + Bulk Favorite unified into Favorites section with tab switching",
      "Locker + Inventory Capacity unified into Protection section",
      "Main panel streamlined from 8 tiles to 6",
    ],
  },
  {
    version: "3.1.97",
    date: "2026-05",
    notes: [
      "Added Prediction Accuracy metric to item restock detail: fetches per-item model accuracy from a new API endpoint and shows a score bar with MAE/median error in the tooltip",
      "Renamed Overall Accuracy to Gap Consistency to distinguish median-gap regularity from logged model prediction accuracy",
      "Event accuracy in the detail window now uses the server-logged predicted timestamp when available, falling back to median interval estimation",
      "Fixed weather-conditional median interval only applying when the server explicitly confirms weather was used",
      "Fixed seed item ID aliases for Dawnbinder, Moonbinder, and Starweaver to match the current canonical server IDs",
      "Removed weather name tag from shop list ETA label",
    ],
  },
  {
    version: "3.1.96",
    date: "2026-05",
    notes: [
      "Added inline delete button to each team row with confirm/cancel prompt",
      "Refactored Manager tab into smaller modules for maintainability",
    ],
  },
  {
    version: "3.1.95",
    date: "2026-05",
    notes: [
      "Fixed Shop Keybinds button styling not rendering when opened from Utility Hub",
    ],
  },
  {
    version: "3.1.94",
    date: "2026-05",
    notes: [
      "Added Shop Keybinds: keyboard shortcuts to open game shops directly (default Alt+S/E/T/D)",
      "Configurable per-shop bindings and enable/disable toggle in Utility Hub",
    ],
  },
  {
    version: "3.1.93",
    date: "2026-05",
    notes: [
      "Overhauled Pet Teams Manager into a unified hub: team list on the left, full editor on the right",
      "Team list: three-line rows with team name, metric (/hr), score, pet sprites, ability pills, and feed toggle",
      "Editor slot cards: ability squares, pet sprite, species/STR, change/clear buttons, hunger bar, feed button, diet gear, and optimizer score",
      "Hunger bars now work for all pets (active, hutch, and inventory), not just active pets",
      "Diet gear popover: click to open crop checklist with sprites, click again to close (toggle behavior)",
      "Feed button opens a floating pet card at its last saved position instead of resetting to default",
      "Per-slot feed keybinds (default Alt+1/2/3): configure via the gear icon on floating cards or in editor slots",
      "Compact ability metric badges in the team summary bar, sized to fit alongside the team score on one row",
      "Removed the standalone Feeding tab, all feeding controls are now inline in the Manager tab",
    ],
  },
  {
    version: "3.1.92",
    date: "2026-05",
    notes: [
      "Overhauled Pet Teams Manager: two-line team rows with sprite clusters, dominant metric, ability pills, and team scores",
      "Added per-pet optimizer scores to editor slot cards with granter bonus indicators",
      "Added inline feeding controls to editor slot cards: hunger bar, feed button, and diet gear popover",
      "Added ability squares to editor slot cards showing each pet's abilities with color coding",
      "Added per-slot feed keybinds (default Alt+1/2/3) with configurable bindings in editor and floating cards",
      "Removed Feeding tab, all feeding controls are now integrated into the Manager tab",
      "Added team score display to the team summary bar",
    ],
  },
  {
    version: "3.1.91",
    date: "2026-05",
    notes: [
      "Added gold-dislike penalty to non-gold-granter pools: gold pets no longer sneak into rainbow teams via secondary abilities when dislike gold is on",
      "Fixed Create Team button missing on merged family groups (e.g. Amberlit Granter / Amberlit Plant Growth Boost)",
    ],
  },
  {
    version: "3.1.90",
    date: "2026-05",
    notes: [
      "Reduced synergy bonus dominance: halved all slot efficiency bonus magnitudes and lowered the bonus cap from 0.30 to 0.15",
      "Added synergy-group gating: standalone abilities (XP Boost, Produce Refund, Sell Boost, etc.) no longer inflate scores as unrelated support",
      "Compressed support standing values to reduce the gap between strong and weak support families",
      "Reduced time-family uplift diversity multipliers so secondary ability combos create smaller ranking differences",
      "Improved ranking accuracy: pets with the same primary role now rank primarily by strength and anchor quality, not secondary ability variety",
    ],
  },
  {
    version: "3.1.89",
    date: "2026-05",
    notes: [
      "Overhauled pet optimizer card layout: inline ability squares, rank badges, and location sprites replace the old stacked design",
      "Added family navigation bar with sticky jump-to links for each ability group",
      "Added family group deduplication: identical top-3 groups are merged into combined labels",
      "Improved family group headers with ability-colored tinting and dot indicators",
      "Replaced floating emoji sell button with inline contextual sell button",
      "Replaced emoji location icons with game sprites for hutch and inventory",
      "Fixed slot efficiency ranking inflated by zero-score abilities (weather-locked or unwanted abilities no longer qualify as meaningful support)",
    ],
  },
  {
    version: "3.1.88",
    date: "2026-05",
    notes: [
      "Fixed pet teams auto-purge incorrectly emptying slots when hutch or inventory atoms return stale data",
      "Fixed purge race during init: purge is now blocked until player identity resolution completes",
      "Added coverage check: large purges (3+ slots) are blocked when pool covers half or fewer referenced pets",
      "Fixed inventory atom returning null being silently treated as complete data",
    ],
  },
  {
    version: "3.1.87",
    date: "2026-05",
    notes: [
      "Anti-AFK improvements in Jotai bridge",
    ],
  },
  {
    version: "3.1.86",
    date: "2026-05",
    notes: [
      "Refactored pet teams store into modular subfolder (8 files, same public API)",
      "Fixed purge firing during team apply, which could corrupt active slots",
      "Fixed team reorder placing items at wrong position on downward drag",
      "Fixed getTeamById returning mutable internal reference",
      "Fixed feed policy event not reaching page context (now uses cross-realm dispatch)",
      "Fixed fast-path applied counter overcounting when falling back to repair pass",
      "Frozen default config/feed policy objects to prevent accidental mutation",
    ],
  },
  {
    version: "3.1.85",
    date: "2026-05",
    notes: [
      "Added reactive seed silo store with real-time capacity and slot tracking (supports upgraded silos up to 50 slots)",
    ],
  },
  {
    version: "3.1.84",
    date: "2026-05",
    notes: [
      "Fixed floating feed cards drifting when the browser window is resized or maximized",
      "Fixed floating feed cards able to be dragged off-screen, making them unreachable",
      "Improved floating feed card positioning: cards now store their position as a viewport ratio so they maintain their relative placement across any window size",
    ],
  },
  {
    version: "3.1.83",
    date: "2026-05",
    notes: [
      "Added reactive hutch store with real-time capacity tracking (supports upgraded hutches up to 100 slots)",
      "Fixed pet team apply failing on upgraded hutches: capacity was capped at 25 regardless of upgrade level",
      "Fixed pet team apply failing when inventory is near-full (98-100 items): retrieves now respect available space",
      "Fixed leftover cleanup using StorePet (active to hutch directly) instead of PickupPet through inventory",
      "Fixed PickupPet sending wrong ID type (was slotId, now sends petId entity UUID)",
      "Added Aries Hold: rapid-fire Space with configurable rate (5-20 Hz), per-context toggles, and hold-sell pet protection",
      "Added Insta-Action: bypasses 500ms press-and-hold delay for shovel, crop cleanser, and mutation potion when Aries Hold is active",
      "Added Insta-Harvest: instant Rainbow/Gold harvest without hold delay",
      "Fixed hold context detection for shovel and sell actions",
    ],
  },
  {
    version: "3.1.82",
    date: "2026-05",
    notes: [
      "Fixed Import/Export not transferring pet teams across browsers",
      "Fixed pet team slots being silently cleared after import before hutch data loaded",
    ],
  },
  {
    version: "3.1.81",
    date: "2026-05",
    notes: [
      "Restock predictions now adjust for current weather — 89 items use weather-specific baselines when sufficient data exists",
      "Fixed restock rate deflation for items added mid-tracking (lifespan-based rate calculation)",
      "Fixed overdue ETA inflation for rare items — uses survival-based mean remaining time instead of cycle/probability",
      "Seasonal and removed items now show a 'Seasonal' label instead of misleading countdowns",
    ],
  },
  {
    version: "3.1.80",
    date: "2026-05",
    notes: [
      "Added Aries Hold toggle in Locker > Insta-Harvest — hold Space to rapidly repeat any action at 10/s (planting, harvesting, interacting, etc.)",
      "Fixed Import/Export to discover player-scoped dynamic keys so pet team backups are never lost when switching accounts",
    ],
  },
  {
    version: "3.1.79",
    date: "2026-04",
    notes: [
      "Pet teams storage is now scoped per player account, preventing teams from being wiped when switching accounts",
      "Purge no longer runs if the active account changed since the store was initialized, guarding against cross-account slot clearing",
      "Existing teams are automatically migrated to the player-scoped key on first load after the update",
    ],
  },
  {
    version: "3.1.78",
    date: "2026-04",
    notes: [
      "Fixed inventory and economy values being inflated by items bought with magic dust (Infinity coin price clamped to 0)",
      "Fixed net worth top-10 dropdown ignoring quantity on decor items (e.g. 7 Wizard Towers showing as 1)",
      "Fixed net worth top-10 not including placed garden decor and eggs",
      "Top-10 dropdown now aggregates identical items across sources and shows quantity for all item types",
      "Calculator pet tab now shows magic dust sell value with formula breakdown",
    ],
  },
  {
    version: "3.1.77",
    date: "2026-04",
    notes: [
      "Fixed inventory capacity overlay keeping its blink animation after being disabled",
    ],
  },
  {
    version: "3.1.76",
    date: "2026-04",
    notes: [
      "Fixed inventory reserve blocking purchases for stackable items already in inventory",
    ],
  },
  {
    version: "3.1.75",
    date: "2026-04",
    notes: [
      "Fixed insta-harvest firing when a tool is equipped — now defers to the game action (water, dig, pot, cleanse, etc.)",
    ],
  },
  {
    version: "3.1.74",
    date: "2026-04",
    notes: [
      "Added Pet tab to Calculator with species selector, strength sliders, color mutations, and sell price formula",
      "Added coin sprites to calculator dropdown rows and selector button",
      "Fixed mutation sprite clipping in calculator result card",
    ],
  },
  {
    version: "3.1.73",
    date: "2026-04",
    notes: [
      "Fixed pet teams incorrectly clearing slots when atom reads fail (only purge with complete data)",
      "Team apply no longer auto-removes slots for temporarily unlocatable pets",
      "Fixed inventory capacity overlay jumping to wrong position after modal close or resize",
      "Overlay anchor now invalidates on modal close and canvas resize for correct repositioning",
    ],
  },
  {
    version: "3.1.72",
    date: "2026-04",
    notes: [
      "Added inventory capacity indicator with configurable warning/full thresholds and colors",
      "Overlay hides when inventory modal is open, repositions reactively on resize",
      "Optional sound alerts for warning and full levels (built-in + custom sounds, once or loop)",
    ],
  },
  {
    version: "3.1.71",
    date: "2026-04",
    notes: [
      "Fixed net worth briefly showing '-' after feeding a pet (NaN from transient atom state)",
    ],
  },
  {
    version: "3.1.70",
    date: "2026-04",
    notes: [
      "All value displays now use the live friend/room bonus instead of hardcoded 1.5x",
      "Sell price rounding now matches the game (two-step: base price rounded, then friend bonus applied)",
      "Fixed inventory value in player compare showing seed cost instead of sell price for produce",
      "Player compare Inv. row now includes storage value",
      "Garden, inventory, and net worth chips show expandable top-10 most valuable items",
      "Net worth now includes storage building prices, placed decor/eggs, and growing crops (seed cost)",
      "Fixed top-10 dropdown not showing storage items (timing + missing seed/decor handling)",
      "Seeds in top-10 show seed sprite and label with quantity (e.g. Sunflower Seeds x100)",
    ],
  },
  {
    version: "3.1.68",
    date: "2026-04",
    notes: [
      "Pet Teams: auto-remove sold/missing pets from team slots instead of showing unknown",
      "Pet Teams: purge stale slots on inventory changes, not just active pet changes",
    ],
  },
  {
    version: "3.1.67",
    date: "2026-04",
    notes: [
      "Economy: Net Worth metric (coins + garden + inventory + storages + active pets)",
      "Economy: Net Worth pop-out floating card with live updates",
      "Economy: Net Worth row in player comparison grid",
      "Version checker: cache-bust fetches, persist results, toast on new update",
    ],
  },
  {
    version: "3.1.66",
    date: "2026-04",
    notes: [
      "Pet Teams: block selecting the same pet in multiple slots of one team",
      "Pet Teams: auto-purge stale slots when a pet is sold or goes missing",
      "Stats Hub: remember the last active tab (Garden/Economy) across refreshes",
      "Panel: reposition upward when expanding near the bottom of the screen",
      "Feeding: fix eligible food count incorrectly including favorited items when all food is favorited",
    ],
  },
  {
    version: "3.1.65",
    date: "2026-04",
    notes: [
      "Economy: compare your Coins, Garden Value, Inventory Value, and Pet count with any other player in the room",
    ],
  },
  {
    version: "3.1.64",
    date: "2026-04",
    notes: [
      "Economy: added Garden Value and Inventory Value chips to the Economy tab with live updates",
      "Economy: all balance/value chips can now be popped out as persistent draggable floating cards",
    ],
  },
  {
    version: "3.1.63",
    date: "2026-04",
    notes: [
      "Feed Queue: spam-click Feed on floating cards or pets window and requests queue automatically instead of waiting per click",
      "Locker: fixed multi-harvest plants where one locked fruit blocked all other fruits on the same plant",
      "Locker: fixed mutation locks (Chilled, Wet, etc.) not blocking harvest when the fruit also had other mutations",
    ],
  },
  {
    version: "3.1.62",
    date: "2026-04",
    notes: [
      "Crop Price: fixed value not showing for variant species (OrangeTulip, PinkRose, etc.)",
    ],
  },
  {
    version: "3.1.61",
    date: "2026-04",
    notes: [
      "Crop Price: new tooltip overlay shows sell value of the crop you're standing on (toggle in Value Display settings)",
      "Crop Size indicator now reacts to C/X slot cycling instead of showing stale data",
      "Tweaked shop restock alert sizing to be more compact",
    ],
  },
  {
    version: "3.1.60",
    date: "2026-04",
    notes: [
      "Fixed storage value overlays showing 'InfinityT' for non-finite numbers",
      "Fixed ability badge colors not matching game UI (updated all fallback colors to verified game values)",
      "Fixed shop alerts staying stuck on 'Requested' after a server disconnect during buy-all",
      "Activity log now defaults to off for new installs (toggle it on in settings if needed)",
    ],
  },
  {
    version: "3.1.59",
    date: "2026-04",
    notes: [
      "Locker: added Insta-Harvest for Rainbow and Gold plants (skips the hold-to-harvest delay)",
    ],
  },
  {
    version: "3.1.58",
    date: "2026-04",
    notes: [
      "Restock: fixed inflated probabilities for seasonal/rare items (Rose, Clover, etc. were showing 40%+ instead of ~2%)",
      "Restock: estimation model now adapts to data volume — high-data items rely more on observed rates, low-data items use stronger priors",
      "Restock: EMA trend tracking — item detail shows whether restock intervals are speeding up or slowing down",
      "Restock: weather-specific interval tracking — detail view shows conditional ETAs during matching weather",
      "Restock: weather badge on Snow/Dawn eggs shows whether required weather is currently active",
      "Locker: fixed eggs not being detected in the garden",
    ],
  },
  {
    version: "3.1.57",
    date: "2026-04",
    notes: [
      "Settings: new collapsible Export/Import buttons — export all settings to a JSON file or import from a previous backup",
      "Shop Restock: fix Moonbinder accuracy regression showing '20d early'; add 5-min tracking for snow eggs",
      "Cleanup: removed ~2,700 lines of dead code",
    ],
  },
  {
    version: "3.1.56",
    date: "2026-04",
    notes: [
      "Pet Teams: fix PlacePet failures in multiplayer rooms — tiles are now resolved from the correct player slot instead of another user's garden",
      "Pet Teams: pre-validate team pet IDs before apply — missing/sold pets report clear errors instead of silent timeouts",
    ],
  },
  {
    version: "3.1.55",
    date: "2026-04",
    notes: [
      "Locker: in classic QPM fashion; refactor lol",
      "Dashboard: Reset Windows button replaces legacy Reset Stats",
    ],
  },
  {
    version: "3.1.54",
    date: "2026-04",
    notes: [
      "locker: new Action Guard feature - block harvests, egg hatches, and decor pickups by plant, mutation, egg type, or decor; per-crop sell protection; custom plant+mutation combo rules with multi-mutation AND logic; inventory reserve; sell-all-pets protections",
    ],
  },
  {
    version: "3.1.53",
    date: "2026-04",
    notes: [
      "shop restock: fixed item list scrolling to the top when pinning or unpinning an item",
      "shop restock: item detail window shows accuracy against the server's actual prediction",
      "shop restock: restored celestial micro-gap noise filter - short intervals no longer skew celestial predictions",
      "shop restock: accuracy scoring now scales with item rarity instead of loose metrics",
      "shop restock: updated the algorithm to my new ADAPTIVE-V5 (more individualised item estimations, stronger dynamic/adaptive estimations, stronger learning off past restocks",
    ],
  },
  {
    version: "3.1.52",
    date: "2026-04",
    notes: [
      "shop restock alerts: alerts now slide in from the top of the screen with a subtle bounce and slide back out on dismiss",
    ],
  },
  {
    version: "3.1.51",
    date: "2026-04",
    notes: [
      "pet picker: fixed modal resizing when hovering different pets by locking window height",
      "shop restock: pinned section now scrolls and has a draggable divider so many pinned items no longer push the items list off screen",
      "pet teams: fixed PlacePet failing when applying a team with more pets than currently active - now finds a real empty garden tile instead of using invalid hardcoded coordinates",
    ],
  },
  {
    version: "3.1.50",
    date: "2026-04",
    notes: [
      "shop restock alerts: per-item sound alerts with built-in/custom sounds, once or loop mode, and configurable repeat speed",
      "shop restock alerts: fixed buy-all using canonical item names for reliable ownership tracking",
      "pet optimizer: seed finder now treats each tier independently",
      "turtle timer: fixed growth abilities using hardcoded Tier II values for all tiers - Cow was ~1.9x overestimated",
      "turtle timer: switched from geometric to game-accurate linear probability model",
      "ability stats: effect-per-hour now correctly scales by pet strength",
    ],
  },
  {
    version: "3.1.49",
    date: "2026-04",
    notes: [
      "pet optimizer: fix Max Strength Boost (hatch-trio) incorrectly boosting XP Boost slot-efficiency scores via support-family bonus",
    ],
  },
  {
    version: "3.1.48",
    date: "2026-04",
    notes: [
      "shop restock alerts: added 45s hard timeout for stuck purchase confirmations",
      "shop restock alerts: socket close now immediately fails pending purchases so they can be retried",
    ],
  },
  {
    version: "3.1.47",
    date: "2026-04",
    notes: [
      "shop restock alerts: added item sprites to alert cards",
      "shop restock alerts: compact card layout, quantity and status on one row",
      "shop restock alerts: fixed CropCleanser and WateringCan cap checks by reading from the correct tool inventory source",
      "shop restock alerts: purchases now stop immediately if the connection is lost",
      "shop stock: added purchase count fallback from player data atom for more accurate remaining stock",
      "internal: split 4 large files into focused modules (shopRestockAlerts, shopRestockWindow, restockDataService, shopStock)",
    ],
  },
  { version: "3.1.46", date: "2026-04", notes: ["Added GMExport Bridge"] },
  {
    version: "3.1.45",
    date: "2026-04",
    notes: [
      "shop restock alerts: notification now dismisses after buy even when purchase atom confirmation lags past the 600ms window",
      'shop restock data: fixed duplicate "Watering Can" / "Watering Cans" entries caused by inconsistent plural ID from game API (server migration + rebuild)',
    ],
  },
  {
    version: "3.1.44",
    date: "2026-04",
    notes: ["fixed buy all button and dismiss button responsiveness"],
  },
  {
    version: "3.1.43",
    date: "2026-04",
    notes: [
      "shop restock alerts: fixed Buy All showing success when purchases were not server-confirmed; now verifies via purchases atom delta after sends",
      "shop restock alerts: added insufficient balance modal - shows cost breakdown and buys as many as your balance allows",
      "shop restock alerts: increased send delay to 100ms to respect WS throttle; fixed throttle bypass",
      "shop stock: fixed custom shop inventories (customRestockInventories) not being applied, matching game behaviour",
      "shop stock: fixed currentStock incorrectly inflated when entry.remaining was present in the raw atom",
    ],
  },
  {
    version: "3.1.42",
    date: "2026-04",
    notes: [
      "item shop history: improved resize behavior so the restock history/detail window remains scrollable and stable after window size changes",
      "shop restock alerts: fixed in-stock alerts persisting after purchase by honoring purchase-limited availability and inventory/silo ownership updates",
      "crop boost tracker: fixed window scrolling by restoring modal body scroll layout and preserving scroll position across reactive refreshes",
    ],
  },
  {
    version: "3.1.41",
    date: "2026-04",
    notes: [
      "shop restock: fixed Seen time sync so history rows now reflect the latest per-item event data consistently",
      "restock history UX: kept the View History modal flow with per-event accuracy percentages and exact probability display",
      "prediction pipeline: switched to adaptive error-calibrated no-pity model (Supabase-driven) with improved refresh behavior",
    ],
  },
  {
    version: "3.1.40",
    date: "2026-04",
    notes: [
      "Pet Optimizer now checks top 3 of both Specialist and Slot Efficiency modes before marking a pet to sell. Added buttons to the keep category to compare competitive pets easier",
    ],
  },
  {
    version: "3.1.39",
    date: "2026-04",
    notes: [
      "fixed window persistence: viewport resize, un-minimize, and async openers now correctly save and restore position; scrollbar style elements cleaned up on destroy",
    ],
  },
  {
    version: "3.1.38",
    date: "2026-04",
    notes: [
      "pet optimizer: scroll position is now preserved when marking a pet as Keep/Return or selling - no longer jumps back to top",
    ],
  },
  {
    version: "3.1.37",
    date: "2026-04",
    notes: [
      "fixed update button: cache-bust query param ensures Tampermonkey sees the latest version instead of a stale GitHub CDN response",
    ],
  },
  {
    version: "3.1.36",
    date: "2026-04",
    notes: [
      "pet optimizer: added per-card Keep/Return override so manual keeps persist and can be reverted to live recommendations",
    ],
  },
  {
    version: "3.1.35",
    date: "2026-04",
    notes: [
      "pet optimizer internals refactored into modular ranking and decision pipelines with no intended behavior changes",
      "pet optimizer window internals split into focused modules for filters, rendering, actions, and sell flows",
      "fixed optimizer cross-realm pets window tab switch dispatch and tightened ranking reason consistency",
    ],
  },
  {
    version: "3.1.34",
    date: "2026-04",
    notes: [
      "rewrote garden filter to use per-tile PIXI forward-map traversal; fixes tile click and section filter accuracy",
      "added Stats Hub garden filter: filter remaining mutations, match-all toggle, per-tile click highlight",
      "added storage value indicator: overlay and window showing estimated total value of stored items",
      "fixed ability tracker: crop mutation boost no longer shows inaccurate procs/hr and coins/hr values",
      "fixed intermittent sprite rendering where pet, plant, and seed canvases could return blank fallbacks on load",
      "added renderer recovery for stale PIXI capture and WebGL context restore to keep sprite extraction stable",
    ],
  },
  {
    version: "3.1.33",
    date: "2026-04",
    notes: [
      "fixed window persistence: pet-hub now restores on reload; fixed toggle no-op during restore",
    ],
  },
  {
    version: "3.1.32",
    date: "2026-04",
    notes: [
      "fixed window persistence: state now saved before render to survive render failures across reloads",
    ],
  },
  {
    version: "3.1.31",
    date: "2026-03",
    notes: [
      "fixed sell pipeline: fresh atom read before each sell prevents stale cache missing favorited/locked pets",
    ],
  },
  {
    version: "3.1.30",
    date: "2026-03",
    notes: [
      "added sell buttons to Pet Optimizer: per-card (💰) and per-family bulk sell with confirmation modal",
      "added window state persistence: open panels are restored automatically after page reload",
    ],
  },
  {
    version: "3.1.29",
    date: "2026-03",
    notes: [
      "fixed Journal Checker Smart Tips Fastest Path cards showing raw variant color code as text and images not loading when sprites not yet ready",
    ],
  },
  {
    version: "3.1.28",
    date: "2026-03",
    notes: ["fixed keybind capture not detecting key presses on Opera GX"],
  },
  {
    version: "3.1.26",
    date: "2026-03",
    notes: [
      "fixed garden filters and sprite capture not working in Firefox / Discord Activities",
      "fixed PIXI app not captured when inline script injection blocked by CSP",
      "fixed tutorial and guide images not loading under strict CSP",
      "fixed KTX2 decoder hanging when WebAssembly blocked by CSP - skips to legacy path",
      "fixed localStorage calls failing in third-party iframe storage partitioning",
      "fixed pet team keybind input not registering key presses",
    ],
  },
  {
    version: "3.1.25",
    date: "2026-03",
    notes: [
      "fixed Garden Stats value calculations: combined mutation + Max Size potential now correct when multiple filters active",
      "fixed max scale values for 13 species (Cabbage, Clover, Rose, Beet, Gentian, PineTree, Peach, VioletCort, Cacao, DragonFruit, and others) sourced directly from game floraSpeciesDex",
    ],
  },
  {
    version: "3.1.24",
    date: "2026-03",
    notes: [
      "fixed garden filter Four-Leaf Clover and Clover (Patch) not matching - corrected PIXI view labels (plant.name + View, not Plant View)",
    ],
  },
  {
    version: "3.1.23",
    date: "2026-03",
    notes: [
      "added Max Size filter to Garden Stats - shows plants where at least one slot has reached its species max scale",
      "fixed coins/hr display for AmberGranter and ProduceScaleBoost (no longer blank between harvests)",
      "reduced unnecessary re-renders in weather tracking, harvest reminder, turtle timer, and shop tile",
    ],
  },
  {
    version: "3.1.22",
    date: "2026-03",
    notes: [
      "fixed Garden Stats species filter conflicting with Garden Filters feature (isolated via dedicated override, no config/storage contamination)",
    ],
  },
  {
    version: "3.1.21",
    date: "2026-03",
    notes: [
      "fixed garden filters (all-tiles-dimmed bug, FourLeafClover matching, crop sprites now visible)",
      "optimised timers and performance (tile node cache, remove GC alloc per frame)",
      "changed Remaining counter in Garden stats to show fruit count instead of crop",
      "added all missing PIXI Plant Views for Garden Filters (Date, Aloe, Cabbage, Beet, Rose, Pear, Gentian, Peach, VioletCort)",
    ],
  },
  {
    version: "3.1.20",
    date: "2026-03",
    notes: [
      "pet team delete button now shows inline confirmation (fixes silent failure in Discord Activities)",
      "pet team name input no longer loses focus while typing",
      "garden filter now dynamically loads all crops from catalog, new plants appear automatically",
      "four leaf clover sprite alias added",
    ],
  },
  {
    version: "3.1.19",
    date: "2026-03",
    notes: [
      "fixed pet optimiser crash (Analysis Failed) caused by undefined weather type in catalog lookup",
    ],
  },
  {
    version: "3.1.18",
    date: "2026-03",
    notes: [
      "added Garden & Hatch Stats to Trackers hub: mutation progress filter + hatch history with ability breakdown",
      "pet hatching tracker now wired up and records species + abilities per hatch",
    ],
  },
  {
    version: "3.1.17",
    date: "2026-03",
    notes: [
      "hopefully fixed the activity log hydration (stutters for 5-10 seconds and then its smooth)",
      "first 5 people to send a screenshot of this to the QPM channel gets 5k bread lol",
    ],
  },
  {
    version: "3.1.16",
    date: "2026-03",
    notes: [
      "added anti-afk in utility hub",
      "fixed and sped up pet hutch swapping with pet teams",
    ],
  },
  {
    version: "3.1.15",
    date: "2026-03",
    notes: [
      "Journal Scroll and window fixes (smaller counter buttons, scroll handling fixed) ***if issues persist, tell me if making the journal window bigger works***",
      "fixed dashboard celestials not updating (was only grabbing from cache once on init)",
    ],
  },
  {
    version: "3.1.14",
    date: "2026-03",
    notes: [
      "added sprite decoder for MG v114+ compressed sprites..... eeeeeee",
      "if youre reading this hello, i hope you have a good day",
    ],
  },
  {
    version: "3.1.13",
    date: "2026-03",
    notes: [
      "Pet Teams: hutch-balanced apply now pairs hutch pulls with outgoing active pets (favorited pets preferred) and reports clearer failure reasons",
      "Activity Log: added extended native activity logging and enabled the Utility Hub Activity Log card by default (customize choices persist)",
    ],
  },
  {
    version: "3.1.12",
    date: "2026-03",
    notes: ["fixed Bulk Favorite, added toggle in Utility"],
  },
  {
    version: "3.1.11",
    date: "2026-03",
    notes: ["removed default pets keybind"],
  },
  {
    version: "3.1.1",
    date: "2026-03",
    notes: [
      "Feeding: detached instant feed buttons now resolve per-pet diets/allowed food totals per active slot",
      "Pet Optimizer: Double Harvest and Crop Refund compare/obsolete logic now ranks per ability family (Top 3 kept per family)",
      "Pet Teams: Sell All keybind location is now in the settings gear cog inside the Pet Teams window",
    ],
  },
  { version: "3.1.09", date: "2026-03", notes: ["fix feed cards"] },
  {
    version: "3.1.08",
    date: "2026-03",
    notes: ["slot specific diet quantity"],
  },
  { version: "3.1.07", date: "2026-03", notes: ["Anti-AFK"] },
  {
    version: "3.1.06",
    date: "2026-03",
    notes: [
      "Pets: Shift can now be used as a modifier key for team keybinds",
      "Teams: added polished ability value badges with accurate Hunger Restore team-based calculations",
      "Feeding: feed buttons now show how much selected food remains in inventory",
      "Pet Optimizer: each ability section now includes Create Team from your top 3 pets",
    ],
  },
  {
    version: "3.1.05",
    date: "2026-03",
    notes: [
      "UI: standardized emoji-safe font fallback across panel and window roots",
      "UI: removed temporary text-repair observer workaround",
      "Fixed icon/symbol placeholders showing as ?? in panel and feature windows",
    ],
  },
  {
    version: "3.1.04",
    date: "2026-03",
    notes: [
      "Tools Hub: customizable cards, updated tool descriptions, and sprite-based icons",
      "Dashboard: Shop Restock tile now uses the Coin UI sprite; Celestial Restocks hide rate percentages",
      "Journal: fixed Amberlit/Ambershine variant matching for completion tracking",
    ],
  },
  {
    version: "3.1.03",
    date: "2026-03",
    notes: [
      "Resize handling fixes for feature windows",
      "Minimize/restore handling fixes",
      "Scroll handling fixes for Pets Manager and Pet Optimizer",
    ],
  },
  {
    version: "3.1.0",
    date: "2026-03",
    notes: [
      "Consolidated tabs into hub windows (Trackers, Utility, Pets)",
      "Shop Restock rewritten with Supabase data",
      "Dashboard: Changelog card, shop restock cards, dashboard modules",
      "Removed Achievements tab",
    ],
  },
  {
    version: "3.0.66",
    date: "2026-03",
    notes: [
      "Fix XP tracker catalog race condition",
      "Fix garden filter mutations display",
    ],
  },
  {
    version: "3.0.65",
    date: "2026-03",
    notes: ["XP Tracker swap button", "Garden filters improvements"],
  },
  {
    version: "3.0.64",
    date: "2026-02",
    notes: ["Sprite mutations + garden filters (amberlit)"],
  },
];

// ---------------------------------------------------------------------------
// Changelog card
// ---------------------------------------------------------------------------

export function buildChangelogCard(): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = [
    "margin-top:14px",
    "padding:10px",
    "background:rgba(255,255,255,0.03)",
    "border:1px solid rgba(143,130,255,0.15)",
    "border-radius:6px",
  ].join(";");

  const headerRow = document.createElement("div");
  headerRow.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;";

  const title = document.createElement("div");
  title.style.cssText = "font-size:11px;font-weight:700;color:#8f82ff;";
  title.textContent = `📋 ${t('panel.footer.changelog')}`;

  const visibleEntries = CHANGELOG.slice(0, 3);
  const latest = visibleEntries[0]!;
  const latestBadge = document.createElement("div");
  latestBadge.style.cssText = "font-size:10px;color:rgba(224,224,224,0.5);";
  latestBadge.textContent = `v${latest.version}`;

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.style.cssText =
    "background:none;border:none;color:rgba(224,224,224,0.4);font-size:10px;cursor:pointer;padding:0 2px;";
  toggleBtn.textContent = "▶";

  headerRow.append(title, latestBadge, toggleBtn);
  card.appendChild(headerRow);

  // All changelog content — collapsed by default
  const body = document.createElement("div");
  body.style.display = "none";

  for (let index = 0; index < visibleEntries.length; index += 1) {
    const entry = visibleEntries[index]!;
    body.appendChild(buildChangelogEntry(entry, index === 0));
  }
  card.appendChild(body);

  let expanded = false;
  const toggle = (): void => {
    expanded = !expanded;
    body.style.display = expanded ? "block" : "none";
    toggleBtn.textContent = expanded ? "▼" : "▶";
  };
  headerRow.addEventListener("click", toggle);

  return card;
}

function buildChangelogEntry(
  entry: { version: string; date: string; notes: string[] },
  isLatest: boolean,
): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `margin-top:8px;padding-top:${isLatest ? "8" : "6"}px;${isLatest ? "" : "border-top:1px solid rgba(255,255,255,0.06);"}`;

  const versionRow = document.createElement("div");
  versionRow.style.cssText =
    "display:flex;align-items:center;gap:6px;margin-bottom:4px;";

  const versionBadge = document.createElement("span");
  versionBadge.style.cssText = `font-size:10px;font-weight:700;color:${isLatest ? "#8f82ff" : "#aaa"};`;
  versionBadge.textContent = `v${entry.version}`;

  const dateBadge = document.createElement("span");
  dateBadge.style.cssText = "font-size:10px;color:rgba(224,224,224,0.35);";
  dateBadge.textContent = entry.date;

  versionRow.append(versionBadge, dateBadge);
  el.appendChild(versionRow);

  const list = document.createElement("ul");
  list.style.cssText = "margin:0;padding:0 0 0 14px;";
  for (const note of entry.notes) {
    const li = document.createElement("li");
    li.style.cssText =
      "font-size:11px;color:rgba(224,224,224,0.7);margin-bottom:2px;";
    li.textContent = note;
    list.appendChild(li);
  }
  el.appendChild(list);

  return el;
}