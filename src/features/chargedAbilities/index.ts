
import { startAbilityTargetingSelector, stopAbilityTargetingSelector } from './selector';
import {
  startChargedAbilitiesPanel,
  stopChargedAbilitiesPanel,
  openChargedAbilitiesPanel,
} from '../../ui/chargedAbilities/floatingPanel';
import {
  openChargedAbilitiesWindow,
  closeChargedAbilitiesWindow,
} from '../../ui/chargedAbilities/window';
import {
  startChargedAbilityProjections,
  stopChargedAbilityProjections,
} from './abilities';
import { startReadyEdgeWatch, stopReadyEdgeWatch } from './readyEdge';

export function startChargedAbilities(): void {
  startChargedAbilityProjections();
  startAbilityTargetingSelector();
  startReadyEdgeWatch();
  startChargedAbilitiesPanel();
}

export function stopChargedAbilities(): void {
  closeChargedAbilitiesWindow();
  stopChargedAbilitiesPanel();
  stopReadyEdgeWatch();
  stopAbilityTargetingSelector();
  stopChargedAbilityProjections();
}

export {
  CHARGED_READY_ROW_PREFIX,
  chargedReadyRowId,
  getChargedReadyAlarmDiagnostics,
  startChargedReadyAlarm,
  stopChargedReadyAlarm,
} from './readyAlarm';

/** Manual launcher — opens the full Charged Abilities window. The floating
 *  HUD overlay auto-opens reactively whenever charged-ability pets are active. */
export { openChargedAbilitiesPanel, openChargedAbilitiesWindow };
