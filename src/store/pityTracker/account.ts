import { fetchGameAccountInfo, getGameAccountLastError } from '../../services/gameAccount';
import { ACCOUNT_REFRESH_MS, ACCOUNT_RETRY_MS, ctx, diag, notify, persist } from './state';

export function refreshAccount(): void {
  const account = ctx.state.account;
  if (account && account.createdAt !== null && Date.now() - account.fetchedAt < ACCOUNT_REFRESH_MS) return;
  // Throttle retries when the answer is still unknown so a persistent 401 doesn't hammer /me.
  if (Date.now() - ctx.lastAccountAttempt < ACCOUNT_RETRY_MS) return;
  ctx.lastAccountAttempt = Date.now();
  fetchGameAccountInfo()
    .then((info) => {
      if (!ctx.started) return;
      if (!info) {
        // Nothing was requested (user not in a room yet, e.g. landing page) — retry on the next update.
        if (getGameAccountLastError() === 'no room base') ctx.lastAccountAttempt = 0;
        return;
      }
      ctx.state.account = { createdAt: info.createdAt, fetchedAt: Date.now() };
      persist();
      notify();
    })
    .catch((error) => diag.warn('QPM-STORE-003', { phase: 'account' }, error));
}
