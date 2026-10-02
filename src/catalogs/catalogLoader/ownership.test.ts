import { describe, expect, it } from 'vitest';
import { parseOwnedCosmetics } from './ownership';

describe('parseOwnedCosmetics', () => {
  it('reads the v1361 plain-filename array', () => {
    const owned = parseOwnedCosmetics(['Bottom_HazmatSuit.png', 'Mid_Ladybug.png', 'Top_Brain.png']);
    expect(owned && [...owned]).toEqual(['Bottom_HazmatSuit.png', 'Mid_Ladybug.png', 'Top_Brain.png']);
  });

  it('still reads {cosmeticFilename} rows and skips unusable entries', () => {
    const owned = parseOwnedCosmetics([{ cosmeticFilename: 'Expression_Alarmed.png' }, 'Mid_Ladybug.png', 42, null, { other: 'x' }]);
    expect(owned && [...owned]).toEqual(['Expression_Alarmed.png', 'Mid_Ladybug.png']);
  });

  it('returns null for a non-array body', () => {
    expect(parseOwnedCosmetics({ cosmetics: [] })).toBeNull();
    expect(parseOwnedCosmetics(null)).toBeNull();
  });
});
