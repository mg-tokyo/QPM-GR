import { describe, expect, it } from 'vitest';
import { extractSpriteEnumFromText, resolveSpriteEnumRefs } from './spriteEnumText';

// Excerpt of the game 1686 AsyncEpoch-*.js table head (categories trimmed to a few names each).
const SPRITE_ENUM_CHUNK = 'AmberMoon=`AmberMoon`,e}({}),ft=i(G),pt={'
  + 'Animation:{ActivationTile:`sprite/animation/ActivationTile`,"CelestialActive-0":`sprite/animation/CelestialActive-0`},'
  + 'Decor:{Birdhouse:`sprite/decor/Birdhouse`,SmallRock:`sprite/decor/SmallRock`,MediumRock:`sprite/decor/MediumRock`,LargeRock:`sprite/decor/LargeRock`},'
  + 'Item:{WateringCan:`sprite/item/WateringCan`,PlanterPot:`sprite/item/PlanterPot`},'
  + 'Mutation:{Wet:`sprite/mutation/Wet`,Chilled:`sprite/mutation/Chilled`,Frozen:`sprite/mutation/Frozen`},'
  + 'MutationOverlay:{WetTallPlant:`sprite/mutation-overlay/WetTallPlant`},'
  + 'Pet:{CommonEgg:`sprite/pet/CommonEgg`,Worm:`sprite/pet/Worm`},'
  + 'PetCosmetic:{Ascot:`sprite/pet-cosmetic/Ascot`},'
  + 'Plant:{BabyCarrot:`sprite/plant/BabyCarrot`,Carrot:`sprite/plant/Carrot`},'
  + 'Seed:{Carrot:`sprite/seed/Carrot`},'
  + 'Ui:{MutationWet:`sprite/ui/MutationWet`}},mt=1;';

describe('extractSpriteEnumFromText', () => {
  it('parses the table, quoted keys included', () => {
    const table = extractSpriteEnumFromText(SPRITE_ENUM_CHUNK);
    expect(table?.Mutation?.Wet).toBe('sprite/mutation/Wet');
    expect(table?.MutationOverlay?.WetTallPlant).toBe('sprite/mutation-overlay/WetTallPlant');
    expect(table?.Animation?.['CelestialActive-0']).toBe('sprite/animation/CelestialActive-0');
    expect(Object.keys(table ?? {})).toHaveLength(10);
  });

  it('walks back to the table from a later category head', () => {
    const emptyFirst = SPRITE_ENUM_CHUNK.replace(/Animation:\{[^}]*\}/, 'Animation:{}');
    expect(extractSpriteEnumFromText(emptyFirst)?.Seed?.Carrot).toBe('sprite/seed/Carrot');
    const refFirst = SPRITE_ENUM_CHUNK.replace('ActivationTile:`sprite/animation/ActivationTile`', 'ActivationTile:k.Other');
    expect(extractSpriteEnumFromText(refFirst)).toBeNull();
  });

  it('rejects lookalike tables with too few categories or non-path values', () => {
    expect(extractSpriteEnumFromText('x={Mutation:{Wet:`sprite/mutation/Wet`},Ui:{A:`sprite/ui/A`}}')).toBeNull();
    const mixed = SPRITE_ENUM_CHUNK.replace('Seed:{Carrot:`sprite/seed/Carrot`}', 'Seed:{Carrot:`Carrot`}');
    expect(extractSpriteEnumFromText(mixed)).toBeNull();
    expect(extractSpriteEnumFromText('var a={Gold:{name:`Gold`}}')).toBeNull();
  });
});

describe('resolveSpriteEnumRefs', () => {
  const table = extractSpriteEnumFromText(SPRITE_ENUM_CHUNK)!;

  it('replaces refs the table knows and leaves the rest', () => {
    const block = '{Wet:{name:`Wet`,sprite:k.Mutation.Wet},Rock:{art:k.Decor.SmallRock,rarity:L.Common,x:k.Mutation.Missing}}';
    expect(resolveSpriteEnumRefs(block, table)).toBe(
      '{Wet:{name:`Wet`,sprite:"sprite/mutation/Wet"},Rock:{art:"sprite/decor/SmallRock",rarity:L.Common,x:k.Mutation.Missing}}',
    );
  });
});
