import { readSync } from '../../../core/gameState';
import { getWeatherDef } from '../../../catalogs/gameCatalogs';
import { getGardenSnapshot } from '../../garden/bridge';
import { formatTimeEstimate } from '../../pets/cropBoostTracker';
import { isRecord } from '../../../utils/typeGuards';
import { fillTemplate } from '../bubbleTags';
import { mutationSlot } from '../bubbleIcons';
import type { LineProvider, Voice } from '../types';
import { voiced } from './voiceText';

const WINDOW_MS = 10 * 60000;
export const forecastUrgency = (msUntil: number): number =>
  msUntil > WINDOW_MS ? 0.2 : 1 - 0.5 * (Math.max(0, msUntil) / WINDOW_MS);

interface Upcoming { weatherId: string; startsAtMs: number }

// quinoaData.weatherForecast: [{ groupId, weatherId: string|null, startsAtMs, endsAtMs }] — verified live 2026-09-17; null weatherId = hidden event.
// Weathers without a mutator (Sunny, live 2026-10-02) have no line to say, so they never count as "next".
function nextForecast(nowMs: number): Upcoming | null {
  const qd = readSync('quinoaData') as unknown;
  const list = isRecord(qd) && Array.isArray(qd.weatherForecast) ? qd.weatherForecast : [];
  let best: Upcoming | null = null;
  for (const e of list) {
    if (!isRecord(e) || typeof e.weatherId !== 'string' || typeof e.startsAtMs !== 'number' || e.startsAtMs <= nowMs) continue;
    if (!weatherInfo(e.weatherId).mutation) continue;
    if (!best || e.startsAtMs < best.startsAtMs) best = { weatherId: e.weatherId, startsAtMs: e.startsAtMs };
  }
  return best;
}

function weatherInfo(weatherId: string): { name: string; mutation: string | null } {
  const def = getWeatherDef(weatherId);
  const name = isRecord(def) && typeof def.name === 'string' ? def.name : weatherId;
  const mutator = isRecord(def) ? def.mutator : null;
  return { name, mutation: isRecord(mutator) && typeof mutator.mutation === 'string' ? mutator.mutation : null };
}

function cropsWithout(mutation: string): number {
  const snap = getGardenSnapshot();
  let n = 0;
  for (const tiles of [snap?.tileObjects, snap?.boardwalkTileObjects]) {
    if (!tiles) continue;
    for (const tile of Object.values(tiles)) {
      if (!isRecord(tile) || tile.objectType !== 'plant' || !Array.isArray(tile.slots)) continue;
      for (const slot of tile.slots) {
        if (!isRecord(slot) || slot.preserved === true) continue;
        if (!(Array.isArray(slot.mutations) && slot.mutations.includes(mutation))) n++;
      }
    }
  }
  return n;
}

export const weatherProvider: LineProvider = {
  id: 'weather',
  themes: ['weatherStation'],
  relevance(nowMs) {
    const active = readSync('weather');
    if (typeof active === 'string' && weatherInfo(active).mutation) return 0.6;
    const next = nextForecast(nowMs);
    return next ? forecastUrgency(next.startsAtMs - nowMs) : null;
  },
  line(voice: Voice, nowMs) {
    const active = readSync('weather');
    if (typeof active === 'string') {
      const { name, mutation } = weatherInfo(active);
      if (mutation) {
        return fillTemplate(
          voiced('feature.npcDialogue.line.weather.active', voice, { weather: name, count: cropsWithout(mutation) }),
          [mutationSlot(mutation)],
        );
      }
    }
    const next = nextForecast(nowMs);
    if (!next) return null;
    const { name, mutation } = weatherInfo(next.weatherId);
    if (!mutation) return null;
    const eta = formatTimeEstimate((next.startsAtMs - nowMs) / 60000);
    return fillTemplate(
      voiced('feature.npcDialogue.line.weather.soon', voice, { weather: name, eta }),
      [mutationSlot(mutation)],
    );
  },
};
