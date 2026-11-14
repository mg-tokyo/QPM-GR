import { atomSource, defineKey, stateSource } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import type {
  QuinoaStateSnapshot, ShopCategorySnapshot, ShopsAtomSnapshot, WeatherAtomValue, WeatherForecastEntry, WeatherWindow,
} from '../../../types/gameAtoms';

const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isForecastEntry = (v: unknown): v is WeatherForecastEntry =>
  isRecord(v) && typeof v.groupId === 'string' && (typeof v.weatherId === 'string' || v.weatherId === null)
  && isMs(v.startsAtMs) && isMs(v.endsAtMs);

const projectWindow = (v: unknown): WeatherWindow | null | undefined => {
  if (v === null) return null;
  return isRecord(v) && isMs(v.startsAtMs) && isMs(v.endsAtMs) ? { startsAtMs: v.startsAtMs, endsAtMs: v.endsAtMs } : undefined;
};

const shops = (s: QuinoaStateSnapshot): ShopsAtomSnapshot | null | undefined => {
  const d = s.child?.data;
  if (!d || typeof d !== 'object') return undefined;
  return isRecord(d.shops) ? (d.shops as ShopsAtomSnapshot) : null;
};

function category(name: 'seed' | 'egg' | 'tool' | 'decor') {
  return defineKey<ShopCategorySnapshot | null>({
    policy: 'authoritative', tier: 'state', doc: `${name} shop`,
    sources: [stateSource(`/child/data/shops/${name}`, (s) => { const all = shops(s); return all === undefined ? undefined : (all?.[name] ?? null); })],
  });
}

export const SHOP_KEYS = {
  weather: defineKey<WeatherAtomValue>({
    policy: 'authoritative', tier: 'state', doc: 'Current weather (null when clear)',
    sources: [
      stateSource('/child/data/weather', (s) => { const d = s.child?.data; if (!d || typeof d !== 'object') return undefined; const w = d.weather; return typeof w === 'string' ? w : w === null ? null : undefined; }),
      atomSource(/^weather(?:State)?Atom$/, 'authoritative', { project: (v) => (typeof v === 'string' ? v : v === null ? null : undefined) }),
    ],
  }),
  // Server-decided schedule, chronological; the bundle has no look-ahead (beta getWeatherStationForecast.ts:22-30).
  weatherForecast: defineKey<readonly WeatherForecastEntry[]>({
    policy: 'authoritative', tier: 'state', doc: 'Upcoming weather events (weatherId null = hidden lunar event)',
    sources: [stateSource('/child/data/weatherForecast', (s) => {
      const list = s.child?.data?.weatherForecast;
      if (!Array.isArray(list)) return undefined;
      return list.every(isForecastEntry) ? list : list.filter(isForecastEntry);
    })],
  }),
  weatherWindow: defineKey<WeatherWindow>({
    policy: 'authoritative', tier: 'state', doc: 'Span of the current weather (null when clear)',
    sources: [
      stateSource('/child/data/weatherWindow', (s) => {
        const d = s.child?.data;
        return d && typeof d === 'object' ? projectWindow(d.weatherWindow) : undefined;
      }),
      atomSource(/^weatherWindowAtom$/, 'authoritative', { project: projectWindow }),
    ],
  }),
  // Written by the game's `dayNight` render system on stage change (REL-6 spec F15–F16); any string, so a new stage flows through.
  dayNightStage: defineKey<string>({
    policy: 'client', tier: 'client', doc: 'Day-cycle stage (day, sunset, midnight, sunrise on 1989; read-only)',
    sources: [atomSource(/^dayNightStageAtom$/, 'client', { structure: (v) => typeof v === 'string' && v.length > 0 })],
  }),
  shops: defineKey<ShopsAtomSnapshot | null>({
    policy: 'authoritative', tier: 'state', doc: 'All shops keyed by id (shopsAtom was removed by the game)',
    // The server patches every shop's countdown once a second; nothing keyed on
    // `shops` needs it (cycle ids use nextRestockAt), so it must not wake the
    // store's ten-category rebuild every frame.
    sources: [stateSource('/child/data/shops', shops, { trustPatches: true, ignorePatchSuffixes: ['/secondsUntilRestock'] })],
  }),
  seedShop: category('seed'),
  eggShop: category('egg'),
  toolShop: category('tool'),
  decorShop: category('decor'),
  // The game gates shop sales on this clock. It ticks once a second, so read it
  // with readSync; a subscription would wake on every tick.
  serverTime: defineKey<number>({
    policy: 'authoritative', tier: 'state', doc: 'Room server clock (ms epoch)',
    sources: [stateSource('/child/data/currentTime', (s) => {
      const t = s.child?.data?.currentTime;
      return typeof t === 'number' && Number.isFinite(t) ? t : undefined;
    }, { trustPatches: true })],
  }),
};
