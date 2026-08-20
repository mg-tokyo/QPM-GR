import { createButton } from '../../../ui/components';
import { t } from '../../../i18n';
import { getMatchSnapshot, onMatchChange } from '../state';
import { loadHighScore, saveHighScore } from '../persistence';
import type { MatchSnapshot, Phase } from '../types';

export function mountGameOverModal(
  host: HTMLElement,
  onRestart: () => void,
  onQuit: () => void,
): () => void {
  const cleanups: Array<() => void> = [];

  const overlay = document.createElement('div');
  overlay.className = 'qpm-td-gameover-overlay';
  overlay.hidden = true;

  const card = document.createElement('div');
  card.className = 'qpm-td-gameover-card';

  const titleEl = document.createElement('div');
  titleEl.className = 'qpm-td-gameover-title';
  titleEl.textContent = t('feature.towerDefense.gameOverTitle');

  const bodyEl = document.createElement('div');
  bodyEl.className = 'qpm-td-gameover-body';

  const btnRow = document.createElement('div');
  btnRow.className = 'qpm-td-gameover-buttons';

  const restartBtn = createButton(t('feature.towerDefense.restart'), {
    variant: 'primary',
    onClick: () => onRestart(),
  });
  const quitBtn = createButton(t('feature.towerDefense.quit'), {
    variant: 'secondary',
    onClick: () => onQuit(),
  });

  btnRow.append(restartBtn, quitBtn);
  card.append(titleEl, bodyEl, btnRow);
  overlay.appendChild(card);
  host.appendChild(overlay);

  let lastPhase: Phase = getMatchSnapshot().phase;

  function fillBody(snap: MatchSnapshot, bestRound: number): void {
    bodyEl.textContent = t('feature.towerDefense.gameOverHighestRound', {
      round: snap.round,
      best: bestRound,
    });
  }

  function render(snap: MatchSnapshot): void {
    const wasEnded = lastPhase === 'ended';
    const isEnded = snap.phase === 'ended';
    lastPhase = snap.phase;

    if (isEnded && !wasEnded) {
      const best = saveHighScore(snap.round, snap.isEndless);
      fillBody(snap, best.highestRoundReached);
      overlay.hidden = false;
    } else if (!isEnded && wasEnded) {
      overlay.hidden = true;
    } else if (isEnded && wasEnded) {
      fillBody(snap, loadHighScore().highestRoundReached);
    }
  }

  render(getMatchSnapshot());
  cleanups.push(onMatchChange(render));

  return () => {
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* teardown must not throw */ }
    }
    try { overlay.remove(); } catch { /* already gone */ }
  };
}
