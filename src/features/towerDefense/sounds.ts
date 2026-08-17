import { playSfx } from '../../audio';

export type TdSoundEvent =
  | 'matchStart'
  | 'waveStart'
  | 'waveClear'
  | 'balloonPop'
  | 'towerSell'
  | 'towerPlace'
  | 'uiClick'
  | 'defeat';

interface EventEntry {
  name: string;
  volumeMultiplier?: number;
}

const EVENT_MAP: Record<TdSoundEvent, EventEntry> = {
  matchStart:  { name: 'CardOpen_A' },
  waveStart:   { name: 'TrainIn',        volumeMultiplier: 0.9 },
  waveClear:   { name: 'ShopRestocked',  volumeMultiplier: 0.8 },
  balloonPop:  { name: 'Destroy_Object', volumeMultiplier: 0.2 },
  towerSell:   { name: 'Sell' },
  towerPlace:  { name: 'Decor_Place' },
  uiClick:     { name: 'Button_Main',    volumeMultiplier: 0.8 },
  defeat:      { name: 'NewspaperHit' },
};

export function tdPlay(event: TdSoundEvent): void {
  const entry = EVENT_MAP[event];
  if (!entry) return;
  const opts: { feature: string; volumeMultiplier?: number } = { feature: 'towerDefense' };
  if (entry.volumeMultiplier !== undefined) opts.volumeMultiplier = entry.volumeMultiplier;
  playSfx(entry.name, opts);
}
