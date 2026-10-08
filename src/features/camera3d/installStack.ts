/** Each piece registers its undo the moment it is in, so a throw anywhere unwinds exactly what exists (A R1). */
export class InstallStack {
  private readonly undos: Array<() => void> = [];
  /** The step started last: after a throw, the one that failed. */
  step = '';

  /** fault: debug only, throws at the step of that name before its install runs. */
  constructor(private readonly fault: string | null = null) {}

  add<T>(name: string, install: () => T, undo: (v: T) => void): T {
    this.step = name;
    if (name === this.fault) throw new Error(`camera3d: injected install fault at ${name}`);
    const v = install();
    this.undos.push(() => undo(v));
    return v;
  }

  /** Last in, first out; every undo runs even when one throws. */
  unwind(): void {
    for (let u = this.undos.pop(); u; u = this.undos.pop()) {
      try { u(); } catch { /* every undo runs */ }
    }
  }

  get size(): number { return this.undos.length; }
}
