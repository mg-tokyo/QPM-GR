/**
 * Controller Settings window body — rendered inside QPM's modal window system.
 * No Shadow DOM; uses inline styles matching QPM's design language.
 *
 * Sections:
 *  - Status badge (brand + connected/disconnected, live updates)
 *  - Enable/Disable toggle
 *  - Cursor speed presets
 *  - Fixed controls (read-only)
 *  - Button bindings (rebindable, click to capture)
 *  - Unbound actions (collapsible)
 *  - Reset to Defaults
 */

import type { Action, CursorSpeed } from '../../features/input/controller/bindings';
import {
  ALL_ACTIONS,
  getActionLabel,
  DEFAULT_BINDINGS,
  loadBindings,
  saveBindings,
  saveCursorSpeed,
  loadCursorSpeed,
  CURSOR_SPEED_VALUES,
} from '../../features/input/controller/bindings';
import type { ControllerProfile } from '../../features/input/controller/controller-profile';
import { detectProfile } from '../../features/input/controller/controller-profile';
import { storage } from '../../utils/storage';
import { t } from '../../i18n';
import { watchDetach } from '../../utils/dom/dom';
import {
  getRunningPoller,
  getRunningCursor,
  startController,
  stopController,
} from '../../features/input/controller/index';

// Actions that are context-sensitive on LB/RB (hotbar when normal, grow slots on multi-harvest)
const CONTEXT_SENSITIVE_ACTIONS = new Set<Action>(['prevHotbarSlot', 'nextHotbarSlot']);
// deselectSlot is always active via the LB+RB chord regardless of bindings
const CHORD_ONLY_ACTION: Action = 'deselectSlot';

const ENABLED_KEY = 'qpm.controller.enabled.v1';


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ControllerSectionContext {
  getProfile(): ControllerProfile | null;
  updateBindings(bindings: Record<number, Action>): void;
}

/**
 * Renders the controller settings panel body.
 * `poller` may be null when the feature is not running (still shows stored settings).
 * `cursor` may be null when the feature is not running.
 */
export function createControllerSection(
  poller: ControllerSectionContext | null,
  cursor: { setSpeed(px: number): void } | null,
): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:0',
    'font-family:var(--qpm-font)',
    'font-size:14px',
    'color:var(--qpm-text, #eef0ff)',
  ].join(';');

  // Prefer the passed instances (opened via Start button); fall back to live
  // running refs (opened from Utility Hub while feature is active).
  const getPoller = (): ControllerSectionContext | null => poller ?? getRunningPoller();
  const getCursor = (): { setSpeed(px: number): void } | null => cursor ?? getRunningCursor();

  // Prefer the live poller's profile; fall back to navigator.getGamepads() directly
  // so labels and badge are correct even when the section is opened from the hub.
  const resolveProfile = (): ControllerProfile | null => {
    const p = getPoller();
    if (p) return p.getProfile();
    for (const gp of navigator.getGamepads()) {
      if (gp) return detectProfile(gp);
    }
    return null;
  };

  // Mutable state
  let currentBindings = loadBindings();
  let currentSpeed = loadCursorSpeed();
  let captureAbort: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // Re-render helper
  // ---------------------------------------------------------------------------

  const rerender = (): void => {
    root.innerHTML = '';
    build();
  };

  // ---------------------------------------------------------------------------
  // Status badge + enable toggle row
  // ---------------------------------------------------------------------------

  const buildHeader = (): void => {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:0 0 12px',
      'border-bottom:1px solid rgba(255,255,255,0.07)',
      'margin-bottom:12px',
    ].join(';');

    const profile = resolveProfile();
    const connected = profile !== null;
    const badgeText = connected ? t('feature.controller.connected', { name: profile!.name }) : t('feature.controller.noController');
    const badge = document.createElement('span');
    badge.style.cssText = [
      'font-size:12px',
      'padding:4px 8px',
      'border-radius:9999px',
      'white-space:nowrap',
      connected
        ? 'background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.35);color:var(--qpm-positive)'
        : 'background:rgba(120,120,120,0.12);border:1px solid rgba(120,120,120,0.2);color:var(--qpm-text-muted)',
    ].join(';');
    badge.textContent = badgeText;

    // Live badge updates via gamepad events
    const updateBadge = (): void => {
      const p = resolveProfile();
      const c = p !== null;
      badge.textContent = c ? t('feature.controller.connected', { name: p!.name }) : t('feature.controller.noController');
      badge.style.background = c ? 'rgba(76,175,80,0.15)' : 'rgba(120,120,120,0.12)';
      badge.style.border = c ? '1px solid rgba(76,175,80,0.35)' : '1px solid rgba(120,120,120,0.2)';
      badge.style.color = c ? 'var(--qpm-positive)' : 'var(--qpm-text-muted)';
    };
    window.addEventListener('gamepadconnected', updateBadge);
    window.addEventListener('gamepaddisconnected', updateBadge);
    // Cleanup when root is removed
    watchDetach(root, () => {
      window.removeEventListener('gamepadconnected', updateBadge);
      window.removeEventListener('gamepaddisconnected', updateBadge);
    });

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1';

    // Enable toggle
    const enabled = storage.get<boolean>(ENABLED_KEY, true);
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = enabled ? t('common.enabled') : t('common.disabled');
    toggleBtn.style.cssText = [
      'padding:6px 12px',
      'border-radius:8px',
      'font-size:12px',
      'cursor:pointer',
      'transition:background 0.15s,border-color 0.15s',
      enabled
        ? 'background:var(--qpm-accent-subtle);border:1px solid var(--qpm-accent-focus);color:var(--qpm-text)'
        : 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:var(--qpm-text-muted)',
    ].join(';');
    toggleBtn.addEventListener('click', () => {
      void (async () => {
        const nowEnabled = !storage.get<boolean>(ENABLED_KEY, true);
        storage.set(ENABLED_KEY, nowEnabled);
        if (nowEnabled) {
          await startController(); // wait for poller to be live before re-rendering labels
        } else {
          stopController();
        }
        rerender();
      })();
    });

    row.append(badge, spacer, toggleBtn);
    root.appendChild(row);
  };

  // ---------------------------------------------------------------------------
  // Cursor Speed
  // ---------------------------------------------------------------------------

  const buildSpeedSection = (): void => {
    const section = makeSection(t('feature.controller.cursorSpeed'));

    const speedLabels: Record<CursorSpeed, string> = {
      slow: t('feature.controller.speedSlow'),
      medium: t('feature.controller.speedMedium'),
      fast: t('feature.controller.speedFast'),
    };

    const speedRow = document.createElement('div');
    speedRow.style.cssText = 'display:flex;gap:6px;padding-bottom:8px;';

    for (const speed of ['slow', 'medium', 'fast'] as CursorSpeed[]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = speedLabels[speed];
      const isActive = speed === currentSpeed;
      btn.style.cssText = [
        'flex:1',
        'padding:6px 4px',
        'border-radius:8px',
        'font-size:12px',
        'cursor:pointer',
        'transition:background 0.15s,color 0.15s,border-color 0.15s',
        isActive
          ? 'background:var(--qpm-accent-border);border:1px solid var(--qpm-accent-emphasis);color:var(--qpm-text)'
          : 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);color:var(--qpm-text-muted)',
      ].join(';');
      btn.addEventListener('click', () => {
        currentSpeed = speed;
        saveCursorSpeed(speed);
        getCursor()?.setSpeed(CURSOR_SPEED_VALUES[speed]);
        rerender();
      });
      speedRow.appendChild(btn);
    }

    section.appendChild(speedRow);
    root.appendChild(section);
  };

  // ---------------------------------------------------------------------------
  // Fixed Controls
  // ---------------------------------------------------------------------------

  const buildFixedSection = (): void => {
    const profile = resolveProfile();
    const lb = btnLabel(profile, 4);
    const rb = btnLabel(profile, 5);

    const section = makeSection(t('feature.controller.fixedControls'));

    const rows: Array<[string | HTMLElement, string]> = [
      [t('feature.controller.leftStick'),  t('feature.controller.moveCharacter')],
      [t('feature.controller.rightStick'), t('feature.controller.moveCursor')],
      [t('feature.controller.dPad'),       t('feature.controller.snapCursor')],
    ];

    const table = makeTable();
    for (const [input, desc] of rows) {
      const tr = document.createElement('tr');
      const tdInput = document.createElement('td');
      tdInput.style.cssText = 'padding:4px 8px 4px 0;width:1%;white-space:nowrap;vertical-align:middle;';
      tdInput.appendChild(makePlainInputLabel(typeof input === 'string' ? input : ''));
      const tdDesc = document.createElement('td');
      tdDesc.style.cssText = 'padding:4px 0;color:var(--qpm-text-muted);font-size:12px;vertical-align:middle;';
      tdDesc.textContent = desc;
      tr.append(tdInput, tdDesc);
      table.querySelector('tbody')!.appendChild(tr);
    }

    // LB+RB chord row
    const chordTr = document.createElement('tr');
    const chordInput = document.createElement('td');
    chordInput.style.cssText = 'padding:4px 8px 4px 0;width:1%;white-space:nowrap;vertical-align:middle;';
    chordInput.append(makePill(lb), makeChordPlus(), makePill(rb));
    const chordDesc = document.createElement('td');
    chordDesc.style.cssText = 'padding:4px 0;color:var(--qpm-text-muted);font-size:12px;vertical-align:middle;';
    chordDesc.textContent = t('feature.controller.deselectHotbar');
    chordTr.append(chordInput, chordDesc);
    table.querySelector('tbody')!.appendChild(chordTr);

    section.appendChild(table);
    root.appendChild(section);
  };

  // ---------------------------------------------------------------------------
  // Button Bindings + Unbound Actions
  // ---------------------------------------------------------------------------

  const buildBindingsSection = (): void => {
    const profile = resolveProfile();
    const section = document.createElement('div');
    section.style.cssText = 'padding:12px 0 4px;border-bottom:1px solid rgba(255,255,255,0.06);';

    // Non-standard warning
    if (profile !== null && !profile.isStandard) {
      const warn = document.createElement('div');
      warn.style.cssText = [
        'margin-bottom:8px',
        'padding:6px 12px',
        'border-radius:8px',
        'background:rgba(255,179,71,0.1)',
        'border:1px solid rgba(255,179,71,0.2)',
        'color:var(--qpm-warning)',
        'font-size:12px',
      ].join(';');
      warn.textContent = `⚠ ${t('feature.controller.nonStandardWarning')}`;
      section.appendChild(warn);
    }

    // Section header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;';
    const label = makeSectionLabel(t('feature.controller.buttonBindings'));
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);font-style:italic;';
    hint.textContent = t('feature.controller.rebindHint');
    header.append(label, hint);
    section.appendChild(header);

    // Bound rows
    const boundEntries: Array<[number, Action]> = Object.entries(currentBindings)
      .map(([k, v]) => [parseInt(k, 10), v as Action] as [number, Action])
      .sort((a, b) => a[0] - b[0]);

    const boundActionSet = new Set(boundEntries.map(([, a]) => a));
    const unboundActions = (ALL_ACTIONS as readonly Action[])
      .filter((a) => !boundActionSet.has(a));

    const hasContextNote = boundEntries.some(([, a]) => CONTEXT_SENSITIVE_ACTIONS.has(a));

    const table = makeTable();
    for (const [btnIdx, action] of boundEntries) {
      const tr = document.createElement('tr');
      const tdInput = document.createElement('td');
      tdInput.style.cssText = 'padding:4px 8px 4px 0;width:1%;white-space:nowrap;vertical-align:middle;';
      tdInput.appendChild(makePill(btnLabel(profile, btnIdx)));

      const tdAction = document.createElement('td');
      tdAction.style.cssText = [
        'cursor:pointer',
        'color:var(--qpm-accent)',
        'padding:4px 0',
        'font-size:12px',
        'transition:color 0.15s',
        'vertical-align:middle',
      ].join(';');
      tdAction.innerHTML = getActionLabel(action) +
        (CONTEXT_SENSITIVE_ACTIONS.has(action)
          ? `<span style="font-size:10px;color:var(--qpm-text-muted);margin-left:4px;vertical-align:super;line-height:0;">†</span>`
          : '');
      tdAction.addEventListener('mouseenter', () => { tdAction.style.color = 'var(--qpm-accent)'; });
      tdAction.addEventListener('mouseleave', () => { tdAction.style.color = 'var(--qpm-accent)'; });
      tdAction.addEventListener('click', () => startCapture(action, tdAction));

      tr.append(tdInput, tdAction);
      table.querySelector('tbody')!.appendChild(tr);
    }
    section.appendChild(table);

    if (hasContextNote) {
      const footnote = document.createElement('div');
      footnote.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);font-style:italic;padding:4px 0 8px;';
      footnote.textContent = t('feature.controller.contextFootnote');
      section.appendChild(footnote);
    }

    // Unbound section
    if (unboundActions.length > 0) {
      const subHeader = document.createElement('div');
      subHeader.style.cssText = [
        'display:flex',
        'align-items:baseline',
        'justify-content:space-between',
        'margin-top:12px',
        'border-top:1px solid rgba(255,255,255,0.05)',
        'padding-top:12px',
      ].join(';');
      const subLabel = makeSectionLabel(t('feature.controller.unbound'), true);

      const collapseBtn = document.createElement('button');
      collapseBtn.type = 'button';
      collapseBtn.textContent = t('feature.controller.show');
      collapseBtn.setAttribute('aria-expanded', 'false');
      collapseBtn.style.cssText = [
        'background:none',
        'border:none',
        'color:var(--qpm-text-muted)',
        'font-size:12px',
        'font-style:italic',
        'font-family:inherit',
        'cursor:pointer',
        'padding:0',
        'transition:color 0.15s',
      ].join(';');
      collapseBtn.addEventListener('mouseenter', () => { collapseBtn.style.color = 'var(--qpm-text)'; });
      collapseBtn.addEventListener('mouseleave', () => { collapseBtn.style.color = 'var(--qpm-text-muted)'; });

      subHeader.append(subLabel, collapseBtn);
      section.appendChild(subHeader);

      const unboundBody = document.createElement('div');
      unboundBody.style.display = 'none';

      const unboundTable = makeTable();
      for (const action of unboundActions) {
        const tr = document.createElement('tr');
        const tdInput = document.createElement('td');
        tdInput.style.cssText = 'padding:4px 8px 4px 0;width:1%;white-space:nowrap;vertical-align:middle;';
        tdInput.appendChild(makePill('—', true));

        const tdAction = document.createElement('td');
        tdAction.style.cssText = [
          'cursor:pointer',
          'color:var(--qpm-text-muted)',
          'padding:4px 0',
          'font-size:12px',
          'transition:color 0.15s',
          'vertical-align:middle',
        ].join(';');
        const isChordAlso = action === CHORD_ONLY_ACTION;
        tdAction.textContent = getActionLabel(action);
        if (isChordAlso) {
          const sub = document.createElement('span');
          sub.style.cssText = 'display:block;font-size:12px;color:var(--qpm-text-muted);font-style:italic;margin-top:1px;';
          sub.textContent = t('feature.controller.chordNote', { lb: btnLabel(profile, 4), rb: btnLabel(profile, 5) });
          tdAction.appendChild(sub);
        }
        tdAction.addEventListener('mouseenter', () => { tdAction.style.color = 'var(--qpm-accent)'; });
        tdAction.addEventListener('mouseleave', () => { tdAction.style.color = 'var(--qpm-text-muted)'; });
        tdAction.addEventListener('click', () => startCapture(action, tdAction));

        tr.append(tdInput, tdAction);
        unboundTable.querySelector('tbody')!.appendChild(tr);
      }
      unboundBody.appendChild(unboundTable);
      section.appendChild(unboundBody);

      collapseBtn.addEventListener('click', () => {
        const expanded = unboundBody.style.display !== 'none';
        unboundBody.style.display = expanded ? 'none' : '';
        collapseBtn.textContent  = expanded ? t('feature.controller.show') : t('feature.controller.hide');
        collapseBtn.setAttribute('aria-expanded', String(!expanded));
      });
    }

    root.appendChild(section);
  };

  // ---------------------------------------------------------------------------
  // Reset footer
  // ---------------------------------------------------------------------------

  const buildFooter = (): void => {
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:12px 0 4px;display:flex;justify-content:flex-end;';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = t('feature.controller.resetToDefaults');
    resetBtn.style.cssText = [
      'background:rgba(244,67,54,0.12)',
      'border:1px solid rgba(244,67,54,0.28)',
      'color:var(--qpm-danger)',
      'padding:6px 12px',
      'border-radius:8px',
      'cursor:pointer',
      'font-size:12px',
      'transition:background 0.15s',
    ].join(';');
    resetBtn.addEventListener('mouseenter', () => { resetBtn.style.background = 'rgba(244,67,54,0.22)'; });
    resetBtn.addEventListener('mouseleave', () => { resetBtn.style.background = 'rgba(244,67,54,0.12)'; });
    resetBtn.addEventListener('click', () => {
      captureAbort?.();
      currentBindings = { ...DEFAULT_BINDINGS };
      saveBindings(currentBindings);
      getPoller()?.updateBindings(currentBindings);
      rerender();
    });

    footer.appendChild(resetBtn);
    root.appendChild(footer);
  };

  // ---------------------------------------------------------------------------
  // Rebind capture
  // ---------------------------------------------------------------------------

  const startCapture = (action: Action, cell: HTMLElement): void => {
    captureAbort?.();

    const originalHTML = cell.innerHTML;
    cell.textContent = t('feature.controller.pressButton');
    cell.style.color = 'var(--qpm-warning)';
    cell.style.fontStyle = 'italic';
    cell.style.cursor = 'default';

    let pollId: ReturnType<typeof setInterval> | null = null;
    let aborted = false;

    const abort = (): void => {
      if (aborted) return;
      aborted = true;
      if (pollId !== null) clearInterval(pollId);
      cell.innerHTML = originalHTML;
      cell.style.color = 'var(--qpm-accent)';
      cell.style.fontStyle = '';
      cell.style.cursor = 'pointer';
      captureAbort = null;
    };

    captureAbort = abort;

    const snapshot: Map<number, boolean> = new Map();
    for (const gp of navigator.getGamepads()) {
      if (!gp) continue;
      gp.buttons.forEach((btn, i) => snapshot.set(i, btn.pressed));
      break;
    }

    pollId = setInterval(() => {
      for (const gp of navigator.getGamepads()) {
        if (!gp) continue;
        gp.buttons.forEach((btn, i) => {
          if (btn.pressed && !(snapshot.get(i) ?? false) && !aborted) {
            clearInterval(pollId!);
            applyRebind(action, i);
            aborted = true;
            captureAbort = null;
          }
        });
        break;
      }
    }, 50);

    setTimeout(() => { if (!aborted) abort(); }, 5_000);
  };

  const applyRebind = (action: Action, newIndex: number): void => {
    // Remove existing mapping for this action
    for (const [btnIdx, act] of Object.entries(currentBindings)) {
      if (act === action) { delete currentBindings[parseInt(btnIdx, 10)]; break; }
    }
    // Displace whatever was on the new button
    delete currentBindings[newIndex];
    currentBindings[newIndex] = action;

    saveBindings(currentBindings);
    getPoller()?.updateBindings(currentBindings);
    rerender();
  };

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  const build = (): void => {
    buildHeader();
    buildSpeedSection();
    buildFixedSection();
    buildBindingsSection();
    buildFooter();
  };

  build();
  return root;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function makeSection(labelText: string): HTMLElement {
  const section = document.createElement('div');
  section.style.cssText = 'padding:0 0 12px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:12px;';
  section.appendChild(makeSectionLabel(labelText));
  return section;
}

function makeSectionLabel(text: string, _dim = false): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'font-size:10px',
    'font-weight:600',
    'letter-spacing:0.08em',
    'text-transform:uppercase',
    `color:var(--qpm-text-muted)`,
    'padding-bottom:8px',
  ].join(';');
  el.textContent = text;
  return el;
}

function makeTable(): HTMLElement {
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;';
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  return table;
}

function makePill(label: string, unbound = false): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'min-width:32px',
    'padding:2px 8px',
    'border-radius:4px',
    unbound
      ? 'border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:var(--qpm-text-muted)'
      : 'border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.09);color:var(--qpm-text)',
    'font-size:12px',
    'font-weight:500',
    'white-space:nowrap',
    'line-height:1.5',
    'vertical-align:middle',
  ].join(';');
  el.textContent = label;
  return el;
}

function makeChordPlus(): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);margin:0 4px;vertical-align:middle;';
  el.textContent = '+';
  return el;
}

function makePlainInputLabel(text: string): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);font-style:italic;';
  el.textContent = text;
  return el;
}

function btnLabel(profile: ControllerProfile | null, index: number): string {
  return profile?.buttonLabels[index] ?? t('feature.controller.btnFallback', { index: String(index) });
}
