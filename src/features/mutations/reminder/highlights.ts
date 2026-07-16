import { $$ } from '../../../utils/dom/dom';
import { reminderState } from './state';
import { scanInventoryForPlants } from './domScan';
import { generatePlantId } from './evaluator';
import { reminderDiag } from './_diagnostics';
import type { PlantData } from './types';

/** Restores highlights after inventory DOM recreation (e.g. reopening). */
export async function reapplyHighlights(): Promise<void> {
  if (reminderState.highlightedPlantIds.size === 0) {
    reminderDiag.debug('No highlights to reapply');
    return;
  }

  reminderDiag.debug(`Reapplying highlights for ${reminderState.highlightedPlantIds.size} tracked plants`);

  const plants = await scanInventoryForPlants();
  if (plants.length === 0) {
    reminderDiag.debug('No plants found in inventory for reapply');
    return;
  }

  const plantsToHighlight = plants.filter(plant => {
    const plantId = generatePlantId(plant);
    return reminderState.highlightedPlantIds.has(plantId);
  });

  if (plantsToHighlight.length > 0) {
    reminderDiag.debug(`Reapplying ${plantsToHighlight.length} highlights`);
    highlightPlants(plantsToHighlight);
  } else {
    reminderDiag.debug('None of the tracked plants found in current inventory');
  }
}

export function highlightPlants(plants: PlantData[]): void {
  for (const plant of plants) {
    const plantId = generatePlantId(plant);

    if (!reminderState.highlightedPlantIds.has(plantId)) {
      continue;
    }

    const parent = plant.element.parentElement;
    if (!parent) continue;

    const existingHighlight = parent.querySelector('.quinoa-mutation-highlight');
    if (existingHighlight) {
      continue;
    }

    const highlight = document.createElement('div');
    highlight.className = 'quinoa-mutation-highlight';
    highlight.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border: 3px solid #4CAF50;
      border-radius: 8px;
      pointer-events: auto;
      z-index: 10;
      animation: quinoa-pulse 1.5s infinite;
      box-shadow: 0 0 15px rgba(76, 175, 80, 0.8);
      cursor: pointer;
    `;

    // Stored so the click handler below knows which plant to unhighlight
    (highlight as any).__plantId = plantId;

    highlight.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (highlight as any).__plantId;
      if (id) {
        reminderState.highlightedPlantIds.delete(id);
        reminderDiag.debug(`Manually removed highlight from ${plant.name}`);
      }
      highlight.remove();
    });

    parent.style.position = 'relative';
    parent.appendChild(highlight);
  }

  if (!document.getElementById('quinoa-mutation-styles')) {
    const style = document.createElement('style');
    style.id = 'quinoa-mutation-styles';
    style.textContent = `
      @keyframes quinoa-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);
  }
}

export function clearHighlights(): void {
  const existingHighlights = $$('.quinoa-mutation-highlight');
  existingHighlights.forEach(el => el.remove());
  reminderState.highlightedPlantIds.clear();
  reminderDiag.debug('Cleared plant highlights');
}
