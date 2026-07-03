// src/core/discordSdk.ts
//
// Thin accessor for the game bundle's Discord Embedded App SDK instance.
// Kept in src/core/ so feature code doesn't reach into `getAtomByLabel`
// directly for a non-game-state atom (Discord SDK is not part of stateTree).
//
// The atom (`discordSdkAtom` in the game's store/store.ts) holds a
// `DiscordSDK` instance after `initializeDiscordSdkInstance` resolves, or
// `undefined` on non-Discord surfaces or before init completes.

import { getAtomByLabel, readAtomValue } from './jotaiBridge';

/** Minimal shape we call on the SDK — full type lives in @discord/embedded-app-sdk. */
interface DiscordSdkHandle {
  instanceId?: string;
  guildId?: string;
  channelId?: string;
  close?: (code: number, reason: string) => void;
  commands?: {
    openExternalLink?: (args: { url: string }) => Promise<{ opened: boolean }>;
  };
}

/**
 * Read the Discord SDK instance if available.
 *
 * Returns `null` when not on Discord surface, before the SDK has initialized,
 * or if the atom lookup fails. Callers must null-check the returned handle
 * AND each method they use (methods are all `?` on the shape).
 */
export async function getDiscordSdk(): Promise<DiscordSdkHandle | null> {
  try {
    const atom = getAtomByLabel('discordSdkAtom');
    if (!atom) return null;
    const value = await readAtomValue<DiscordSdkHandle | undefined>(atom);
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Close the Discord Activity ("leave" the current Discord-instance room).
 *
 * No-op if the SDK isn't available. Uses RPCCloseCodes.CLOSE_NORMAL (1000).
 */
export async function closeDiscordActivity(reason: string): Promise<void> {
  const sdk = await getDiscordSdk();
  try { sdk?.close?.(1000, reason); } catch (err) { console.warn('[QPM] discordSdk.close failed', err); }
}
