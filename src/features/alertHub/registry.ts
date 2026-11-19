import { t } from '../../i18n';

export type AlertGroup = 'shops' | 'pets' | 'garden' | 'room' | 'qpm';

export interface AlertRowDef {
  id: string;
  group: AlertGroup;
  /** i18n key of the row's name in the centre. */
  labelKey: string;
  /** Values for the label's placeholders, e.g. a catalog ability name on per-ability rows. */
  labelParams?: Record<string, string | number>;
  /** Sound when the player never chose one: a built-in id, a custom id, or `none`. */
  defaultSound: string;
  /** On before the player ever chose; only QPM's own rare messages (ALR-9 PD1). New alerts stay off. */
  defaultEnabled?: boolean;
  /** Opens the feature's own controls (the centre's ⚙). */
  settingsAction?: () => void;
  /** Centre row icon: a sprite data URL of the live entity or a catalog sprite, null while unresolved. */
  icon?: () => string | null;
  /** Centre row's live one-line summary of its settings. */
  summary?: () => string;
  /** The alert's colour (catalog value or `--qpm-*` token); a resolver when it follows a setting. */
  accent?: string | (() => string | null);
}

const rows = new Map<string, AlertRowDef>();

export function resolveRowLabel(def: AlertRowDef): string {
  return t(def.labelKey, def.labelParams);
}

type RowLook = Pick<AlertRowDef, 'icon' | 'summary' | 'accent'>;

// Resolvers read live feature state; a throwing one must not break the card or the centre.
export function resolveRowIcon(def: RowLook | null): string | null {
  try { return def?.icon?.() ?? null; } catch { return null; }
}

export function resolveRowSummary(def: RowLook | null): string | null {
  try { return def?.summary?.() ?? null; } catch { return null; }
}

export function resolveRowAccent(def: RowLook | null): string | null {
  try { return typeof def?.accent === 'function' ? def.accent() : def?.accent ?? null; } catch { return null; }
}

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
