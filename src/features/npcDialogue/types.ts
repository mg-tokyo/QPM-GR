export type MutationTag = { mutation: string };
export type GameThingTag = { gameThing: { name: string; sprite: string } };
export type CurrencyTag = { currency: { kind: 'currencyAmount'; currency: 'coins' | 'credits' | 'magicDust'; amount: number | null } };
export type BubbleTag = MutationTag | GameThingTag | CurrencyTag;
export interface BubbleLine {
  message: string;
  tags?: Record<number, BubbleTag>;
}

/** A slot is an icon tag, or plain text when no icon is available. */
export type Slot = BubbleTag | string;
export type Voice = 'station' | 'trader' | 'preserve' | 'neutral';
export type LineId = 'restock' | 'weather' | 'gardenValue' | 'pity' | 'abilityProc' | 'inventoryFull';

export interface Speaker {
  npcId: string;
  role: 'companion' | 'native';
  locationKey: string | null;
  voice: Voice;
}

export interface LineProvider {
  id: LineId;
  /** mapAtom.locations keys this line is themed to. */
  themes: readonly string[];
  companionOnly?: boolean;
  /** 0–1 urgency, or null when there is nothing to say. Must not throw. */
  relevance(nowMs: number): number | null;
  line(voice: Voice, nowMs: number): BubbleLine | null;
}
