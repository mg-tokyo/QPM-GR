import { S_LAST_THIRD, S_TILT_END } from '../math/zoomCurve';
import type { SPhase } from './zoomState';

/** How long after a forced exit 3D comes back on its own (P4 a: "within ~10 s"). */
export const RESUME_WINDOW_MS = 10_000;

export interface ResumePose { s: number; yaw: number; pitch: number }

/** The game moves its own camera, so 3D animates out (P4 a). Live v1419: shouldBlockZoom() is zoom.inputBlocked (a
 *  cutscene camera, the tram's focus zoom) or pi('cameraNavigation') (any modal, the inventory, a confirmation dialog's
 *  movement hold): those own input, not the camera, and 3D holds still under them. */
export function gameTakesCamera(zoom: { readonly inputBlocked?: boolean }, sys: { shouldBlockZoom(): boolean }): boolean {
  return typeof zoom.inputBlocked === 'boolean' ? zoom.inputBlocked : sys.shouldBlockZoom();
}

/** Where a forced exit should bring the camera back to: the pose being zoomed to, or null when the user was leaving 3D
 *  anyway. A pose inside the push-in band is never a rest point: it resolves to first person or the last third key. */
export function resumeTarget(phase: SPhase, target: number, firstPerson: boolean): number | null {
  if (phase === 'exit' || phase === 'leaving') return null;
  if (target >= 1) return firstPerson ? 1 : S_LAST_THIRD;
  return Math.min(S_LAST_THIRD, Math.max(S_TILT_END, target));
}

/** A forced exit's pose, kept until the block clears (then handed out once), the window lapses, or the user changes the
 *  game's zoom in 2D (they meant to stay out). */
export class ResumeWindow {
  private pose: ResumePose | null = null;
  private until = 0;
  private intent = 0;

  arm(pose: ResumePose, now: number, intent: number): void {
    this.pose = { s: pose.s, yaw: pose.yaw, pitch: pose.pitch };
    this.until = now + RESUME_WINDOW_MS;
    this.intent = intent;
  }

  pending(): boolean { return this.pose !== null; }

  /** clear: nothing blocks 3D any more. Returns the pose to resume to (once), or null. */
  take(now: number, clear: boolean, intent: number): ResumePose | null {
    const p = this.pose;
    if (!p) return null;
    if (now > this.until || intent !== this.intent) { this.pose = null; return null; }
    if (!clear) return null;
    this.pose = null;
    return p;
  }

  clear(): void { this.pose = null; }
}
