import { listSeenRivUrls } from '../../rive-engine/fetchInterceptor';
import { getAssetManifest, getBlob, joinPath } from '../manifest';
import { buildAssetsBaseUrl } from '../detector';
import { spriteLog } from '../diagnostics';

// Game ≥1973: manifest bundle `pets` holds one .riv per species, alias
// `rive/pets/<Species>[.riv]`, src `/runtime-assets/<Species>.<hash>.riv`.
// Game <1973: one `rive/pets` asset with every species as an artboard.
const SPLIT_ALIAS_RE = /^rive\/pets\/([^/.]+)(?:\.riv)?$/;
const OTHER_RIV_ALIAS_RE = /^rive\/([^/.]+)(?:\.riv)?$/;
const SEEN_SPLIT_URL_RE = /\/runtime-assets\/([A-Za-z0-9]+)\.[a-f0-9]+\.riv(?:[?#]|$)/;
const PETS_URL_MATCH = /(^|\/)pets(\.[a-f0-9]+)?\.riv(\?|$)/i;

export type PetRiveSources =
  | { kind: 'split'; bySpecies: Map<string, string>; otherRivNames: Set<string> }
  | { kind: 'single'; url: string }
  | { kind: 'none' };

type ManifestLike = {
  bundles?: Array<{
    assets?: Array<{
      alias?: string[];
      src?: Array<string | { src?: string }>;
    }>;
  }>;
};

function firstSrc(entries: Array<string | { src?: string }> | undefined): string | null {
  for (const entry of entries ?? []) {
    const src = typeof entry === 'string' ? entry : entry?.src;
    if (typeof src === 'string' && src) return src;
  }
  return null;
}

function absoluteUrl(path: string, base: string, origin: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/')) return `${origin}${path}`;
  return joinPath(base, path);
}

type ManifestWalk = { bySpecies: Map<string, string>; otherRivNames: Set<string>; singlePath: string | null };

function walkManifest(manifest: ManifestLike, base: string, origin: string): ManifestWalk {
  const bySpecies = new Map<string, string>();
  const otherRivNames = new Set<string>();
  let singlePath: string | null = null;

  for (const bundle of manifest.bundles ?? []) {
    for (const asset of bundle.assets ?? []) {
      const aliases = asset.alias ?? [];
      const src = firstSrc(asset.src);
      if (!src) continue;
      let matchedPets = false;
      for (const alias of aliases) {
        const split = SPLIT_ALIAS_RE.exec(alias);
        if (split?.[1]) {
          bySpecies.set(split[1], absoluteUrl(src, base, origin));
          matchedPets = true;
          break;
        }
        if (alias === 'rive/pets' || alias === 'rive/pets.riv') {
          singlePath ??= src;
          matchedPets = true;
          break;
        }
      }
      if (matchedPets) continue;
      for (const alias of aliases) {
        const other = OTHER_RIV_ALIAS_RE.exec(alias);
        if (other?.[1]) otherRivNames.add(other[1]);
      }
    }
  }

  return { bySpecies, otherRivNames, singlePath };
}

/** Pure manifest walk; `otherRivNames` lists the non-pet .riv bundles (avatar, currency, …). */
export function collectPetRiveSources(manifest: ManifestLike, base: string, origin: string): PetRiveSources {
  const { bySpecies, otherRivNames, singlePath } = walkManifest(manifest, base, origin);
  if (bySpecies.size > 0) return { kind: 'split', bySpecies, otherRivNames };
  if (singlePath) return { kind: 'single', url: absoluteUrl(singlePath, base, origin) };
  return { kind: 'none' };
}

/** Species from already-fetched per-species URLs; `excludeNames` are the manifest's non-pet .riv bundles. */
export function collectSeenSplitSources(seenUrls: string[], excludeNames: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const url of seenUrls) {
    const match = SEEN_SPLIT_URL_RE.exec(url);
    const name = match?.[1];
    if (!name || excludeNames.has(name) || out.has(name)) continue;
    out.set(name, url);
  }
  return out;
}

function seenRivUrls(): string[] {
  try {
    return listSeenRivUrls();
  } catch {
    return []; // engine may not be initialized yet
  }
}

export async function discoverPetRiveSources(): Promise<PetRiveSources> {
  let otherRivNames = new Set<string>();
  try {
    const base = buildAssetsBaseUrl();
    const manifest = await getAssetManifest<ManifestLike>(base);
    const walk = walkManifest(manifest, base, window.location.origin);
    otherRivNames = walk.otherRivNames;
    if (walk.bySpecies.size > 0) return { kind: 'split', bySpecies: walk.bySpecies, otherRivNames };
    if (walk.singlePath) return { kind: 'single', url: absoluteUrl(walk.singlePath, base, window.location.origin) };
  } catch (error) {
    spriteLog('warn', 'pet-rive-manifest-lookup-failed', 'Manifest lookup for pet .riv files failed', {
      error: String((error as Error)?.message ?? error),
    });
  }

  const seen = seenRivUrls();
  const bySpecies = collectSeenSplitSources(seen, otherRivNames);
  if (bySpecies.size > 0) return { kind: 'split', bySpecies, otherRivNames };
  const single = seen.find((url) => PETS_URL_MATCH.test(url));
  if (single) return { kind: 'single', url: single };
  return { kind: 'none' };
}

// Game assets are same-origin; the interceptor may record them relative or absolute.
function pathKey(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
}

/** Split-mode species whose file the game has already fetched (cheap to warm: HTTP cache hit). */
export function listSeenSpecies(sources: PetRiveSources): string[] {
  if (sources.kind !== 'split') return [];
  const seen = new Set(seenRivUrls().map(pathKey));
  const out: string[] = [];
  for (const [species, url] of sources.bySpecies) {
    if (seen.has(pathKey(url))) out.push(species);
  }
  return out;
}

/** Species whose per-species file a just-seen .riv fetch belongs to, or null. */
export function speciesForSeenUrl(sources: PetRiveSources, url: string): string | null {
  if (sources.kind !== 'split') return null;
  const key = pathKey(url);
  for (const [species, candidate] of sources.bySpecies) {
    if (pathKey(candidate) === key) return species;
  }
  return null;
}

export async function fetchRivBytes(url: string): Promise<Uint8Array | null> {
  try {
    const blob = await getBlob(url);
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  } catch (error) {
    spriteLog('warn', 'pet-rive-fetch-failed', 'Pet .riv fetch failed', {
      url,
      error: String((error as Error)?.message ?? error),
    });
    return null;
  }
}
