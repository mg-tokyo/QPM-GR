import { t } from '../../../../i18n';
import type { PetSnap } from '../../../../store/petActivity';
import { liveDescribeDeps } from './describeLive';
import { petSpriteUrl } from './sprites';

/** One dropdown entry per species; `sample` is any pet of that species (used for the sprite). */
export interface SpeciesOption { species: string; sample: PetSnap; count: number }
export interface PetDropdownOptions { selectedSpecies: string | null; onSelect(species: string | null): void }
export interface PetDropdownHandle { root: HTMLElement; setSpecies(options: SpeciesOption[]): void; dispose(): void }

/** Single-select species filter: sprite + species name trigger, popover list of every species with recorded events. */
export function createPetDropdown(opts: PetDropdownOptions): PetDropdownHandle {
  const root = document.createElement('div'); root.className = 'qpm-pact__dd';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'qpm-pact__dd-btn'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('img'); icon.className = 'qpm-pact__dd-icon'; icon.alt = '';
  const label = document.createElement('span'); label.className = 'qpm-pact__dd-label';
  const caret = document.createElement('span'); caret.className = 'qpm-pact__dd-caret'; caret.textContent = '▾';
  btn.append(icon, label, caret);
  const menu = document.createElement('div'); menu.className = 'qpm-pact__dd-menu'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
  root.append(btn, menu);

  let options: SpeciesOption[] = [];
  let selected = opts.selectedSpecies;
  let open = false;
  // Mutations stripped so the icon is the base species, not whichever pet happened to be seen first.
  const spriteOf = (o: SpeciesOption): string => petSpriteUrl({ ...o.sample, mutations: [] });

  function paintBtn(): void {
    const o = options.find((x) => x.species === selected);
    const url = o ? spriteOf(o) : '';
    icon.hidden = !url;
    if (url) icon.src = url;
    label.textContent = o ? liveDescribeDeps.petSpeciesName(o.species) : t('feature.petActivity.allPets');
    btn.title = label.textContent;
  }
  function item(o: SpeciesOption | null): HTMLElement {
    const el = document.createElement('button'); el.type = 'button'; el.setAttribute('role', 'option');
    const active = (o?.species ?? null) === selected;
    el.className = `qpm-pact__dd-item${active ? ' qpm-pact__dd-item--active' : ''}`;
    el.setAttribute('aria-selected', String(active));
    const name = document.createElement('span'); name.className = 'qpm-pact__dd-name';
    if (o) {
      const url = spriteOf(o);
      if (url) { const img = document.createElement('img'); img.alt = ''; img.src = url; el.appendChild(img); }
      name.textContent = liveDescribeDeps.petSpeciesName(o.species);
      const count = document.createElement('span'); count.className = 'qpm-pact__dd-count'; count.textContent = `×${o.count}`;
      el.append(name, count);
    } else {
      name.textContent = t('feature.petActivity.allPets');
      el.appendChild(name);
    }
    el.addEventListener('click', () => { selected = o?.species ?? null; paintBtn(); setOpen(false); opts.onSelect(selected); });
    return el;
  }
  function renderMenu(): void {
    menu.replaceChildren(item(null), ...options.map(item));
  }
  function setOpen(v: boolean): void {
    open = v;
    menu.hidden = !v;
    btn.setAttribute('aria-expanded', String(v));
    if (v) renderMenu();
  }
  btn.addEventListener('click', () => setOpen(!open));
  const onDocPointer = (e: Event): void => { if (open && e.target instanceof Node && !root.contains(e.target)) setOpen(false); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && open) setOpen(false); };
  document.addEventListener('mousedown', onDocPointer, true);
  document.addEventListener('keydown', onKey);
  paintBtn();

  return {
    root,
    setSpecies(next) {
      options = next;
      // The selected species can disappear (history cleared / pruned) — fall back to all.
      if (selected && !options.some((o) => o.species === selected)) { selected = null; opts.onSelect(null); }
      paintBtn();
      if (open) renderMenu();
    },
    dispose() {
      document.removeEventListener('mousedown', onDocPointer, true);
      document.removeEventListener('keydown', onKey);
    },
  };
}
