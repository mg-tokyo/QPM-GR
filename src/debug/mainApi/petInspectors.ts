import { getActivePetsDebug } from '../../store/pets';
import { estimatePetLevel, getPetXPHistory } from '../../store/petLevelCalculator';
import { feedPetInstantly, feedPetByIds, feedAllPetsInstantly, isInstantFeedAvailable } from '../../features/pets/instantFeed';
import { getAtomByLabel, readAtomValue } from '../../core/jotaiBridge';

export const petInspectorApi = {
  debugPets: () => {
    const pets = getActivePetsDebug();
    console.log('=== Active Pets Debug (v2024-11-13-DOM-STRENGTH) ===');
    console.table(pets.map(p => ({
      Slot: p.slotIndex,
      Name: p.name || p.species,
      Species: p.species,
      Level: p.level,
      Strength: p.strength,
      TargetScale: p.targetScale,
      Abilities: p.abilities.join(', '),
      Hunger: p.hungerPct ? `${p.hungerPct.toFixed(1)}%` : 'N/A',
    })));
    console.log('Full normalized data:', pets);
    console.log('\n=== Raw Data Inspection ===');
    pets.forEach((p, i) => {
      console.log(`\nPet ${i} (${p.name}):`);
      console.log('Raw object:', p.raw);
      if (p.raw && typeof p.raw === 'object') {
        const raw = p.raw as Record<string, unknown>;
        console.log('Available fields:', Object.keys(raw));
        if (raw.slot && typeof raw.slot === 'object') {
          console.log('slot fields:', Object.keys(raw.slot as Record<string, unknown>));
          console.log('slot.xp:', (raw.slot as Record<string, unknown>).xp);
        }
        if (raw.pet && typeof raw.pet === 'object') {
          console.log('pet fields:', Object.keys(raw.pet as Record<string, unknown>));
        }
      }
    });
    return pets;
  },

  checkTargetScale: () => {
    const pets = getActivePetsDebug();
    console.log('=== TargetScale Analysis ===');
    console.log('Checking if targetScale might be strength-related...\n');

    pets.forEach((p, i) => {
      const targetScale = p.targetScale ?? 0;
      const xp = p.xp ?? 0;

      // Try common formulas to convert targetScale to strength (0-100+ range)
      const possibleStrength1 = Math.round(targetScale * 50); // Scale up by 50
      const possibleStrength2 = Math.round((targetScale - 1) * 100); // Offset and scale
      const possibleStrength3 = Math.round(targetScale * 45 + 5); // Linear transform

      console.log(`Pet ${i}: ${p.name}`);
      console.log(`  XP: ${xp}`);
      console.log(`  TargetScale: ${targetScale.toFixed(6)}`);
      console.log(`  Possible STR (×50): ${possibleStrength1}`);
      console.log(`  Possible STR ((x-1)×100): ${possibleStrength2}`);
      console.log(`  Possible STR (×45+5): ${possibleStrength3}\n`);
    });

    return pets;
  },

  debugSlotInfos: () => {
    try {
      const cache = (window as any).__qpmJotaiAtomCache__;
      const store = (window as any).__qpmJotaiStore__;

      if (!cache || !store) {
        console.error('Jotai cache/store not available');
        return null;
      }

      console.log('=== myPetSlotInfosAtom Data ===');

      // Find the atom
      let slotInfosAtom = null;
      for (const [atom, meta] of cache.entries()) {
        if (meta && typeof meta === 'object' && 'debugLabel' in meta) {
          const label = (meta as any).debugLabel;
          if (label === 'myPetSlotInfosAtom') {
            slotInfosAtom = atom;
            break;
          }
        }
      }

      if (!slotInfosAtom) {
        console.error('myPetSlotInfosAtom not found in cache');
        return null;
      }

      // Get the value
      const value = store.get(slotInfosAtom);
      console.log('Raw value:', value);

      // Try to extract entries
      if (Array.isArray(value)) {
        console.log(`\nFound ${value.length} entries:\n`);
        value.forEach((entry, i) => {
          console.log(`Entry ${i}:`, entry);
          if (entry && typeof entry === 'object') {
            console.log(`  Fields:`, Object.keys(entry));
            if ('slot' in entry && entry.slot && typeof entry.slot === 'object') {
              console.log(`  slot fields:`, Object.keys(entry.slot));
            }
            if ('pet' in entry && entry.pet && typeof entry.pet === 'object') {
              console.log(`  pet fields:`, Object.keys(entry.pet));
            }
            if ('stats' in entry && entry.stats && typeof entry.stats === 'object') {
              console.log(`  stats fields:`, Object.keys(entry.stats));
              console.log(`  stats content:`, entry.stats);
            }
          }
        });
      }

      return value;
    } catch (error) {
      console.error('Failed to inspect myPetSlotInfosAtom:', error);
      return null;
    }
  },

  debugPetInventory: () => {
    try {
      const cache = (window as any).__qpmJotaiAtomCache__;
      const store = (window as any).__qpmJotaiStore__;

      if (!cache || !store) {
        console.error('Jotai cache/store not available');
        return null;
      }

      console.log('=== Pet Inventory & Hutch Atoms ===\n');

      const atomsToCheck = [
        'myPetInventoryAtom',
        'myPetHutchPetItemsAtom',
        'myPrimitivePetSlotsAtom',
        'petInfosAtom'
      ];

      const results: Record<string, any> = {};

      for (const atomLabel of atomsToCheck) {
        console.log(`\n--- ${atomLabel} ---`);

        // Find the atom
        let targetAtom = null;
        for (const [atom, meta] of cache.entries()) {
          if (meta && typeof meta === 'object' && 'debugLabel' in meta) {
            const label = (meta as any).debugLabel;
            if (label === atomLabel) {
              targetAtom = atom;
              break;
            }
          }
        }

        if (!targetAtom) {
          console.log(`${atomLabel} not found`);
          continue;
        }

        try {
          const value = store.get(targetAtom);
          results[atomLabel] = value;
          console.log('Value:', value);

          if (Array.isArray(value) && value.length > 0) {
            const first = value[0];
            if (first && typeof first === 'object') {
              console.log('First entry fields:', Object.keys(first));

              // Check for nested pet/stats/slot
              if ('pet' in first && first.pet && typeof first.pet === 'object') {
                console.log('  pet fields:', Object.keys(first.pet));
                console.log('  pet sample:', first.pet);
              }
              if ('stats' in first && first.stats && typeof first.stats === 'object') {
                console.log('  stats fields:', Object.keys(first.stats));
                console.log('  stats sample:', first.stats);
              }
              if ('slot' in first && first.slot && typeof first.slot === 'object') {
                console.log('  slot fields:', Object.keys(first.slot));
              }
            }
          }
        } catch (error) {
          console.error(`Error reading ${atomLabel}:`, error);
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to inspect pet atoms:', error);
      return null;
    }
  },

  debugLevels: () => {
    try {
      console.log('=== Pet Level Calculation Debug ===\n');

      const pets = getActivePetsDebug();

      pets.forEach((pet, idx) => {
        console.log(`\n--- Pet ${idx}: ${pet.name} (${pet.species}) ---`);
        console.log(`XP: ${pet.xp ?? 'N/A'}`);
        console.log(`Strength: ${pet.strength ?? 'N/A'}`);
        console.log(`Level (Jotai): ${pet.level ?? 'null'}`);

        if (pet.petId) {
          const history = getPetXPHistory(pet.petId);
          console.log(`XP History: ${history.length} samples`);

          if (history.length >= 2) {
            const first = history[0]!;
            const last = history[history.length - 1]!;
            const xpGained = last.xp - first.xp;
            const timeElapsed = (last.timestamp - first.timestamp) / 1000;
            const xpRate = xpGained / timeElapsed;

            console.log(`  First sample: ${first.xp} XP at ${new Date(first.timestamp).toLocaleTimeString()}`);
            console.log(`  Last sample: ${last.xp} XP at ${new Date(last.timestamp).toLocaleTimeString()}`);
            console.log(`  XP gained: ${xpGained.toFixed(0)} over ${timeElapsed.toFixed(0)}s`);
            console.log(`  XP rate: ${xpRate.toFixed(2)} XP/sec`);
          }

          const levelEstimate = estimatePetLevel(pet);
          console.log(`\nLevel Estimate:`);
          console.log(`  Current Level: ${levelEstimate.currentLevel ?? 'N/A'} / ${levelEstimate.maxLevel}`);
          console.log(`  Confidence: ${levelEstimate.confidence}`);
          console.log(`  Total XP Needed: ${levelEstimate.totalXPNeeded?.toFixed(0) ?? 'N/A'}`);
          console.log(`  XP Rate: ${levelEstimate.xpGainRate?.toFixed(2) ?? 'N/A'} XP/sec`);

          if (levelEstimate.totalXPNeeded && pet.xp) {
            const progress = (pet.xp / levelEstimate.totalXPNeeded) * 100;
            console.log(`  Progress: ${progress.toFixed(1)}%`);
          }
        }
      });

      return pets;
    } catch (error) {
      console.error('Failed to debug levels:', error);
      return null;
    }
  },

  // Instant Feed Functions (WebSocket-based)
  feedPet: async (petIndex: number) => {
    console.log(`🍖 Feeding pet at index ${petIndex}...`);
    const result = await feedPetInstantly(petIndex);
    if (result.success) {
      console.log(`✅ Successfully fed ${result.petName || result.petSpecies} with ${result.foodSpecies}`);
    } else {
      console.error(`❌ Failed to feed pet: ${result.error}`);
    }
    return result;
  },

  feedPetByIds: async (petId: string, cropId: string) => {
    console.log(`🍖 Feeding pet ${petId} with crop ${cropId}...`);
    const result = await feedPetByIds(petId, cropId);
    if (result.success) {
      console.log(`✅ Successfully fed pet`);
    } else {
      console.error(`❌ Failed to feed pet: ${result.error}`);
    }
    return result;
  },

  feedAllPets: async (hungerThreshold = 40) => {
    console.log(`🍖 Feeding all pets below ${hungerThreshold}% hunger...`);
    const results = await feedAllPetsInstantly(hungerThreshold);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`✅ Fed ${successful} pets, ${failed} failed`);
    return results;
  },

  isInstantFeedAvailable: () => {
    const available = isInstantFeedAvailable();
    console.log(available ? '✅ Instant feed is available' : '❌ Instant feed is NOT available (RoomConnection missing)');
    return available;
  },

  auditRainbowPets: async () => {
    const readPetAtom = async (label: string): Promise<any[] | null> => {
      const atom = getAtomByLabel(label);
      if (!atom) return null;
      try {
        const value = await readAtomValue<any>(atom);
        if (Array.isArray(value)) return value;
        if (value && Array.isArray((value as any).items)) return (value as any).items;
      } catch (error) {
        console.error(`Failed to read ${label}`, error);
      }
      return null;
    };

    const petAtoms = ['myPetInventoryAtom', 'myPetHutchPetItemsAtom'];
    const results: Record<string, any[]> = {};

    const isRainbow = (item: any) => {
      const raw = item?.raw ?? {};
      const textFields: Array<unknown> = [
        item.rarity,
        item.petRarity,
        item.rarityName,
        item.quality,
        item.variant,
        item.mutation,
        item.name,
        item.petVariant,
        raw.rarity,
        raw.petRarity,
        raw.rarityName,
        raw.quality,
        raw.variant,
        raw.mutation,
        raw.name,
      ];
      if (textFields.some((f) => `${f ?? ''}`.toLowerCase().includes('rainbow'))) return true;
      return item.isRainbow === true || raw.isRainbow === true;
    };

    for (const label of petAtoms) {
      const items = await readPetAtom(label);
      if (!items) continue;
      const hits = [] as Array<{ id: string; targetScale?: number | null; fields: unknown[] }>;
      items.forEach((it: any, idx: number) => {
        const raw = it?.raw ?? {};
        if (isRainbow(it)) {
          hits.push({
            id: String(it.id ?? it.itemId ?? `idx-${idx}`),
            targetScale: Number(it.targetScale ?? raw.targetScale ?? null) || null,
            fields: [it.rarity, it.petRarity, it.rarityName, it.quality, it.variant, it.mutation, it.name, it.petVariant, raw.rarity, raw.petRarity, raw.rarityName, raw.quality, raw.variant, raw.mutation, raw.name],
          });
        }
      });
      results[label] = hits;
      console.log(`Rainbow hits for ${label}:`, hits);
    }
    return results;
  },
};
