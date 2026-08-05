import { listSeenRivUrls } from '../../rive-engine/fetchInterceptor';
import { getBlob, getJSON, joinPath } from '../manifest';
import { buildAssetsBaseUrl } from '../detector';
import { spriteLog } from '../diagnostics';

const PETS_URL_MATCH = /(^|\/)pets(\.[a-f0-9]+)?\.riv(\?|$)/i;

type ManifestLike = {
  bundles?: Array<{
    assets?: Array<{
      alias?: string[];
      src?: Array<string | { src?: string }>;
    }>;
  }>;
};

function findPetsUrlInSeen(): string | null {
  try {
    for (const url of listSeenRivUrls()) {
      if (PETS_URL_MATCH.test(url)) return url;
    }
  } catch {
    // engine may not be initialized yet
  }
  return null;
}

function findPetsPathInManifest(manifest: ManifestLike): string | null {
  for (const bundle of manifest.bundles ?? []) {
    for (const asset of bundle.assets ?? []) {
      const aliases = asset.alias ?? [];
      const isPetsAlias = aliases.some((a) => a === 'rive/pets' || a === 'rive/pets.riv');
      if (!isPetsAlias) continue;
      for (const entry of asset.src ?? []) {
        const src = typeof entry === 'string' ? entry : entry?.src;
        if (typeof src === 'string' && src) return src;
      }
    }
  }
  return null;
}

async function discoverViaManifest(): Promise<string | null> {
  try {
    const base = buildAssetsBaseUrl();
    const manifest = await getJSON<ManifestLike>(joinPath(base, 'manifest.json'));
    const petsPath = findPetsPathInManifest(manifest);
    if (!petsPath) return null;
    if (/^https?:\/\//i.test(petsPath)) return petsPath;
    if (petsPath.startsWith('/')) return `${window.location.origin}${petsPath}`;
    return joinPath(base, petsPath);
  } catch (error) {
    spriteLog('warn', 'pet-rive-manifest-lookup-failed', 'Manifest lookup for pets.riv failed', {
      error: String((error as Error)?.message ?? error),
    });
    return null;
  }
}

export async function discoverPetsRivUrl(): Promise<string | null> {
  const seen = findPetsUrlInSeen();
  if (seen) return seen;
  return discoverViaManifest();
}

export async function fetchPetsRivBytes(): Promise<Uint8Array | null> {
  const url = await discoverPetsRivUrl();
  if (!url) {
    spriteLog('warn', 'pet-rive-url-missing', 'pets.riv URL not discoverable', undefined, {
      onceKey: 'pet-rive-url-missing',
    });
    return null;
  }
  try {
    const blob = await getBlob(url);
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  } catch (error) {
    spriteLog('warn', 'pet-rive-fetch-failed', 'pets.riv fetch failed', {
      url,
      error: String((error as Error)?.message ?? error),
    });
    return null;
  }
}
