// Responds to Starweaver Mod Manager GM-export requests so it can migrate
// TM/VM private GM storage into its own persistence layer. Protocol uses the
// __swmmType envelope key: request "gm-export-request" -> response
// "gm-export-response" with { nonce, values: Record<string, string> }.

import { exportAllValues } from './storage';

const ENVELOPE_KEY = '__swmmType';
const REQUEST_TYPE = 'gm-export-request';
const RESPONSE_TYPE = 'gm-export-response';

/**
 * Registers a one-time-per-page window message listener that answers export
 * requests from the Starweaver Mod Manager content bridge.
 *
 * Safe to call multiple times — a guard prevents duplicate registration.
 */
export function initGmExportBridge(): void {
  const guardKey = '__qpmGmExportBridgeInitialized';
  if ((window as unknown as Record<string, unknown>)[guardKey]) {
    return;
  }
  (window as unknown as Record<string, unknown>)[guardKey] = true;

  window.addEventListener('message', (event: MessageEvent) => {
    // Only handle messages from the same frame (rules out child frames / iframes)
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (
      !message ||
      typeof message !== 'object' ||
      message[ENVELOPE_KEY] !== REQUEST_TYPE ||
      typeof message.nonce !== 'string' ||
      message.nonce.length === 0
    ) {
      return;
    }

    const values = exportAllValues();

    // Use location.origin as targetOrigin so the response stays on this page.
    window.postMessage(
      { [ENVELOPE_KEY]: RESPONSE_TYPE, nonce: message.nonce, values },
      location.origin
    );
  });
}
