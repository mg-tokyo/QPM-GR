import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Layer = typeof import('./gm');

// SMM's wrapper parameter list, in order (Starweaver-Mod-Manager src/mods/bundle.ts GM_BINDINGS).
const BINDINGS = [
  'GM', 'GM_info', 'GM_addStyle', 'GM_addElement', 'GM_getResourceText', 'GM_getResourceURL',
  'GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues', 'GM_setValues', 'GM_getValues',
  'GM_deleteValues', 'GM_xmlhttpRequest', 'GM_openInTab', 'GM_registerMenuCommand',
  'GM_unregisterMenuCommand', 'GM_download', 'GM_addValueChangeListener',
  'GM_removeValueChangeListener', 'unsafeWindow',
] as const;
type Binding = (typeof BINDINGS)[number];
type Api = Partial<Record<Binding, unknown>>;

const COMPILED = transformSync(
  readFileSync(fileURLToPath(new URL('./gm.ts', import.meta.url)), 'utf8'),
  { loader: 'ts', format: 'cjs', target: 'es2020' },
).code;

// SMM closure style: the layer's source is a function body whose parameters are the API.
function loadWrapped(params: Api): Layer {
  const mod = { exports: {} as Record<string, unknown> };
  const body = new Function('module', 'exports', ...BINDINGS, COMPILED) as (...args: unknown[]) => void;
  body(mod, mod.exports, ...BINDINGS.map((name) => params[name]));
  return mod.exports as unknown as Layer;
}

// Tampermonkey / old SMM style: no parameters, the API lives on the global object.
function loadUnwrapped(): Layer {
  const mod = { exports: {} as Record<string, unknown> };
  const body = new Function('module', 'exports', COMPILED) as (...args: unknown[]) => void;
  body(mod, mod.exports);
  return mod.exports as unknown as Layer;
}

function stubGlobals(api: Api): void {
  for (const [name, value] of Object.entries(api)) vi.stubGlobal(name, value);
}

function fakeApi(): Api & { GM: Record<string, unknown> } {
  const gm: Record<string, unknown> = {};
  gm.getValue = vi.fn(function (this: unknown) { return Promise.resolve(this === gm ? 'bound' : 'unbound'); });
  gm.setValue = vi.fn(() => Promise.resolve());
  gm.deleteValue = vi.fn(() => Promise.resolve());
  gm.listValues = vi.fn(() => Promise.resolve([]));
  return {
    GM: gm,
    GM_info: { scriptHandler: 'Starweaver Mod Manager', version: '0.1.8', script: { version: '3.3.65' } },
    GM_getValue: vi.fn(),
    GM_setValue: vi.fn(),
    GM_deleteValue: vi.fn(),
    GM_listValues: vi.fn(() => []),
    GM_xmlhttpRequest: vi.fn(),
    GM_openInTab: vi.fn(() => ({ closed: false })),
    unsafeWindow: { page: true },
  };
}

function expectAllFound(layer: Layer, api: ReturnType<typeof fakeApi>): void {
  const legacy = layer.gmLegacyStorage();
  expect(legacy?.getValue).toBe(api.GM_getValue);
  expect(legacy?.setValue).toBe(api.GM_setValue);
  expect(legacy?.deleteValue).toBe(api.GM_deleteValue);
  expect(legacy?.listValues).toBe(api.GM_listValues);
  expect(layer.gmModernStorage()).not.toBeNull();
  expect(layer.gmXhr()).toBe(api.GM_xmlhttpRequest);
  expect(layer.gmInfo()).toEqual({ handler: 'Starweaver Mod Manager', handlerVersion: '0.1.8', scriptVersion: '3.3.65' });
  expect(layer.gmUnsafeWindow()).toBe(api.unsafeWindow);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gm layer under an SMM-style closure', () => {
  it('finds every API through the parameters while globalThis has none of them', async () => {
    for (const name of BINDINGS) expect(name in globalThis).toBe(false);
    const api = fakeApi();
    const layer = loadWrapped(api);
    expectAllFound(layer, api);
    await expect(layer.gmModernStorage()?.getValue('k')).resolves.toBe('bound');
    await expect(layer.gmOpenInTab('https://example.com/')).resolves.toBe(true);
  });

  it('treats undefined (ungranted) parameters as absent even when page globals exist', async () => {
    const pageApi = fakeApi();
    stubGlobals(pageApi);
    const layer = loadWrapped({});
    expect(layer.gmLegacyStorage()).toBeNull();
    expect(layer.gmModernStorage()).toBeNull();
    expect(layer.gmXhr()).toBeNull();
    expect(layer.gmInfo()).toBeNull();
    expect(layer.gmUnsafeWindow()).toBeNull();
    await expect(layer.gmOpenInTab('https://example.com/')).resolves.toBe(false);
    expect(pageApi.GM_openInTab).not.toHaveBeenCalled();
  });

  it('touches nothing at import', () => {
    let reads = 0;
    const trap = <T extends object>(target: T): T => new Proxy(target, { get: (t, p, r) => { reads += 1; return Reflect.get(t, p, r); } });
    const api = fakeApi();
    const layer = loadWrapped({ ...api, GM: trap(api.GM), GM_info: trap(api.GM_info as object), unsafeWindow: trap(api.unsafeWindow as object) });
    expect(reads).toBe(0);
    layer.gmInfo();
    expect(reads).toBeGreaterThan(0);
  });
});

describe('gm layer with the API on the global object', () => {
  it('finds every API through bare identifiers', () => {
    const api = fakeApi();
    stubGlobals(api);
    expectAllFound(loadUnwrapped(), api);
  });

  it('resolves at call time, not at import', () => {
    const layer = loadUnwrapped();
    expect(layer.gmLegacyStorage()).toBeNull();
    expect(layer.gmXhr()).toBeNull();
    const api = fakeApi();
    stubGlobals(api);
    expect(layer.gmLegacyStorage()?.getValue).toBe(api.GM_getValue);
    expect(layer.gmXhr()).toBe(api.GM_xmlhttpRequest);
  });
});

describe('gmXhr fallbacks', () => {
  it('prefers GM.xmlHttpRequest, then GM.xmlhttpRequest, bound to GM', () => {
    const gm: Record<string, unknown> = {};
    const lower = vi.fn(function (this: unknown) { return this; });
    gm.xmlhttpRequest = lower;
    expect(loadWrapped({ GM: gm }).gmXhr()?.({ method: 'GET', url: 'https://x/' })).toBe(gm);
    const upper = vi.fn(function (this: unknown) { return this; });
    gm.xmlHttpRequest = upper;
    loadWrapped({ GM: gm }).gmXhr()?.({ method: 'GET', url: 'https://x/' });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).toHaveBeenCalledTimes(1);
  });
});

describe('gmOpenInTab', () => {
  const url = 'https://example.com/a';
  const open = (impl: unknown): Promise<boolean> => loadWrapped({ GM_openInTab: impl }).gmOpenInTab(url);

  it('passes the default options and reports a sync tab handle as opened', async () => {
    const fn = vi.fn(() => ({ closed: false }));
    await expect(open(fn)).resolves.toBe(true);
    expect(fn).toHaveBeenCalledWith(url, { active: true, insert: true, setParent: true });
  });

  it('follows an SMM-style promise result', async () => {
    await expect(open(() => Promise.resolve({ opened: true }))).resolves.toBe(true);
    await expect(open(() => Promise.resolve({ opened: false }))).resolves.toBe(false);
    await expect(open(() => Promise.reject(new Error('https only')))).resolves.toBe(false);
  });

  it('resolves false when the call throws or nothing is granted', async () => {
    await expect(open(() => { throw new Error('boom'); })).resolves.toBe(false);
    await expect(open(undefined)).resolves.toBe(false);
  });

  it('falls back to GM.openInTab bound to GM', async () => {
    const gm: Record<string, unknown> = {};
    gm.openInTab = vi.fn(function (this: unknown) { return Promise.resolve({ opened: this === gm }); });
    await expect(loadWrapped({ GM: gm }).gmOpenInTab(url)).resolves.toBe(true);
  });
});

describe('gmHttpRequest', () => {
  type Details = Parameters<NonNullable<ReturnType<Layer['gmXhr']>>>[0];
  const url = 'https://example.com/r';
  const withXhr = (impl: (details: Details) => void): Layer => loadWrapped({ GM_xmlhttpRequest: vi.fn(impl) });

  it('resolves a load with status, text and response, and passes the options through', async () => {
    let seen: Details | null = null;
    const layer = withXhr((d) => { seen = d; d.onload?.({ status: 404, responseText: 'nope', response: 'nope' }); });
    await expect(layer.gmHttpRequest(url, { method: 'POST', headers: { a: 'b' }, data: '{}', timeoutMs: 5 }))
      .resolves.toEqual({ kind: 'load', status: 404, responseText: 'nope', response: 'nope' });
    expect(seen).toMatchObject({ method: 'POST', url, headers: { a: 'b' }, data: '{}', timeout: 5 });
  });

  it('defaults to GET and sets no timeout or responseType unless asked', async () => {
    let seen: Details | null = null;
    await withXhr((d) => { seen = d; d.onload?.({ status: 200, responseText: 'ok' }); }).gmHttpRequest(url);
    expect(seen).toMatchObject({ method: 'GET', url });
    expect(seen).not.toHaveProperty('timeout');
    expect(seen).not.toHaveProperty('responseType');
    expect(seen).not.toHaveProperty('headers');
  });

  it('reads only `response` for a blob request', async () => {
    const blob = { size: 3 };
    const res = { status: 200, response: blob, get responseText(): string { throw new Error('not text'); } };
    await expect(withXhr((d) => d.onload?.(res)).gmHttpRequest(url, { responseType: 'blob' }))
      .resolves.toEqual({ kind: 'load', status: 200, responseText: '', response: blob });
  });

  it('turns onerror, ontimeout and a throwing call into outcomes, never a rejection', async () => {
    const err = new Error('net');
    await expect(withXhr((d) => d.onerror?.(err)).gmHttpRequest(url)).resolves.toEqual({ kind: 'error', error: err });
    await expect(withXhr((d) => d.ontimeout?.()).gmHttpRequest(url)).resolves.toEqual({ kind: 'timeout' });
    await expect(withXhr(() => { throw err; }).gmHttpRequest(url)).resolves.toEqual({ kind: 'error', error: err });
  });

  it('reports unavailable when nothing is granted, even with a page global', async () => {
    const pageXhr = vi.fn();
    vi.stubGlobal('GM_xmlhttpRequest', pageXhr);
    await expect(loadWrapped({}).gmHttpRequest(url)).resolves.toEqual({ kind: 'unavailable' });
    expect(pageXhr).not.toHaveBeenCalled();
  });

  it('uses GM.xmlhttpRequest bound to GM (SMM has only the lowercase alias)', async () => {
    const gm: Record<string, unknown> = {};
    gm.xmlhttpRequest = function (this: unknown, d: Details) { d.onload?.({ status: this === gm ? 200 : 500, responseText: '' }); };
    await expect(loadWrapped({ GM: gm }).gmHttpRequest(url)).resolves.toMatchObject({ kind: 'load', status: 200 });
  });
});

describe('gmInfo shapes', () => {
  it('reads GM.info when GM_info is absent', () => {
    const info = { scriptHandler: 'Tampermonkey', version: '5.5.1', script: { version: '3.3.65' } };
    expect(loadWrapped({ GM: { info } }).gmInfo()).toEqual({ handler: 'Tampermonkey', handlerVersion: '5.5.1', scriptVersion: '3.3.65' });
  });

  it('reports no handler for a GM_info without scriptHandler', () => {
    expect(loadWrapped({ GM_info: { name: 'probe', version: '0.0.1' } }).gmInfo()).toEqual({ handler: null, handlerVersion: '0.0.1', scriptVersion: null });
  });
});
