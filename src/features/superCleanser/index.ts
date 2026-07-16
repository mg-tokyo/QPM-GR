import { startSuperCleanseSelector, stopSuperCleanseSelector } from './selector';
import { startSuperCleanseKeydown, stopSuperCleanseKeydown } from './keydownHandler';
import {
  startSuperCleansePanel,
  stopSuperCleansePanel,
  openSuperCleansePanel,
} from '../../ui/superCleanser/floatingPanel';
import {
  openSuperCleanserWindow,
  closeSuperCleanserWindow,
} from '../../ui/superCleanser/window';

export function startSuperCleanser(): void {
  startSuperCleanseSelector();
  startSuperCleansePanel();
  startSuperCleanseKeydown();
}

export function stopSuperCleanser(): void {
  stopSuperCleanseKeydown();
  closeSuperCleanserWindow();
  stopSuperCleansePanel();
  stopSuperCleanseSelector();
}

export { openSuperCleanserWindow, openSuperCleansePanel };
