
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

export function startChargedAbilities(): void {
  startAbilityTargetingSelector();
  startChargedAbilitiesPanel();
}

export function stopChargedAbilities(): void {
  closeChargedAbilitiesWindow();
  stopChargedAbilitiesPanel();
  stopAbilityTargetingSelector();
}

/** Manual launcher — opens the full Charged Abilities window. The floating
 *  HUD overlay auto-opens reactively whenever charged-ability pets are active. */
export { openChargedAbilitiesPanel, openChargedAbilitiesWindow };
