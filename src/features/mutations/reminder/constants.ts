import type { MutationActiveWeather } from '../../../store/mutationSummary';
import type { MutationLetter } from './types';

export const MUTATION_LETTERS: MutationLetter[] = ['F', 'W', 'C', 'D', 'A', 'R', 'G'];
export const DEBUG_MUTATION_DECISIONS = false;

export const MUTATION_CONFIG_KEY = 'quinoa-mutation-reminder-config';
export const INVENTORY_CONTAINER = '.McFlex.css-zo8r2v';
export const INVENTORY_ITEM = 'div.css-79elbk';
export const CROP_INVENTORY_ATOM_LABEL = 'myCropInventoryAtom';

export const MUTATION_WEATHERS: MutationActiveWeather[] = ['rain', 'snow', 'dawn', 'amber'];

export const SLOT_MUTATION_DEBUG_LIMIT = 5;

export const INVENTORY_BASE_INDEX_ATTRS = [
  'data-tm-inventory-base-index',
  'data-tm-inventory-baseindex',
  'data-tm-base-index',
  'data-base-index',
];

export const INVENTORY_ID_ATTRS = [
  'data-tm-inventory-id',
  'data-inventory-id',
  'data-item-id',
  'data-itemid',
  'data-itemId',
  'data-item-uuid',
  'data-itemuuid',
  'data-item-guid',
  'data-uuid',
  'data-guid',
  'data-entity-id',
  'data-entityid',
  'data-record-id',
  'data-recordid',
  'data-row-id',
  'data-rowid',
  'data-tm-item-id',
  'data-tm-itemid',
  'data-id',
];
