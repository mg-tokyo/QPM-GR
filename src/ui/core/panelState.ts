import type { ShopCategoryKey } from '../../store/stats';

export interface UIState {
  panel: HTMLElement | null;
  content: HTMLElement | null;
  status: HTMLElement | null;
  toggle: HTMLElement | null;
  weatherStatus: HTMLElement | null;
  shopStatus: HTMLElement | null;
  shopItemToggles: HTMLElement | null;
  mutationStatus: HTMLElement | null;
  headerContainer: HTMLElement | null;
  headerWeather: HTMLElement | null;
  headerMeta: HTMLElement | null;
  headerTimer: number | null;
  dashboardRestockSummary: HTMLElement | null;
  dashboardRestockValues: Record<ShopCategoryKey, HTMLElement | null>;
  turtleStatus: HTMLElement | null;
  turtleDetail: HTMLElement | null;
  turtleFooter: HTMLElement | null;
  turtleEnableButtons: HTMLButtonElement[];
  turtleFocusSelects: HTMLSelectElement[];
  turtleFocusTargetSelects: HTMLSelectElement[];
  turtleFocusTargetContainers: HTMLElement[];
  turtleEggFocusSelects: HTMLSelectElement[];
  turtleEggFocusTargetSelects: HTMLSelectElement[];
  turtleEggFocusTargetContainers: HTMLElement[];
  turtlePlantSummary: HTMLElement | null;
  turtlePlantEta: HTMLElement | null;
  turtlePlantTable: HTMLElement | null;
  turtlePlantTotals: HTMLElement | null;
  turtlePlantSimple: HTMLElement | null;
  turtlePlantLuck: HTMLElement | null;
  turtleEggSummary: HTMLElement | null;
  turtleEggEta: HTMLElement | null;
  turtleEggTable: HTMLElement | null;
  turtleEggTotals: HTMLElement | null;
  turtleEggSimple: HTMLElement | null;
  turtleEggLuck: HTMLElement | null;
  turtleSupportSummary: HTMLElement | null;
  turtleSupportTotals: HTMLElement | null;
  turtleSupportSimple: HTMLElement | null;
  turtleSupportList: HTMLElement | null;
  trackerAbilitySummary: HTMLElement | null;
  trackerAbilityFilterSelect: HTMLSelectElement | null;
  trackerAbilityTable: HTMLElement | null;
  trackerAbilityUnknown: HTMLElement | null;
  trackerXpSummary: HTMLElement | null;
  trackerXpAbilityTable: HTMLElement | null;
  trackerXpPerPetTable: HTMLElement | null;
  trackerXpTargetModeSelect: HTMLSelectElement | null;
  trackerXpTargetPetSelect: HTMLSelectElement | null;
  mutationTrackerCard: HTMLElement | null;
  mutationTrackerSummary: HTMLElement | null;
  mutationTrackerTotals: HTMLElement | null;
  mutationTrackerRatios: HTMLElement | null;
  mutationTrackerCountdown: HTMLElement | null;
  mutationTrackerDetail: HTMLElement | null;
  mutationTrackerTable: HTMLTableSectionElement | null;
  mutationTrackerSourceSelect: HTMLSelectElement | null;
  mutationTrackerDetailToggle: HTMLButtonElement | null;
  mutationTrackerSourceBadge: HTMLElement | null;
  mutationTrackerEmpty: HTMLElement | null;
  trackerAbilityHistoryUnsubscribe: (() => void) | null;
  trackerAbilityTicker: (() => void) | null;
  mutationTrackerUnsubscribe: (() => void) | null;
  mutationTrackerTicker: (() => void) | null;
  turtleUnsubscribe: (() => void) | null;
  turtlePlantNameText: HTMLElement | null;
  headerRestockCleanup: (() => void) | null;
  headerSpritesCleanup: (() => void) | null;
  notificationsSection: HTMLElement | null;
  notificationsListWrapper: HTMLElement | null;
  notificationsList: HTMLElement | null;
  notificationsFilterBar: HTMLElement | null;
  notificationsEmpty: HTMLElement | null;
  notificationsUnsubscribe: (() => void) | null;
  notificationsDetail: HTMLElement | null;
  notificationsDetailHeader: HTMLElement | null;
  notificationsDetailTitle: HTMLElement | null;
  notificationsDetailTimestamp: HTMLElement | null;
  notificationsDetailMeta: HTMLElement | null;
  notificationsDetailMessage: HTMLElement | null;
  notificationsDetailActions: HTMLElement | null;
  notificationsDetailRaw: HTMLElement | null;
  notificationsDetailPlaceholder: HTMLElement | null;
  notificationsDetailToggle: HTMLButtonElement | null;
}

export function createInitialUIState(): UIState {
  return {
    panel: null,
    content: null,
    status: null,
    toggle: null,
    weatherStatus: null,
    shopStatus: null,
    shopItemToggles: null,
    mutationStatus: null,
    headerContainer: null,
    headerWeather: null,
    headerMeta: null,
    headerTimer: null,
    dashboardRestockSummary: null,
    dashboardRestockValues: {
      seeds: null,
      eggs: null,
      tools: null,
      decor: null,
      dawn: null,
    },
    turtleStatus: null,
    turtleDetail: null,
    turtleFooter: null,
    turtleEnableButtons: [],
    turtleFocusSelects: [],
    turtleFocusTargetSelects: [],
    turtleFocusTargetContainers: [],
    turtleEggFocusSelects: [],
    turtleEggFocusTargetSelects: [],
    turtleEggFocusTargetContainers: [],
    turtlePlantSummary: null,
    turtlePlantEta: null,
    turtlePlantTable: null,
    turtlePlantTotals: null,
    turtlePlantSimple: null,
    turtlePlantLuck: null,
    turtleEggSummary: null,
    turtleEggEta: null,
    turtleEggTable: null,
    turtleEggTotals: null,
    turtleEggSimple: null,
    turtleEggLuck: null,
    turtleSupportSummary: null,
    turtleSupportTotals: null,
    turtleSupportSimple: null,
    turtleSupportList: null,
    trackerAbilitySummary: null,
    trackerAbilityFilterSelect: null,
    trackerAbilityTable: null,
    trackerAbilityUnknown: null,
    trackerXpSummary: null,
    trackerXpAbilityTable: null,
    trackerXpPerPetTable: null,
    trackerXpTargetModeSelect: null,
    trackerXpTargetPetSelect: null,
    mutationTrackerCard: null,
    mutationTrackerSummary: null,
    mutationTrackerTotals: null,
    mutationTrackerRatios: null,
    mutationTrackerCountdown: null,
    mutationTrackerDetail: null,
    mutationTrackerTable: null,
    mutationTrackerSourceSelect: null,
    mutationTrackerDetailToggle: null,
    mutationTrackerSourceBadge: null,
    mutationTrackerEmpty: null,
    trackerAbilityHistoryUnsubscribe: null,
    trackerAbilityTicker: null,
    mutationTrackerUnsubscribe: null,
    mutationTrackerTicker: null,
    turtleUnsubscribe: null,
    turtlePlantNameText: null,
    headerRestockCleanup: null,
    headerSpritesCleanup: null,
    notificationsSection: null,
    notificationsListWrapper: null,
    notificationsList: null,
    notificationsFilterBar: null,
    notificationsEmpty: null,
    notificationsUnsubscribe: null,
    notificationsDetail: null,
    notificationsDetailHeader: null,
    notificationsDetailTitle: null,
    notificationsDetailTimestamp: null,
    notificationsDetailMeta: null,
    notificationsDetailMessage: null,
    notificationsDetailActions: null,
    notificationsDetailRaw: null,
    notificationsDetailPlaceholder: null,
    notificationsDetailToggle: null,
  };
}
