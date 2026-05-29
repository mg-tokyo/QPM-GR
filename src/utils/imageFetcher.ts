// src/utils/imageFetcher.ts
// Fetch external images via GM_xmlhttpRequest to bypass CSP img-src restrictions.

/**
 * Fetch an image URL via GM_xmlhttpRequest (bypasses CSP img-src),
 * returning a blob object URL. Falls back to the original URL if
 * GM_xmlhttpRequest is unavailable.
 */
export function fetchImageUrl(url: string): Promise<string> {
  if (typeof GM_xmlhttpRequest !== 'function') {
    return Promise.resolve(url);
  }

  return new Promise<string>((resolve) => {
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        onload(response: { response: Blob }) {
          try {
            const blob = response.response;
            if (blob instanceof Blob && blob.size > 0) {
              resolve(URL.createObjectURL(blob));
            } else {
              resolve(url);
            }
          } catch {
            resolve(url);
          }
        },
        onerror() {
          resolve(url);
        },
        ontimeout() {
          resolve(url);
        },
      } as never);
    } catch {
      resolve(url);
    }
  });
}
