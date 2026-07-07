export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function formatSince(timestamp: number): string {
  if (!timestamp) return '—';
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function normalizeSpeciesKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/(seed|plant|baby|fruit|crop)$/i, '');
}
