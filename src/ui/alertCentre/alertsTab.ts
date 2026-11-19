import { isRowDesktop, listAlertRows, type AlertGroup } from '../../features/alertHub';
import { t } from '../../i18n';
import { onSpritesReady } from '../../sprite-v2/compat';
import { HYDRATION_EVENT } from '../../sprite-v2/service/constants';
import { createSectionHeader } from '../components';
import { createDesktopCard } from './desktopCard';
import { getLinkedRows } from './linkedRows';
import { createHubRowCard, createLinkedRowCard, createMasterCard, ensureCentreStyles, type RowCard } from './rowCard';

const GROUP_ORDER: readonly AlertGroup[] = ['shops', 'pets', 'garden', 'room', 'qpm'];

interface GroupView {
  setBadge(value: string): void;
  cards: RowCard[];
}

function rowIdsKey(): string {
  return [...listAlertRows(), ...getLinkedRows()].map((r) => r.id).join('|');
}

/** Rows shown with a Desktop tick that is set: every hub row, plus linked rows that send desktop notifications. */
function desktopTickedCount(): number {
  const ids = [...listAlertRows().map((r) => r.id), ...getLinkedRows().filter((r) => r.desktop).map((r) => r.id)];
  return ids.filter(isRowDesktop).length;
}

/** Master sound card, then one card per hub row and linked producer, grouped by section. Returns its cleanup. */
export function renderAlertsTab(container: HTMLElement): () => void {
  ensureCentreStyles();
  const cleanups: Array<() => void> = [];
  let rowCleanups: Array<() => void> = [];
  let groups: GroupView[] = [];
  let renderedIds = '';

  const master = createMasterCard();
  // The master switch greys or frees every row's Desktop tick.
  const desktop = createDesktopCard(desktopTickedCount, () => {
    for (const g of groups) for (const c of g.cards) c.refresh();
  });
  const list = document.createElement('div');
  container.append(master.root, desktop.root, list);

  const recount = (): void => {
    desktop.refresh();
    let on = 0;
    let total = 0;
    for (const g of groups) {
      const states = g.cards.map((c) => c.isOn()).filter((s): s is boolean => s !== null);
      const groupOn = states.filter(Boolean).length;
      g.setBadge(t('feature.alertCentre.groupCount', { on: groupOn, total: states.length }));
      on += groupOn;
      total += states.length;
    }
    master.setCount(on, total);
  };

  const build = (): void => {
    for (const fn of rowCleanups) fn();
    rowCleanups = [];
    groups = [];
    renderedIds = rowIdsKey();
    const hubRows = listAlertRows();
    const linked = getLinkedRows();
    const sections: HTMLElement[] = [];
    for (const group of GROUP_ORDER) {
      const own = hubRows.filter((r) => r.group === group);
      const links = linked.filter((r) => r.group === group);
      if (own.length === 0 && links.length === 0) continue;
      const cards = [
        ...own.map((def) => createHubRowCard(def, recount)),
        ...links.map((def) => createLinkedRowCard(def, recount, rowCleanups)),
      ];
      // No badge for a group without switches (Shops): an empty badge still draws its pill.
      const switchable = cards.some((c) => c.isOn() !== null);
      const header = createSectionHeader(t(`feature.alertCentre.group.${group}`), switchable ? { badge: '' } : {});
      const section = document.createElement('div');
      section.style.cssText = 'margin-top:12px;';
      section.dataset.qpmAlertCentreGroup = group;
      section.append(header.root, ...cards.map((c) => c.root));
      sections.push(section);
      groups.push({ setBadge: switchable ? header.setBadge : () => {}, cards });
    }
    list.replaceChildren(...sections);
    recount();
  };

  // Settings change in the feature windows the ⚙ buttons open; returning to the centre re-reads them.
  const refresh = (): void => {
    if (rowIdsKey() !== renderedIds) {
      build();
    } else {
      for (const g of groups) for (const c of g.cards) c.refresh();
      recount();
    }
    master.refresh();
  };

  build();
  container.addEventListener('pointerenter', refresh);
  cleanups.push(() => { container.removeEventListener('pointerenter', refresh); });
  // Late sprites: the atlas loads after the centre can open, and Rive pets hydrate per species.
  window.addEventListener(HYDRATION_EVENT, refresh);
  cleanups.push(() => { window.removeEventListener(HYDRATION_EVENT, refresh); });
  cleanups.push(onSpritesReady(refresh));
  return () => {
    for (const fn of rowCleanups) fn();
    for (const fn of cleanups) fn();
  };
}
