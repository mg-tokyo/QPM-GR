// Fires the actions INP-1 added. Existing binds keep their own listeners (plan global constraints); the
// registry's one-action-per-combo keeps the two from both firing.

import { isEditableTarget, isKeybindRecording, normalizeKeybind } from '../../../ui/pets/petsWindow/helpers';
import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import { getActionBinds } from './actionBinds';
import { buildRunnableActions } from './runnable';
import type { RunnableAction } from './types';

const { ensureBusRegistered, publishOk, warnFeature } = createFeatureDiagnostics('feature:keybinds', 'keybinds');

export function findBoundAction(
  combo: string,
  actions: readonly RunnableAction[],
  binds: Readonly<Record<string, string>>,
): RunnableAction | null {
  return actions.find(a => binds[a.id] === combo) ?? null;
}

let handler: ((e: KeyboardEvent) => void) | null = null;

export function startKeybindDispatcher(): void {
  if (handler) return;
  ensureBusRegistered();
  handler = (e: KeyboardEvent) => {
    if (e.repeat || isKeybindRecording() || isEditableTarget(e.target)) return;
    const combo = normalizeKeybind(e);
    if (!combo) return;
    const action = findBoundAction(combo, buildRunnableActions(), getActionBinds());
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action.run().catch((err) => {
      warnFeature('QPM-FEATURE-004', { what: 'keybindAction', action: action.id }, err);
    });
  };
  document.addEventListener('keydown', handler);
  publishOk('Started', { bound: Object.keys(getActionBinds()).length });
}

export function stopKeybindDispatcher(): void {
  if (!handler) return;
  document.removeEventListener('keydown', handler);
  handler = null;
}
