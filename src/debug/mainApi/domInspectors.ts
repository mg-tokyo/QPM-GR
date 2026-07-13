import { getActivePetsDebug } from '../../store/pets';

export const domInspectorApi = {
  searchPageWindow: () => {
    try {
      const pageWin = (window as any).unsafeWindow || window;
      console.log('=== Searching Page Window for Pet Data ===\n');

      // Check common locations
      const locations = [
        'myData',
        'myPets',
        'activePets',
        'petData',
        'pets',
        'UnifiedState',
        'gameState',
        'quinoaData'
      ];

      const found: Record<string, any> = {};

      for (const loc of locations) {
        if (loc in pageWin) {
          console.log(`\nFound: ${loc}`);
          const value = pageWin[loc];
          console.log('Type:', typeof value);

          if (value && typeof value === 'object') {
            console.log('Keys:', Object.keys(value).slice(0, 20));
            found[loc] = value;

            // Look for pet-related nested data
            if ('pets' in value) {
              console.log('  → has pets property:', value.pets);
            }
            if ('activePets' in value) {
              console.log('  → has activePets property:', value.activePets);
            }
            if ('inventory' in value && value.inventory) {
              console.log('  → has inventory property');
              const inv = value.inventory;
              if (inv && typeof inv === 'object' && 'items' in inv) {
                const items = (inv as any).items;
                if (Array.isArray(items)) {
                  console.log(`  → inventory has ${items.length} items`);
                  // Look for pets in inventory
                  const petItems = items.filter((item: any) =>
                    item && typeof item === 'object' &&
                    (item.itemType === 'Pet' || item.type === 'Pet' || 'petSpecies' in item || 'species' in item)
                  );
                  if (petItems.length > 0) {
                    console.log(`  → Found ${petItems.length} pet items in inventory`);
                    console.log('  → First pet item:', petItems[0]);
                    console.log('  → First pet fields:', Object.keys(petItems[0]));
                  }
                }
              }
            }
          }
        }
      }

      // Search all window properties for pet-related data
      console.log('\n=== Searching all window properties ===');
      const allKeys = Object.keys(pageWin).filter(k =>
        k.toLowerCase().includes('pet') ||
        k.toLowerCase().includes('animal') ||
        k.toLowerCase().includes('creature')
      );
      console.log('Pet-related keys:', allKeys);

      return found;
    } catch (error) {
      console.error('Failed to search page window:', error);
      return null;
    }
  },

  inspectPetCards: () => {
    try {
      console.log('=== Inspecting Pet Card UI Elements ===\n');

      // Look for pet cards on the left side of screen
      const petCardSelectors = [
        '[data-pet-slot]',
        '[data-pet-id]',
        '[data-slot-index]',
        '.pet-card',
        '.pet-slot',
        '[class*="pet"]',
        '[class*="Pet"]'
      ];

      const foundElements: HTMLElement[] = [];

      for (const selector of petCardSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          elements.forEach(el => {
            if (el instanceof HTMLElement && !foundElements.includes(el)) {
              foundElements.push(el);
            }
          });
        }
      }

      console.log(`\nTotal unique pet card elements found: ${foundElements.length}\n`);

      foundElements.slice(0, 10).forEach((el, idx) => {
        console.log(`\n--- Element ${idx} ---`);
        console.log('Tag:', el.tagName);
        console.log('Classes:', el.className);
        console.log('Text content:', el.textContent?.substring(0, 200));
        console.log('Data attributes:', Object.keys(el.dataset));

        // Try to extract level/strength from text
        const text = el.textContent || '';
        const levelMatch = text.match(/(?:level|lvl|lv)[:\s]*(\d+)/i);
        const strMatch = text.match(/(?:str|strength)[:\s]*(\d+)/i);
        const ageMatch = text.match(/(?:age)[:\s]*(\d+)/i);

        if (levelMatch) console.log('  → Found level:', levelMatch[1]);
        if (strMatch) console.log('  → Found strength:', strMatch[1]);
        if (ageMatch) console.log('  → Found age:', ageMatch[1]);
      });

      return foundElements;
    } catch (error) {
      console.error('Failed to inspect pet cards:', error);
      return null;
    }
  },

  findPetDataInDOM: () => {
    try {
      console.log('=== Searching DOM for Pet Level/Strength Data ===\n');

      const pets = getActivePetsDebug();
      const petNames = pets.map(p => p.name).filter(Boolean);

      console.log('Looking for pets:', petNames);

      // Search for elements containing pet names or level/strength keywords
      const allElements = document.querySelectorAll('*');
      const relevantElements: Array<{el: Element, reason: string}> = [];

      for (const el of allElements) {
        const text = el.textContent?.toLowerCase() || '';

        // Skip if too much text (likely container)
        if (text.length > 500) continue;

        // Check for pet names
        for (const name of petNames) {
          if (name && text.includes(name.toLowerCase())) {
            relevantElements.push({el, reason: `Contains pet name: ${name}`});
            break;
          }
        }

        // Check for level/age/strength keywords
        if (/\b(age|level|lvl|lv|str|strength|max str)\b/i.test(text)) {
          relevantElements.push({el, reason: 'Contains level/strength keywords'});
        }
      }

      console.log(`\nFound ${relevantElements.length} potentially relevant elements\n`);

      // Show up to 15 most relevant elements
      relevantElements.slice(0, 15).forEach(({el, reason}, idx) => {
        console.log(`\n--- Element ${idx} ---`);
        console.log('Reason:', reason);
        console.log('Tag:', el.tagName);
        console.log('Classes:', el.className);
        console.log('Text (first 300 chars):', el.textContent?.substring(0, 300));

        // Try to extract numeric values
        const text = el.textContent || '';
        const ageMatch = text.match(/age[:\s]*(\d+)/i);
        const strMatch = text.match(/(?:max\s+)?str[:\s]*(\d+)/i);
        const levelMatch = text.match(/(?:level|lvl|lv)[:\s]*(\d+)/i);

        if (ageMatch) console.log('  ✓ Age:', ageMatch[1]);
        if (strMatch) console.log('  ✓ Strength:', strMatch[1]);
        if (levelMatch) console.log('  ✓ Level:', levelMatch[1]);
      });

      return relevantElements;
    } catch (error) {
      console.error('Failed to search DOM:', error);
      return null;
    }
  },

  extractStrengthFromUI: () => {
    try {
      console.log('=== Extracting Strength from Pet Card UI ===\n');

      const pets = getActivePetsDebug();
      const results: Array<{pet: string, strength: number | null, element: Element | null}> = [];

      // Search for elements containing "STR XX" pattern
      const allElements = Array.from(document.querySelectorAll('*'));

      for (const pet of pets) {
        const petName = pet.name || pet.species || `Pet ${pet.slotIndex}`;
        let foundStrength: number | null = null;
        let foundElement: Element | null = null;

        // Look for elements with text matching "STR \d+"
        for (const el of allElements) {
          const text = el.textContent || '';

          // Skip containers with too much text
          if (text.length > 100) continue;

          // Look for "STR XX" pattern
          const strMatch = text.match(/\bSTR\s+(\d+)\b/i);
          if (strMatch && strMatch[1]) {
            const strength = parseInt(strMatch[1], 10);

            // Check if this element is near the pet's position/slot
            // For now, just collect all STR values and log them
            console.log(`Found STR ${strength} in element:`, el);
            console.log('  Tag:', el.tagName);
            console.log('  Classes:', el.className);
            console.log('  Text:', text.trim());
            console.log('  Parent:', el.parentElement?.className);

            // Try to match by order (first STR found = first pet, etc)
            if (!foundStrength) {
              foundStrength = strength;
              foundElement = el;
            }
          }
        }

        results.push({
          pet: petName,
          strength: foundStrength,
          element: foundElement
        });
      }

      console.log('\n=== Extracted Strength Values ===');
      console.table(results.map(r => ({
        Pet: r.pet,
        Strength: r.strength ?? 'Not found'
      })));

      return results;
    } catch (error) {
      console.error('Failed to extract strength from UI:', error);
      return null;
    }
  },
};
