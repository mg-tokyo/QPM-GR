import type { LegacyGmStorageApi, ModernGmStorageApi } from './storageBackends';

// The only file that names the userscript API. Managers that pass these as wrapper
// parameters (SMM) hide them from globalThis, so every lookup is a bare identifier.
declare const GM: unknown;
declare const GM_info: unknown;
declare const GM_getValue: unknown;
declare const GM_setValue: unknown;
declare const GM_deleteValue: unknown;
declare const GM_listValues: unknown;
declare const GM_xmlhttpRequest: unknown;
declare const GM_openInTab: unknown;
declare const unsafeWindow: unknown;

type AnyFn = (...args: never[]) => unknown;
type PageWindow = Window & typeof globalThis & Record<string, unknown>;

export interface GmXhrResponse {
  status: number;
  responseText: string;
  response?: unknown;
  finalUrl?: string;
  responseHeaders?: string;
}

export interface GmXhrDetails {
  method: 'GET' | 'POST' | 'HEAD';
  url: string;
  data?: string;
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: 'text' | 'blob' | 'arraybuffer';
  onload?: (res: GmXhrResponse) => void;
  onerror?: (err: unknown) => void;
  ontimeout?: () => void;
}

export type GmXhr = (details: GmXhrDetails) => unknown;

export interface GmOpenInTabOptions {
  active?: boolean;
  insert?: boolean;
  setParent?: boolean;
}

export interface GmInfo {
  handler: string | null;
  handlerVersion: string | null;
  scriptVersion: string | null;
}

function isFn(value: unknown): value is AnyFn {
  return typeof value === 'function';
}

function gmObject(): Record<string, unknown> | null {
  try {
    return typeof GM === 'object' && GM !== null ? (GM as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function gmMethod(name: string): AnyFn | null {
  const gm = gmObject();
  if (!gm) return null;
  try {
    const fn = gm[name];
    return isFn(fn) ? (fn.bind(gm) as AnyFn) : null;
  } catch {
    return null;
  }
}

export function gmLegacyStorage(): LegacyGmStorageApi | null {
  const getValue = typeof GM_getValue === 'function' ? GM_getValue : undefined;
  const setValue = typeof GM_setValue === 'function' ? GM_setValue : undefined;
  const deleteValue = typeof GM_deleteValue === 'function' ? GM_deleteValue : undefined;
  if (!isFn(getValue) || !isFn(setValue) || !isFn(deleteValue)) return null;
  const api: LegacyGmStorageApi = {
    getValue: getValue as LegacyGmStorageApi['getValue'],
    setValue: setValue as LegacyGmStorageApi['setValue'],
    deleteValue: deleteValue as LegacyGmStorageApi['deleteValue'],
  };
  const listValues = typeof GM_listValues === 'function' ? GM_listValues : undefined;
  if (isFn(listValues)) api.listValues = listValues as NonNullable<LegacyGmStorageApi['listValues']>;
  return api;
}

export function gmModernStorage(): ModernGmStorageApi | null {
  const getValue = gmMethod('getValue');
  const setValue = gmMethod('setValue');
  const deleteValue = gmMethod('deleteValue');
  if (!getValue || !setValue || !deleteValue) return null;
  const api: ModernGmStorageApi = {
    getValue: getValue as ModernGmStorageApi['getValue'],
    setValue: setValue as ModernGmStorageApi['setValue'],
    deleteValue: deleteValue as ModernGmStorageApi['deleteValue'],
  };
  const listValues = gmMethod('listValues');
  if (listValues) api.listValues = listValues as NonNullable<ModernGmStorageApi['listValues']>;
  return api;
}

// Tampermonkey exposes GM.xmlHttpRequest, SMM only GM.xmlhttpRequest (T0 probe, 2026-11-18).
export function gmXhr(): GmXhr | null {
  const legacy = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : undefined;
  if (isFn(legacy)) return legacy as GmXhr;
  const modern = gmMethod('xmlHttpRequest') ?? gmMethod('xmlhttpRequest');
  return modern ? (modern as GmXhr) : null;
}

export interface GmHttpOptions {
  method?: GmXhrDetails['method'];
  headers?: Record<string, string>;
  data?: string;
  timeoutMs?: number;
  responseType?: 'blob' | 'arraybuffer';
}

export type GmHttpOutcome =
  | { kind: 'load'; status: number; responseText: string; response: unknown }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' }
  | { kind: 'unavailable' };

function readLoad(res: GmXhrResponse, binary: boolean): GmHttpOutcome {
  let responseText = '';
  let response: unknown;
  try {
    if (!binary && typeof res.responseText === 'string') responseText = res.responseText;
    response = res.response;
  } catch { /* unreadable field */ }
  return { kind: 'load', status: res.status, responseText, response };
}

// Never rejects. Callers parse text themselves: SMM has no responseType 'json'.
export function gmHttpRequest(url: string, options: GmHttpOptions = {}): Promise<GmHttpOutcome> {
  const xhr = gmXhr();
  if (!xhr) return Promise.resolve({ kind: 'unavailable' });
  return new Promise((resolve) => {
    const details: GmXhrDetails = {
      method: options.method ?? 'GET',
      url,
      onload: (res) => resolve(readLoad(res, options.responseType !== undefined)),
      onerror: (error) => resolve({ kind: 'error', error }),
      ontimeout: () => resolve({ kind: 'timeout' }),
    };
    if (options.headers) details.headers = options.headers;
    if (options.data !== undefined) details.data = options.data;
    if (options.timeoutMs !== undefined) details.timeout = options.timeoutMs;
    if (options.responseType) details.responseType = options.responseType;
    try {
      xhr(details);
    } catch (error) {
      resolve({ kind: 'error', error });
    }
  });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && isFn((value as { then?: unknown }).then);
}

// Tampermonkey/Violentmonkey return a tab handle synchronously; SMM returns a Promise of
// `{ opened }` that can reject. False means "nothing opened": the caller uses its own fallback.
export async function gmOpenInTab(
  url: string,
  options: GmOpenInTabOptions = { active: true, insert: true, setParent: true },
): Promise<boolean> {
  const legacy = typeof GM_openInTab === 'function' ? GM_openInTab : undefined;
  const open = isFn(legacy) ? legacy : gmMethod('openInTab');
  if (!open) return false;
  try {
    const returned = (open as (url: string, options: GmOpenInTabOptions) => unknown)(url, options);
    const result = isThenable(returned) ? await returned : returned;
    if (typeof result === 'object' && result !== null && 'opened' in result) {
      return (result as { opened: unknown }).opened === true;
    }
    return true;
  } catch {
    return false;
  }
}

function readInfoObject(): Record<string, unknown> | null {
  try {
    if (typeof GM_info === 'object' && GM_info !== null) return GM_info as Record<string, unknown>;
  } catch { /* unreadable GM_info */ }
  const gm = gmObject();
  if (!gm) return null;
  try {
    const info = gm.info;
    return typeof info === 'object' && info !== null ? (info as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function gmInfo(): GmInfo | null {
  const info = readInfoObject();
  if (!info) return null;
  try {
    const script = info.script;
    return {
      handler: stringOrNull(info.scriptHandler),
      handlerVersion: stringOrNull(info.version),
      scriptVersion: typeof script === 'object' && script !== null
        ? stringOrNull((script as Record<string, unknown>).version)
        : null,
    };
  } catch {
    return null;
  }
}

export function gmUnsafeWindow(): PageWindow | null {
  try {
    return typeof unsafeWindow === 'object' && unsafeWindow !== null ? (unsafeWindow as PageWindow) : null;
  } catch {
    return null;
  }
}
