/** A bake window's top-left tile. */
export interface Win { a: number; b: number }
/** One rect to paint, in tiles: world origin (wx, wy), size, and where it lands in the n×n toroidal texture (tx, ty). */
export interface RingPiece { wx: number; wy: number; w: number; h: number; tx: number; ty: number }

const mod = (v: number, n: number): number => ((v % n) + n) % n;

function addRect(out: RingPiece[], wx: number, w: number, wy: number, h: number, n: number): void {
  const tx = mod(wx, n), ty = mod(wy, n);
  const w0 = Math.min(w, n - tx), h0 = Math.min(h, n - ty);
  for (const [x, cw, cx] of [[wx, w0, tx], [wx + w0, w - w0, 0]] as const) {
    if (cw <= 0) continue;
    for (const [y, ch, cy] of [[wy, h0, ty], [wy + h0, h - h0, 0]] as const) if (ch > 0) out.push({ wx: x, wy: y, w: cw, h: ch, tx: cx, ty: cy });
  }
}

/** The rects a toroidal n×n-tile texture (texel = world tile mod n) must repaint when its window moves from prev to next:
 * the columns that entered (full height), then the rows that entered over the other columns. At most 8 pieces. */
export function ringPieces(prev: Win | null, next: Win, n: number): RingPiece[] {
  const out: RingPiece[] = [];
  const da = prev ? next.a - prev.a : n, db = prev ? next.b - prev.b : n;
  if (Math.abs(da) >= n || Math.abs(db) >= n) {
    addRect(out, next.a, n, next.b, n, n);
    return out;
  }
  if (da !== 0) addRect(out, da > 0 ? next.a + n - da : next.a, Math.abs(da), next.b, n, n);
  if (db !== 0) {
    const restX = da > 0 ? next.a : next.a - da;
    addRect(out, restX, n - Math.abs(da), db > 0 ? next.b + n - db : next.b, Math.abs(db), n);
  }
  return out;
}

/** Which levels bake this frame (PC2): never both, the near one first; the far one waits a frame unless it is urgent. */
export function staggerBakes(nearDue: boolean, farDue: boolean, farUrgent: boolean): { near: boolean; far: boolean } {
  return { near: nearDue, far: farDue && (!nearDue || farUrgent) };
}
