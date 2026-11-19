// Team apply with the Pets window toasts, shared by the per-team keys and the Next/Previous team keys (INP-1.5b).

import { applyTeam } from '../../../store/petTeams';
import { t } from '../../../i18n';
import { showToast } from './helpers';

// Applies queue (store/petTeams/apply.ts enqueueApply); a key press during one steps on from this team.
let pendingKeyApply: { teamId: string; count: number } | null = null;

export function getPendingKeyApplyTeamId(): string | null {
  return pendingKeyApply?.teamId ?? null;
}

export function applyTeamWithToasts(team: { id: string; name: string }): Promise<void> {
  pendingKeyApply = { teamId: team.id, count: (pendingKeyApply?.count ?? 0) + 1 };
  showToast(t('feature.petsWindow.applyingTeam', { name: team.name }));
  return applyTeam(team.id)
    .then((result) => {
      if (result.errors.length === 0) {
        showToast(t('feature.petsWindow.appliedTeam', { name: team.name }), 'success');
      } else {
        const summary = result.errorSummary ? `: ${result.errorSummary}` : '';
        showToast(t('feature.petsWindow.appliedWithErrors', { name: team.name, count: String(result.errors.length), summary }), 'error');
      }
    })
    .catch(() => showToast(t('feature.petsWindow.teamApplyFailed'), 'error'))
    .finally(() => {
      if (!pendingKeyApply) return;
      pendingKeyApply.count -= 1;
      if (pendingKeyApply.count <= 0) pendingKeyApply = null;
    });
}
