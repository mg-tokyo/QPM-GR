import { toggleWindow, isWindowOpen, closeWindow } from '../core/modalWindow';
import { t } from '../../i18n';
import {
  createToggle,
  createSectionHeader,
  createPillTabs,
  createButton,
} from '../components';
import { makeMutationTile } from '../locker/lockerPrimitives';
import {
  getSuperCleanseSettings,
  setSuperCleanseEnabled,
  setAutoOpenPanel,
  setFilterMode,
  setFilterMutations,
  subscribeSuperCleanseSettings,
} from '../../features/superCleanser/storage';
import { WEATHER_MUTATIONS } from '../../features/superCleanser/constants';
import { injectSuperCleanseStyles } from './styles';

const WINDOW_ID = 'super-cleanse-window';
const WINDOW_WIDTH = '380px';
const WINDOW_HEIGHT = 'auto';

let bodyRef: HTMLElement | null = null;
let unsubSettings: (() => void) | null = null;

function render(root: HTMLElement): void {
  injectSuperCleanseStyles();
  root.classList.add('qpm-super-cleanse__wroot');
  root.replaceChildren();

  const settings = getSuperCleanseSettings();

  const enableToggle = createToggle({
    checked: settings.enabled,
    label: t('feature.superCleanser.enable'),
    onChange: (v) => setSuperCleanseEnabled(v),
  });
  root.appendChild(enableToggle.root);

  const autoOpenToggle = createToggle({
    checked: settings.autoOpenPanel,
    label: t('feature.superCleanser.autoOpen'),
    onChange: (v) => setAutoOpenPanel(v),
  });
  root.appendChild(autoOpenToggle.root);

  const filterSection = document.createElement('div');
  filterSection.className = 'qpm-super-cleanse__section';

  filterSection.appendChild(createSectionHeader(t('feature.superCleanser.filter')).root);

  const pillLabels = [t('feature.superCleanser.mode.any'), t('feature.superCleanser.mode.all')];
  const activeIdx = settings.filterMode === 'any' ? 0 : 1;
  filterSection.appendChild(createPillTabs(pillLabels, activeIdx, (idx) => {
    setFilterMode(idx === 0 ? 'any' : 'all');
  }));

  const chipsRow = document.createElement('div');
  chipsRow.className = 'qpm-super-cleanse__chips';
  for (const mutation of WEATHER_MUTATIONS) {
    const tile = makeMutationTile(
      mutation,
      () => new Set(getSuperCleanseSettings().filterMutations).has(mutation),
      () => {
        const current = new Set(getSuperCleanseSettings().filterMutations);
        if (current.has(mutation)) current.delete(mutation);
        else current.add(mutation);
        setFilterMutations([...current]);
      },
    );
    chipsRow.appendChild(tile);
  }
  filterSection.appendChild(chipsRow);

  if (settings.filterMutations.length > 0) {
    const clearBtn = createButton(t('feature.superCleanser.clearFilter'), {
      variant: 'ghost',
      size: 'sm',
      onClick: () => setFilterMutations([]),
    });
    filterSection.appendChild(clearBtn);
  }

  root.appendChild(filterSection);
}

function attachSettingsSubscription(): void {
  if (unsubSettings) return;
  unsubSettings = subscribeSuperCleanseSettings(() => {
    if (bodyRef) render(bodyRef);
  });
}

export function openSuperCleanserWindow(): void {
  toggleWindow(
    WINDOW_ID,
    t('feature.superCleanser.title'),
    (root) => {
      bodyRef = root;
      render(root);
      attachSettingsSubscription();
    },
    WINDOW_WIDTH,
    WINDOW_HEIGHT,
  );
}

export function closeSuperCleanserWindow(): void {
  if (isWindowOpen(WINDOW_ID)) closeWindow(WINDOW_ID);
  unsubSettings?.();
  unsubSettings = null;
  bodyRef = null;
}
