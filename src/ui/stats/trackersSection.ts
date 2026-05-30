import type { UIState } from '../core/panelState';

export function createTrackersSection(uiState: UIState): HTMLElement[] {
  if (uiState.mutationTrackerUnsubscribe) {
    uiState.mutationTrackerUnsubscribe();
    uiState.mutationTrackerUnsubscribe = null;
  }
  if (uiState.mutationTrackerTicker != null) {
    uiState.mutationTrackerTicker();
    uiState.mutationTrackerTicker = null;
  }

  if (uiState.trackerAbilityHistoryUnsubscribe) {
    uiState.trackerAbilityHistoryUnsubscribe();
    uiState.trackerAbilityHistoryUnsubscribe = null;
  }
  if (uiState.trackerAbilityTicker != null) {
    uiState.trackerAbilityTicker();
    uiState.trackerAbilityTicker = null;
  }

  // Tracker buttons removed - now accessible via tab buttons instead
  return [];
}
