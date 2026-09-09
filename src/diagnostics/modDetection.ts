import { pageWindow } from '../core/pageContext';

export interface WrapperFingerprint {
  /** Which native was wrapped, e.g. "WS.send". */
  readonly target: string;
  /** FNV-1a 32-bit hex of the collapsed wrapper source. */
  readonly hash: string;
  /** Whitespace-collapsed source excerpt for manual identification in reports. */
  readonly excerpt: string;
  /** Label when the source matched WRAPPER_SIGNATURES, else null. */
  readonly label: string | null;
}

export interface ModDetectionResult {
  /** Mods identified by a page global or wrapper signature, e.g. "AriesMod 2.4". */
  readonly known: readonly string[];
  /** Heuristic global-sweep hits, live this session, e.g. "SomeGlobal 1.3?". */
  readonly discovered: readonly string[];
  /** Unidentified foreign wrappers on natives QPM does not patch itself. */
  readonly wrappers: readonly WrapperFingerprint[];
  /** Foreign fingerprints from registered probes, e.g. "room.send". */
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

// Grows from real Discord reports: a stable substring of the collapsed wrapper
// source identifies the mod even when it carries no global.
const WRAPPER_SIGNATURES: ReadonlyArray<{ pattern: string; label: string }> = [];

const EXCERPT_MAX = 72;
const SWEEP_MAX_RESULTS = 6;

// QPM's own page globals, game globals, and version-bearing libraries — never mod evidence.
const SWEEP_EXCLUDE_PREFIXES: readonly string[] = [
  'QPM', '__QPM', '__qpm', '__MG_', 'MagicCircle', 'webpack', '__REACT', '__NEXT', '__VUE',
  // 'GPU' covers WebGPU spec interfaces (GPUMapMode etc.) whose names contain "Mod"
  // and would otherwise pass the mod-name hint. '__cf' covers Cloudflare's __cfBeacon
  // and siblings on the game's CDN.
  'GPU', '__cf',
];
const SWEEP_EXCLUDE_EXACT: ReadonlySet<string> = new Set([
  'Sprites',
  'PIXI', 'React', 'ReactDOM', 'THREE', 'Vue', 'jQuery', '$', '_',
  'rive', 'Rive', 'regeneratorRuntime', 'Modernizr',
  '__SENTRY__',
  ...KNOWN_MOD_GLOBALS.map((k) => k.global),
]);
const MOD_NAME_HINT = /(mod|cheat|hack|trainer)/i;

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

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Same convention as brandWrapper() in src/websocket/sendChain.ts — duplicated
// so diagnostics keeps zero non-core imports.
function isQpmBranded(fn: unknown): boolean {
  try {
    return (fn as { __qpmWrapped?: unknown } | null)?.__qpmWrapped === true;
  } catch {
    return false;
  }
}

function fingerprintWrapper(target: string, fn: unknown): WrapperFingerprint | null {
  if (typeof fn !== 'function' || isQpmBranded(fn)) return null;
  let src: string;
  try {
    src = Function.prototype.toString.call(fn);
  } catch {
    // Native toString never throws — a throwing function is itself a wrap signal.
    src = '(unreadable)';
  }
  if (/\[native code\]/.test(src)) return null;
  const collapsed = src.replace(/\s+/g, ' ').trim();
  const sig = WRAPPER_SIGNATURES.find((s) => collapsed.includes(s.pattern));
  return {
    target,
    hash: fnv1a(collapsed),
    excerpt: collapsed.slice(0, EXCERPT_MAX),
    label: sig ? sig.label : null,
  };
}

// fetch is excluded: QPM patches it itself (rive-engine, custom skins).
export function collectWrapperFingerprints(
  win: Record<string, unknown> = pageWindow as unknown as Record<string, unknown>,
): WrapperFingerprint[] {
  const out: WrapperFingerprint[] = [];
  try {
    const ws = win.WebSocket as { prototype?: { send?: unknown } } | undefined;
    const ctor = fingerprintWrapper('WebSocket', ws);
    if (ctor) out.push(ctor);
    else if (ws) {
      const send = fingerprintWrapper('WS.send', ws.prototype?.send);
      if (send) out.push(send);
    }
  } catch { /* no access */ }
  try {
    const xhr = win.XMLHttpRequest as { prototype?: { open?: unknown } } | undefined;
    if (xhr) {
      const open = fingerprintWrapper('XHR.open', xhr.prototype?.open);
      if (open) out.push(open);
    }
  } catch { /* no access */ }
  return out;
}

export function sweepModGlobals(
  win: Record<string, unknown> = pageWindow as unknown as Record<string, unknown>,
): string[] {
  let names: string[];
  try {
    names = Object.getOwnPropertyNames(win);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (out.length >= SWEEP_MAX_RESULTS) break;
    if (SWEEP_EXCLUDE_EXACT.has(name)) continue;
    if (SWEEP_EXCLUDE_PREFIXES.some((p) => name.startsWith(p))) continue;
    let value: unknown;
    try {
      value = win[name];
    } catch {
      continue;
    }
    if (!value || value === win) continue;
    if (typeof value !== 'object' && typeof value !== 'function') continue;
    const version = readVersion(value);
    if (version) out.push(`${name} ${version}?`);
    else if (typeof value === 'object' && MOD_NAME_HINT.test(name)) out.push(`${name}?`);
  }
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

  const fingerprints = collectWrapperFingerprints(win);
  for (const w of fingerprints) {
    if (w.label) known.push(`${w.label} (${w.target})`);
  }

  const signals: string[] = [];
  for (const [id, probe] of signalProbes) {
    try {
      if (probe()) signals.push(id);
    } catch {
      // probe failure is not a signal
    }
  }

  return {
    known,
    discovered: sweepModGlobals(win),
    wrappers: fingerprints.filter((w) => w.label === null),
    signals,
  };
}

export function formatModsLine(result: ModDetectionResult): string | null {
  const parts = [...result.known, ...result.discovered];
  for (const w of result.wrappers) {
    parts.push(`+wrapped(${w.target}#${w.hash} "${w.excerpt}")`);
  }
  if (result.signals.length > 0) parts.push(`+unknown(${result.signals.join(', ')})`);
  if (parts.length === 0) return null;
  return `Mods: ${parts.join('  ')}`;
}
