import { describe, expect, it } from 'vitest';
import { parsePanelIds, parseShopPanels, parseStoragePanels } from './gamePanelsParsing';

// Exact excerpts of beta pr-4669-gke-2911 (2026-11-17): `playerInteractionAtoms-B27a7oL_.js` and `sessionNoticeLifecycle-Ca2LdKZY.js`.
const PANELS = 'sessionNoticeLifecycle-Ca2LdKZY.js";var l={seedShop:r.Seed,eggShop:r.Egg,toolShop:r.Tool,decorShop:r.Decor,rainShop:r.Rain,dawnShop:r.Dawn,amberShop:r.Amber,snowShop:r.Snow,thunderShop:r.Thunder,apologyShop:r.Apology,spookyShop:r.Spooky,petCosmeticsShop:`petCosmetics`,outfitStation:`outfitStation`,dailyQuests:`dailyQuests`,weatherStation:`weatherStation`,travel:`travel`,petHutch:`petHutch`,decorShed:`decorShed`,seedSilo:`seedSilo`,toolShack:`toolShack`,feedingTrough:`feedingTrough`,journal:`journal`,newspaper:`newspaper`,billboard:`billboard`,petTeams:`petTeams`,pumpkinCarving:`pumpkinCarving`,activityLog:null},u={[r.Seed]:n.Ui.SeedsRestock';
const STORAGES = '?.()!==!1)&&Pc(B,e)}function Rc(){Fc?.()!==!1&&zc()}function zc(){Nc(B)!==null&&Xt(`Button_Modal_Close`),Pc(B,null)}var Bc={PetHutch:`petHutch`,DecorShed:`decorShed`,SeedSilo:`seedSilo`,ToolShack:`toolShack`,FeedingTrough:`feedingTrough`};function Vc(e){return Bc[e]}var Hc=new Set(O';
// Same build: a storage map with other values must not count as the panel table.
const CAPACITY_DECOY = 'Vu={DecorShed:`decorShedCapacitySlotsBySlotIdx`,PetHutch:`petHutchCapacitySlotsBySlotIdx`,SeedSilo:`seedSiloCapacitySlotsBySlotIdx`}';

describe('parsePanelIds (INP-1.4a)', () => {
  it('reads every panel id of the beta table', () => {
    const ids = parsePanelIds(PANELS);
    expect(ids).toHaveLength(27);
    expect(ids).toEqual(expect.arrayContaining(['journal', 'dailyQuests', 'weatherStation', 'petHutch', 'feedingTrough', 'seedShop', 'activityLog']));
  });

  it('accepts double quotes', () => {
    expect(parsePanelIds(PANELS.replace(/`/g, '"'))).toHaveLength(27);
  });

  it('no table, too few ids, or an unclosed object → null', () => {
    expect(parsePanelIds('var a=1;')).toBeNull();
    expect(parsePanelIds('{journal:`journal`,petTeams:`petTeams`}')).toBeNull();
    expect(parsePanelIds(PANELS.slice(0, PANELS.indexOf('activityLog')).replace(/}/g, ''))).toBeNull();
  });
});

// Same build, `installPlayerSystems-CWjoH9In.js`: the ten shop configs with the fields after `secondsAtom` cut, then
// two modal options from the same chunk that are not shop configs.
const SHOP_FIELDS = [['seedShop', 'Seed'], ['eggShop', 'Egg'], ['toolShop', 'Tool'], ['decorShop', 'Decor'], ['rainShop', 'Rain'],
  ['dawnShop', 'Dawn'], ['amberShop', 'Amber'], ['snowShop', 'Snow'], ['thunderShop', 'Thunder'], ['spookyShop', 'Spooky']];
const SHOPS = `headingIcons:IS.map(HS)},qJ={${SHOP_FIELDS.map(([id, type]) =>
  `${id}:{modalName:\`${id}\`,shopType:T.${type},inventoryAtom:Hy,secondsAtom:zy,title:{id:\`cb00zd\`,message:\`New seeds in\`},sort:UJ}`).join(',')}};`
  + 'super(e,t,{modalName:`apologyShop`,zIndex:Wc.shopModal});super(e,t,{modalName:`journal`,zIndex:5})';

describe('parseShopPanels (multi-shop P3)', () => {
  it('reads the ten shop windows in the game order and nothing else', () => {
    expect(parseShopPanels(SHOPS)).toEqual(SHOP_FIELDS.map(([id]) => id));
  });

  it('accepts double quotes', () => {
    expect(parseShopPanels(SHOPS.replace(/`/g, '"'))).toHaveLength(10);
  });

  it('no seed shop config, or too few shops → null', () => {
    expect(parseShopPanels('var a=1;')).toBeNull();
    expect(parseShopPanels(SHOPS.replace('modalName:`seedShop`,shopType', 'modalName:`seedShop`,kind'))).toBeNull();
    expect(parseShopPanels('{modalName:`seedShop`,shopType:T.Seed},{modalName:`eggShop`,shopType:T.Egg}')).toBeNull();
  });
});

describe('parseStoragePanels (INP-1.4a)', () => {
  it('reads the five storage panels', () => {
    expect(parseStoragePanels(STORAGES)?.sort()).toEqual(['decorShed', 'feedingTrough', 'petHutch', 'seedSilo', 'toolShack']);
  });

  it('the capacity map or no table → null', () => {
    expect(parseStoragePanels(CAPACITY_DECOY)).toBeNull();
    expect(parseStoragePanels('var a=1;')).toBeNull();
  });
});
