import { hasSfx, isAudioReady, playSfx } from '../../../audio';
import { readSync, subscribe, write } from '../../../core/gameState';
import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import { t } from '../../../i18n';
import { getInventoryItems } from '../../../store/inventory';
import { showToast } from '../../../ui/components';
import { sendRoomAction, type WebSocketSendResult } from '../../../websocket/api';
import { planSelect, type SelectTarget } from './core';

const diag = createFeatureDiagnostics('feature:selectItem', 'selectItem');

// The game's own pick/drop cosmetics (beta client/…/atoms/myAtoms.ts:480-506; avatarRiveConstants.ts:83-84).
const PICK = { animation: 'pickupObject', sfx: 'Object_PickUp' } as const;
const DROP = { animation: 'dropObject', sfx: 'Object_Drop' } as const;
// The server reply then the patch normally land well under this; a longer wait only delays the code.
const CONFIRM_MS = 3000;

/**
 * `bagFull`, `refused`, `superseded`: INP-5 storage fetch (a newer press came while the move was waiting).
 * `returned`, `returnRefused`: a fetched stack put away and sent back to its storage, or kept in the bag on refusal.
 */
export type SelectOutcome =
  | 'picked' | 'putAway' | 'missing' | 'failed' | 'bagFull' | 'refused' | 'superseded' | 'returned' | 'returnRefused';

export interface SelectResult {
  readonly outcome: SelectOutcome;
  readonly itemId?: string;
  readonly reason?: string;
}

export interface SelectConfirmState {
  readonly expected: string | null;
  readonly reply: string;
  /** Press → hand matched, null while waiting or when it never matched. */
  readonly tookMs: number | null;
  readonly took: boolean | null;
}

let animWarned = false;
const sfxWarned = new Set<string>();
let pressGen = 0;
let lastConfirm: SelectConfirmState | null = null;

function playSound(name: string): void {
  if (!isAudioReady()) return;
  if (hasSfx(name)) { playSfx(name); return; }
  if (sfxWarned.has(name)) return;
  sfxWarned.add(name);
  diag.warnFeature('QPM-SELECTITEM-002', { sfx: name });
}

async function triggerAnimation(animation: string): Promise<void> {
  const warn = (reason: string, cause?: unknown): void => {
    if (animWarned) return;
    animWarned = true;
    diag.warnFeature('QPM-SELECTITEM-001', { reason }, cause);
  };
  const playerId = readSync('playerId');
  if (!playerId) { warn('no-player'); return; }
  try {
    await write('avatarTriggerAnimation', { playerId, animation, skipSfx: true });
  } catch (err) {
    warn('write', err);
  }
}

function playCosmetics(pickup: boolean): void {
  const c = pickup ? PICK : DROP;
  playSound(c.sfx);
  void triggerAnimation(c.animation);
}

function waitForHand(expected: string | null, ms: number): Promise<boolean> {
  if (readSync('selectedItemId') === expected) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    let off: (() => void) | null = null;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off?.();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), ms);
    off = subscribe('selectedItemId', (v) => { if (v === expected) finish(true); });
    if (done) off();
  });
}

/** 'ok', the rejection code, or 'none' when the transport gives no result or it timed out (outcome unknown). */
export async function readReply(result: WebSocketSendResult): Promise<string> {
  if (!result.awaitResult) return 'none';
  try {
    const reply = await result.awaitResult();
    return reply.ok ? 'ok' : String(reply.code ?? 'rejected');
  } catch {
    return 'none';
  }
}

// A newer press supersedes this check, so a quick pick-then-put-away never reads as a failed pick.
async function confirmHand(expected: string | null, result: WebSocketSendResult, gen: number, startedAt: number): Promise<void> {
  const reply = await readReply(result);
  if (gen !== pressGen) return;
  const took = reply === 'ok' || reply === 'none' ? await waitForHand(expected, CONFIRM_MS) : false;
  if (gen !== pressGen) return;
  lastConfirm = { expected, reply, took, tookMs: took ? Date.now() - startedAt : null };
  if (!took) diag.warnFeature('QPM-SELECTITEM-003', { expected, held: readSync('selectedItemId'), reply });
}

/**
 * One press: pick the target into the hand, or put it away when it is already held (INP-4 D1, D4–D6).
 * `name` is the display name for the not-in-bag toast; the catalog id is used when absent.
 */
export function selectBagItem(target: SelectTarget, name?: string): SelectResult {
  const items = getInventoryItems().map(item => item.raw);
  const plan = planSelect(items, target, readSync('selectedItemId'));
  if (plan.action === 'missing') {
    showToast(t('feature.keybinds.notInBag', { item: name ?? target.id }));
    return { outcome: 'missing' };
  }
  return sendSelect(plan.itemId, plan.action === 'pickup');
}

/** The send half of a press: hold message, pick-up or drop, the game's cosmetics, then the hand check. */
export function sendSelect(itemId: string, pickup: boolean): SelectResult {
  const expected = pickup ? itemId : null;
  const startedAt = Date.now();
  // decorRotation 0: a fresh pick always sends 0 (live 2065, spec F23).
  const result = sendRoomAction('SetSelectedItem', { itemId: expected, decorRotation: 0 });
  if (!result.ok) return { outcome: 'failed', itemId, reason: result.reason ?? 'send_failed' };
  sendRoomAction(pickup ? 'PickupObject' : 'DropObject', {});
  playCosmetics(pickup);
  lastConfirm = { expected, reply: 'pending', took: null, tookMs: null };
  void confirmHand(expected, result, ++pressGen, startedAt);
  return { outcome: pickup ? 'picked' : 'putAway', itemId };
}

export function getSelectItemDebugState(): { lastConfirm: SelectConfirmState | null; animWarned: boolean; sfxWarned: string[] } {
  return { lastConfirm, animWarned, sfxWarned: [...sfxWarned] };
}
