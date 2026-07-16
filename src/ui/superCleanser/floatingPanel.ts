import { openFloatingCard, closeFloatingCard, hasFloatingCard } from '../components/floatingCard';
import { subscribeSuperCleanseSnapshot } from '../../features/superCleanser/selector';
import {
  getSuperCleanseSettings,
  setSuperCleanseEnabled,
  subscribeSuperCleanseSettings,
} from '../../features/superCleanser/storage';
import { matchSlots } from '../../features/superCleanser/matching';
import {
  PANEL_POSITION_STORAGE_KEY,
  DEFAULT_PANEL_POSITION,
} from '../../features/superCleanser/constants';
import { getAnySpriteDataUrl, renderBySpriteKey } from '../../sprite-v2/compat';
import { getFloraBlueprint } from '../../catalogs/gameCatalogs';
import { injectSuperCleanseStyles } from './styles';
import { t } from '../../i18n';
import type { SlotView, SuperCleanseSnapshot } from '../../features/superCleanser/types';

const PANEL_KEY = 'super-cleanse';

let userClosedThisSession = false;
let manuallyOpened = false;
let bodyElement: HTMLDivElement | null = null;
let unsubscribeSnap: (() => void) | null = null;
let unsubscribeSettings: (() => void) | null = null;
let latestSnap: SuperCleanseSnapshot | null = null;

function buildHeader(onClose: () => void): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'qpm-super-cleanse__header';
  const iconSlot = document.createElement('div');
  iconSlot.className = 'qpm-super-cleanse__header-icon';
  const iconUrl = getAnySpriteDataUrl('sprite/item/CropCleanser');
  if (iconUrl) {
    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = '';
    iconSlot.appendChild(img);
  }
  const title = document.createElement('div');
  title.className = 'qpm-super-cleanse__title';
  title.textContent = t('feature.superCleanser.title');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'qpm-super-cleanse__close';
  close.textContent = '×';
  close.title = t('feature.superCleanser.close');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose();
  });
  header.append(iconSlot, title, close);
  return header;
}

function paintBody(body: HTMLElement): void {
  body.replaceChildren();
  const settings = getSuperCleanseSettings();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className =
    'qpm-super-cleanse__toggle ' +
    (settings.enabled ? 'qpm-super-cleanse__toggle--on' : 'qpm-super-cleanse__toggle--off');
  btn.textContent = settings.enabled
    ? t('feature.superCleanser.active')
    : t('feature.superCleanser.off');
  btn.addEventListener('click', () => {
    setSuperCleanseEnabled(!settings.enabled);
  });
  body.appendChild(btn);

  if (latestSnap && settings.enabled) {
    const matches = matchSlots(
      latestSnap.hoveredWeatherSet,
      settings.filterMutations,
      settings.filterMode,
      latestSnap.slotsOnTile,
    );
    const caption = document.createElement('div');
    caption.className = 'qpm-super-cleanse__caption';
    caption.textContent = t('feature.superCleanser.willCleanse', { count: matches.length });
    body.appendChild(caption);

    if (matches.length > 0) {
      body.appendChild(buildSlotPreview(matches));
    }
  }
}

function renderCropByFloraBlueprint(species: string, mutations: readonly string[]): string {
  const bp = getFloraBlueprint(species);
  const key = bp?.cropSpriteKey;
  if (!key) return '';
  const canvas = renderBySpriteKey(key, [...mutations]);
  return canvas ? canvas.toDataURL() : '';
}

function buildSlotPreview(slots: readonly SlotView[]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'qpm-super-cleanse__slot-preview';
  for (const slot of slots) {
    const item = document.createElement('div');
    item.className = 'qpm-super-cleanse__slot-preview-item';
    item.title = slot.weatherMutations.length > 0
      ? `${slot.species}: ${slot.weatherMutations.join(', ')}`
      : slot.species;
    const url = renderCropByFloraBlueprint(slot.species, slot.mutations);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = slot.species;
      item.appendChild(img);
    }
    row.appendChild(item);
  }
  return row;
}

function ensurePanelOpen(): void {
  if (hasFloatingCard(PANEL_KEY)) {
    if (bodyElement) paintBody(bodyElement);
    return;
  }
  injectSuperCleanseStyles();
  const header = buildHeader(() => {
    userClosedThisSession = true;
    manuallyOpened = false;
    closeFloatingCard(PANEL_KEY);
  });
  const body = document.createElement('div');
  body.className = 'qpm-super-cleanse__body';
  bodyElement = body;

  openFloatingCard({
    key: PANEL_KEY,
    className: 'qpm-super-cleanse',
    header,
    body,
    persistKey: PANEL_POSITION_STORAGE_KEY,
    defaultPosition: DEFAULT_PANEL_POSITION,
    baseWidth: 200,
    dragExcludeSelectors: ['.qpm-super-cleanse__close', '.qpm-super-cleanse__toggle'],
    onDestroy: () => {
      bodyElement = null;
    },
  });

  paintBody(body);
}

function ensurePanelClosed(): void {
  if (hasFloatingCard(PANEL_KEY)) closeFloatingCard(PANEL_KEY);
}

function onSnap(snap: SuperCleanseSnapshot): void {
  latestSnap = snap;
  const settings = getSuperCleanseSettings();
  if (!snap.holdingCleanser) {
    if (manuallyOpened && hasFloatingCard(PANEL_KEY)) {
      if (bodyElement) paintBody(bodyElement);
      return;
    }
    ensurePanelClosed();
    return;
  }
  if (hasFloatingCard(PANEL_KEY)) {
    if (bodyElement) paintBody(bodyElement);
    return;
  }
  if (userClosedThisSession) return;
  if (!settings.autoOpenPanel) return;
  ensurePanelOpen();
}

export function startSuperCleansePanel(): void {
  if (unsubscribeSnap) return;
  unsubscribeSnap = subscribeSuperCleanseSnapshot(onSnap);
  unsubscribeSettings = subscribeSuperCleanseSettings(() => {
    if (bodyElement) paintBody(bodyElement);
  });
}

export function stopSuperCleansePanel(): void {
  unsubscribeSnap?.();
  unsubscribeSnap = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  ensurePanelClosed();
  userClosedThisSession = false;
  manuallyOpened = false;
  latestSnap = null;
}

export function openSuperCleansePanel(): void {
  userClosedThisSession = false;
  manuallyOpened = true;
  ensurePanelOpen();
}
