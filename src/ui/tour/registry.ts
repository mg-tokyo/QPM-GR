// src/ui/tour/registry.ts

import type { TourDefinition } from './types';

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
