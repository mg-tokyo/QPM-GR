import { pageWindow } from '../core/pageContext';

/** Detects the game version hash (e.g., "436ff68") from globals, then script/link tag URLs. */
export function detectGameVersion(): string {
  const win = pageWindow as any;
  const gv = win.gameVersion || win.MG_gameVersion || win.__MG_GAME_VERSION__;

  if (gv) {
    if (typeof gv.getVersion === 'function') {
      return gv.getVersion();
    }
    if (typeof gv.get === 'function') {
      return gv.get();
    }
    if (typeof gv === 'string') {
      return gv;
    }
  }

  const scriptUrls = Array.from(document.scripts || [])
    .map((s) => s.src)
    .filter(Boolean);

  const linkUrls = Array.from(document.querySelectorAll<HTMLLinkElement>('link[href]') || [])
    .map((l) => l.href);

  const urls = [...scriptUrls, ...linkUrls];

  // Look for pattern: /version/[HASH]/
  for (const u of urls) {
    const m = u.match(/\/version\/([^/]+)\//);
    if (m?.[1]) {
      return m[1];
    }
  }

  throw new Error('Version not found. Could not detect game version from DOM or global variables.');
}

export async function detectGameVersionWithRetry(
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 12000;
  const intervalMs = Math.max(50, options.intervalMs ?? 250);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      return detectGameVersion();
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Version not found after retry window.');
}

function resolveAssetsOrigin(origin?: string): string {
  const runtimeOrigin = getRuntimeWindow()?.location?.origin;
  const resolved = (origin && origin.trim()) || runtimeOrigin || 'https://magicgarden.gg';
  return resolved.replace(/\/$/, '');
}

/** Builds the base assets URL, e.g. "https://magicgarden.gg/version/436ff68/assets/". */
export function buildAssetsBaseUrl(origin?: string, version?: string): string {
  const resolvedVersion = (version && version.trim()) || detectGameVersion();
  return `${resolveAssetsOrigin(origin)}/version/${resolvedVersion}/assets/`;
}

export function isUserscriptEnv(): boolean {
  return typeof GM_xmlhttpRequest !== 'undefined';
}

export function getRuntimeWindow(): Window & typeof globalThis {
  return pageWindow as Window & typeof globalThis;
}
