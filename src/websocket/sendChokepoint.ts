// Finds the room connection's internal send method by shape: the one method
// both prototype sendMessage and trySendMessageNow call with arguments (game
// 1125: sendOpenMessage). Name-free so a rename or rebundle keeps working; any
// ambiguity returns null and the sequencer stays in slot mode.

const SLOT_KEYS: readonly string[] = ['sendMessage', 'trySendMessageNow'];
const CALLS_SLOT = /this\.(?:sendMessage|trySendMessageNow)\(/;
const verdicts = new WeakMap<object, string | null>();

function sourceOf(fn: unknown): string | null {
  if (typeof fn !== 'function') return null;
  try {
    const src = Function.prototype.toString.call(fn);
    return src.includes('[native code]') ? null : src;
  } catch {
    return null;
  }
}

// `this.x(<something>)` only: zero-argument calls (isConnected()) cannot be the writer.
function calleesWithArgs(fn: unknown): Set<string> | null {
  const src = sourceOf(fn);
  if (src === null) return null;
  const out = new Set<string>();
  const re = /this\.([A-Za-z_$][\w$]*)\(\s*[^)\s]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

function compute(proto: object): string | null {
  const rec = proto as Record<string, unknown>;
  const viaSend = calleesWithArgs(rec.sendMessage);
  const viaTry = calleesWithArgs(rec.trySendMessageNow);
  if (!viaSend || !viaTry) return null;
  const candidates = [...viaSend].filter(
    (k) => viaTry.has(k) && !SLOT_KEYS.includes(k) && typeof rec[k] === 'function',
  );
  if (candidates.length !== 1) return null;
  const key = candidates[0];
  if (key === undefined) return null;
  const src = sourceOf(rec[key]);
  if (src === null || CALLS_SLOT.test(src)) return null;
  return key;
}

export function discoverSendChokepoint(proto: object | null): string | null {
  if (!proto) return null;
  const cached = verdicts.get(proto);
  if (cached !== undefined) return cached;
  let key: string | null = null;
  try { key = compute(proto); } catch { key = null; }
  verdicts.set(proto, key);
  return key;
}
