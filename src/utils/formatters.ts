// Shared formatting utilities to avoid duplication across UI modules

/**
 * Format a number with K/M/B suffixes for readability
 * @param value Number to format
 * @returns Formatted string (e.g., "1.5K", "2.3M", "1.0B")
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(0);
}

/**
 * Format a coin value, returning '—' for null/undefined/NaN
 * @param value Coin value to format
 * @returns Formatted string or '—'
 */
export function formatCoins(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return formatNumber(value);
}

/**
 * Format a timestamp as a localized date string
 * @param timestamp Unix timestamp in milliseconds
 * @returns Localized date/time string
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Format a duration in hours to a human-readable string
 * @param hours Duration in hours
 * @returns Formatted string (e.g., "2.5h", "1.0d")
 */
export function formatDuration(hours: number): string {
  if (hours >= 24) return `${(hours / 24).toFixed(1)}d`;
  return `${hours.toFixed(1)}h`;
}

/**
 * Format a percentage value
 * @param value Percentage (0-100)
 * @param decimals Number of decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}
