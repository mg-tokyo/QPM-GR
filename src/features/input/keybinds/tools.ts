// INP-4.3 (D2): one key action per toolsDex entry, run on the INP-4.2 select engine; all start unbound (INP-1 D5).

import { getAllItems } from '../../../catalogs/gameCatalogs';
import { getItemCatalogName, getItemCatalogSpriteKey } from '../../../catalogs/shopEligibility';
import { getInventoryItems, onInventoryChange } from '../../../store/inventory';
import { chooseItemId, pressSelectItem, type SelectTarget } from '../selectItem';
import { storagePanelLook } from './panelLook';
import type { RunnableAction } from './types';

const PREFIX = 'tool:';

export interface ToolLook {
  name: string;
  spriteKey: string | null;
}

export function toolIdOf(actionId: string): string | null {
  return actionId.startsWith(PREFIX) && actionId.length > PREFIX.length ? actionId.slice(PREFIX.length) : null;
}

export function toolLook(toolId: string): ToolLook {
  return { name: getItemCatalogName(toolId) ?? toolId, spriteKey: getItemCatalogSpriteKey(toolId) };
}

/** One key press on the select engine (Tools and My items rows); fetches from storage per INP-5. */
export async function pressSelect(target: SelectTarget, name: string): Promise<void> {
  const result = await pressSelectItem(target, { item: name, storage: id => storagePanelLook(id)?.name ?? id });
  // Surfaces through the dispatcher's QPM-FEATURE-004; every other outcome already showed its toast.
  if (result.outcome === 'failed') throw new Error(`select ${target.id}: ${result.reason ?? 'failed'}`);
}

export function buildToolActions(toolIds: readonly string[] = getAllItems()): RunnableAction[] {
  return toolIds.map(id => ({ id: `${PREFIX}${id}`, section: 'tools', run: () => pressSelect({ kind: 'tool', id }, toolLook(id).name) }));
}

/** The tool ids with at least one pickable item in the bag (same rule as the select engine). */
export function toolsInBag(toolIds: readonly string[], items: readonly unknown[] = getInventoryItems().map(i => i.raw)): Set<string> {
  return new Set(toolIds.filter(id => chooseItemId(items, { kind: 'tool', id }) !== null));
}

export function onToolBagChange(cb: () => void): () => void {
  return onInventoryChange(() => cb());
}
