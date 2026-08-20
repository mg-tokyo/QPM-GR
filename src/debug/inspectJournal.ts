/**
 * Debug helper to inspect actual journal structure
 * Run in console: QPM.inspectJournal()
 */

import { getAtomByLabel, readAtomValue } from '../core/jotaiBridge';
import { getSlotOwnerId } from '../core/playerContext';

export async function inspectJournal() {
  try {
    const stateAtom = getAtomByLabel('stateAtom');
    if (!stateAtom) {
      console.log('❌ stateAtom not found');
      return;
    }

    const state = await readAtomValue<any>(stateAtom);
    const playerAtom = getAtomByLabel('playerAtom');
    if (!playerAtom) {
      console.log('❌ playerAtom not found');
      return;
    }

    const player = await readAtomValue<any>(playerAtom);
    const playerId = player?.id;

    const slots = state?.child?.data?.userSlots || [];
    let playerSlot: any = null;

    if (Array.isArray(slots)) {
      playerSlot = slots.find((s: any) => getSlotOwnerId(s) === String(playerId));
    } else if (slots && typeof slots === 'object') {
      for (const slot of Object.values(slots)) {
        if (getSlotOwnerId(slot) === String(playerId)) {
          playerSlot = slot;
          break;
        }
      }
    }

    const journal = playerSlot?.data?.journal || playerSlot?.journal;

    if (!journal) {
      console.log('❌ No journal found');
      return;
    }

    console.log('=== JOURNAL STRUCTURE ===');
    console.log('Journal keys:', Object.keys(journal));

    // Inspect produce
    if (journal.produce) {
      console.log('\n=== PRODUCE ENTRIES ===');
      const produceSpecies = Object.keys(journal.produce);
      console.log(`Total species: ${produceSpecies.length}`);

      // Show first entry in detail
      if (produceSpecies.length > 0) {
        const firstSpecies = produceSpecies[0];
        if (firstSpecies) {
          console.log(`\nSample entry (${firstSpecies}):`, journal.produce[firstSpecies]);

          if (journal.produce[firstSpecies]?.variantsLogged) {
            console.log('\nVariants logged for this species:');
            journal.produce[firstSpecies].variantsLogged.forEach((v: any) => {
              console.log(`  - ${v.variant} (collected at: ${v.createdAt})`);
            });
          }
        }
      }

      // Show all unique variant names across all produce
      const allVariants = new Set<string>();
      for (const species of produceSpecies) {
        const entry = journal.produce[species];
        if (entry?.variantsLogged) {
          for (const v of entry.variantsLogged) {
            allVariants.add(v.variant);
          }
        }
      }
      console.log('\n=== ALL UNIQUE PRODUCE VARIANTS IN JOURNAL ===');
      console.log(Array.from(allVariants).sort());
    }

    // Inspect pets
    if (journal.pets) {
      console.log('\n=== PET ENTRIES ===');
      const petSpecies = Object.keys(journal.pets);
      console.log(`Total species: ${petSpecies.length}`);

      // Show first entry in detail
      if (petSpecies.length > 0) {
        const firstSpecies = petSpecies[0];
        if (firstSpecies) {
          console.log(`\nSample entry (${firstSpecies}):`, journal.pets[firstSpecies]);

          if (journal.pets[firstSpecies]?.variantsLogged) {
            console.log('\nVariants logged for this species:');
            journal.pets[firstSpecies].variantsLogged.forEach((v: any) => {
              console.log(`  - ${v.variant} (collected at: ${v.createdAt})`);
            });
          }
        }
      }

      // Show all unique variant names across all pets
      const allVariants = new Set<string>();
      for (const species of petSpecies) {
        const entry = journal.pets[species];
        if (entry?.variantsLogged) {
          for (const v of entry.variantsLogged) {
            allVariants.add(v.variant);
          }
        }
      }
      console.log('\n=== ALL UNIQUE PET VARIANTS IN JOURNAL ===');
      console.log(Array.from(allVariants).sort());
    }

    return journal;
  } catch (error) {
    console.error('Error inspecting journal:', error);
  }
}
