// First-QPM-wins guard. Two copies of QPM on the page (ALPHA + private, or a
// duplicated userscript) double every per-frame cost and stack branded send
// wrappers the sequencer refuses (spec F6). Storage-free: runs before hooks.
import { readSharedGlobal, shareGlobal } from './pageContext';

const KEY = '__QPM_INSTANCE__';

export interface InstanceInfo {
  version: string;
  startedAt: number;
}

let mine: InstanceInfo | null = null;
let other: InstanceInfo | null = null;

function isInfo(v: unknown): v is InstanceInfo {
  return !!v
    && typeof v === 'object'
    && typeof (v as InstanceInfo).version === 'string'
    && typeof (v as InstanceInfo).startedAt === 'number';
}

export function claimQpmInstance(
  version: string,
): { first: true } | { first: false; existing: InstanceInfo } {
  const existing = readSharedGlobal<unknown>(KEY);
  if (isInfo(existing)) {
    other = existing;
    return { first: false, existing };
  }
  mine = { version, startedAt: Date.now() };
  shareGlobal(KEY, mine);
  return { first: true };
}

export function getInstanceInfo(): { mine: InstanceInfo | null; other: InstanceInfo | null } {
  return { mine, other };
}
