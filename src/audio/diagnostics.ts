import { healthBus } from '../diagnostics/healthBus';
import type { Subsystem } from '../diagnostics/types';
import { shareGlobal } from '../core/pageContext';
import { getRoute, getSfxNames, getSubroute, hasSfx, isAudioReady, retryCatalogNow } from './catalog';
import { getActiveLoopCount, playSfx, stopAllLoops } from './player';
import { getSystemVolume, isMuted, setMasterMultiplier } from './settings';
import { fetchedDebugSnapshot, discoverAudiospriteUrls, tryInitAudiosprite } from './audiosprite';
import type { AudioCatalogSnapshot, AudioRoute } from './types';
import type { AudioSubroute } from './catalog';

const AUDIO_SUBSYSTEM: Subsystem = 'audio';
let registered = false;

export function startAudioDiagnostics(): void {
  if (registered) return;
  registered = true;
  healthBus.register(AUDIO_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Awaiting bridge',
  });
  shareGlobal('__QPM_AUDIO__', getAudioDebugApi());
}

export function publishAudioHealth(): void {
  if (!registered) return;
  const snap = getAudioSnapshot();
  const sub = getSubroute();
  const status = snap.route === 'audiosprite' ? 'ok'
    : snap.route === 'fallback' ? 'degraded'
    : snap.ready ? 'failed' : 'starting';
  const routeLabel = snap.route === 'audiosprite' && sub ? `${snap.route}:${sub}` : snap.route;
  const message = snap.ready
    ? `${snap.sfxCount} SFX via ${routeLabel}`
    : 'Awaiting bridge';
  healthBus.publish({
    subsystem: AUDIO_SUBSYSTEM,
    category: 'core',
    status,
    message,
    metrics: {
      sfxCount: snap.sfxCount,
      activeLoops: snap.activeLoops,
      volume: snap.volume,
      mute: snap.mute ? 1 : 0,
      route: routeLabel,
    },
  });
}

export function getAudioSnapshot(): AudioCatalogSnapshot {
  return {
    ready: isAudioReady(),
    route: getRoute(),
    sfxCount: getSfxNames().length,
    activeLoops: getActiveLoopCount(),
    mute: isMuted(),
    volume: getSystemVolume(),
  };
}

interface AudioDebugApi {
  snapshot(): AudioCatalogSnapshot & { subroute: AudioSubroute };
  list(filter?: string): readonly string[];
  play(name: string, volume?: number): void;
  stopAll(): void;
  mute(): void;
  unmute(): void;
  route(): AudioRoute;
  subroute(): AudioSubroute;
  has(name: string): boolean;
  retry(): Promise<boolean>;
  urls(): { mp3: string; json: string } | null;
  fetchedInfo(): ReturnType<typeof fetchedDebugSnapshot>;
}

function getAudioDebugApi(): AudioDebugApi {
  return {
    snapshot: () => ({ ...getAudioSnapshot(), subroute: getSubroute() }),
    list: (filter?: string): readonly string[] => {
      const all = getSfxNames();
      if (!filter) return all;
      const needle = filter.toLowerCase();
      return all.filter(n => n.toLowerCase().includes(needle));
    },
    play: (name: string, volume?: number): void => {
      playSfx(name, volume !== undefined ? { volumeOverride: volume } : undefined);
    },
    stopAll: () => stopAllLoops(),
    mute: () => setMasterMultiplier(0),
    unmute: () => setMasterMultiplier(1),
    route: () => getRoute(),
    subroute: () => getSubroute(),
    has: (name: string) => hasSfx(name),
    retry: async (): Promise<boolean> => {
      retryCatalogNow();
      return await tryInitAudiosprite();
    },
    urls: () => discoverAudiospriteUrls(),
    fetchedInfo: () => fetchedDebugSnapshot(),
  };
}
