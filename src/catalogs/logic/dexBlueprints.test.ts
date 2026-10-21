import { describe, expect, it } from 'vitest';
import { extractDexFromText } from './dexBlueprints';
import { extractSpriteEnumFromText } from './spriteEnumText';

// Game 1686 literal shapes (modalAtom-*.js), padded with renamed copies to clear each dex's entry floor.
const pad = (entry: string, id: string, n: number): string =>
  Array.from({ length: n }, (_v, i) => entry.split(id).join(`${id}X${i}`)).join(',');

const WET = 'Wet:{name:`Wet`,baseChance:0,coinMultiplier:2,group:`Hydro`,sprite:k.Mutation.Wet}';
const MUTATIONS = 'wo={Gold:{name:`Gold`,baseChance:.01,coinMultiplier:25,group:`Growth`},'
  + `${WET},Chilled:{name:\`Chilled\`,baseChance:0,coinMultiplier:2,group:\`Hydro\`,sprite:k.Mutation.Chilled},`
  + `Rainbow:{name:\`Rainbow\`,baseChance:.001,coinMultiplier:50,group:\`Growth\`},${pad(WET, 'Wet', 6)}}`;

const CARROT = 'Carrot:{name:`Carrot`,seed:{sprite:k.Seed.Carrot,name:`Carrot Seed`,eligibleShops:[T.Seed],coinPrice:10,creditPrice:7,rarity:L.Common},'
  + 'plant:{sprite:k.Plant.BabyCarrot,name:`Carrot Plant`,harvestType:V.Single,baseTileScale:.7},'
  + 'crop:{sprite:k.Plant.Carrot,name:`Carrot`,baseSellPrice:20,baseWeight:.1,baseTileScale:.6,maxScale:3}}';
const PLANTS = `Ln={${CARROT},${pad(CARROT, 'Carrot', 20)}}`;

const WORM = 'Worm:{name:`Worm`,coinsToFullyReplenishHunger:500,innateAbilityWeights:{SeedFinderI:50,ProduceEater:50},'
  + 'maxScale:2,hoursToMature:12,rarity:L.Common,tileTransformOrigin:`bottom`,diet:[`Strawberry`,`Carrot`]}';
const PETS = `var W={${WORM},${pad(WORM, 'Worm', 20)}}`;

const ROCK = (id: string): string => `${id}:{art:k.Decor.${id},name:\`Small Garden Rock\`,shopName:\`Small Rock\`,eligibleShops:[T.Decor],`
  + 'coinPrice:1e3,creditPrice:2,rarity:L.Common,isOneTimePurchase:!1,avatarNudgeY:-.06,depthBehavior:Fi.Ground}';
const DECOR = `Dd={${ROCK('SmallRock')},${ROCK('MediumRock')},${ROCK('LargeRock')}}`;

const TABLE = extractSpriteEnumFromText('pt={'
  + 'Decor:{SmallRock:`sprite/decor/SmallRock`,MediumRock:`sprite/decor/MediumRock`,LargeRock:`sprite/decor/LargeRock`},'
  + 'Mutation:{Wet:`sprite/mutation/Wet`,Chilled:`sprite/mutation/Chilled`},'
  + 'Pet:{CommonEgg:`sprite/pet/CommonEgg`},'
  + 'Plant:{BabyCarrot:`sprite/plant/BabyCarrot`,Carrot:`sprite/plant/Carrot`},'
  + 'Seed:{Carrot:`sprite/seed/Carrot`}}');

describe('extractDexFromText with the sprite enum', () => {
  it('fixture table parses', () => {
    expect(TABLE).not.toBeNull();
  });

  it('resolves mutation sprites to their paths', () => {
    const map = extractDexFromText(MUTATIONS, 'mutationCatalog', TABLE);
    expect(map?.Wet?.sprite).toBe('sprite/mutation/Wet');
    expect(map?.Chilled?.sprite).toBe('sprite/mutation/Chilled');
    expect(map?.Gold).not.toHaveProperty('sprite');
    // Unresolvable refs (WetX0 has no table entry) are dropped, never kept as bare names.
    expect(map?.WetX0).not.toHaveProperty('sprite');
  });

  it('resolves stage-level plant sprites', () => {
    const carrot = extractDexFromText(PLANTS, 'plantCatalog', TABLE)?.Carrot;
    expect((carrot?.seed as Record<string, unknown>).sprite).toBe('sprite/seed/Carrot');
    expect((carrot?.plant as Record<string, unknown>).sprite).toBe('sprite/plant/BabyCarrot');
    expect((carrot?.crop as Record<string, unknown>).sprite).toBe('sprite/plant/Carrot');
  });

  it('resolves decor art and leaves a sprite-less pet entry without one', () => {
    expect(extractDexFromText(DECOR, 'decorCatalog', TABLE)?.SmallRock?.art).toBe('sprite/decor/SmallRock');
    const worm = extractDexFromText(PETS, 'petCatalog', TABLE)?.Worm;
    expect(worm?.name).toBe('Worm');
    expect(worm).not.toHaveProperty('sprite');
  });

  it('keeps entries priced with the 1/0 Infinity idiom', () => {
    const shed = 'DecorShed:{art:k.Decor.SmallRock,name:`Decor Shed`,coinPrice:1/0,creditPrice:249,rarity:L.Divine}';
    const map = extractDexFromText(DECOR.replace(/\}$/, `,${shed}}`), 'decorCatalog', TABLE);
    expect(map?.DecorShed?.coinPrice).toBe(Infinity);
  });

  it('drops sprite fields when no table is given', () => {
    expect(extractDexFromText(MUTATIONS, 'mutationCatalog')?.Wet).not.toHaveProperty('sprite');
    expect(extractDexFromText(DECOR, 'decorCatalog')?.SmallRock).not.toHaveProperty('art');
  });
});
