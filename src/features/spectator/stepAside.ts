import type { GridPosition } from '../../types/gameAtoms';
import type { PauseReason } from './state';

export type CameraWriteKey = 'cutsceneCameraTarget' | 'freelookCameraPosition';

export interface AsideInputs {
  cutsceneActive: boolean;
  tramActive: boolean;
  /** The key targetValue was read from; lastWritten is QPM's last write to that same key. */
  targetKey: CameraWriteKey;
  targetValue: GridPosition | null;
  lastWritten: GridPosition | null;
  uiOwnsInput: boolean;
}

export const sameGrid = (a: GridPosition | null, b: GridPosition | null): boolean => !!a && !!b && a.x === b.x && a.y === b.y;

export function stepAsideReason(i: AsideInputs): PauseReason | null {
  if (i.cutsceneActive) return 'cutscene';
  if (i.tramActive) return 'tram';
  // Only the cutscene target has foreign writers to wait out (Iris's pan; the cutscene end nulls it, S F2). The freelook
  // position is never null, so a "not ours" rule there would pause a real spectator for good.
  if (i.targetKey === 'cutsceneCameraTarget' && i.targetValue !== null && !sameGrid(i.targetValue, i.lastWritten)) return 'foreign';
  if (i.uiOwnsInput) return 'ui';
  return null;
}

/** Re-chosen every frame, so a seat change mid-spectate switches in one frame (S §4.2). */
export function targetKeyFor(presence: 'seated' | 'spectating' | 'unseated'): CameraWriteKey | null {
  if (presence === 'seated') return 'cutsceneCameraTarget';
  if (presence === 'spectating') return 'freelookCameraPosition';
  return null;
}
