import { subscribeAtomValue } from '../../../core/atomRegistry';
import { onActivePetInfos } from '../../../store/pets';
import { ctx } from './types';
import { refreshLayerBNow } from './layerB-schedule';

export function initTileObjectHook(): () => void {
  let unsub: (() => void) | null = null;
  let disposed = false;
  let firstFire = true;
  let debounceTimer = 0;

  void subscribeAtomValue('myData', () => {
    if (firstFire) { firstFire = false; return; }
    if (debounceTimer) return;
    debounceTimer = window.setTimeout(() => {
      debounceTimer = 0;
      ctx.contextRevision++;
      refreshLayerBNow();
    }, 2000);
  }).then((cleanup) => {
    if (disposed) { cleanup?.(); return; }
    unsub = cleanup;
  });

  return () => {
    disposed = true;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = 0; }
    unsub?.();
  };
}

export function initPetSwapHook(): () => void {
  let lastPetIdKey = '';
  return onActivePetInfos((infos) => {
    const key = infos.map((p) => p.petId).sort().join(',');
    if (key === lastPetIdKey) return;
    lastPetIdKey = key;
    ctx.contextRevision++;
    refreshLayerBNow();
  }, false);
}
