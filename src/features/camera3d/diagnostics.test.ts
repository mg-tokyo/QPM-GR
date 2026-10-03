import { describe, expect, it } from 'vitest';
import { formatCamera3dLine } from './diagnostics';

describe('formatCamera3dLine', () => {
  it('renders the copy-report line within 120 characters', () => {
    const line = formatCamera3dLine({ enabled: true, live: true, s: 0.4237, fp: false, detail: 'medium', caps: 'ok', fails: 0, pickMs: 1.13, jsMs: 2.05 });
    expect(line).toBe('3D: on live=1 s=0.42 fp=0 detail=M caps=ok fails=0 pick=1.1ms js=2.1ms');
    expect(line.length).toBeLessThanOrEqual(120);
  });

  it('omits perf fields that have no samples and truncates a long caps list', () => {
    const line = formatCamera3dLine({ enabled: true, live: false, s: 0, fp: false, detail: 'far', caps: 'missing:' + 'x'.repeat(200), fails: 2, pickMs: null, jsMs: null });
    expect(line.startsWith('3D: on live=0 s=0.00 fp=0 detail=F caps=missing:')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(120);
  });
});
