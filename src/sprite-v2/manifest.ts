import type { Manifest, AtlasData } from './types';

const REQUEST_TIMEOUT_MS = 20000;

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function fetchRequest(url: string, type: 'text' | 'blob'): Promise<any> {
  const init: RequestInit = {};
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  if (type === 'blob') {
    return fetch(url, init).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} (${url})`);
      return r.blob();
    });
  }
  return fetch(url, init).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} (${url})`);
    return r.text().then((text) => ({ responseText: text }));
  });
}

/**
 * Same-origin URLs (all game assets — the base is built from location.origin)
 * use plain fetch: Violentmonkey MV3 can drop GM_xmlhttpRequest callbacks
 * entirely (no onload/onerror ever fires), which hung sprite boot forever and
 * blocked UI creation. GM path is kept for cross-origin only, with a real
 * `timeout` value — without it ontimeout never fires.
 */
function gmRequest(url: string, type: 'text' | 'blob'): Promise<any> {
  if (isSameOrigin(url)) {
    return fetchRequest(url, type);
  }

  if (typeof GM_xmlhttpRequest !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reqConfig: any = {
        method: 'GET',
        url,
        timeout: REQUEST_TIMEOUT_MS,
        onload: (r: any) =>
          r.status >= 200 && r.status < 300
            ? resolve(r)
            : reject(new Error(`HTTP ${r.status} (${url})`)),
        onerror: () => reject(new Error(`Network error (${url})`)),
        ontimeout: () => reject(new Error(`Timeout (${url})`)),
      };

      if (type === 'blob') {
        reqConfig.responseType = 'blob';
      }

      GM_xmlhttpRequest(reqConfig);
    });
  }

  return fetchRequest(url, type);
}

export async function getJSON<T = any>(url: string): Promise<T> {
  const response = await gmRequest(url, 'text');
  const text = response.responseText || response;
  return JSON.parse(text) as T;
}

export async function getBlob(url: string): Promise<Blob> {
  const response = await gmRequest(url, 'blob');
  return response.response || response;
}

export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image decode failed'));
    };

    img.src = url;
  });
}

export function joinPath(base: string, path: string): string {
  return base.replace(/\/?$/, '/') + String(path || '').replace(/^\//, '');
}

export function dirOf(path: string): string {
  return path.lastIndexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

export function relPath(base: string, path: string): string {
  if (typeof path !== 'string') return path;
  return path.startsWith('/') ? path.slice(1) : dirOf(base) + path;
}

export function extractAtlasJsons(manifest: Manifest): Set<string> {
  const jsons = new Set<string>();

  for (const bundle of manifest.bundles || []) {
    for (const asset of bundle.assets || []) {
      for (const srcItem of asset.src || []) {
        const src = typeof srcItem === 'string' ? srcItem : (srcItem as any).src;
        if (typeof src !== 'string') continue;
        if (!src.endsWith('.json')) continue;
        if (src === 'manifest.json') continue;
        if (src.startsWith('audio/')) continue;

        jsons.add(src);
      }
    }
  }

  return jsons;
}

/**
 * Loads all atlas JSON files from manifest, following related_multi_packs
 */
export async function loadAtlasJsons(
  base: string,
  manifest: Manifest
): Promise<Record<string, AtlasData>> {
  const jsons = extractAtlasJsons(manifest);
  const seen = new Set<string>();
  const data: Record<string, AtlasData> = {};

  const loadOne = async (path: string): Promise<void> => {
    if (seen.has(path)) return;
    seen.add(path);

    const json = await getJSON<AtlasData>(joinPath(base, path));
    data[path] = json;

    // Handle related multi-packs (sprites split across multiple atlases)
    if (json?.meta?.related_multi_packs) {
      for (const rel of json.meta.related_multi_packs) {
        await loadOne(relPath(path, rel));
      }
    }
  };

  await Promise.all(Array.from(jsons).map((p) => loadOne(p)));

  return data;
}

export function isAtlas(j: any): j is AtlasData {
  return j && typeof j === 'object' && j.frames && j.meta && typeof j.meta.image === 'string';
}

export function splitKey(key: string): string[] {
  return String(key || '')
    .split('/')
    .filter(Boolean);
}

export function categoryOf(key: string, catLevels = 1): string {
  const parts = splitKey(key);
  const start = parts[0] === 'sprite' || parts[0] === 'sprites' ? 1 : 0;
  const width = Math.max(1, catLevels | 0);
  return parts.slice(start, start + width).join('/') || 'misc';
}

/**
 * Parses animation frame from key (e.g., "sprite_001.png" → { baseKey, idx: 1 })
 */
export function animParse(key: string): { baseKey: string; idx: number; frameKey: string } | null {
  const parts = splitKey(key);
  const last = parts[parts.length - 1];
  const match = last && last.match(/^(.*?)(?:[_-])(\d{1,6})(\.[a-z0-9]+)?$/i);

  if (!match) return null;

  const baseName = (match[1] || '') + (match[3] || '');
  const idx = Number(match[2]);

  if (!baseName || !Number.isFinite(idx)) return null;

  return {
    baseKey: parts.slice(0, -1).concat(baseName).join('/'),
    idx,
    frameKey: key,
  };
}
