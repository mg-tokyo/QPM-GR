import { storage } from '../../utils/storage';
import type { LineId } from './types';

const ENABLED_KEY = 'qpm.npcDialogue.enabled.v1';
const LINES_KEY = 'qpm.npcDialogue.lines.v1';
const COMPANION_INJECT_KEY = 'qpm.npcDialogue.companionInject.v1';

export const LINE_IDS: readonly LineId[] = ['restock', 'weather', 'gardenValue', 'pity', 'abilityProc', 'inventoryFull'];

export interface NpcDialogueSettings {
  enabled: boolean;
  lines: Record<LineId, boolean>;
  companionInject: boolean;
}

export function getNpcDialogueSettings(): NpcDialogueSettings {
  const stored = storage.get<Partial<Record<LineId, boolean>> | null>(LINES_KEY, null) ?? {};
  const lines = Object.fromEntries(LINE_IDS.map((id) => [id, stored[id] !== false])) as Record<LineId, boolean>;
  return {
    enabled: storage.get<boolean | null>(ENABLED_KEY, null) !== false,
    lines,
    companionInject: storage.get<boolean | null>(COMPANION_INJECT_KEY, null) === true,
  };
}

export function setNpcDialogueEnabled(v: boolean): void {
  storage.set(ENABLED_KEY, v);
}

export function setNpcDialogueLineEnabled(id: LineId, v: boolean): void {
  storage.set(LINES_KEY, { ...getNpcDialogueSettings().lines, [id]: v });
}

export function setNpcDialogueCompanionInject(v: boolean): void {
  storage.set(COMPANION_INJECT_KEY, v);
}
