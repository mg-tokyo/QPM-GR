import type { SpriteCategory } from '../../../sprite-v2/types';
import type { SpriteInventoryEntry } from '../../../sprite-v2/compat';
import type { TextureOverrideRule } from '../../../features/standalone/textureSwapper';
import type { RuleScope } from '../../../features/standalone/textureSwapper/types';
import { isDevModeEnabled } from '../../../core/devMode';

export type { SpriteCategory };

export const WINDOW_ID = 'texture-swapper';

export type CategoryTab = {
  label: string;
  categories: SpriteCategory[];
  // Dev-only tabs cover sprite categories outside the typed SpriteCategory
  // enum (ui, mutation, object, animation, winter). When present, the browse
  // grid uses getSpriteInventory() + this predicate instead of svc.list(),
  // and skips species-lock gating (journal unlocks don't apply here).
  devScan?: (entry: SpriteInventoryEntry) => boolean;
};

export const CATEGORY_TABS: CategoryTab[] = [
  { label: 'feature.gardenPainter.plants', categories: ['plant', 'tallplant', 'crop'] },
  { label: 'feature.gardenPainter.pets', categories: ['pet'] },
  { label: 'feature.gardenPainter.seeds', categories: ['seed'] },
  { label: 'feature.gardenPainter.items', categories: ['item'] },
  { label: 'feature.gardenPainter.catDecor', categories: ['decor'] },
];

const DEV_CATEGORY_TABS: CategoryTab[] = [
  { label: 'UI',      categories: [], devScan: (e) => e.category === 'ui' || e.category === 'mutation' || e.category === 'mutation-overlay' },
  { label: 'World',   categories: [], devScan: (e) => e.category === 'object' || e.category === 'animation' },
  { label: 'Weather', categories: [], devScan: (e) => e.category === 'winter' || /weather|storm|rain|snow|thunder|dawn|amber/i.test(e.id) },
];

export function getVisibleCategoryTabs(): CategoryTab[] {
  return isDevModeEnabled() ? [...CATEGORY_TABS, ...DEV_CATEGORY_TABS] : CATEGORY_TABS;
}

export type MutationGroup = {
  label: string;
  mutations: string[];
};

export const MUTATION_GROUPS: MutationGroup[] = [
  { label: 'feature.gardenPainter.specialMutations', mutations: ['None'] },
  { label: 'feature.gardenPainter.growthMutations', mutations: ['Gold', 'Rainbow'] },
  { label: 'feature.gardenPainter.weatherMutations', mutations: ['Wet', 'Chilled', 'Frozen', 'Thunderstruck'] },
  { label: 'feature.gardenPainter.lunarMutations', mutations: ['Dawnlit', 'Dawncharged', 'Ambershine', 'Ambercharged'] },
];

export const MUTATION_COLORS: Record<string, string> = {
  None: '#888888',
  Gold: '#f0c040',
  Rainbow: '#c084fc',
  Wet: '#81d4fa',
  Chilled: '#81d4fa',
  Frozen: '#64b5f6',
  Thunderstruck: '#ffeb3b',
  Dawnlit: '#ffb74d',
  Dawncharged: '#ffb74d',
  Ambershine: '#ff9800',
  Ambercharged: '#ff9800',
};

export type GridMode = 'browse' | 'swap-pick' | 'mutation-pick';

export type RuleType = 'swap' | 'mutation' | 'transparency' | 'legacy';

export function getRuleType(rule: TextureOverrideRule): RuleType {
  if (rule.source.librarySpriteKey || rule.source.uploadAssetId) return 'swap';
  if (rule.cosmeticMutations?.length) return 'mutation';
  if (rule.params.alpha != null && rule.params.alpha !== 1) return 'transparency';
  if (rule.params.tintColor || rule.params.scaleX != null || rule.params.scaleY != null) return 'legacy';
  return 'transparency';
}

export interface WindowState {
  activeTabIndex: number;
  searchFilter: string;
  selectedSpriteKey: string;
  gridMode: GridMode;
  pickerTargetKey: string;
  /** Rule being edited, or null if creating new */
  editingRuleId: string | null;
  pickerSwapKey: string;
  pickerSwapTab: 'game' | 'upload';
  pickerSwapCategory: number;
  pickerMutations: string[];
  previewSwapKey: string;
  advancedOpen: boolean;
  /**
   * Selected crop slot index for the Advanced section. `null` = "All slots"
   * (rule with no slotIndex). A non-null value pairs the Advanced controls
   * to that specific slot's rule. Only meaningful when the selected sprite
   * is a multi-harvest crop with more than one slot.
   */
  advancedSlotIndex: number | null;
  editorTab: 'swap' | 'mutations' | 'transparency' | 'tintsize';
  editorScope: RuleScope;
  tileComponents: TileComponent[] | null;
  /**
   * objectType of the currently scoped tile (`plant`, `egg`, `decor`) when
   * `editorScope.kind === 'tile'`. Null when no tile is scoped or unknown.
   * Used by `buildTileComponents` to pick the correct sprite-key branch.
   */
  tileObjectType: string | null;
  /**
   * For multi-harvest plants picked from the tile grid: the number of
   * currently filled crop slots on the live tile. Caps the "Crop N" tabs so
   * the editor only shows slots that actually hold fruit. Null = unknown,
   * fall back to blueprint slot count.
   */
  tileLiveSlotCount: number | null;
}

export interface TileComponent {
  label: string;
  spriteKey: string;
  slotIndex: number | null;
}

export function defaultState(): WindowState {
  return {
    activeTabIndex: 0,
    searchFilter: '',
    selectedSpriteKey: '',
    gridMode: 'browse',
    pickerTargetKey: '',
    editingRuleId: null,
    pickerSwapKey: '',
    pickerSwapTab: 'game',
    pickerSwapCategory: 0,
    pickerMutations: [],
    previewSwapKey: '',
    advancedOpen: false,
    advancedSlotIndex: null,
    editorTab: 'mutations',
    editorScope: { kind: 'all' },
    tileComponents: null,
    tileObjectType: null,
    tileLiveSlotCount: null,
  };
}
