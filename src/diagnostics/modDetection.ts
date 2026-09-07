import { pageWindow } from '../core/pageContext';

export interface ModDetectionResult {
  /** Mods identified by a page global, e.g. "AriesMod 2.4". */
  readonly known: readonly string[];
  /** Foreign fingerprints no known mod claims, e.g. "WS.send", "room.send". */
  readonly signals: readonly string[];
}

type SignalProbe = () => boolean;

// Subsystems that already know about a foreign wrapper (command sequencer,
// catalog Object.* hooks) register here; diagnostics stays a leaf module.
const signalProbes = new Map<string, SignalProbe>();

export function registerForeignSignal(id: string, probe: SignalProbe): () => void {
  signalProbes.set(id, probe);
  return () => {
    if (signalProbes.get(id) === probe) signalProbes.delete(id);
  };
}

const KNOWN_MOD_GLOBALS: ReadonlyArray<{ global: string; label: string }> = [
  { global: 'AriesMod', label: 'AriesMod' },
  { global: 'starweaver', label: 'Starweaver' },
];

function readVersion(value: unknown): string | null {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
  const obj = value as Record<string, unknown>;
  for (const key of ['version', 'VERSION']) {
    try {
      const v = obj[key];
      if (typeof v === 'string' && v.length > 0 && v.length <= 24) return v;
    } catch {
      // getter threw — treat as absent
    }
  }
  return null;
}

function isNonNativeFunction(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  try {
    return !/\[native code\]/.test(Function.prototype.toString.call(fn));
  } catch {
    return true;
  }
}

// fetch is excluded: QPM patches it itself (rive-engine, custom skins).
function nativeFingerprints(): string[] {
  const win = pageWindow as unknown as Record<string, unknown>;
  const out: string[] = [];
  try {
    const ws = win.WebSocket as { prototype?: { send?: unknown } } | undefined;
    if (isNonNativeFunction(ws)) out.push('WebSocket');
    else if (ws && isNonNativeFunction(ws.prototype?.send)) out.push('WS.send');
  } catch { /* no access */ }
  try {
    const xhr = win.XMLHttpRequest as { prototype?: { open?: unknown } } | undefined;
    if (xhr && isNonNativeFunction(xhr.prototype?.open)) out.push('XHR.open');
  } catch { /* no access */ }
  return out;
}

export function detectOtherMods(): ModDetectionResult {
  const win = pageWindow as unknown as Record<string, unknown>;
  const known: string[] = [];
  for (const { global, label } of KNOWN_MOD_GLOBALS) {
    let value: unknown;
    try { value = win[global]; } catch { continue; }
    if (value === undefined || value === null) continue;
    const version = readVersion(value);
    known.push(version ? `${label} ${version}` : label);
  }

  const signals = nativeFingerprints();
  for (const [id, probe] of signalProbes) {
    try {
      if (probe()) signals.push(id);
    } catch {
      // probe failure is not a signal
    }
  }
  return { known, signals };
}

export function formatModsLine(result: ModDetectionResult): string | null {
  if (result.known.length === 0 && result.signals.length === 0) return null;
  const parts = [...result.known];
  if (result.signals.length > 0) parts.push(`+unknown(${result.signals.join(', ')})`);
  return `Mods: ${parts.join('  ')}`;
}
