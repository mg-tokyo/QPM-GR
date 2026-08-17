import { pageWindow, isIsolatedContext } from '../core/pageContext';
import { isDiscordSurface } from '../utils/environment';
import type { AudioBridge } from './types';

declare const cloneInto: ((obj: unknown, target: object) => unknown) | undefined;
declare const exportFunction: ((fn: Function, target: object) => Function) | undefined;

const _cloneInto: ((obj: unknown, target: object) => unknown) | null =
  typeof cloneInto === 'function' ? cloneInto : null;
const _exportFn: ((fn: Function, target: object) => Function) | null =
  typeof exportFunction === 'function' ? exportFunction : null;

function cloneToPage(obj: unknown, target: object): unknown {
  if (!isIsolatedContext || !_cloneInto) return obj;
  try { return _cloneInto(obj, target); } catch { return obj; }
}

function exportToPage(fn: Function, target: object): Function {
  if (!isIsolatedContext || !_exportFn) return fn;
  try { return _exportFn(fn, target); } catch { return fn; }
}

const BRIDGE_KEY = '__QPM_AUDIO_BRIDGE__';

export function getAudioBridge(): AudioBridge | null {
  const root = pageWindow as unknown as Record<string, unknown>;
  const b = root[BRIDGE_KEY];
  if (!b || typeof b !== 'object') return null;
  return b as AudioBridge;
}

const BRIDGE_SCRIPT = `
(function () {
  if (window.__QPM_AUDIO_BRIDGE_ACTIVE__) return;
  window.__QPM_AUDIO_BRIDGE_ACTIVE__ = true;

  var ATLAS_KEYS = ['audio/sfx/sfx-atlas', 'sfx-atlas', 'sfx.json', 'sfxAtlas', 'sfx_atlas'];
  var SOUND_KEYS = ['audio/sfx/sfx', 'sfx', 'sfxSprite', 'sfx.mp3', 'sfx.ogg'];

  function tryGetFromCache(cache, key) {
    if (!cache) return null;
    try { if (typeof cache.get === 'function') { var v = cache.get(key); if (v != null) return v; } } catch (_) {}
    try { if (cache._cache && typeof cache._cache.get === 'function') { var v2 = cache._cache.get(key); if (v2 != null) return v2; } } catch (_) {}
    try { var raw = cache[key]; if (raw != null) return raw; } catch (_) {}
    return null;
  }

  function walkCacheEntries(cache, cb) {
    if (!cache) return;
    var visited = new WeakSet();
    function visit(target) {
      if (!target || typeof target !== 'object') return;
      if (visited.has(target)) return;
      visited.add(target);
      try {
        if (typeof target.forEach === 'function' && typeof target.entries === 'function') {
          target.forEach(function (v, k) { cb(String(k), v); });
        } else {
          var keys = Object.keys(target);
          for (var i = 0; i < keys.length; i++) cb(keys[i], target[keys[i]]);
        }
      } catch (_) {}
    }
    visit(cache);
    if (cache._cache) visit(cache._cache);
    if (cache.cache) visit(cache.cache);
  }

  function isAtlasShape(v) {
    if (!v || typeof v !== 'object') return false;
    var keys = Object.keys(v);
    if (keys.length < 4) return false;
    var first = v[keys[0]];
    return !!(first && typeof first === 'object' && typeof first.start === 'number' && typeof first.end === 'number');
  }

  function isSoundShape(v) {
    if (!v || typeof v !== 'object') return false;
    return typeof v.play === 'function' && (typeof v.addSprites === 'function' || v.sprites);
  }

  function findAssets() {
    var P = window.PIXI || window.__PIXI__;
    if (P && P.Assets) return P.Assets;
    var app = window.__QPM_PIXI_CAPTURED__ && window.__QPM_PIXI_CAPTURED__.app;
    if (app && app.Assets) return app.Assets;
    return null;
  }

  var cachedSound = null;
  var cachedAtlas = null;

  function resolveSoundAndAtlas() {
    if (cachedSound && cachedAtlas) return true;
    var Assets = findAssets();
    if (!Assets || !Assets.cache) return false;
    var cache = Assets.cache;
    for (var i = 0; i < SOUND_KEYS.length && !cachedSound; i++) {
      var s = tryGetFromCache(cache, SOUND_KEYS[i]);
      if (isSoundShape(s)) cachedSound = s;
    }
    for (var j = 0; j < ATLAS_KEYS.length && !cachedAtlas; j++) {
      var a = tryGetFromCache(cache, ATLAS_KEYS[j]);
      if (isAtlasShape(a)) cachedAtlas = a;
    }
    if (!cachedSound || !cachedAtlas) {
      walkCacheEntries(cache, function (k, v) {
        if (!cachedSound && isSoundShape(v)) cachedSound = v;
        if (!cachedAtlas && isAtlasShape(v)) cachedAtlas = v;
      });
    }
    return !!(cachedSound && cachedAtlas);
  }

  function findStereoFilterCtor() {
    var P = window.PIXI || window.__PIXI__;
    var buckets = [P && P.sound, window.PIXI_SOUND, cachedSound && cachedSound.filters];
    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      if (b && b.filters && typeof b.filters.StereoFilter === 'function') return b.filters.StereoFilter;
      if (b && typeof b.StereoFilter === 'function') return b.StereoFilter;
    }
    return null;
  }

  var LOOP_ID = 0;
  var loops = new Map();

  window.__QPM_AUDIO_BRIDGE__ = {
    hasAtlas: function () { return resolveSoundAndAtlas(); },
    getAtlas: function () {
      if (!resolveSoundAndAtlas()) return null;
      var out = {};
      var keys = Object.keys(cachedAtlas);
      for (var i = 0; i < keys.length; i++) {
        var e = cachedAtlas[keys[i]];
        if (e && typeof e.start === 'number' && typeof e.end === 'number') {
          out[keys[i]] = { start: e.start, end: e.end };
        }
      }
      return out;
    },
    play: function (name, opts) {
      if (!resolveSoundAndAtlas()) return false;
      if (!cachedAtlas[name]) return false;
      var vol = (opts && typeof opts.volume === 'number') ? opts.volume : 1;
      var playArgs = { sprite: name, volume: vol, loop: false };
      if (opts && opts.pan !== undefined && opts.pan !== null) {
        var Ctor = findStereoFilterCtor();
        if (Ctor) { try { playArgs.filters = [new Ctor(opts.pan)]; } catch (_) {} }
      }
      try { cachedSound.play(playArgs); return true; } catch (_) { return false; }
    },
    startLoop: function (name, opts) {
      if (!resolveSoundAndAtlas()) return null;
      if (!cachedAtlas[name]) return null;
      var vol = (opts && typeof opts.volume === 'number') ? opts.volume : 1;
      var pan = opts && opts.pan;
      var Ctor = findStereoFilterCtor();
      var stereoFilter = (pan !== undefined && pan !== null && Ctor) ? (function(){ try { return new Ctor(pan); } catch (_) { return null; } })() : null;
      var playArgs = { sprite: name, volume: vol, loop: true };
      if (stereoFilter) playArgs.filters = [stereoFilter];
      var maybe;
      try { maybe = cachedSound.play(playArgs); } catch (_) { return null; }
      var id = ++LOOP_ID;
      var active = true;
      var instance = null;
      function attach(inst) {
        instance = inst;
        if (!active) { try { inst.stop(); } catch (_) {} return; }
        try { inst.once && inst.once('stop', function () { active = false; loops.delete(id); }); } catch (_) {}
      }
      if (maybe && typeof maybe.then === 'function') maybe.then(attach, function () { active = false; loops.delete(id); });
      else if (maybe) attach(maybe);
      var handle = {
        id: id,
        setVolume: function (v) { if (instance) { try { instance.volume = v; } catch (_) {} } },
        setPan: function (p) { if (stereoFilter) { try { stereoFilter.pan = p; } catch (_) {} } },
        stop: function () {
          active = false;
          if (instance) { try { instance.stop(); } catch (_) {} }
          try { if (stereoFilter && stereoFilter.destroy) stereoFilter.destroy(); } catch (_) {}
          loops.delete(id);
        },
        isActive: function () { return active; }
      };
      loops.set(id, handle);
      return handle;
    },
    stopAll: function () {
      var it = loops.values();
      var step = it.next();
      while (!step.done) { try { step.value.stop(); } catch (_) {} step = it.next(); }
      loops.clear();
    },
    primeUnlock: function () {
      if (!resolveSoundAndAtlas()) return;
      try {
        var atlasKeys = Object.keys(cachedAtlas);
        if (atlasKeys.length === 0) return;
        var probe = cachedSound.play({ sprite: atlasKeys[0], volume: 0, loop: false });
        if (probe && typeof probe.then === 'function') probe.then(function (inst) { try { inst && inst.stop(); } catch (_) {} }, function () {});
        else if (probe && typeof probe.stop === 'function') { try { probe.stop(); } catch (_) {} }
      } catch (_) {}
    }
  };
})();
`;

interface DiscordBridgeState {
  sound: any;
  atlas: Record<string, { start: number; end: number }> | null;
  loopId: number;
  loops: Map<number, { stop: () => void; setVolume: (v: number) => void; setPan: (p: number) => void; isActive: () => boolean }>;
}

function setupBridgeOnRoot(root: Record<string, unknown>): void {
  if (root.__QPM_AUDIO_BRIDGE_ACTIVE__) return;
  root.__QPM_AUDIO_BRIDGE_ACTIVE__ = true;

  const state: DiscordBridgeState = { sound: null, atlas: null, loopId: 0, loops: new Map() };
  const ATLAS_KEYS = ['audio/sfx/sfx-atlas', 'sfx-atlas', 'sfx.json', 'sfxAtlas', 'sfx_atlas'];
  const SOUND_KEYS = ['audio/sfx/sfx', 'sfx', 'sfxSprite', 'sfx.mp3', 'sfx.ogg'];

  const tryGet = (cache: any, key: string): unknown => {
    if (!cache) return null;
    try { if (typeof cache.get === 'function') { const v = cache.get(key); if (v != null) return v; } } catch { /* boundary */ }
    try { if (cache._cache?.get) { const v = cache._cache.get(key); if (v != null) return v; } } catch { /* boundary */ }
    try { const raw = cache[key]; if (raw != null) return raw; } catch { /* boundary */ }
    return null;
  };

  const walk = (cache: any, cb: (k: string, v: unknown) => void): void => {
    if (!cache) return;
    const visited = new WeakSet<object>();
    const visit = (t: any): void => {
      if (!t || typeof t !== 'object') return;
      if (visited.has(t)) return;
      visited.add(t);
      try {
        if (typeof t.forEach === 'function' && typeof t.entries === 'function') t.forEach((v: unknown, k: unknown) => cb(String(k), v));
        else for (const k of Object.keys(t)) cb(k, t[k]);
      } catch { /* boundary */ }
    };
    visit(cache);
    if (cache._cache) visit(cache._cache);
    if (cache.cache) visit(cache.cache);
  };

  const isAtlas = (v: any): boolean => {
    if (!v || typeof v !== 'object') return false;
    const ks = Object.keys(v);
    if (ks.length < 4) return false;
    const f = v[ks[0]!];
    return !!(f && typeof f === 'object' && typeof f.start === 'number' && typeof f.end === 'number');
  };
  const isSound = (v: any): boolean => !!v && typeof v === 'object' && typeof v.play === 'function' && (typeof v.addSprites === 'function' || v.sprites);

  const findAssets = (): any => {
    const P: any = (root as any).PIXI || (root as any).__PIXI__;
    if (P?.Assets) return P.Assets;
    const app: any = (root as any).__QPM_PIXI_CAPTURED__?.app;
    if (app?.Assets) return app.Assets;
    return null;
  };

  const resolve = (): boolean => {
    if (state.sound && state.atlas) return true;
    const Assets = findAssets();
    if (!Assets?.cache) return false;
    const cache = Assets.cache;
    for (const k of SOUND_KEYS) { if (state.sound) break; const s = tryGet(cache, k); if (isSound(s)) state.sound = s; }
    for (const k of ATLAS_KEYS) { if (state.atlas) break; const a = tryGet(cache, k); if (isAtlas(a)) state.atlas = a as Record<string, { start: number; end: number }>; }
    if (!state.sound || !state.atlas) {
      walk(cache, (_k, v) => {
        if (!state.sound && isSound(v)) state.sound = v;
        if (!state.atlas && isAtlas(v)) state.atlas = v as Record<string, { start: number; end: number }>;
      });
    }
    return !!(state.sound && state.atlas);
  };

  const findStereoCtor = (): any => {
    const P: any = (root as any).PIXI || (root as any).__PIXI__;
    const buckets = [P?.sound, (root as any).PIXI_SOUND, state.sound?.filters];
    for (const b of buckets) {
      if (b?.filters?.StereoFilter) return b.filters.StereoFilter;
      if (b?.StereoFilter) return b.StereoFilter;
    }
    return null;
  };

  const bridge = {
    hasAtlas: () => resolve(),
    getAtlas: (): Record<string, { start: number; end: number }> | null => {
      if (!resolve()) return null;
      const out: Record<string, { start: number; end: number }> = {};
      const src = state.atlas!;
      for (const k of Object.keys(src)) { const e = src[k]!; out[k] = { start: e.start, end: e.end }; }
      return out;
    },
    play: (name: string, opts: { volume: number; pan?: number }): boolean => {
      if (!resolve()) return false;
      if (!state.atlas![name]) return false;
      const args: any = { sprite: name, volume: opts.volume ?? 1, loop: false };
      if (opts.pan !== undefined) {
        const Ctor = findStereoCtor();
        if (Ctor) { try { args.filters = [new Ctor(opts.pan)]; } catch { /* boundary */ } }
      }
      try { state.sound.play(args); return true; } catch { return false; }
    },
    startLoop: (name: string, opts: { volume: number; pan?: number }) => {
      if (!resolve()) return null;
      if (!state.atlas![name]) return null;
      const Ctor = findStereoCtor();
      const stereoFilter = (opts.pan !== undefined && Ctor) ? ((): unknown => { try { return new Ctor(opts.pan); } catch { return null; } })() : null;
      const args: any = { sprite: name, volume: opts.volume ?? 1, loop: true };
      if (stereoFilter) args.filters = [stereoFilter];
      let inst: any = null;
      try { inst = state.sound.play(args); } catch { return null; }
      const id = ++state.loopId;
      let active = true;
      const attach = (i: any): void => {
        inst = i;
        if (!active) { try { i.stop(); } catch { /* boundary */ } return; }
        try { i.once?.('stop', () => { active = false; state.loops.delete(id); }); } catch { /* boundary */ }
      };
      if (inst && typeof inst.then === 'function') inst.then(attach, () => { active = false; state.loops.delete(id); });
      else if (inst) attach(inst);
      const handle = {
        id,
        setVolume: (v: number): void => { if (inst) { try { inst.volume = v; } catch { /* boundary */ } } },
        setPan: (p: number): void => { if (stereoFilter) { try { (stereoFilter as any).pan = p; } catch { /* boundary */ } } },
        stop: (): void => {
          active = false;
          if (inst) { try { inst.stop(); } catch { /* boundary */ } }
          try { (stereoFilter as any)?.destroy?.(); } catch { /* boundary */ }
          state.loops.delete(id);
        },
        isActive: (): boolean => active,
      };
      state.loops.set(id, handle);
      return handle;
    },
    stopAll: (): void => {
      for (const h of state.loops.values()) { try { h.stop(); } catch { /* boundary */ } }
      state.loops.clear();
    },
    primeUnlock: (): void => {
      if (!resolve()) return;
      try {
        const keys = Object.keys(state.atlas!);
        if (keys.length === 0) return;
        const probe: any = state.sound.play({ sprite: keys[0], volume: 0, loop: false });
        if (probe && typeof probe.then === 'function') probe.then((i: any) => { try { i?.stop?.(); } catch { /* boundary */ } }, () => { /* boundary */ });
        else if (probe?.stop) { try { probe.stop(); } catch { /* boundary */ } }
      } catch { /* boundary */ }
    },
  };

  const wrapped = cloneToPage(
    {
      hasAtlas: exportToPage(bridge.hasAtlas, root),
      getAtlas: exportToPage(bridge.getAtlas, root),
      play: exportToPage(bridge.play, root),
      startLoop: exportToPage(bridge.startLoop, root),
      stopAll: exportToPage(bridge.stopAll, root),
      primeUnlock: exportToPage(bridge.primeUnlock, root),
    },
    root,
  );
  root[BRIDGE_KEY] = wrapped;
}

let injected = false;

export function injectAudioBridge(): void {
  if (injected) return;
  injected = true;
  const root = pageWindow as unknown as Record<string, unknown>;

  if (isDiscordSurface) {
    setupBridgeOnRoot(root);
    return;
  }

  try {
    const script = document.createElement('script');
    script.textContent = BRIDGE_SCRIPT;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch {
    setupBridgeOnRoot(root);
  }
}
