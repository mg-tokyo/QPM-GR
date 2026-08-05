import { storage } from '../../utils/storage';
import { createNamedLogger } from '../../diagnostics/logger';

const log = createNamedLogger('battleship');
const KEY = 'qpm.battleship.record.v1';

export interface MatchRecordEntry {
  at: number;
  mode: 'solo' | 'mp';
  outcome: 'win' | 'loss';
  opponent: string;
}

interface StoredRecord {
  soloWins: number;
  soloLosses: number;
  mpWins: number;
  mpLosses: number;
  history: MatchRecordEntry[];
}

const MAX_HISTORY = 50;

function empty(): StoredRecord {
  return { soloWins: 0, soloLosses: 0, mpWins: 0, mpLosses: 0, history: [] };
}

function read(): StoredRecord {
  const raw = storage.get<StoredRecord | null>(KEY, null);
  if (!raw || typeof raw !== 'object') return empty();
  return {
    soloWins: typeof raw.soloWins === 'number' ? raw.soloWins : 0,
    soloLosses: typeof raw.soloLosses === 'number' ? raw.soloLosses : 0,
    mpWins: typeof raw.mpWins === 'number' ? raw.mpWins : 0,
    mpLosses: typeof raw.mpLosses === 'number' ? raw.mpLosses : 0,
    history: Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY) : [],
  };
}

export function recordMatchOutcome(entry: MatchRecordEntry): void {
  try {
    const cur = read();
    const bumpField =
      entry.mode === 'solo'
        ? (entry.outcome === 'win' ? 'soloWins' : 'soloLosses')
        : (entry.outcome === 'win' ? 'mpWins' : 'mpLosses');
    cur[bumpField] = cur[bumpField] + 1;
    cur.history = [...cur.history, entry].slice(-MAX_HISTORY);
    storage.set(KEY, cur);
  } catch (err) {
    log.warn('QPM-BS-REC-001', { outcome: entry.outcome, mode: entry.mode }, err);
  }
}

export function getRecordSnapshot(): StoredRecord {
  return read();
}
