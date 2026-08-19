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

// Multiple pops in the same synchronous frame sum in-phase and turn into one
// smeared wash instead of N distinct pops. Coalesce per JS task, then play a
// single instance scaled by sqrt(count) so density is still audible.
const POP_DENSITY_CAP = 3;
let pendingBalloonPops = 0;

function flushBalloonPops(): void {
  const count = pendingBalloonPops;
  pendingBalloonPops = 0;
  if (count <= 0) return;
  const entry = EVENT_MAP.balloonPop;
  const base = entry.volumeMultiplier ?? 1;
  const scale = Math.min(Math.sqrt(count), POP_DENSITY_CAP);
  playSfx(entry.name, { feature: 'towerDefense', volumeMultiplier: base * scale });
}

export function tdPlay(event: TdSoundEvent): void {
  if (event === 'balloonPop') {
    if (pendingBalloonPops === 0) queueMicrotask(flushBalloonPops);
    pendingBalloonPops++;
    return;
  }
  const entry = EVENT_MAP[event];
  if (!entry) return;
  const opts: { feature: string; volumeMultiplier?: number } = { feature: 'towerDefense' };
  if (entry.volumeMultiplier !== undefined) opts.volumeMultiplier = entry.volumeMultiplier;
  playSfx(entry.name, opts);
}
