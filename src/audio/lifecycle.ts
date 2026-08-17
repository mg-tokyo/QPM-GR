import { injectAudioBridge } from './bridge';
import { onAudioReady, onAudioTimedOut, markFallbackReady, markNone, startCatalogPoll, stopCatalog } from './catalog';
import { discoverFallbackCatalog } from './fallback';
import { publishAudioHealth, startAudioDiagnostics } from './diagnostics';
import { attachGesturePrimer, stopAllLoops } from './player';
import { loadAudioPrefs, startAudioSettingsSubscriptions, stopAudioSettingsSubscriptions } from './settings';

let started = false;

export function initAudio(): void {
  if (started) return;
  started = true;

  startAudioDiagnostics();
  loadAudioPrefs();
  void startAudioSettingsSubscriptions();

  injectAudioBridge();
  attachGesturePrimer();

  onAudioReady(() => publishAudioHealth());

  onAudioTimedOut(() => {
    const catalog = discoverFallbackCatalog();
    if (catalog.length > 0) markFallbackReady(catalog);
    else markNone();
    publishAudioHealth();
  });

  startCatalogPoll();
}

export function stopAudio(): void {
  if (!started) return;
  started = false;
  stopAllLoops();
  stopAudioSettingsSubscriptions();
  stopCatalog();
}
