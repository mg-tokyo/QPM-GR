import { beforeEach, describe, expect, it, vi } from 'vitest';

const USERSCRIPT_NAMES = ['GM', 'GM_info', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues'];

function stubWindow(packaging: string | undefined): void {
  vi.stubGlobal('window', { __QPM_BUNDLE_INFO__: packaging === undefined ? {} : { packaging } });
}

function stubGmStorage(): void {
  vi.stubGlobal('GM_getValue', () => undefined);
  vi.stubGlobal('GM_setValue', () => {});
  vi.stubGlobal('GM_deleteValue', () => {});
}

async function scriptHandler(): Promise<string | null> {
  vi.resetModules();
  const { readEnvironmentInfo } = await import('./environmentInfo');
  return readEnvironmentInfo(0).scriptHandler;
}

beforeEach(() => {
  for (const name of USERSCRIPT_NAMES) vi.stubGlobal(name, undefined);
});

describe('Env line script handler', () => {
  it('names the SMM weavermod when there is no GM_info and the package is a weavermod', async () => {
    stubWindow('weavermod');
    stubGmStorage();
    expect(await scriptHandler()).toBe('SMM weavermod');
  });

  it('keeps GM:unknown-handler for a userscript package with GM storage and no GM_info', async () => {
    stubWindow('userscript');
    stubGmStorage();
    expect(await scriptHandler()).toBe('GM:unknown-handler');
  });

  it('prefers the manager GM_info names over the package', async () => {
    stubWindow('weavermod');
    stubGmStorage();
    vi.stubGlobal('GM_info', { scriptHandler: 'Starweaver Mod Manager', version: '0.1.8' });
    expect(await scriptHandler()).toBe('Starweaver Mod Manager 0.1.8');
  });

  it('reports no manager without GM storage, GM_info or a weavermod package', async () => {
    stubWindow(undefined);
    expect(await scriptHandler()).toBeNull();
  });
});
