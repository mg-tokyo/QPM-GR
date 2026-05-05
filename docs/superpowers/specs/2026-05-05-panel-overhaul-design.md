# QPM Panel Layout Overhaul

## Summary

Replace the current two-layer UI (main panel tiles + separate Hub window) with a unified panel that absorbs the Hub's navigation and feature groups directly. The panel gets a horizontal nav bar, a customizable Home tile grid, and inline Hub-style card views for each feature category.

## Architecture

### Panel Structure (top to bottom)

1. **Title bar** — unchanged (drag, collapse, version bubble)
2. **Horizontal nav bar** — icon-only buttons (32×32), replaces the Hub's vertical sidebar
3. **View area** — content changes based on selected nav button:
   - **Home (🏠)** — customizable tile grid + collapsible Changelog/Settings
   - **Trackers (📊)** — Hub Trackers group cards rendered inline
   - **Garden (🌱)** — Hub Garden group cards rendered inline
   - **Items (🎒)** — Hub Items group cards rendered inline
   - **Config (⚙️)** — Hub Config group cards rendered inline
   - **Tools (🧰)** — Hub Tools group cards rendered inline

### Nav Bar

- Icons only, 32×32 buttons, tooltip on hover for label
- Active button: `background:rgba(143,130,255,0.15)`, `border:1px solid rgba(143,130,255,0.3)`, full opacity
- Inactive buttons: transparent background, `opacity:0.45`
- Tools button pushed to the right via `margin-left:auto`
- Uses same sprite icons from the current Hub sidebar (`buildSidebarIcon`)

### Home View

The Home view contains:

1. **Tile grid** — user-customizable set of feature shortcut buttons
2. **"+" button** — always visible at the end of the grid, opens the Add Tile picker
3. **Collapsible rows** — Changelog and Settings, collapsed by default

### Tile Grid Behavior

- Tiles arranged in a flex-wrap grid (2 columns at default panel width)
- Each tile: icon + label + optional live status text (same as current tiles)
- Clicking a tile opens its associated feature window (same behavior as current)
- **Always-draggable**: long-press (or hold) to grab and reorder via drag
- **Swipe left to delete**: reveals a delete action (or long-press shows a delete affordance)
- **"+" button**: always present at the end of the tile list

### Add Tile Picker

- Triggered by tapping the "+" button
- Flat scrollable list of ALL available features
- Each row: icon + feature name + action ("+ add" or "already added" grayed)
- Tapping "+ add" immediately inserts the tile at the end of the grid
- Picker dismisses after adding (or on outside click)

### Available Tile Features (complete list)

Every feature that can open a window or trigger an action:

| Feature | Icon | Action |
|---------|------|--------|
| Pet Teams | 👥 | Opens Pets window |
| Shop Restock | 🏪 | Opens Shop Restock window |
| Public Rooms | 🌐 | Opens Public Rooms window |
| Journal Checker | 📔 | Opens Journal Checker window |
| Ability Tracker | 📊 | Opens Ability Tracker (detached) |
| XP Tracker | ✨ | Opens XP Tracker (detached) |
| Turtle Timer | 🐢 | Opens Turtle Timer (detached) |
| Crop Boosts | 🌱 | Opens Crop Boost Tracker window |
| Value Display | 💰 | Opens Value Display settings |
| Activity Log | 📜 | Opens Activity Log window |
| Locker / Protection | 🔒 | Opens Protection window |
| Crop Calculator | 🧮 | Opens Crop Calculator window |
| Texture Swapper | 🖼️ | Opens Texture Swapper window |
| Controller | 🎮 | Opens Controller settings window |

Additional features should be added to this registry as they are created.

### Non-Home Views (Feature Groups)

When a non-Home nav button is clicked, the view area renders that group's cards directly — the same `renderHubGroup()` output currently shown inside the Hub window. This means:

- Expandable cards (accordion with expand/collapse, detach button)
- Launcher cards (click to open window)
- Inline toggle cards (quick enable/disable)
- Same card styling, same icons, same expand behavior
- Scrollable within the panel's view area

### Tile Persistence

- Tile configuration stored in storage: `qpm.home-tiles.v1`
- Shape: `{ tiles: Array<{ id: string; order: number }> }`
- Default set on first load: Pet Teams, Shop Restock, Public Rooms, Journal Checker
- Changes persisted immediately on reorder/add/delete

## Removals

| Removed | Reason |
|---------|--------|
| Hub window (`qpm-hub`) | Absorbed into panel nav |
| Hub tile (🔮 button on panel) | No longer needed |
| Dashboard tile (📊 button) | Replaced by Home nav |
| Celestial Restocks section | User requested removal |
| Stats Header section | Not visible in current UI, not needed |
| Section collapse divider (▼) | No longer needed — nav handles view switching |
| PETS/GAME/TOOLS section headers | Tiles are now flat, user-organized |

## Data Flow

```
Nav button click
  → setActiveView(groupId)
  → if Home: renderHomeView()
       → read tile config from storage
       → render tile grid + "+" + collapsibles
  → else: renderHubGroup(groupDef)
       → same as current Hub group rendering
```

```
Tile reorder (drag)
  → update tile config order in memory
  → persist to storage
  → re-render grid with new order
```

```
Add tile
  → show picker overlay/dropdown
  → user taps feature
  → append to tile config
  → persist
  → re-render grid
  → dismiss picker
```

## Error Handling

- If tile config is corrupted/missing, reset to default set
- If a registered tile's feature fails to load, tile still renders but click shows error toast
- Nav buttons always render even if their group definition fails to load

## Migration

- On first load with new code, if no `qpm.home-tiles.v1` exists, populate with the current hardcoded tile set (Pet Teams, Shop Restock, Public Rooms, Journal)
- Old storage keys for panel state (position, collapsed, size) remain unchanged
- Hub window state (`qpm-hub-active-group`, `qpm-hub-expanded-card`) can be preserved for the inline group views

## File Impact

### New files
- `src/ui/panelNav.ts` — horizontal nav bar renderer
- `src/ui/homeView.ts` — Home view (tile grid + collapsibles + add picker)
- `src/ui/tileRegistry.ts` — registry of all available tile features (id, icon, label, action)
- `src/ui/tileDrag.ts` — drag-to-reorder + swipe-to-delete interaction logic

### Modified files
- `src/ui/originalPanel.ts` — major rewrite: remove tile sections, section divider, Dashboard tab; add nav bar + view switching
- `src/ui/hubWindow/index.ts` — remove `toggleHub()` export (or keep as no-op for backwards compat during transition)

### Removed/deprecated
- Hub tile click handler and registration
- Dashboard tile and `registerTabPanel('dashboard', ...)` logic
- `createStatsHeader()` usage
- Celestial Restocks rendering code
- Section divider (collapse/expand of tab content)

## Testing

- Verify all nav buttons render and switch views correctly
- Verify tile grid renders default set on fresh install
- Verify long-press drag reorders tiles and persists
- Verify swipe-left deletes a tile and persists
- Verify "+" picker shows all features, grays already-added ones
- Verify adding a tile appends it and persists
- Verify non-Home views render Hub cards correctly (expand, collapse, detach all work)
- Verify panel collapse/expand still works with new layout
- Verify panel drag/resize still works
- Verify no regressions in window opening from tiles
