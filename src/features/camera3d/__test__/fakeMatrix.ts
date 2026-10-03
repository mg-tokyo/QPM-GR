// Minimal PIXI-compatible affine matrix for unit tests: append(m) = this ∘ m, prepend(m) = m ∘ this.
export class FakeMatrix {
  constructor(public a = 1, public b = 0, public c = 0, public d = 1, public tx = 0, public ty = 0) {}
  set(a: number, b: number, c: number, d: number, tx: number, ty: number): this { Object.assign(this, { a, b, c, d, tx, ty }); return this; }
  clone(): FakeMatrix { return new FakeMatrix(this.a, this.b, this.c, this.d, this.tx, this.ty); }
  copyFrom(m: FakeMatrix): this { return this.set(m.a, m.b, m.c, m.d, m.tx, m.ty); }
  append(m: FakeMatrix): this {
    const { a, b, c, d } = this;
    return this.set(m.a * a + m.b * c, m.a * b + m.b * d, m.c * a + m.d * c, m.c * b + m.d * d, m.tx * a + m.ty * c + this.tx, m.tx * b + m.ty * d + this.ty);
  }
  prepend(m: FakeMatrix): this {
    const { a, b, c, d, tx, ty } = this;
    return this.set(a * m.a + b * m.c, a * m.b + b * m.d, c * m.a + d * m.c, c * m.b + d * m.d, tx * m.a + ty * m.c + m.tx, tx * m.b + ty * m.d + m.ty);
  }
  invert(): this {
    const { a, b, c, d, tx, ty } = this;
    const n = a * d - b * c;
    return this.set(d / n, -b / n, -c / n, a / n, (c * ty - d * tx) / n, -(a * ty - b * tx) / n);
  }
  translate(x: number, y: number): this { this.tx += x; this.ty += y; return this; }
  scale(x: number, y: number): this { return this.set(this.a * x, this.b * y, this.c * x, this.d * y, this.tx * x, this.ty * y); }
  apply(p: { x: number; y: number }): { x: number; y: number } { return { x: this.a * p.x + this.c * p.y + this.tx, y: this.b * p.x + this.d * p.y + this.ty }; }
}
