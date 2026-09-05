import { subscribeAtomValue } from '../../../core/atomRegistry';
import { isHarvestAction } from '../actionShape';
import { recordObservedKind } from './store';

let unsubscribe: (() => void) | null = null;
let starting = false;

export function startHarvestKindObserver(): void {
  if (unsubscribe || starting) return;
  starting = true;
  void subscribeAtomValue('action', (value) => {
    if (typeof value !== 'string') return;
    if (value === 'harvest') return;
    if (!isHarvestAction(value)) return;
    recordObservedKind(value);
  }).then((stop) => {
    starting = false;
    if (stop) unsubscribe = stop;
  }).catch(() => {
    starting = false;
  });
}

export function stopHarvestKindObserver(): void {
  if (unsubscribe) {
    try { unsubscribe(); } catch { /* swallow */ }
    unsubscribe = null;
  }
}
