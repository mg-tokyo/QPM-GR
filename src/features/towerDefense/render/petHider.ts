import { onPixiNodeAddedByPrefix, onPixiNodeRemovedByPrefix } from '../../../core/pixiSceneEvents';
import { createNamedLogger } from '../../../diagnostics/logger';

const log = createNamedLogger('td');

// Hides every player/NPC pet in the world while TD is running. Pets are
// Jotai-driven (renderedPetInfosAtom), so the patch-stage state doctor used
// for garden tiles cannot suppress them — the atom is written after patch
// subscribers fire (beta RoomConnection.ts:825-829). We hide at the PIXI
// layer instead by matching PetView container labels (`Pet: <species>`,
// beta PetView.ts:328-332), discovered push-style via the addChild hook.
//
// PetSystem re-asserts `visible = true` on viewport entry (PetSystem.ts:305),
// so after the real setter runs once we shadow `visible` with an own accessor
// that swallows writes — no per-frame sweep needed. Restore deletes the
// accessor and flips the real setter back on.

const PET_LABEL_PREFIX = 'Pet: ';

interface PixiNode {
  label?: unknown;
  visible?: boolean;
  destroyed?: unknown;
}

interface HiderState {
  unsubscribeAdded: () => void;
  unsubscribeRemoved: () => void;
  hidden: Set<PixiNode>;
}

let state: HiderState | null = null;

function isNode(v: unknown): v is PixiNode {
  return !!v && typeof v === 'object';
}

function hide(node: PixiNode): void {
  const s = state;
  if (!s || s.hidden.has(node) || node.destroyed === true) return;
  try {
    node.visible = false;
    Object.defineProperty(node, 'visible', {
      configurable: true,
      enumerable: false,
      get: () => false,
      set: () => { /* game re-assertions are swallowed while TD runs */ },
    });
    s.hidden.add(node);
  } catch (err) {
    log.warn('QPM-TD-PETHIDE-001', { reason: 'hide_threw' }, err);
  }
}

function restore(node: PixiNode): void {
  try {
    if (Object.prototype.hasOwnProperty.call(node, 'visible')) {
      delete (node as { visible?: boolean }).visible;
    }
    if (node.destroyed !== true) node.visible = true;
  } catch { /* ignore */ }
}

export function initPetHider(): void {
  if (state) return;
  const hidden = new Set<PixiNode>();
  state = {
    hidden,
    unsubscribeAdded: () => {},
    unsubscribeRemoved: () => {},
  };
  state.unsubscribeAdded = onPixiNodeAddedByPrefix(PET_LABEL_PREFIX, (node) => {
    if (isNode(node)) hide(node);
  });
  state.unsubscribeRemoved = onPixiNodeRemovedByPrefix(PET_LABEL_PREFIX, (node) => {
    const s = state;
    if (!s || !isNode(node) || !s.hidden.has(node)) return;
    s.hidden.delete(node);
    restore(node);
  });
}

export function stopPetHider(): void {
  const s = state;
  if (!s) return;
  state = null;
  s.unsubscribeAdded();
  s.unsubscribeRemoved();
  for (const node of s.hidden) restore(node);
  s.hidden.clear();
}
