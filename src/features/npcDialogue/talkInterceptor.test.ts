import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureTalkInterceptor,
  getInterceptorState,
  installTalkInterceptor,
  uninstallTalkInterceptor,
} from './talkInterceptor';

function fakeAtom() {
  const calls: unknown[] = [];
  const atom = {
    write(this: unknown, _g: unknown, _s: unknown, update: unknown) {
      calls.push(update);
    },
  };
  return {
    atom,
    calls,
    send: (u: unknown) => atom.write.call(atom, null, null, u),
    sendOver: (current: unknown, u: unknown) => atom.write.call(atom, () => current, null, u),
  };
}

const talk = (id: string, extra: Record<string, unknown> = {}) => ({
  [id]: { seq: 0, playerId: id, message: 'native', timestamp: 1, ...extra },
});

describe('talkInterceptor', () => {
  beforeEach(() => uninstallTalkInterceptor());

  it('rewrites a fresh Talk entry and stamps both markers', () => {
    const f = fakeAtom();
    installTalkInterceptor(f.atom, () => ({ message: 'qpm <0/>', tags: { 0: { mutation: 'Wet' } } }));
    f.send(talk('NPC_Reina'));
    expect(f.calls[0]).toEqual({
      NPC_Reina: {
        seq: 0,
        playerId: 'NPC_Reina',
        message: 'qpm <0/>',
        timestamp: 1,
        tags: { 0: { mutation: 'Wet' } },
        qpmAuthored: true,
        ariesAuthored: true,
      },
    });
  });

  it('drops stale tags when the QPM line has none', () => {
    const f = fakeAtom();
    installTalkInterceptor(f.atom, () => ({ message: 'plain' }));
    f.send(talk('NPC_Reina', { tags: { 0: { mutation: 'Wet' } } }));
    expect((f.calls[0] as Record<string, Record<string, unknown>>).NPC_Reina).not.toHaveProperty('tags');
  });

  it('never touches Aries-authored or QPM-authored entries, clears, or functional updates', () => {
    const f = fakeAtom();
    const rewrite = vi.fn(() => ({ message: 'x' }));
    installTalkInterceptor(f.atom, rewrite);
    const aries = talk('NPC_Wade', { ariesAuthored: true });
    const fn = () => ({});
    f.send(aries);
    f.send({});
    f.send(fn);
    expect(rewrite).not.toHaveBeenCalled();
    expect(f.calls).toEqual([aries, {}, fn]);
  });

  it('leaves entries already in the atom alone when a write spreads them back (keepOthers / single delete)', () => {
    const f = fakeAtom();
    const rewrite = vi.fn(() => ({ message: 'q' }));
    installTalkInterceptor(f.atom, rewrite);
    const shown = talk('NPC_Reina').NPC_Reina;
    const visitor = { seq: 0, playerId: 'NPC_Iris#u1', message: 'visit', timestamp: 2 };
    f.sendOver({ NPC_Reina: shown }, { NPC_Reina: shown, 'NPC_Iris#u1': visitor });
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(rewrite).toHaveBeenCalledWith('NPC_Iris#u1', visitor);
    expect((f.calls[0] as Record<string, unknown>).NPC_Reina).toBe(shown);
  });

  it('passes the original through when the rewriter returns null or throws', () => {
    const f = fakeAtom();
    installTalkInterceptor(f.atom, () => {
      throw new Error('boom');
    });
    const t = talk('NPC_Reina');
    f.send(t);
    expect(f.calls[0]).toBe(t);
  });

  it('self-heals after another mod restores a stale write', () => {
    const f = fakeAtom();
    const original = f.atom.write;
    installTalkInterceptor(f.atom, () => ({ message: 'q' }));
    f.atom.write = original;
    expect(getInterceptorState()).toBe('displaced');
    expect(ensureTalkInterceptor()).toBe(true);
    f.send(talk('NPC_Reina'));
    const rewritten = (f.calls[0] as Record<string, { message: string }>).NPC_Reina;
    expect(rewritten?.message).toBe('q');
  });

  it('goes pass-through instead of restoring when wrapped over', () => {
    const f = fakeAtom();
    installTalkInterceptor(f.atom, () => ({ message: 'q' }));
    const ours = f.atom.write;
    f.atom.write = function (this: unknown, g: unknown, s: unknown, u: unknown) {
      return ours.call(this, g, s, u);
    };
    const outer = f.atom.write;
    uninstallTalkInterceptor();
    expect(f.atom.write).toBe(outer);
    const t = talk('NPC_Reina');
    f.send(t);
    expect(f.calls[0]).toBe(t);
  });
});
