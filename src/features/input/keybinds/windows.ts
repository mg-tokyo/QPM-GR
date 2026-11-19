// QPM window actions (INP-1 D2, PD1): one per panel card that opens a window, running the card's own open action,
// so a key does what a click on the card does (most windows close again on a second press).

import { getHubGroups } from '../../../ui/hub';
import type { CardConfig, HubGroupDef } from '../../../ui/hub';
import type { RunnableAction } from './types';

export function cardOpenAction(card: CardConfig): (() => void) | null {
  if (card.tier === 'launcher') return card.opensExternal === true ? null : card.onOpen;
  if (card.tier === 'expandable') return card.onDetach ?? null;
  return null;
}

export function buildWindowActions(groups: ReadonlyArray<HubGroupDef> = getHubGroups()): RunnableAction[] {
  const actions: RunnableAction[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const card of group.cards) {
      const open = cardOpenAction(card);
      const id = `window:${card.key}`;
      if (!open || seen.has(id)) continue;
      seen.add(id);
      actions.push({ id, section: 'windows', run: () => Promise.resolve().then(open) });
    }
  }
  return actions;
}
