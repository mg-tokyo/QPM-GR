// Room session lifecycle (client/src/store/store.ts, live 1973).
// The game writes the socket close code on a permanent disconnect (e.g. VersionExpired = 4710), and the same
// code on an HTTP 409 carrying X-MagicCircle-Error-Code: VersionExpired. The session notice renders from it.
import { atomSource, defineKey } from '../define';

const isCodeOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isInteger(v));

export const SESSION_KEYS = {
  permanentlyDisconnectedReason: defineKey<number | null>({
    policy: 'client', tier: 'client', defaultValue: null,
    doc: 'Close code of a permanent disconnect, null while connected (game-written, read-only)',
    sources: [atomSource(/^permanentlyDisconnectedReasonAtom$/, 'client', { structure: isCodeOrNull })],
  }),
};
