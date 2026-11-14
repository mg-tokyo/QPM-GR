export type AlertGroup = 'shops' | 'pets' | 'garden' | 'room' | 'qpm';

export interface AlertRowDef {
  id: string;
  group: AlertGroup;
  /** i18n key of the row's name in the centre. */
  labelKey: string;
  /** Sound when the player never chose one: a built-in id, a custom id, or `none`. */
  defaultSound: string;
  /** On before the player ever chose; only QPM's own rare messages (ALR-9 PD1). New alerts stay off. */
  defaultEnabled?: boolean;
  /** Opens the feature's own controls (the centre's ⚙). */
  settingsAction?: () => void;
}

const rows = new Map<string, AlertRowDef>();

/** Idempotent: a second call with the same id replaces the definition in place. */
export function registerAlertRow(def: AlertRowDef): void {
  rows.set(def.id, def);
}

export function getAlertRow(id: string): AlertRowDef | null {
  return rows.get(id) ?? null;
}

export function listAlertRows(): AlertRowDef[] {
  return [...rows.values()];
}
