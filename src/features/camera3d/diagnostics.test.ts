import { describe, expect, it } from 'vitest';
import { formatCamera3dLine, type Camera3dStatus } from './diagnostics';

const status = (o: Partial<Camera3dStatus> = {}): Camera3dStatus => ({
  enabled: true, live: true, s: 0.4237, fp: false, blocked: null, fov: 70, firstPerson: true, camMove: true, invertY: false,
  gfx: 'high', detail: 'medium', farAnim: 'full', ground: 'high', weather3d: 'full', caps: 'ok', fails: 0, pickMs: 1.13, jsMs: 2.05, ...o,
});

describe('formatCamera3dLine (A U8)', () => {
  it('renders the copy-report line within 120 characters', () => {
    const line = formatCamera3dLine(status());
    expect(line).toBe('3D: on live=1 s=0.42 fp=0 fov=70 opts=fp,move gfx=H:MFHF caps=ok fails=0 pick=1.1ms js=2.1ms');
    expect(line.length).toBeLessThanOrEqual(120);
  });

  it('carries the blocked reason and every option a "W walks the wrong way" report needs', () => {
    expect(formatCamera3dLine(status({ live: false, blocked: 'no-avatar', camMove: false, invertY: true, fov: 95 })))
      .toContain('fp=0 blocked=no-avatar fov=95 opts=fp,invY gfx=H:MFHF');
    expect(formatCamera3dLine(status({ firstPerson: false, camMove: false }))).toContain(' opts=- ');
  });

  it('gfx: the lit preset, then the distance, far animation, ground and weather rows by initial (perf Task 9, S §4.5)', () => {
    expect(formatCamera3dLine(status({ gfx: 'low', detail: 'closest', farAnim: 'off', ground: 'low', weather3d: 'simple' }))).toContain(' gfx=L:COLS ');
    expect(formatCamera3dLine(status({ gfx: 'medium', detail: 'near' }))).toContain(' gfx=M:NFHF ');
    expect(formatCamera3dLine(status({ gfx: 'ultra', detail: 'far' }))).toContain(' gfx=U:FFHF ');
    expect(formatCamera3dLine(status({ gfx: 'custom', ground: 'low' }))).toContain(' gfx=C:MFLF ');
  });

  it('turned off: a short line, with the failure count when there is one', () => {
    expect(formatCamera3dLine(status({ enabled: false }))).toBe('3D: off');
    expect(formatCamera3dLine(status({ enabled: false, fails: 3 }))).toBe('3D: off fails=3');
  });

  it('omits perf fields that have no samples and truncates a long caps list', () => {
    const line = formatCamera3dLine(status({ live: false, s: 0, gfx: 'ultra', detail: 'far', caps: 'missing:' + 'x'.repeat(200), fails: 2, pickMs: null, jsMs: null }));
    expect(line.startsWith('3D: on live=0 s=0.00 fp=0 fov=70 opts=fp,move gfx=U:FFHF caps=missing:')).toBe(true);
    expect(line.endsWith('… fails=2')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(120);
  });

  it('the longest head still leaves the line within 120 characters', () => {
    const line = formatCamera3dLine(status({
      fp: true, blocked: 'camera-overlay', fov: 100, invertY: true, gfx: 'custom', caps: 'missing:depth-keys,tilemap-layout', fails: 3,
    }));
    expect(line.length).toBeLessThanOrEqual(120);
    expect(line).toContain('blocked=camera-overlay');
    expect(line).toContain(' gfx=C:MFHF ');
  });
});
