import type { TargetRecipe } from './types';

export const TARGET_RECIPES: TargetRecipe[] = [
  // ── Core Scene Structure (Pixi) ──────────────────────────────────
  { id: 'scene.world', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'World', weight: 3 }], minConfidence: 0.55 },
  { id: 'scene.ui', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'UI', weight: 3 }], minConfidence: 0.55 },
  { id: 'scene.camera', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'Camera', weight: 3 }], minConfidence: 0.55 },
  { id: 'scene.ground', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'Ground', weight: 3 }], minConfidence: 0.55 },
  { id: 'scene.aboveGround', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'AboveGround', weight: 3 }], minConfidence: 0.55 },
  { id: 'game.canvas', sources: ['dom'], requiredSignals: [{ type: 'typeIncludes', value: 'canvas', weight: 3 }], minConfidence: 0.8 },

  // ── Inventory (Pixi) ─────────────────────────────────────────────
  { id: 'inventory.modal', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'InventoryModal', weight: 3 }], minConfidence: 0.55 },
  { id: 'inventory.content', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'InventoryContent', weight: 3 }], minConfidence: 0.55 },
  { id: 'inventory.grid', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'InventoryContent', weight: 3 }, { type: 'minChildren', value: 1, weight: 1 }], minConfidence: 0.55 },
  { id: 'inventory.scroll', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'InventoryScrollView', weight: 3 }], minConfidence: 0.55 },
  { id: 'inventory.item', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'InventoryItemVisual', weight: 3 }, { type: 'interactive', value: true, weight: 1 }], minConfidence: 0.55 },
  { id: 'inventory.selectedLayer', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'InventorySelectedItemLayer', weight: 3 }], minConfidence: 0.55 },
  { id: 'inventory.card', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'InventoryCardVisual', weight: 3 }], minConfidence: 0.55 },
  { id: 'inventory.cardPreview', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'InventoryCardPreview', weight: 3 }], minConfidence: 0.55 },
  { id: 'inventory.filter', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'FilterContainer', weight: 3 }], minConfidence: 0.55 },
  { id: 'inventory.sort', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'SortDropdownMenu', weight: 3 }], minConfidence: 0.55 },

  // ── Storage (Pixi) ───────────────────────────────────────────────
  { id: 'storage.modal', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'StorageModal', weight: 3 }], minConfidence: 0.55 },
  { id: 'storage.content', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'StorageContent', weight: 3 }], minConfidence: 0.55 },
  { id: 'storage.scroll', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'StorageScrollView', weight: 3 }], minConfidence: 0.55 },
  { id: 'storage.selectedLayer', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'StorageSelectedItemLayer', weight: 3 }], minConfidence: 0.55 },

  // ── Journal (Pixi) ───────────────────────────────────────────────
  { id: 'journal.modal', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'JournalModal', weight: 3 }], minConfidence: 0.55 },
  { id: 'journal.content', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'JournalContent', weight: 3 }], minConfidence: 0.55 },
  { id: 'journal.overview', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'JournalOverviewPage', weight: 3 }], minConfidence: 0.55 },
  { id: 'journal.species', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'JournalSpeciesPage', weight: 3 }], minConfidence: 0.55 },
  { id: 'journal.tabs', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'JournalTabs', weight: 3 }], minConfidence: 0.55 },

  // ── Plants & Crops (Pixi) ────────────────────────────────────────
  { id: 'plant.body', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: 'PlantBody$', weight: 3 }], minConfidence: 0.50 },
  { id: 'plant.byName', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: 'PlantBody$', weight: 3 }], minConfidence: 0.50 },
  { id: 'plant.crop', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'CropVisual', weight: 3 }], minConfidence: 0.55 },
  { id: 'plant.area', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'AreaIndicator', weight: 3 }], minConfidence: 0.55 },

  // ── Buildings (Pixi) ─────────────────────────────────────────────
  { id: 'building.any', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: '^Building \\(', weight: 3 }], minConfidence: 0.50 },
  { id: 'building.byId', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: '^Building \\(', weight: 3 }], minConfidence: 0.50 },

  // ── Pets (Pixi) ──────────────────────────────────────────────────
  { id: 'pet.any', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: '^Pet: ', weight: 3 }], minConfidence: 0.50 },
  { id: 'pet.byName', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: '^Pet: ', weight: 3 }], minConfidence: 0.50 },
  { id: 'pet.slots', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'PetSlots', weight: 3 }], minConfidence: 0.55 },
  { id: 'pet.actions', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'PetActionButtons', weight: 3 }], minConfidence: 0.55 },
  { id: 'pet.hungerBar', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'HungerBar', weight: 3 }], minConfidence: 0.55 },

  // ── Avatars (Pixi) ───────────────────────────────────────────────
  { id: 'avatar.any', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: '^AvatarContainer ', weight: 3 }], minConfidence: 0.50 },
  { id: 'avatar.byId', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: '^AvatarContainer ', weight: 3 }], minConfidence: 0.50 },
  { id: 'avatar.heldItem', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'HeldItemVisual', weight: 3 }], minConfidence: 0.55 },

  // ── Decorations (Pixi) ───────────────────────────────────────────
  { id: 'decor.any', sources: ['pixi'], requiredSignals: [{ type: 'labelPattern', value: 'Container$', weight: 3 }], minConfidence: 0.50 },

  // ── Tooltips & Overlays (Pixi) ───────────────────────────────────
  { id: 'tooltip.root', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'PixiTooltip', weight: 3 }], minConfidence: 0.55 },
  { id: 'tooltip.content', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'TooltipContent', weight: 3 }], minConfidence: 0.55 },
  { id: 'overlay.weather', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'Weather', weight: 3 }], minConfidence: 0.55 },
  { id: 'overlay.vignette', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'Vignette', weight: 3 }], minConfidence: 0.55 },

  // ── DOM Buttons ──────────────────────────────────────────────────
  { id: 'button.byText', sources: ['dom'], requiredSignals: [{ type: 'interactive', value: true, weight: 2 }], minConfidence: 0.80 },
  { id: 'button.partyMenu', sources: ['dom'], requiredSignals: [{ type: 'labelIncludes', value: 'Party Menu', weight: 3 }, { type: 'interactive', value: true, weight: 1 }], minConfidence: 0.70 },
  { id: 'button.feed', sources: ['dom'], requiredSignals: [{ type: 'labelPattern', value: '^Feed', weight: 3 }, { type: 'interactive', value: true, weight: 1 }], minConfidence: 0.70 },
  { id: 'button.close', sources: ['dom'], requiredSignals: [{ type: 'labelPattern', value: '^Close', weight: 3 }, { type: 'interactive', value: true, weight: 1 }], minConfidence: 0.70 },

  // ── DOM Modals/Overlays ──────────────────────────────────────────
  { id: 'dialog.any', sources: ['dom'], requiredSignals: [{ type: 'typeIncludes', value: 'dialog', weight: 2 }], minConfidence: 0.78 },
  { id: 'shop.modal', sources: ['dom'], requiredSignals: [{ type: 'textIncludesAny', value: ['Shop', 'Seeds', 'Restock'], weight: 3 }], minConfidence: 0.80 },

  // ── Dev/Debug (Pixi) ─────────────────────────────────────────────
  { id: 'debug.overlay', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'DebugOverlay', weight: 3 }], minConfidence: 0.55 },
  { id: 'debug.devTool', sources: ['pixi'], requiredSignals: [{ type: 'labelEquals', value: 'DevToolModal', weight: 3 }], minConfidence: 0.55 },
];

export function getTargetRecipe(id: string): TargetRecipe | null {
  return TARGET_RECIPES.find((recipe) => recipe.id === id) ?? null;
}
