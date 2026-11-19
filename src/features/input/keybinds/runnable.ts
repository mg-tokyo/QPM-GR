import { buildGameActions } from './gamePanels';
import { buildMultiShopActions } from './multiShop';
import { buildMultiStorageActions } from './multiStorage';
import { buildMyItemActions } from './myItems';
import { buildTeamCycleActions } from './teamCycle';
import { buildToolActions } from './tools';
import { buildWindowActions } from './windows';
import type { RunnableAction } from './types';

export function buildRunnableActions(): RunnableAction[] {
  return [
    ...buildWindowActions(), ...buildGameActions(), ...buildMultiStorageActions(), ...buildMultiShopActions(),
    ...buildToolActions(), ...buildMyItemActions(), ...buildTeamCycleActions(),
  ];
}
