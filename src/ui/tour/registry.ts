// src/ui/tour/registry.ts

import type { TourDefinition, DiscoveryDefinition, HelpPanelDefinition } from './types';

const registry = new Map<string, TourDefinition>();

/** Register a tour definition. Overwrites if windowId already registered. */
export function registerTour(definition: TourDefinition): void {
  registry.set(definition.windowId, definition);
}

/** Look up a tour by window ID. Returns undefined if not registered. */
export function lookupTour(windowId: string): TourDefinition | undefined {
  return registry.get(windowId);
}

/** Check if a tour is registered for a window ID. */
export function hasTour(windowId: string): boolean {
  return registry.has(windowId);
}

/** Get all registered tour definitions. */
export function getAllTours(): TourDefinition[] {
  return Array.from(registry.values());
}

// ── Discovery registry ──────────────────────────────────────

const discoveryRegistry = new Map<string, DiscoveryDefinition>();
const helpRegistry = new Map<string, HelpPanelDefinition>();

/** Register a discovery definition for a window. */
export function registerDiscovery(definition: DiscoveryDefinition): void {
  discoveryRegistry.set(definition.windowId, definition);
}

/** Look up discovery definition by window ID. */
export function lookupDiscovery(windowId: string): DiscoveryDefinition | undefined {
  return discoveryRegistry.get(windowId);
}

/** Register a help panel definition for a window. */
export function registerHelp(definition: HelpPanelDefinition): void {
  helpRegistry.set(definition.windowId, definition);
}

/** Look up help panel definition by window ID. */
export function lookupHelp(windowId: string): HelpPanelDefinition | undefined {
  return helpRegistry.get(windowId);
}

/** Check if a help panel is registered for a window ID. */
export function hasHelp(windowId: string): boolean {
  return helpRegistry.has(windowId);
}

/** Get all window IDs that have discovery definitions registered. */
export function getAllDiscoveryWindowIds(): string[] {
  return Array.from(discoveryRegistry.keys());
}
