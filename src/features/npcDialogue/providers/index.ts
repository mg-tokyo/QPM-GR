import type { LineProvider } from '../types';
import { abilityProcProvider } from './abilityProc';
import { gardenValueProvider } from './gardenValue';
import { inventoryFullProvider } from './inventoryFull';
import { pityProvider } from './pity';
import { restockProvider } from './restock';
import { weatherProvider } from './weather';

export const PROVIDERS: readonly LineProvider[] = [
  restockProvider,
  weatherProvider,
  gardenValueProvider,
  pityProvider,
  abilityProcProvider,
  inventoryFullProvider,
];
