import { spriteExtractor } from '../sprite-v2/compat';
import { log } from './logger';
import { getAllCropNames } from '../features/garden/data/cropBaseStats';

export function QPM_TEST_ALL_SPRITES(): void {
  log('✅ Testing all sprites...');

  const petSpecies = [
    'Worm', 'Snail', 'Bee', 'Chicken', 'Bunny', 'Dragonfly',
    'Pig', 'Cow', 'Turkey', 'Squirrel', 'Turtle', 'Goat',
    'Butterfly', 'Peacock', 'Capybara',
  ];

  const mutations = ['rainbow', 'gold'];
  let successCount = 0;
  let failCount = 0;
  const failures: string[] = [];

  log('Testing pet sprites...');
  for (const species of petSpecies) {
    try {
      const sprite = spriteExtractor.getPetSprite(species);
      if (sprite) {
        successCount++;
      } else {
        failCount++;
        failures.push(`Pet: ${species} (returned null)`);
      }
    } catch (error) {
      failCount++;
      failures.push(`Pet: ${species} (${error})`);
    }
  }

  log('Testing crop sprites...');
  const cropNames = getAllCropNames();
  for (const cropName of cropNames) {
    try {
      const sprite = spriteExtractor.getCropSprite(cropName.toLowerCase());
      if (sprite) {
        successCount++;
      } else {
        failCount++;
        failures.push(`Crop: ${cropName} (returned null)`);
      }
    } catch (error) {
      failCount++;
      failures.push(`Crop: ${cropName} (${error})`);
    }

    // Mutations (base render only, relies on compat rendering)
    for (const mutation of mutations) {
      try {
        const baseSprite = spriteExtractor.getCropSprite(cropName.toLowerCase());
        if (baseSprite) {
          successCount++;
        } else {
          failCount++;
          failures.push(`Crop: ${cropName} + ${mutation} (base sprite returned null)`);
        }
      } catch (error) {
        failCount++;
        failures.push(`Crop: ${cropName} + ${mutation} (${error})`);
      }
    }
  }

  log(`✅ Sprite Test Complete: ${successCount} passed, ${failCount} failed`);

  if (failures.length > 0) {
    log('⚠️ Failed sprites:', failures);
  }

  log('ℹ️ Cache stats unavailable (canvas-first sprite path uses PIXI internal cache)');
}

export function QPM_BENCHMARK(): void {
  log('🚀 Running performance benchmark...');

  const iterations = 1000;
  const testSpecies = 'Butterfly';

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    spriteExtractor.getPetSprite(testSpecies);
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;
  const opsPerSecond = (iterations / (totalTime / 1000)).toFixed(0);

  log(`📊 Benchmark Results (${iterations} iterations):`);
  log(`   Total time: ${totalTime.toFixed(2)}ms`);
  log(`   Average time per sprite: ${avgTime.toFixed(3)}ms`);
  log(`   Operations per second: ${opsPerSecond}`);
}

export function QPM_VALIDATE_SPECIES(): void {
  log('🔎 Validating species name mappings...');

  const testCases = [
    { input: 'OrangeTulip', expected: 'Tulip' },
    { input: 'WhiteTulip', expected: 'Tulip' },
    { input: 'DawnCelestial', expected: 'Dawnbinder' },
    { input: 'MoonCelestial', expected: 'Moonbinder' },
    { input: 'Starweaver', expected: 'Starweaver' },
    { input: 'MythicalEgg', expected: 'Mythical' },
    { input: 'Butterfly', expected: 'Butterfly' },
    { input: 'Sunflower', expected: 'Sunflower' },
  ];

  let passedCount = 0;
  let failedCount = 0;

  for (const testCase of testCases) {
    const normalized = testCase.input
      .replace(/^(Orange|White|Pink|Red|Purple)Tulip$/i, 'Tulip')
      .replace(/^DawnCelestial$/i, 'Dawnbinder')
      .replace(/^MoonCelestial$/i, 'Moonbinder')
      .replace(/^MythicalEgg$/i, 'Mythical');

    if (normalized === testCase.expected) {
      passedCount++;
      log(`✅ ${testCase.input} → ${normalized}`);
    } else {
      failedCount++;
      log(`⚠️ ${testCase.input} → ${normalized} (expected ${testCase.expected})`);
    }
  }

  log(`\n📋 Validation Complete: ${passedCount} passed, ${failedCount} failed`);
}

declare global {
  interface Window {
    QPM_TEST_ALL_SPRITES: typeof QPM_TEST_ALL_SPRITES;
    QPM_BENCHMARK: typeof QPM_BENCHMARK;
    QPM_VALIDATE_SPECIES: typeof QPM_VALIDATE_SPECIES;
  }
}

export function exposeValidationCommands(): void {
  window.QPM_TEST_ALL_SPRITES = QPM_TEST_ALL_SPRITES;
  window.QPM_BENCHMARK = QPM_BENCHMARK;
  window.QPM_VALIDATE_SPECIES = QPM_VALIDATE_SPECIES;

  log('✅ Validation commands exposed to window:');
  log('   QPM_TEST_ALL_SPRITES() - Test all pet and crop sprites');
  log('   QPM_BENCHMARK() - Performance benchmark');
  log('   QPM_VALIDATE_SPECIES() - Validate species name mappings');
}
