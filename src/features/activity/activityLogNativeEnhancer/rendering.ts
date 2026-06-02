import { addStyle } from '../../../utils/dom/dom';
import type {
  SpeciesDropdownHandle,
  SpeciesDropdownOption,
  RowMetadata,
  ModalHandles,
  TypeFilter,
  OrderFilter,
} from './types';
import {
  STYLE_ID,
  TYPE_OPTIONS,
  ORDER_OPTIONS,
} from './constants';
import { S } from './state';
import { readString, normalizeWhitespace } from './parsing';

export function createSpeciesDropdown(params: {
  placeholder: string;
  onChange: (value: string) => void;
}): SpeciesDropdownHandle {
  const root = document.createElement('div');
  root.className = 'qpm-activity-species';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'qpm-activity-species-btn';
  button.textContent = params.placeholder;

  const menu = document.createElement('div');
  menu.className = 'qpm-activity-species-menu';
  menu.style.display = 'none';

  root.append(button, menu);

  let isOpen = false;
  let selectedValue = '';
  let options: SpeciesDropdownOption[] = [];

  const closeMenu = (): void => {
    if (!isOpen) return;
    isOpen = false;
    menu.style.display = 'none';
  };

  const openMenu = (): void => {
    if (isOpen) return;
    isOpen = true;
    menu.style.display = 'block';
  };

  const renderButton = (): void => {
    const selected = options.find((option) => option.value === selectedValue) ?? null;
    button.replaceChildren();
    if (selected?.iconUrl) {
      const img = document.createElement('img');
      img.className = 'qpm-activity-species-icon';
      img.src = selected.iconUrl;
      img.alt = '';
      button.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = selected?.label ?? params.placeholder;
    button.appendChild(label);
  };

  const renderMenu = (): void => {
    menu.replaceChildren();
    const applySelection = (value: string): void => {
      if (selectedValue === value) {
        closeMenu();
        return;
      }
      selectedValue = value;
      renderButton();
      renderMenu();
      closeMenu();
      params.onChange(selectedValue);
    };

    for (const option of options) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `qpm-activity-species-option${option.value === selectedValue ? ' is-active' : ''}`;
      row.dataset.value = option.value;

      if (option.iconUrl) {
        const img = document.createElement('img');
        img.className = 'qpm-activity-species-icon';
        img.src = option.iconUrl;
        img.alt = '';
        row.appendChild(img);
      }

      const label = document.createElement('span');
      label.textContent = option.label;
      row.appendChild(label);

      row.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        applySelection(option.value);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        applySelection(option.value);
      });

      menu.appendChild(row);
    }
  };

  const onGlobalPointer = (event: Event): void => {
    const target = event.target instanceof Node ? event.target : null;
    if (!target) return;
    if (root.contains(target)) return;
    closeMenu();
  };

  button.addEventListener('click', () => {
    if (isOpen) closeMenu();
    else openMenu();
  });

  document.addEventListener('pointerdown', onGlobalPointer, true);

  return {
    root,
    button,
    menu,
    setValue(value: string): void {
      selectedValue = value;
      renderButton();
      renderMenu();
    },
    getValue(): string {
      return selectedValue;
    },
    setOptions(nextOptions: SpeciesDropdownOption[]): void {
      options = nextOptions;
      if (!options.some((option) => option.value === selectedValue)) {
        selectedValue = '';
      }
      renderButton();
      renderMenu();
    },
    destroy(): void {
      document.removeEventListener('pointerdown', onGlobalPointer, true);
    },
  };
}

export function buildSelect<T extends string>(
  options: Array<{ value: T; label: string }>,
  currentValue: T,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'qpm-activity-select';
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    if (option.value === currentValue) {
      node.selected = true;
    }
    select.appendChild(node);
  }
  return select;
}

export function applyFiltersToRows(rows: RowMetadata[]): number {
  let visibleCount = 0;
  for (const meta of rows) {
    const matchAction = true;
    const matchType = S.filters.type === 'all' || meta.type === S.filters.type;
    const petFilterKey = S.filters.petSpecies;
    const plantFilterKey = S.filters.plantSpecies;
    const matchPet = !petFilterKey || meta.petFilterKey === petFilterKey;
    const matchPlant = !plantFilterKey || meta.plantFilterKey === plantFilterKey;
    const matchSpecies = petFilterKey && plantFilterKey
      ? (matchPet || matchPlant)
      : (matchPet && matchPlant);
    const visible = matchAction && matchType && matchSpecies;
    const nextDisplay = visible ? '' : 'none';
    if (meta.row.style.display !== nextDisplay) {
      meta.row.style.display = nextDisplay;
    }
    if (visible) visibleCount += 1;
  }
  return visibleCount;
}

export function normalizeSpeciesFilterValue(options: SpeciesDropdownOption[], value: string): string {
  return options.some((option) => option.value === value) ? value : '';
}

export function updateSummary(handles: ModalHandles, visibleCount: number, totalCount: number): void {
  if (!S.showSummaryInDebug) {
    handles.summary.classList.add('is-hidden');
    handles.summary.textContent = '';
    return;
  }

  handles.summary.classList.remove('is-hidden');
  handles.summary.textContent = `History: ${S.history.length} saved, ${visibleCount}/${totalCount} visible`;
}

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
    .qpm-activity-toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin: 4px 0 8px;
      padding: 0;
      border: 0;
      background: transparent;
      box-sizing: border-box;
    }
    .qpm-activity-select {
      min-height: 24px;
      border: 1px solid rgba(138, 150, 168, 0.45);
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 11px;
      line-height: 1.2;
      background: rgba(247, 248, 250, 0.86);
      color: #2f3a4a;
      cursor: pointer;
      box-sizing: border-box;
    }
    .qpm-activity-select:focus {
      outline: none;
      border-color: rgba(110, 124, 146, 0.72);
    }
    .qpm-activity-chip-wrap {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .qpm-activity-chip {
      border: 1px solid rgba(138, 150, 168, 0.45);
      background: rgba(247, 248, 250, 0.82);
      color: #2f3a4a;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      line-height: 1.2;
      cursor: pointer;
      white-space: nowrap;
    }
    .qpm-activity-chip.is-active {
      border-color: rgba(100, 113, 131, 0.75);
      background: rgba(232, 236, 243, 0.94);
      color: #222e3d;
    }
    .qpm-activity-species {
      position: relative;
      min-width: 150px;
    }
    .qpm-activity-species-btn {
      min-height: 24px;
      width: 100%;
      border: 1px solid rgba(138, 150, 168, 0.45);
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 11px;
      line-height: 1.2;
      background: rgba(247, 248, 250, 0.86);
      color: #2f3a4a;
      cursor: pointer;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-start;
      text-align: left;
    }
    .qpm-activity-species-menu {
      position: absolute;
      z-index: 20;
      left: 0;
      right: 0;
      top: calc(100% + 4px);
      max-height: 220px;
      overflow-y: auto;
      border-radius: 10px;
      border: 1px solid rgba(138, 150, 168, 0.45);
      background: rgba(252, 253, 255, 0.98);
      box-shadow: 0 10px 24px rgba(40, 52, 70, 0.18);
      padding: 4px;
      box-sizing: border-box;
    }
    .qpm-activity-species-option {
      width: 100%;
      border: 0;
      background: transparent;
      color: #2f3a4a;
      border-radius: 8px;
      min-height: 28px;
      padding: 5px 8px;
      font-size: 11px;
      line-height: 1.2;
      cursor: pointer;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .qpm-activity-species-option:hover {
      background: rgba(233, 238, 247, 0.9);
    }
    .qpm-activity-species-option.is-active {
      background: rgba(221, 231, 247, 0.95);
      color: #1f2c3d;
      font-weight: 600;
    }
    .qpm-activity-species-icon {
      width: 16px;
      height: 16px;
      object-fit: contain;
      image-rendering: pixelated;
      flex: 0 0 16px;
      pointer-events: none;
    }
    .qpm-activity-summary {
      margin-left: auto;
      font-size: 11px;
      color: #3f4a5e;
      font-weight: 600;
      white-space: nowrap;
    }
    .qpm-activity-summary.is-hidden {
      display: none;
    }
    @media (max-width: 780px) {
      .qpm-activity-summary {
        width: 100%;
        margin-left: 0;
        white-space: normal;
      }
    }
  `;
  const style = addStyle(css);
  style.id = STYLE_ID;
}
