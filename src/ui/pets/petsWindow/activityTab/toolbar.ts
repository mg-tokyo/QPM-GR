import { createPillTabs } from '../../../components/pillTabs';
import { createButton } from '../../../components/button';
import { showConfirmDialog } from '../../../components/confirmDialog';
import { t } from '../../../../i18n';
import type { I18nKey } from '../../../../i18n/types';
import type { KindFilter, PetActivityUiPrefs } from '../../../../store/petActivity/types';
import { getAbilityColor } from '../../../../utils/rendering/petCardRenderer';
import { createPetDropdown, type SpeciesOption } from './petDropdown';

export const KIND_FILTERS: Array<{ id: KindFilter; key: I18nKey }> = [
  { id: 'all', key: 'feature.petActivity.filter.all' }, { id: 'ability', key: 'feature.petActivity.filter.ability' },
  { id: 'feed', key: 'feature.petActivity.filter.feed' }, { id: 'hatchSell', key: 'feature.petActivity.filter.hatchSell' },
  { id: 'potion', key: 'feature.petActivity.filter.potion' }, { id: 'mount', key: 'feature.petActivity.filter.mount' },
];

export interface ToolbarHandlers {
  onKind(id: KindFilter): void; onPet(species: string | null): void; onFamilies(ids: string[]): void; onDensity(v: 'ledger' | 'compact'): void; onClear(): void;
}
export interface FamilyChip { id: string; label: string; action: string }
export interface ToolbarHandle { root: HTMLElement; setSpecies(options: SpeciesOption[]): void; setFamilies(families: FamilyChip[], visible: boolean): void; dispose(): void }

export function buildToolbar(prefs: PetActivityUiPrefs, h: ToolbarHandlers): ToolbarHandle {
  const root = document.createElement('div'); root.className = 'qpm-pact__toolbar';
  // createPillTabs paints the active pill only at creation, so each row is re-created on select.
  const pillRow = (labels: string[], initial: number, onSelect: (i: number) => void): HTMLElement => {
    const host = document.createElement('div');
    const paint = (idx: number): void => { host.replaceChildren(createPillTabs(labels, idx, (i) => { paint(i); onSelect(i); })); };
    paint(initial);
    return host;
  };
  const kindIdx = Math.max(0, KIND_FILTERS.findIndex((k) => k.id === prefs.kind));
  root.appendChild(pillRow(KIND_FILTERS.map((k) => t(k.key)), kindIdx, (i) => h.onKind(KIND_FILTERS[i]?.id ?? 'all')));
  const right = document.createElement('div'); right.className = 'qpm-pact__toolbar-right'; root.appendChild(right);
  right.appendChild(pillRow([t('feature.petActivity.density.ledger'), t('feature.petActivity.density.compact')], prefs.density === 'compact' ? 1 : 0, (i) => h.onDensity(i === 1 ? 'compact' : 'ledger')));
  const petDropdown = createPetDropdown({ selectedSpecies: prefs.pet, onSelect: h.onPet });
  right.appendChild(petDropdown.root);
  right.appendChild(createButton(t('feature.petActivity.clear'), { variant: 'ghost', size: 'sm', onClick: () => {
    void showConfirmDialog({ title: t('feature.petActivity.clearTitle'), message: t('feature.petActivity.clearMessage'), variant: 'danger' }).then((ok) => { if (ok) h.onClear(); });
  } }));
  const famRow = document.createElement('div'); famRow.className = 'qpm-pact__toolbar'; root.appendChild(famRow);
  const selectedFamilies = new Set(prefs.families);
  return {
    root,
    setSpecies(options) { petDropdown.setSpecies(options); },
    setFamilies(families, visible) {
      famRow.replaceChildren();
      famRow.hidden = !visible;
      if (!visible) return;
      for (const f of families) {
        const chip = document.createElement('button'); chip.type = 'button';
        chip.className = 'qpm-pets__rarity-pill' + (selectedFamilies.has(f.id) ? ' qpm-pets__rarity-pill--active' : '');
        const dot = document.createElement('i'); dot.className = 'qpm-pact__fam-dot'; dot.style.background = getAbilityColor(f.action).base;
        chip.append(dot, document.createTextNode(f.label));
        chip.addEventListener('click', () => { if (selectedFamilies.has(f.id)) selectedFamilies.delete(f.id); else selectedFamilies.add(f.id); chip.classList.toggle('qpm-pets__rarity-pill--active'); h.onFamilies([...selectedFamilies]); });
        famRow.appendChild(chip);
      }
    },
    dispose() { petDropdown.dispose(); },
  };
}
