# QPM

qol all-in-one mod for Magic Garden. it started out as a pet stats tracker (QPM = Quinoa Pet Manager) but its a lot more than that now.

works on magicgarden.gg, magiccircle.gg, starweaver.org and the Discord activity. for Discord it has to be Discord in the browser, userscripts cant run in the desktop app.

## Install

1. install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
   - on chrome you also need to turn on **Allow User Scripts** in the extension details
   - on edge its **Developer mode** on the extensions page
2. open [QPM.user.js](https://github.com/mg-tokyo/QPM-GR/raw/refs/heads/master/dist/QPM.user.js) and click install
3. load into Magic Garden and press **Alt + Q** (Option + Q on mac) to open/close the panel

if the install page freezes, download the file instead and use Import from File in the tampermonkey dashboard (Utilities tab).

qpm checks for updates when you load the game, the version number in the panel header lets you know when theres a new one.

## What most people use it for

### Shop Restock
predicts when seeds, eggs, tools and decor will restock next, and shows how accurate the predictions have been for each item. pin anything you want and youll get an alert with a buy all button when it comes in stock. alt + s/e/t/d opens each shop too.

### Pet Teams & Pet Optimizer
save your teams and swap between them with a keybind. feed keybinds per slot (alt + 1/2/3 by default), diet settings, and hunger bars for every pet, including hutch and inventory. the optimizer ranks your pets for each ability and tells you which ones are worth keeping or selling. theres also an activity tab that logs every proc, feed, hatch, sell and mount.

### Protection
you pick what you DONT want harvested, sold, hatched or picked up and qpm blocks it. overrides let you set rules for one specific crop. favourites live next to it, bulk favourite a whole crop type in one click or set up auto favourite rules.

### Garden Filters & Garden Stats
filters dim every tile except the species/mutation/rarity youre hunting. garden stats shows which plants still need each mutation, and what your coins, garden and inventory are worth.

### Journal Checker
shows which produce and pet variants youre still missing, with some tips on what to go for next. unlogged variants also show up on the games tile card when you stand on a crop.

### Bad Luck Protection
how close you are to each guaranteed rare, gold and rainbow drop for seeds, eggs and capsules. it only counts while qpm is loaded.

### 3D Camera (still very experimental)
scroll in past max zoom to tilt into 3d, keep scrolling for first person, right click and drag to look around. weather, fences, hedges, trees and rocks are all 3d and your held item shows in first person. you can turn it off or change settings in the Config tab.

## Everything else

everything is a card in one of the tabs at the top of the panel:

- **Trackers** - Ability Tracker (procs and coins/hr per pet), XP Tracker (time to max str), Turtle Timer (real finish times with your growth boosts, also shown on the tile card), Crop Boosts, Charged Abilities (cooldowns for Thundercharger, DawnCapture etc), Activity Log (keeps up to 5k entries)
- **Items** - Calculator (crop and pet sell values), Value Display (totals for your silo, hutch, shed and inventory, plus sell price on the tile card)
- **Garden** - Reminders (which plants to place when a mutation weather starts), Insta-Harvest (no more hold to harvest on rainbow/gold), Hold Settings, Super Cleanser (hold a crop cleanser and press space to cleanse every matching crop on the tile, never touches rainbow or gold), Inventory Capacity, Tower Defense, Garden Battleship (1v1 a friend in your room or play the ai)
- **Config** - NPC dialogue (talk to a garden npc and it tells you your restocks, weather and pity progress), Controller, Shop Keybinds, Shop enhancer (buy all in the shop, turns itself off if you have Aries Mod since it already does this), Panel Shortcut, Tutorials, Diagnostics
- **Tools** - Garden Painter (local only texture swaps, with presets), Blobling Customiser, Guide
- **Home** - Public Rooms, and you can add any card here with the + tile

qpm follows whatever language the game is set to, english, german, spanish, french and portuguese for now.

## Bugs / lag

post in the qpm thread in the Magic Circle discord (community-tools > QPM Mod Menu). if its a bug or lag, open Diagnostics in the Config tab, hit **Copy for Discord** and paste it in with what happened, it tells me pretty much everything i need.

## Building it yourself

```bash
git clone https://github.com/mg-tokyo/QPM-GR.git
cd QPM-GR
npm install
npm run build        # builds dist/QPM.user.js
```

other commands: `npm run dev` (rebuilds on save), `npm run typecheck`, `npm run lint`, `npm test`

[CONTRIBUTING.md](CONTRIBUTING.md) has the conventions, [CHANGELOG.md](CHANGELOG.md) has the version history.

## Support

qpm is free and always will be. if you ever feel like tossing something at it theres a [github sponsors](https://github.com/sponsors/mg-tokyo) link, and a ko-fi button in the About window 💜

## License

[MIT](LICENSE) - Copyright (c) 2025 TOKYO.#6464
