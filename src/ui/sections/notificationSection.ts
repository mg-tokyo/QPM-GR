import type { UIState } from '../core/panelState';
import type { NotificationEvent, NotificationLevel } from '../../core/notifications';
import { onNotifications, clearNotifications } from '../../core/notifications';
import { storage } from '../../utils/storage';
import { formatSince } from '../../utils/helpers';
import { createButton, createEmptyState } from '../components';

// Module-level uiState reference, set when createNotificationSection is called
let uiState: UIState | null = null;

// Hex values intentional — used in ${accent}14 alpha-append pattern.
// Values match: --qpm-info, --qpm-accent, --qpm-warning, --qpm-danger.
const NOTIFICATION_LEVEL_COLORS: Record<NotificationLevel, string> = {
  info: '#64b5f6',
  success: '#8f82ff',
  warn: '#ffb347',
  error: '#f44336',
};

const NOTIFICATION_LEVEL_ICONS: Record<NotificationLevel, string> = {
  info: 'ℹ️',
  success: '✅',
  warn: '⚠️',
  error: '⛔',
};

const NOTIFICATIONS_COLLAPSED_KEY = 'quinoa-ui-notifications-collapsed';
const NOTIFICATIONS_DETAIL_EXPANDED_KEY = 'quinoa-ui-notifications-detail-expanded';

const notificationFilters = new Set<string>();
let lastNotificationEvents: NotificationEvent[] = [];
let notificationAllButton: HTMLButtonElement | null = null;
const notificationFeatureButtons = new Map<string, HTMLButtonElement>();
const notificationItemElements = new Map<string, HTMLButtonElement>();
let notificationSelectedId: string | null = null;
let notificationSectionCollapsed = storage.get<boolean>(NOTIFICATIONS_COLLAPSED_KEY, false) ?? false;
let notificationDetailExpanded = storage.get<boolean>(NOTIFICATIONS_DETAIL_EXPANDED_KEY, false) ?? false;
let lastNotificationFilteredCount = 0;

export function createNotificationSection(state: UIState): HTMLElement {
  uiState = state;
  if (uiState.notificationsSection) {
    return uiState.notificationsSection;
  }

  const section = document.createElement('div');
  section.className = 'qpm-card';
  section.dataset.qpmSection = 'notifications';

  const headerRow = document.createElement('div');
  headerRow.className = 'qpm-card__header';

  const title = document.createElement('div');
  title.className = 'qpm-card__title';
  title.textContent = '🔔 Notifications';

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';

  const collapseButton = createButton('', { size: 'sm', onClick: () => {
    setNotificationSectionCollapsed(!notificationSectionCollapsed);
    updateCollapseButton();
  }});
  // Re-apply active state after createButton's hover cycle resets cssText
  collapseButton.addEventListener('mouseout', () => {
    if (notificationSectionCollapsed) {
      collapseButton.style.background = 'var(--qpm-accent)';
      collapseButton.style.color = '#fff';
    }
  });

  const detailToggle = createButton('', { size: 'sm', onClick: () => {
    notificationDetailExpanded = !notificationDetailExpanded;
    storage.set(NOTIFICATIONS_DETAIL_EXPANDED_KEY, notificationDetailExpanded);
    updateNotificationDetailToggle();
    const selectedEvent = notificationSelectedId
      ? lastNotificationEvents.find((event) => event.id === notificationSelectedId) ?? null
      : null;
    updateNotificationDetailVisibility(selectedEvent);
    refreshNotificationContainerVisibility();
  }});
  // Re-apply active state after createButton's hover cycle resets cssText
  detailToggle.addEventListener('mouseout', () => {
    if (notificationDetailExpanded) {
      detailToggle.style.background = 'var(--qpm-accent)';
      detailToggle.style.color = '#fff';
    }
  });

  const clearButton = createButton('Clear', { size: 'sm', onClick: () => {
    clearNotifications();
    resetNotificationFilters();
    notificationSelectedId = null;
    notificationItemElements.clear();
    renderNotificationDetail(null);
    renderNotificationList([]);
    refreshNotificationContainerVisibility();
  }});

  controls.append(collapseButton, detailToggle, clearButton);
  headerRow.append(title, controls);
  section.appendChild(headerRow);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:8px;';
  section.appendChild(body);

  const filterBar = document.createElement('div');
  filterBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  body.appendChild(filterBar);

  const listWrapper = document.createElement('div');
  listWrapper.style.cssText = 'max-height:240px;overflow-y:auto;padding-right:4px;';
  body.appendChild(listWrapper);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  listWrapper.appendChild(list);

  const emptyState = createEmptyState('No notifications yet.');
  body.appendChild(emptyState);

  const detailCard = document.createElement('div');
  detailCard.style.cssText = 'border:1px solid var(--qpm-border);background:var(--qpm-surface-2);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:120px';
  body.appendChild(detailCard);

  const detailPlaceholder = document.createElement('div');
  detailPlaceholder.textContent = 'Select a notification to see full details.';
  detailPlaceholder.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);text-align:center;';
  detailCard.appendChild(detailPlaceholder);

  const detailHeader = document.createElement('div');
  detailHeader.style.cssText = 'display:none;justify-content:space-between;align-items:flex-start;gap:12px;';
  detailCard.appendChild(detailHeader);

  const detailTitle = document.createElement('div');
  detailTitle.style.cssText = 'font-weight:600;font-size:12px;color:var(--qpm-text);flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;';
  detailHeader.appendChild(detailTitle);

  const detailTimestamp = document.createElement('div');
  detailTimestamp.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);white-space:nowrap;';
  detailHeader.appendChild(detailTimestamp);

  const detailMeta = document.createElement('div');
  detailMeta.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;font-size:10px;color:#d7e3ff;';
  detailCard.appendChild(detailMeta);

  const detailMessage = document.createElement('div');
  detailMessage.style.cssText = 'display:none;font-size:12px;line-height:1.5;color:var(--qpm-text);white-space:pre-wrap;word-break:break-word;';
  detailCard.appendChild(detailMessage);

  const detailActions = document.createElement('div');
  detailActions.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;';
  detailCard.appendChild(detailActions);

  const detailRaw = document.createElement('pre');
  detailRaw.style.cssText = 'display:none;font-size:10px;color:#9cd2ff;background:rgba(255,255,255,0.05);padding:8px;border-radius:4px;margin:0;max-height:140px;overflow:auto;';
  detailCard.appendChild(detailRaw);

  uiState.notificationsSection = section;
  uiState.notificationsFilterBar = filterBar;
  uiState.notificationsListWrapper = listWrapper;
  uiState.notificationsList = list;
  uiState.notificationsEmpty = emptyState;
  uiState.notificationsDetail = detailCard;
  uiState.notificationsDetailHeader = detailHeader;
  uiState.notificationsDetailTitle = detailTitle;
  uiState.notificationsDetailTimestamp = detailTimestamp;
  uiState.notificationsDetailMeta = detailMeta;
  uiState.notificationsDetailMessage = detailMessage;
  uiState.notificationsDetailActions = detailActions;
  uiState.notificationsDetailRaw = detailRaw;
  uiState.notificationsDetailPlaceholder = detailPlaceholder;
  uiState.notificationsDetailToggle = detailToggle;

  notificationFilters.clear();
  notificationFeatureButtons.clear();
  notificationAllButton = null;
  notificationItemElements.clear();
  notificationSelectedId = null;
  renderNotificationDetail(null);

  uiState.notificationsUnsubscribe?.();
  uiState.notificationsUnsubscribe = onNotifications((events) => {
    lastNotificationEvents = events;
    rebuildNotificationFilterButtons(events);
    renderNotificationList(events);
    if (notificationSelectedId) {
      const matching = events.find((event) => event.id === notificationSelectedId) ?? null;
      if (!matching) {
        renderNotificationDetail(null);
      }
    }
  });

  const updateCollapseButton = (): void => {
    collapseButton.textContent = notificationSectionCollapsed ? 'Expand' : 'Collapse';
    if (notificationSectionCollapsed) {
      collapseButton.style.background = 'var(--qpm-accent)';
      collapseButton.style.color = '#fff';
    } else {
      collapseButton.style.background = '';
      collapseButton.style.color = '';
    }
  };

  updateCollapseButton();
  updateNotificationDetailToggle();
  setNotificationSectionCollapsed(notificationSectionCollapsed);
  updateNotificationDetailVisibility(null);
  refreshNotificationContainerVisibility();

  return section;
}

function rebuildNotificationFilterButtons(events: NotificationEvent[]): void {
  if (!uiState) return;
  const filterBar = uiState.notificationsFilterBar;
  if (!filterBar) return;

  const features = Array.from(new Set(events.map(event => event.feature))).sort();
  for (const feature of Array.from(notificationFilters)) {
    if (!features.includes(feature)) {
      notificationFilters.delete(feature);
    }
  }

  filterBar.textContent = '';

  notificationAllButton = createNotificationFilterButton('All', () => {
    resetNotificationFilters();
    renderNotificationList(lastNotificationEvents);
  });
  setNotificationFilterActive(notificationAllButton, notificationFilters.size === 0);
  filterBar.appendChild(notificationAllButton);

  notificationFeatureButtons.clear();
  for (const feature of features) {
    const button = createNotificationFilterButton(formatNotificationFeature(feature), () => {
      toggleNotificationFilter(feature);
    });
    setNotificationFilterActive(button, notificationFilters.has(feature));
    filterBar.appendChild(button);
    notificationFeatureButtons.set(feature, button);
  }
}

function toggleNotificationFilter(feature: string): void {
  if (notificationFilters.has(feature)) {
    notificationFilters.delete(feature);
  } else {
    notificationFilters.add(feature);
  }

  if (notificationFilters.size === 0) {
    setNotificationFilterActive(notificationAllButton, true);
  } else {
    setNotificationFilterActive(notificationAllButton, false);
  }

  for (const [name, button] of notificationFeatureButtons) {
    setNotificationFilterActive(button, notificationFilters.has(name));
  }

  renderNotificationList(lastNotificationEvents);
}

function resetNotificationFilters(): void {
  notificationFilters.clear();
  setNotificationFilterActive(notificationAllButton, true);
  for (const button of notificationFeatureButtons.values()) {
    setNotificationFilterActive(button, false);
  }
  refreshNotificationContainerVisibility();
}

function setNotificationSectionCollapsed(collapsed: boolean): void {
  notificationSectionCollapsed = collapsed;
  try {
    storage.set(NOTIFICATIONS_COLLAPSED_KEY, collapsed);
  } catch (error) {
    console.warn('[qpm] failed to persist notification collapse state', error);
  }
  refreshNotificationContainerVisibility();
}

function updateNotificationDetailToggle(): void {
  if (!uiState) return;
  const toggle = uiState.notificationsDetailToggle;
  if (!toggle) return;
  toggle.textContent = notificationDetailExpanded ? 'Hide extra info' : 'Show extra info';
  if (notificationDetailExpanded) {
    toggle.style.background = 'var(--qpm-accent)';
    toggle.style.color = '#fff';
  } else {
    toggle.style.background = '';
    toggle.style.color = '';
  }
}

function updateNotificationDetailVisibility(event: NotificationEvent | null): void {
  if (!uiState) return;
  const meta = uiState.notificationsDetailMeta;
  const actions = uiState.notificationsDetailActions;
  const raw = uiState.notificationsDetailRaw;
  if (!meta || !actions || !raw) {
    return;
  }

  if (!event) {
    meta.style.display = 'none';
    actions.style.display = 'none';
    raw.style.display = 'none';
    return;
  }

  if (notificationDetailExpanded) {
    meta.style.display = 'flex';
    actions.style.display = actions.childElementCount > 0 ? 'flex' : 'none';
    raw.style.display = 'block';
  } else {
    meta.style.display = 'none';
    actions.style.display = 'none';
    raw.style.display = 'none';
  }
}

function refreshNotificationContainerVisibility(): void {
  if (!uiState) return;
  const filterBar = uiState.notificationsFilterBar;
  const listWrapper = uiState.notificationsListWrapper;
  const emptyState = uiState.notificationsEmpty;
  const detail = uiState.notificationsDetail;
  const detailToggle = uiState.notificationsDetailToggle;
  const section = uiState.notificationsSection;

  if (section) {
    section.dataset.collapsed = notificationSectionCollapsed ? 'true' : 'false';
  }

  const hasItems = lastNotificationFilteredCount > 0;

  if (filterBar) {
    filterBar.style.display = notificationSectionCollapsed ? 'none' : 'flex';
  }
  if (listWrapper) {
    listWrapper.style.display = notificationSectionCollapsed ? 'none' : hasItems ? 'block' : 'none';
  }
  if (emptyState) {
    emptyState.style.display = notificationSectionCollapsed ? 'none' : hasItems ? 'none' : 'block';
  }
  if (detail) {
    // Only show detail card when NOT collapsed AND detail is expanded
    detail.style.display = notificationSectionCollapsed ? 'none' : (notificationDetailExpanded ? 'flex' : 'none');
  }
  if (detailToggle) {
    detailToggle.style.display = notificationSectionCollapsed ? 'none' : 'inline-flex';
    detailToggle.disabled = !notificationSelectedId;
    detailToggle.style.opacity = detailToggle.disabled ? '0.6' : '1';
  }
}

function renderNotificationList(events: NotificationEvent[]): void {
  if (!uiState) return;
  lastNotificationEvents = events;
  const list = uiState.notificationsList;
  const emptyState = uiState.notificationsEmpty;
  if (!list || !emptyState) return;

  const filtered = notificationFilters.size > 0
    ? events.filter(event => notificationFilters.has(event.feature))
    : events;

  if (notificationSelectedId && !filtered.some((event) => event.id === notificationSelectedId)) {
    notificationSelectedId = null;
  }

  const ordered = filtered.slice().reverse();
  lastNotificationFilteredCount = ordered.length;

  if (ordered.length > 0 && !notificationSelectedId) {
    notificationSelectedId = ordered[0]?.id ?? null;
  }

  list.textContent = '';
  notificationItemElements.clear();

  if (ordered.length === 0) {
    list.style.display = 'none';
    emptyState.style.display = 'block';
    renderNotificationDetail(null);
    refreshNotificationContainerVisibility();
    return;
  }

  list.style.display = 'flex';
  emptyState.style.display = 'none';

  for (const event of ordered) {
    const item = buildNotificationListItem(event);
    notificationItemElements.set(event.id, item);
    list.appendChild(item);
  }

  applyNotificationSelection();

  const selectedEvent = ordered.find((event) => event.id === notificationSelectedId) ?? null;
  renderNotificationDetail(selectedEvent);
  refreshNotificationContainerVisibility();
}

function buildNotificationListItem(event: NotificationEvent): HTMLButtonElement {
  const accent = NOTIFICATION_LEVEL_COLORS[event.level] || NOTIFICATION_LEVEL_COLORS.info;
  const icon = NOTIFICATION_LEVEL_ICONS[event.level] || NOTIFICATION_LEVEL_ICONS.info;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.notificationId = event.id;
  button.dataset.accent = accent;
  button.setAttribute('aria-pressed', 'false');

  // Modern card design inspired by Aries mod
  button.style.cssText = `
    text-align: left;
    background: linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
    border: 1px solid var(--qpm-border);
    border-left: 4px solid ${accent};
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--qpm-text);
    cursor: pointer;
    transition: all 0.2s ease;
    backdrop-filter: blur(8px);
  `;
  button.addEventListener('click', () => handleNotificationSelection(event));

  // Hover effect
  button.addEventListener('mouseenter', () => {
    if (button.dataset.notificationId !== notificationSelectedId) {
      button.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))';
      button.style.borderColor = 'var(--qpm-accent-subtle)';
      button.style.transform = 'translateX(2px)';
    }
  });
  button.addEventListener('mouseleave', () => {
    if (button.dataset.notificationId !== notificationSelectedId) {
      button.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))';
      button.style.borderColor = 'var(--qpm-border)';
      button.style.transform = 'none';
    }
  });

  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';

  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;';

  // Larger, more prominent icon
  const iconBadge = document.createElement('span');
  iconBadge.textContent = icon;
  iconBadge.style.cssText = `
    font-size: 16px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: ${accent}14;
    border-radius: 8px;
    flex-shrink: 0;
  `;
  headerLeft.appendChild(iconBadge);

  // Feature tag with better styling
  const featureTag = document.createElement('span');
  featureTag.textContent = formatNotificationFeature(event.feature);
  featureTag.style.cssText = `
    background: var(--qpm-accent-subtle);
    padding: 4px 8px;
    border-radius: 8px;
    font-size: 12px;
    color: #c7b8ff;
    font-weight: 600;
    letter-spacing: 0.3px;
  `;
  headerLeft.appendChild(featureTag);

  // Level badge (only show for warn/error to reduce clutter)
  if (event.level === 'warn' || event.level === 'error') {
    const levelTag = document.createElement('span');
    levelTag.textContent = event.level.toUpperCase();
    levelTag.style.cssText = `
      padding: 4px 8px;
      border-radius: 8px;
      background: ${accent}20;
      color: ${accent};
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
    `;
    headerLeft.appendChild(levelTag);
  }

  // Cleaner timestamp
  const time = document.createElement('span');
  time.textContent = formatSince(event.timestamp);
  time.title = new Date(event.timestamp).toLocaleString();
  time.style.cssText = `
    font-size: 12px;
    color: var(--qpm-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
    font-weight: 500;
  `;

  headerRow.append(headerLeft, time);
  button.appendChild(headerRow);

  // Message with better readability
  const summaryText = event.message.length > 160 ? `${event.message.slice(0, 160)}…` : event.message;
  const message = document.createElement('div');
  message.textContent = summaryText;
  message.style.cssText = `
    font-size: 12px;
    color: rgba(255,255,255,0.85);
    line-height: 1.6;
    margin-left: 36px;
  `;
  button.appendChild(message);

  // Action hint with icon
  if (Array.isArray(event.actions) && event.actions.length > 0) {
    const hint = document.createElement('div');
    hint.textContent = `⚡ ${event.actions.length} quick action${event.actions.length > 1 ? 's' : ''} available`;
    hint.style.cssText = `
      font-size: 12px;
      color: #90caf9;
      margin-left: 36px;
      font-weight: 500;
    `;
    button.appendChild(hint);
  }

  return button;
}

function handleNotificationSelection(event: NotificationEvent): void {
  notificationSelectedId = event.id;
  applyNotificationSelection();
  renderNotificationDetail(event);
}

function applyNotificationSelection(): void {
  for (const [id, element] of notificationItemElements) {
    const accent = element.dataset.accent ?? NOTIFICATION_LEVEL_COLORS.info;
    if (id === notificationSelectedId) {
      // Modern selected state
      element.style.background = `linear-gradient(135deg, ${accent}14, ${accent}08)`;
      element.style.borderColor = `${accent}`;
      element.style.borderLeftWidth = '4px';
      element.style.boxShadow = `0 4px 12px ${accent}30, inset 0 0 0 1px ${accent}20`;
      element.style.transform = 'translateX(4px)';
      element.setAttribute('aria-pressed', 'true');
    } else {
      element.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))';
      element.style.borderColor = 'var(--qpm-border)';
      element.style.borderLeftWidth = '4px';
      element.style.boxShadow = 'none';
      element.style.transform = 'none';
      element.setAttribute('aria-pressed', 'false');
    }
  }
}

function renderNotificationDetail(event: NotificationEvent | null): void {
  if (!uiState) return;
  const placeholder = uiState.notificationsDetailPlaceholder;
  const header = uiState.notificationsDetailHeader;
  const title = uiState.notificationsDetailTitle;
  const timestamp = uiState.notificationsDetailTimestamp;
  const meta = uiState.notificationsDetailMeta;
  const message = uiState.notificationsDetailMessage;
  const actions = uiState.notificationsDetailActions;
  const raw = uiState.notificationsDetailRaw;

  if (!placeholder || !header || !title || !timestamp || !meta || !message || !actions || !raw) {
    return;
  }

  if (!event) {
    placeholder.style.display = 'block';
    header.style.display = 'none';
    message.style.display = 'none';
    meta.style.display = 'none';
    actions.style.display = 'none';
    raw.style.display = 'none';
    raw.textContent = '';
    updateNotificationDetailToggle();
    refreshNotificationContainerVisibility();
    return;
  }

  placeholder.style.display = 'none';
  header.style.display = 'flex';
  message.style.display = 'block';

  const absoluteTime = new Date(event.timestamp);
  title.textContent = `${formatNotificationFeature(event.feature)} — ${event.level.toUpperCase()}`;
  title.title = event.message;
  timestamp.textContent = `${formatSince(event.timestamp)} • ${absoluteTime.toLocaleString()}`;

  meta.textContent = '';
  meta.appendChild(createNotificationMetaBadge('ID', event.id));
  meta.appendChild(createNotificationMetaBadge('Feature', formatNotificationFeature(event.feature)));
  meta.appendChild(createNotificationMetaBadge('Level', event.level.toUpperCase()));

  message.textContent = event.message;

  actions.textContent = '';
  if (Array.isArray(event.actions) && event.actions.length > 0) {
    for (const action of event.actions) {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.textContent = action.label;
      actionBtn.className = 'qpm-button';
      actionBtn.style.fontSize = '10px';
      actionBtn.addEventListener('click', () => {
        try {
          action.onClick();
        } catch (error) {
          console.error('[qpm] notification action error', error);
        }
      });
      actions.appendChild(actionBtn);
    }
  }

  const safeActions = Array.isArray(event.actions)
    ? event.actions.map(({ label }) => ({ label }))
    : undefined;
  const safeEvent = {
    ...event,
    actions: safeActions,
  } satisfies Record<string, unknown>;
  raw.textContent = JSON.stringify(safeEvent, null, 2);
  raw.scrollTop = 0;
  updateNotificationDetailVisibility(event);
  updateNotificationDetailToggle();
  refreshNotificationContainerVisibility();
}

function createNotificationMetaBadge(label: string, value: string): HTMLElement {
  const badge = document.createElement('span');
  badge.style.cssText = 'padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.08);color:#d7e3ff;display:inline-flex;gap:4px;align-items:center;';

  const labelEl = document.createElement('span');
  labelEl.textContent = `${label}:`;
  labelEl.style.cssText = 'font-weight:600;color:var(--qpm-text);';
  badge.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.textContent = value;
  badge.appendChild(valueEl);

  return badge;
}

function createNotificationFilterButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = 'qpm-button';
  button.style.fontSize = '10px';
  button.addEventListener('click', onClick);
  return button;
}

function setNotificationFilterActive(button: HTMLButtonElement | null, active: boolean): void {
  if (!button) return;
  button.dataset.active = active ? 'true' : 'false';
  if (active) {
    button.classList.add('qpm-button--positive');
  } else {
    button.classList.remove('qpm-button--positive');
  }
}

function formatNotificationFeature(feature: string): string {
  if (!feature) return 'General';
  return feature
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
