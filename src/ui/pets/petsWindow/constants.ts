// Constants shared across petsWindow modules.

export const WINDOW_ID = 'qpm-pets-window';
export const PETS_WINDOW_SWITCH_TAB_EVENT = 'qpm:pets-window-switch-tab';
export const DEFAULT_KEYBIND = '';
export const FLOATING_CARD_STATE_EVENT = 'qpm:floating-card-state';
export const PET_TEAMS_UI_STATE_KEY = 'qpm.petTeams.uiState.v1';
export const ARIES_IMPORT_ONCE_KEY = 'petHub:ariesImportOnce.v1';
export const PETS_TAB_KEY = 'qpm.petsWindow.activeTab';

export const FEED_KEYBINDS_STORAGE_KEY = 'qpm.feed-keybinds.v1';

export const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
export const IS_OPERA = /\bOPR\//.test(navigator.userAgent);
