import { toggleWindow } from './core/modalWindow';
import { createButton, createSectionHeader } from './components';
import { t } from '../i18n';
import {
  initBattleship,
  getMatchSnapshot,
  onMatchChange,
  startSoloMatch,
  beginPlacement,
  resignMatch,
  sendChallenge,
  acceptChallenge,
  declineChallenge,
  claimTimeoutWin,
  getRecordSnapshot,
  FLEET_SPECS,
  type MatchSnapshot,
  type PlacementController,
  type GridSide,
} from '../features/battleship';

export const BATTLESHIP_WINDOW_ID = 'battleship';

export function openBattleshipWindow(): void {
  toggleWindow(
    BATTLESHIP_WINDOW_ID,
    t('feature.battleship.title', undefined, 'Garden Battleship'),
    render,
    '360px',
    'min(520px, 80vh)',
  );
}

function render(root: HTMLElement): void {
  root.style.cssText =
    'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;gap:12px;font-family:var(--qpm-font);color:var(--qpm-text);';

  let controller: PlacementController | null = null;

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
  root.appendChild(body);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() === 'r' && controller && getMatchSnapshot().phase === 'placing') {
      controller.rotate();
    }
  };
  document.addEventListener('keydown', onKey);

  // The panel body stays in DOM across close/re-open (window is hidden, not
  // destroyed). Mirror statsHubWindow's pattern: keep the onMatchChange
  // subscription alive across close, and force a re-render on restore so the
  // click-handler closures aren't stale after re-open. See modalWindow.ts:709.
  let needsRebuild = false;
  const onWindowClosed = (e: Event): void => {
    if ((e as CustomEvent).detail?.id !== BATTLESHIP_WINDOW_ID) return;
    needsRebuild = true;
  };
  const onWindowRestored = (e: Event): void => {
    if ((e as CustomEvent).detail?.id !== BATTLESHIP_WINDOW_ID) return;
    if (needsRebuild) {
      needsRebuild = false;
      update(getMatchSnapshot());
    }
  };
  window.addEventListener('qpm:window-closed', onWindowClosed);
  window.addEventListener('qpm:window-restored', onWindowRestored);

  const update = (snap: MatchSnapshot): void => {
    body.textContent = '';
    // Challenger enters 'placing' after opp accepts — panel needs a controller.
    if (snap.phase === 'placing' && !controller) controller = beginPlacement();
    if (snap.phase === 'idle' || snap.phase === 'ended') {
      controller = null;
      renderIdle(snap);
    } else if (snap.phase === 'placing') renderPlacing(snap);
    else if (snap.phase === 'waitingAccept' || snap.phase === 'waitingReady') renderWaiting(snap);
    else renderBattle(snap);
  };

  function note(text: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);';
    el.textContent = text;
    return el;
  }

  function buttonRow(...buttons: HTMLElement[]): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    row.append(...buttons);
    return row;
  }

  function renderIdle(snap: MatchSnapshot): void {
    if (snap.pendingChallenge) {
      renderIncomingChallenge(snap.pendingChallenge);
      // Fall through so player can still start solo below.
    }
    const section = document.createElement('div');
    section.dataset.tour = 'battleship-modes';
    section.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    section.appendChild(createSectionHeader(t('feature.battleship.playSolo', undefined, 'Play vs AI')).root);
    if (snap.phase === 'ended' && snap.endReason) {
      const result = document.createElement('div');
      result.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-accent);';
      result.textContent = endReasonLabel(snap.endReason);
      section.appendChild(result);
    }
    section.appendChild(note(t('feature.battleship.chooseGrid', undefined, 'Choose which of your two plots hosts your hidden fleet:')));
    const startSolo = (grid: GridSide): void => {
      if (startSoloMatch(grid)) controller = beginPlacement();
    };
    section.appendChild(
      buttonRow(
        createButton(t('feature.battleship.leftPlot', undefined, 'Left plot'), { variant: 'primary', onClick: () => startSolo(0) }),
        createButton(t('feature.battleship.rightPlot', undefined, 'Right plot'), { variant: 'primary', onClick: () => startSolo(1) }),
      ),
    );
    body.appendChild(section);

    renderPlayerPicker(snap.roomPlayers);
    renderRecord();

    const safety = document.createElement('div');
    safety.dataset.tour = 'battleship-safety';
    safety.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px;';
    safety.appendChild(
      note(t('feature.battleship.safety', undefined, 'Your real garden is hidden and locked during a match — nothing real is ever changed.')),
    );
    body.appendChild(safety);
  }

  function renderRecord(): void {
    const rec = getRecordSnapshot();
    const soloTotal = rec.soloWins + rec.soloLosses;
    const mpTotal = rec.mpWins + rec.mpLosses;
    if (soloTotal === 0 && mpTotal === 0) return; // don't show empty tracker

    const section = document.createElement('div');
    section.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px;';
    section.appendChild(createSectionHeader(t('feature.battleship.record', undefined, 'Your record')).root);

    const row = (label: string, wins: number, losses: number): HTMLElement => {
      const total = wins + losses;
      const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
      const el = document.createElement('div');
      el.style.cssText =
        'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--qpm-surface-2);border-radius:6px;font-size:12px;';
      const name = document.createElement('span');
      name.style.cssText = 'flex:1;color:var(--qpm-text-muted);';
      name.textContent = label;
      const bar = document.createElement('span');
      bar.style.cssText = 'display:inline-flex;flex:2;height:8px;border-radius:9999px;overflow:hidden;background:var(--qpm-danger);';
      if (total > 0) {
        const winFill = document.createElement('span');
        winFill.style.cssText = `width:${winRate}%;background:var(--qpm-positive);`;
        bar.appendChild(winFill);
      }
      const nums = document.createElement('span');
      nums.style.cssText = 'display:inline-flex;gap:6px;color:var(--qpm-text);font-weight:600;min-width:70px;justify-content:flex-end;';
      nums.textContent = `${wins}W · ${losses}L`;
      el.append(name, bar, nums);
      return el;
    };

    if (soloTotal > 0) section.appendChild(row(t('feature.battleship.vsAi', undefined, 'vs AI'), rec.soloWins, rec.soloLosses));
    if (mpTotal > 0) section.appendChild(row(t('feature.battleship.vsPlayers', undefined, 'vs players'), rec.mpWins, rec.mpLosses));
    body.appendChild(section);
  }

  function renderIncomingChallenge(pc: { playerId: string; playerName: string }): void {
    const card = document.createElement('div');
    card.style.cssText =
      'display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:8px;background:var(--qpm-surface-2);';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-accent);';
    title.textContent = t(
      'feature.battleship.challengeIncoming',
      { name: pc.playerName },
      '{name} wants to play Garden Battleship!',
    );
    card.appendChild(title);
    card.appendChild(note(t('feature.battleship.chooseGrid', undefined, 'Choose which of your two plots hosts your hidden fleet:')));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    const doAccept = (g: GridSide): void => {
      if (acceptChallenge(g)) controller = beginPlacement();
    };
    grid.append(
      createButton(t('feature.battleship.leftPlot', undefined, 'Left plot'), { variant: 'primary', onClick: () => doAccept(0) }),
      createButton(t('feature.battleship.rightPlot', undefined, 'Right plot'), { variant: 'primary', onClick: () => doAccept(1) }),
      createButton(t('feature.battleship.decline', undefined, 'Decline'), { variant: 'ghost', onClick: () => declineChallenge() }),
    );
    card.appendChild(grid);
    body.appendChild(card);
  }

  function renderPlayerPicker(players: Array<{ id: string; name: string }>): void {
    const section = document.createElement('div');
    section.dataset.tour = 'battleship-picker';
    section.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    section.appendChild(createSectionHeader(t('feature.battleship.challenge', undefined, 'Challenge a player…')).root);
    if (players.length === 0) {
      section.appendChild(
        note(t('feature.battleship.noOtherPlayers', undefined, 'No other players in this room right now.')),
      );
    } else {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;';
      for (const p of players) {
        const row = document.createElement('div');
        row.style.cssText =
          'display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--qpm-surface-2);border-radius:4px;';
        const name = document.createElement('span');
        name.style.cssText = 'flex:1;font-size:12px;';
        name.textContent = p.name;
        const btn = createButton(t('feature.battleship.challengeThem', undefined, 'Challenge'), {
          onClick: () => sendChallenge(p.id, p.name),
        });
        row.append(name, btn);
        list.appendChild(row);
      }
      section.appendChild(list);
    }
    body.appendChild(section);
  }

  function renderWaiting(snap: MatchSnapshot): void {
    const section = document.createElement('div');
    section.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    const label =
      snap.phase === 'waitingAccept'
        ? t('feature.battleship.challengeSent', { name: snap.opponentName ?? '?' }, 'Waiting for {name} to accept…')
        : t('feature.battleship.waitingOpponent', undefined, 'Waiting for opponent to be ready…');
    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-accent);';
    heading.textContent = label;
    section.appendChild(heading);
    section.appendChild(
      buttonRow(
        createButton(t('feature.battleship.cancel', undefined, 'Cancel'), { variant: 'ghost', onClick: () => resignMatch() }),
      ),
    );
    body.appendChild(section);
  }

  function endReasonLabel(reason: NonNullable<MatchSnapshot['endReason']>): string {
    switch (reason) {
      case 'win': return t('feature.battleship.win', undefined, 'Victory! You harvested the whole enemy garden');
      case 'loss': return t('feature.battleship.loss', undefined, 'Defeat — your garden was fully harvested');
      case 'opponentResign': return t('feature.battleship.opponentResigned', { name: '' }, 'Opponent resigned. You win!');
      case 'opponentLeft': return t('feature.battleship.opponentLeft', { name: '' }, 'Opponent left the room — match ended.');
      case 'timeoutClaim': return t('feature.battleship.timeoutClaimWon', undefined, 'Match claimed by timeout.');
      case 'voidMismatch': return t('feature.battleship.voidMismatch', undefined, 'Opponent layout did not match their commit — match voided.');
      case 'resign': return t('feature.battleship.resignedByYou', undefined, 'You resigned. Match ended.');
      case 'aborted': return t('feature.battleship.matchEnded', undefined, 'Match ended');
      case 'featureStop': return t('feature.battleship.matchEnded', undefined, 'Match ended');
    }
  }

  function renderPlacing(snap: MatchSnapshot): void {
    const section = document.createElement('div');
    section.dataset.tour = 'battleship-fleet';
    section.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    section.appendChild(createSectionHeader(t('feature.battleship.placeFleet', undefined, 'Plant your fleet')).root);
    const placed = snap.placement?.placed ?? 0;

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    FLEET_SPECS.forEach((spec, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;';
      const cells = document.createElement('span');
      cells.style.cssText = `display:inline-block;width:${spec.length * 12}px;height:10px;border-radius:4px;background:${
        i < placed ? 'var(--qpm-positive)' : i === placed ? 'var(--qpm-accent)' : 'var(--qpm-surface-2)'
      };`;
      const label = document.createElement('span');
      label.textContent = `${t('feature.battleship.row', undefined, 'Crop row')} × ${spec.length}`;
      label.style.cssText = i === placed ? 'color:var(--qpm-accent);font-weight:600;' : '';
      row.append(cells, label);
      list.appendChild(row);
    });
    section.appendChild(list);
    section.appendChild(
      note(
        t(
          'feature.battleship.placeHint',
          { key: snap.placement?.horizontal ? 'R → vertical' : 'R → horizontal' },
          'Walk your character onto your plot and press SPACE to place the highlighted row. Rotate: {key}.',
        ),
      ),
    );
    section.appendChild(
      buttonRow(
        createButton(t('feature.battleship.rotate', undefined, 'Rotate (R)'), { onClick: () => controller?.rotate() }),
        createButton(t('feature.battleship.random', undefined, 'Random'), { onClick: () => controller?.randomize() }),
        createButton(t('feature.battleship.clear', undefined, 'Clear'), { onClick: () => controller?.clearAll() }),
        createButton(t('feature.battleship.ready', undefined, 'Ready'), {
          variant: 'confirm',
          disabled: placed !== FLEET_SPECS.length,
          onClick: () => {
            void controller?.ready();
          },
        }),
      ),
    );
    section.appendChild(
      buttonRow(createButton(t('feature.battleship.abandon', undefined, 'Abandon'), { variant: 'ghost', onClick: () => resignMatch() })),
    );
    body.appendChild(section);
  }

  function renderBattle(snap: MatchSnapshot): void {
    const status = document.createElement('div');
    status.dataset.tour = 'battleship-status';
    status.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    const turn = document.createElement('div');
    turn.style.cssText = `font-size:14px;font-weight:600;color:${snap.myTurn ? 'var(--qpm-positive)' : 'var(--qpm-text-muted)'};`;
    turn.textContent = snap.myTurn
      ? t('feature.battleship.yourShot', undefined, 'Your shot — walk onto an enemy tile and use your shovel to fire')
      : t('feature.battleship.theirTurn', undefined, 'Their turn…');
    status.appendChild(turn);

    const pips = (label: string, left: number): HTMLElement => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;';
      const name = document.createElement('span');
      name.style.cssText = 'width:80px;';
      name.textContent = label;
      const dots = document.createElement('span');
      dots.style.cssText = 'display:flex;gap:4px;';
      for (let i = 0; i < FLEET_SPECS.length; i++) {
        const dot = document.createElement('span');
        dot.style.cssText = `width:10px;height:10px;border-radius:9999px;background:${
          i < left ? 'var(--qpm-accent)' : 'var(--qpm-surface-2)'
        };`;
        dots.appendChild(dot);
      }
      row.append(name, dots);
      return row;
    };
    status.appendChild(pips(t('feature.battleship.you', undefined, 'You'), snap.myRowsLeft));
    status.appendChild(pips(snap.opponentName ?? '?', snap.theirRowsLeft));
    status.appendChild(note(`${t('feature.battleship.shots', undefined, 'Shots fired')}: ${snap.shotCount}`));
    body.appendChild(status);

    const actions = document.createElement('div');
    actions.dataset.tour = 'battleship-actions';
    actions.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    if (snap.canClaimTimeoutWin) {
      actions.appendChild(
        buttonRow(
          createButton(t('feature.battleship.claimWin', undefined, 'Claim win'), {
            variant: 'confirm',
            onClick: () => claimTimeoutWin(),
          }),
        ),
      );
    }
    actions.appendChild(
      buttonRow(
        createButton(t('feature.battleship.resign', undefined, 'Resign'), {
          variant: 'danger',
          onClick: () => resignMatch(),
        }),
      ),
    );
    actions.appendChild(
      note(t('feature.battleship.safety', undefined, 'Your real garden is hidden and locked during a match — nothing real is ever changed.')),
    );
    body.appendChild(actions);
  }

  initBattleship();
  onMatchChange(update);
  update(getMatchSnapshot());

  import('./tour')
    .then(({ checkTour, injectReplayButton }) => {
      checkTour(BATTLESHIP_WINDOW_ID, root);
      injectReplayButton(BATTLESHIP_WINDOW_ID);
    })
    .catch(() => {
      /* tour is optional */
    });

  // No cleanup returned — mirrors statsHubWindow: subscription + listeners
  // survive close (modalWindow.ts:709 runContentCleanup would tear them down
  // otherwise). Body stays in DOM across close; leaks are page-lifetime bounded.
}
