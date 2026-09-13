import { describe, it, expect } from 'vitest';
import { shouldReapplyForAddedNode } from './reapply';

describe('shouldReapplyForAddedNode', () => {
  it('accepts a child whose parent is a Tile container', () => {
    const child = { label: 'Carrot Plant View', parent: { label: 'Tile (3, 7)' } };
    expect(shouldReapplyForAddedNode(child)).toBe(true);
  });
  it('rejects a child under a non-tile parent', () => {
    const child = { label: 'Carrot Plant View', parent: { label: 'World' } };
    expect(shouldReapplyForAddedNode(child)).toBe(false);
  });
  it('rejects an orphan child', () => {
    const child = { label: 'Egg' } as { parent?: { label?: unknown } | null };
    expect(shouldReapplyForAddedNode(child)).toBe(false);
  });
});
