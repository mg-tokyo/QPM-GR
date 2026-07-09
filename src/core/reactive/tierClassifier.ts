// src/core/reactive/tierClassifier.ts
// Fallback classifier for subscribes without an explicit tier hint. Looks at
// the atom's debug label and applies known patterns. Unknown → 'dynamic',
// which means the subscription falls back to the 5s safety poll — safe.

import type { SubscriberTier } from './types';

const STATE_LABEL_PATTERNS: readonly RegExp[] = [
  /^my(?:Player)?Data(?:Atom)?$/i,
  /^my(?:Main)?Inventory(?:Data)?Atom$/i,
  /^myCrop(?:s)?Inventory(?:Data)?Atom$/i,
  /^myTool(?:s)?Inventory(?:Data)?Atom$/i,
  /^myPet(?:Inventory|Items)(?:Data)?Atom$/i,
  /^myPetHutch(?:Pet)?Items(?:Data)?Atom$/i,
  /^myPetHutch(?:Capacity|Cap)(?:Level|Slots)?(?:Data)?Atom$/i,
  /^myNumPetHutchItems(?:Data)?Atom$/i,
  /^mySeedSiloSeed?Items(?:Data)?Atom$/i,
  /^mySeedSiloCapacity(?:Slots|Level)(?:Data)?Atom$/i,
  /^myNumSeedSiloItems(?:Data)?Atom$/i,
  /^myDecorShedDecor?Items(?:Data)?Atom$/i,
  /^myDecorShedCapacity(?:Slots|Level)(?:Data)?Atom$/i,
  /^myNumDecorShedItems(?:Data)?Atom$/i,
  /^my(?:Primitive|NonPrimitive)?Pet(?:Slots|SlotInfos)(?:Data)?Atom$/i,
  /^my(?:Coins|coins)(?:Count|Balance)?Atom$/i,
  /^my(?:MagicDust|magicDust)(?:Count|Balance)?Atom$/i,
  /^myUserSlotAtom$/,
  /^myActivityLogsAtom$/,
  /^myShopPurchasesAtom$/,
  /^quinoaDataAtom$/,
  /^(?:room|game)?[Ss]tate(?:Data)?Atom$/,
  /^(?:room)?[Uu]ser[Ss]lots(?:Data)?Atom$/,
  /^weather(?:State)?Atom$/,
  /^shops(?:Data)?Atom$/,
  /^playersAtom$/,
];

const CLIENT_LABEL_PATTERNS: readonly RegExp[] = [
  /^active(?:Modal|Dialog)(?:Name)?(?:Data)?Atom$/i,
  /^mySelectedItemIdAtom$/,
  /^mySelectedSlotIdAtom$/,
  /^myRiddenPetId(?:Atom)?$/,
  /^(?:player)?(?:grid)?[Pp]osition(?:Data)?Atom$/,
  /^local(?:Player)?(?:Position|Pos)(?:Data)?Atom$/,
];

const COMPOSITE_LABEL_PATTERNS: readonly RegExp[] = [
  /^(?:current|room)?[Aa]ction(?:Data)?Atom$/,
];

export function classifyByLabel(atomLabel: string | undefined): SubscriberTier {
  if (!atomLabel) return 'dynamic';
  if (COMPOSITE_LABEL_PATTERNS.some((rx) => rx.test(atomLabel))) return 'composite';
  if (CLIENT_LABEL_PATTERNS.some((rx) => rx.test(atomLabel))) return 'client';
  if (STATE_LABEL_PATTERNS.some((rx) => rx.test(atomLabel))) return 'state';
  return 'dynamic';
}
