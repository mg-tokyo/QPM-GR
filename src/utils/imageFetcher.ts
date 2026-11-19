import { gmHttpRequest } from './gm';

/**
 * Fetch an image URL via GM_xmlhttpRequest (bypasses CSP img-src),
 * returning a blob object URL. Falls back to the original URL if
 * GM_xmlhttpRequest is unavailable.
 */
export async function fetchImageUrl(url: string): Promise<string> {
  const res = await gmHttpRequest(url, { responseType: 'blob', timeoutMs: 15000 });
  if (res.kind !== 'load') return url;
  try {
    const blob = res.response;
    return blob instanceof Blob && blob.size > 0 ? URL.createObjectURL(blob) : url;
  } catch {
    return url;
  }
}
