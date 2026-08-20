import { createButton, createToggle, showConfirmDialog } from '../../../ui/components';
import { t } from '../../../i18n';
import { PRESCRIPTED_ROUNDS } from '../constants';
import {
  getMatchSnapshot,
  onMatchChange,
  setAutoStart,
  setPaused,
  setSpeed,
} from '../state';
import type { MatchSnapshot, Speed } from '../types';
import { createEnemiesPopover } from './enemiesPopover';
import { getActiveTrack } from '../engine/path';
import { canSwitchTrack } from '../tracks/active';
import { getTrackDisplayName } from '../tracks/registry';
import { createTrackPopover } from './trackPopover';

const SPEED_VALUES: readonly Speed[] = [1, 2, 3];

interface HudRefs {
  cashValue: HTMLSpanElement;
  livesValue: HTMLSpanElement;
  roundValue: HTMLSpanElement;
  pauseBtn: HTMLButtonElement;
  speedBtns: Map<Speed, HTMLButtonElement>;
  setAutoStartChecked: (v: boolean) => void;
  trackBtn: HTMLButtonElement;
}

export function mountHud(host: HTMLElement, onQuit: () => void, onOpenSaves: () => void): () => void {
  const cleanups: Array<() => void> = [];

  const bar = document.createElement('div');
  bar.className = 'qpm-td-hud';

  const roundStat = buildStat(t('feature.towerDefense.title'));
  const cashStat = buildStat(t('feature.towerDefense.cash'));
  const livesStat = buildStat(t('feature.towerDefense.lives'));

  const spacer = document.createElement('div');
  spacer.className = 'qpm-td-hud-spacer';

  const speedCluster = document.createElement('div');
  speedCluster.className = 'qpm-td-hud-speeds';

  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'qpm-td-speed-btn';
  pauseBtn.textContent = t('feature.towerDefense.paused');
  pauseBtn.addEventListener('click', () => {
    const snap = getMatchSnapshot();
    setPaused(!snap.paused);
    render(getMatchSnapshot());
  });

  const speedBtns = new Map<Speed, HTMLButtonElement>();
  for (const s of SPEED_VALUES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qpm-td-speed-btn';
    b.textContent = `${s}x`;
    b.addEventListener('click', () => {
      setSpeed(s);
      const snap = getMatchSnapshot();
      if (snap.paused) setPaused(false);
      render(getMatchSnapshot());
    });
    speedBtns.set(s, b);
  }

  speedCluster.append(pauseBtn, ...speedBtns.values());

  const initial = getMatchSnapshot();
  const autoStartToggle = createToggle({
    size: 'compact',
    checked: initial.autoStart,
    label: t('feature.towerDefense.autoStart'),
    onChange: (v) => setAutoStart(v),
  });

  const enemiesPopover = createEnemiesPopover();
  const enemiesWrap = document.createElement('div');
  enemiesWrap.className = 'qpm-td-enemies-wrap';
  const enemiesBtn = createButton(t('feature.towerDefense.enemies.buttonLabel'), {
    variant: 'secondary',
    size: 'sm',
    onClick: () => enemiesPopover.toggle(),
  });
  enemiesWrap.append(enemiesBtn, enemiesPopover.root);
  cleanups.push(() => enemiesPopover.destroy());

  const trackPopover = createTrackPopover();
  const trackWrap = document.createElement('div');
  trackWrap.className = 'qpm-td-tracks-wrap';
  const trackBtn = createButton('', {
    variant: 'secondary',
    size: 'sm',
    onClick: () => trackPopover.toggle(),
  });
  trackBtn.classList.add('qpm-td-tracks-btn');
  trackWrap.append(trackBtn, trackPopover.root);
  cleanups.push(() => trackPopover.destroy());

  const savesBtn = createButton(t('feature.towerDefense.saves.button'), {
    variant: 'secondary',
    size: 'sm',
    onClick: () => onOpenSaves(),
  });

  const quitBtn = createButton('Quit', {
    variant: 'danger',
    size: 'sm',
    onClick: () => {
      void showConfirmDialog({
        title: t('feature.towerDefense.quitConfirm'),
        message: '',
        variant: 'danger',
      }).then((accepted) => {
        if (accepted) onQuit();
      });
    },
  });

  bar.append(
    roundStat.root,
    cashStat.root,
    livesStat.root,
    spacer,
    speedCluster,
    autoStartToggle.root,
    enemiesWrap,
    trackWrap,
    savesBtn,
    quitBtn,
  );
  host.appendChild(bar);

  const refs: HudRefs = {
    cashValue: cashStat.value,
    livesValue: livesStat.value,
    roundValue: roundStat.value,
    pauseBtn,
    speedBtns,
    setAutoStartChecked: autoStartToggle.setChecked,
    trackBtn,
  };

  function render(snap: MatchSnapshot): void {
    refs.cashValue.textContent = String(snap.cash);
    refs.cashValue.className = 'qpm-td-hud-stat-value qpm-td-hud-stat-value--cash';

    refs.livesValue.textContent = String(snap.lives);
    const lowLives = snap.lives <= 20;
    refs.livesValue.className =
      'qpm-td-hud-stat-value ' +
      (lowLives ? 'qpm-td-hud-stat-value--lives-low' : 'qpm-td-hud-stat-value--lives');

    refs.roundValue.textContent = roundText(snap);

    refs.pauseBtn.classList.toggle('qpm-td-active', snap.paused);
    for (const [s, b] of refs.speedBtns) {
      b.classList.toggle('qpm-td-active', !snap.paused && snap.speed === s);
    }

    refs.trackBtn.textContent = t('feature.towerDefense.tracks.button', { name: getTrackDisplayName(getActiveTrack()) });
    const trackLocked = !canSwitchTrack(snap);
    refs.trackBtn.disabled = trackLocked;
    refs.trackBtn.title = trackLocked ? t('feature.towerDefense.tracks.locked') : '';
    if (trackLocked) trackPopover.close();

    refs.setAutoStartChecked(snap.autoStart);
  }

  render(initial);
  const unsub = onMatchChange(render);
  cleanups.push(unsub);

  return () => {
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* teardown must not throw */ }
    }
    try { bar.remove(); } catch { /* already gone */ }
  };
}

interface StatEls {
  root: HTMLElement;
  value: HTMLSpanElement;
}

function buildStat(label: string): StatEls {
  const root = document.createElement('div');
  root.className = 'qpm-td-hud-stat';

  const labelEl = document.createElement('span');
  labelEl.className = 'qpm-td-hud-stat-label';
  labelEl.textContent = label;

  const value = document.createElement('span');
  value.className = 'qpm-td-hud-stat-value';
  value.textContent = '—';

  root.append(labelEl, value);
  return { root, value };
}

function roundText(snap: MatchSnapshot): string {
  if (snap.phase === 'idle') return '—';
  if (snap.isEndless) return t('feature.towerDefense.roundEndless', { n: snap.round });
  return t('feature.towerDefense.roundLabel', { round: snap.round, total: PRESCRIPTED_ROUNDS });
}
