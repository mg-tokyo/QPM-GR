import { storage } from '../../utils/storage';
import { isRecord } from '../../utils/typeGuards';

const SETTINGS_KEY = 'qpm.alertHub.v1';

/** `none` = the row raises silently. */
export interface AlertRowSettings {
  enabled: boolean;
  soundId: string;
}

/** The row's Desktop tick (ALR-13) sits in the same stored row, outside the public row shape. */
interface StoredRow extends AlertRowSettings {
  desktop?: boolean;
}

interface StoredSettings {
  soundsOn: boolean;
  desktopOn: boolean;
  rows: Record<string, StoredRow>;
}

function readStored(): StoredSettings {
  const raw = storage.get<unknown>(SETTINGS_KEY, null);
  const r = isRecord(raw) ? raw : {};
  const rows: Record<string, StoredRow> = {};
  if (isRecord(r.rows)) {
    for (const [id, row] of Object.entries(r.rows)) {
      if (isRecord(row) && typeof row.enabled === 'boolean' && typeof row.soundId === 'string') {
        rows[id] = { enabled: row.enabled, soundId: row.soundId, ...(row.desktop === true ? { desktop: true } : {}) };
      }
    }
  }
  return { soundsOn: r.soundsOn !== false, desktopOn: r.desktopOn === true, rows };
}

/** Master gate for every QPM alert sound (D3); on unless the player turned it off. */
export function areAlertSoundsOn(): boolean {
  return readStored().soundsOn;
}

export function writeAlertSoundsOn(on: boolean): void {
  storage.set(SETTINGS_KEY, { ...readStored(), soundsOn: on });
}

/** A row never saved uses its defaults: off unless the row says otherwise (intake: new alerts off by default). */
export function getAlertRowSettings(id: string, defaultSound: string, defaultEnabled = false): AlertRowSettings {
  const row = readStored().rows[id];
  return row ? { enabled: row.enabled, soundId: row.soundId } : { enabled: defaultEnabled, soundId: defaultSound };
}

export function writeAlertRowSettings(id: string, row: AlertRowSettings): void {
  const stored = readStored();
  storage.set(SETTINGS_KEY, { ...stored, rows: { ...stored.rows, [id]: { ...stored.rows[id], ...row } } });
}

/** Master "Desktop notifications" switch (ALR-13 D1); off by default. */
export function isDesktopOn(): boolean {
  return readStored().desktopOn;
}

export function writeDesktopOn(on: boolean): void {
  storage.set(SETTINGS_KEY, { ...readStored(), desktopOn: on });
}

export function isRowDesktop(id: string): boolean {
  return readStored().rows[id]?.desktop === true;
}

/** A row never saved is written with its defaults so the tick has a row to live on. */
export function writeRowDesktop(id: string, desktop: boolean, defaults: AlertRowSettings): void {
  const stored = readStored();
  const base = stored.rows[id] ?? defaults;
  const { desktop: _old, ...rest } = base as StoredRow;
  storage.set(SETTINGS_KEY, { ...stored, rows: { ...stored.rows, [id]: desktop ? { ...rest, desktop: true } : rest } });
}
