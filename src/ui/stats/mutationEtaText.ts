// Mutation ETA wording shared by the Stats Hub garden tab and the ability tracker (ALR-5.4).

import { t } from '../../i18n';
import type { MutationEtaEntry } from '../../features/garden/mutationEta';

export function formatEtaHours(hours: number): string {
  const totalMinutes = Math.max(1, Math.round(hours * 60));
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return t('feature.mutationEta.days', { d: String(d), h: String(h) });
  if (h > 0) return t('feature.mutationEta.hours', { h: String(h), m: String(m) });
  return t('feature.mutationEta.minutes', { m: String(m) });
}

/** "~4d 15h", "done", or "no fed granter" when the granters have no rate. */
export function describeEta(entry: MutationEtaEntry): string {
  if (entry.etaHours === 0) return t('feature.mutationEta.done');
  if (entry.etaHours === null) return t('feature.mutationEta.noGranter');
  return formatEtaHours(entry.etaHours);
}
