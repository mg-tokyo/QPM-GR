// src/core/reactive/index.ts
// Public entry point for the reactive subscription layer.

export type { SubscriberTier, PatchPath, ReactiveSubscribeOptions, ReactiveStats } from './types';
export { matchesPathPrefix } from './pathMatcher';
export { classifyByLabel } from './tierClassifier';
export {
  ReactiveSubscriptionManager,
  reactiveManager,
  initReactiveManager,
  stopReactiveManager,
  getReactiveStats,
  isReactiveTierEnabled,
} from './manager';
