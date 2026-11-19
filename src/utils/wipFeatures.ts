import { storage } from './storage';

const ALERTS_WIP_KEY = 'qpm.dev.alertsWip';

// The alert centre, its alarms and the forecast widget stay off in releases until ALR-17 reworks their UI.
// Only QPM_DEBUG_API.alertsWip turns them on (debug globals only); read once at init, so a change needs a reload.
export function areAlertsWipEnabled(): boolean {
  return storage.get<boolean>(ALERTS_WIP_KEY, false) === true;
}

export function setAlertsWipEnabled(on: boolean): void {
  storage.set(ALERTS_WIP_KEY, on);
}
