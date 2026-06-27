import { subscribeAtomValue } from '../../../core/atomRegistry';
import { onActivePetInfos } from '../../../store/pets';
import { ctx } from './types';
import { refreshLayerBNow } from './layerB-schedule';

export function initTileObjectHook(): () => void {
  let unsub: (() => void) | null = null;
  let disposed = false;
  let firstFire = true;

  void subscribeAtomValue('myData', () => {
    if (firstFire) { firstFire = false; return; }
    ctx.contextRevision++;
    refreshLayerBNow();
  }).then((cleanup) => {
    if (disposed) { cleanup?.(); return; }
    unsub = cleanup;
  });

  return () => {
    disposed = true;
    unsub?.();
  };
}

export function initPetSwapHook(): () => void {
  return onActivePetInfos(() => {
    ctx.contextRevision++;
    refreshLayerBNow();
  }, false);
}
