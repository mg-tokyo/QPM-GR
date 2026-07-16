import { t } from '../../../i18n';
import {
  ACCENT,
  TEXT,
  MUTED,
  HOVER_BG,
  PILL_ACTIVE_BG,
  PILL_ACTIVE_BORDER,
  PILL_INACTIVE_BG,
  PILL_INACTIVE_BORDER,
  MUT_INACTIVE_BG,
  MUT_INACTIVE_BORDER,
} from './constants';
import { el } from './domHelpers';
import type { PillOption, MutationTileOption } from './types';

export function buildPillRow(
  options: PillOption[],
  initial: string | null,
  onChange: (value: string | null) => void,
): { container: HTMLElement; setActive: (value: string | null) => void } {
  const container = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');
  let activeValue = initial;
  const buttons: { btn: HTMLElement; value: string | null }[] = [];

  function applyStyle(btn: HTMLElement, active: boolean): void {
    btn.style.background = active ? PILL_ACTIVE_BG : PILL_INACTIVE_BG;
    btn.style.borderColor = active ? PILL_ACTIVE_BORDER : PILL_INACTIVE_BORDER;
    btn.style.color = active ? TEXT : MUTED;
  }

  for (const opt of options) {
    const btn = el(
      'button',
      [
        'padding:4px 8px',
        'font-size:12px',
        'border-radius:8px',
        'cursor:pointer',
        'border:1px solid',
        'transition:background 0.12s,border-color 0.12s,color 0.12s',
        'font-family:inherit',
      ].join(';'),
      opt.label,
    );
    btn.type = 'button';
    applyStyle(btn, opt.value === activeValue);
    buttons.push({ btn, value: opt.value });

    btn.addEventListener('click', () => {
      activeValue = opt.value;
      for (const b of buttons) applyStyle(b.btn, b.value === activeValue);
      onChange(opt.value);
    });

    container.appendChild(btn);
  }

  const setActive = (value: string | null) => {
    activeValue = value;
    for (const b of buttons) applyStyle(b.btn, b.value === activeValue);
  };

  return { container, setActive };
}

export function buildMutationToggleRow(
  options: MutationTileOption[],
  onChange: (value: string | null) => void,
): { container: HTMLElement; setActive: (value: string | null) => void } {
  const container = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');
  let activeValue: string | null = null;

  interface TileRef { tile: HTMLElement; dot: HTMLElement; label: HTMLElement; value: string | null; color: string; gradient: string | undefined }
  const tiles: TileRef[] = [];

  function applyState(t: TileRef, active: boolean): void {
    t.tile.style.borderColor = active ? t.color : MUT_INACTIVE_BORDER;
    t.tile.style.background = active ? (t.gradient ?? t.color) : MUT_INACTIVE_BG;
    t.dot.style.background = active ? 'rgba(0,0,0,0.2)' : (t.gradient ?? t.color);
    t.label.style.color = active ? '#111' : MUTED;
  }

  // "None" tile
  {
    const tile = el('button', [
      'padding:4px 8px',
      'border-radius:8px',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'gap:6px',
      'transition:background .15s,border-color .15s,color .15s',
      `border:1px solid ${PILL_ACTIVE_BORDER}`,
      `background:${PILL_ACTIVE_BG}`,
      'font-family:inherit',
    ].join(';'));
    tile.type = 'button';
    const label = el('div', `font-size:12px;font-weight:600;white-space:nowrap;color:${TEXT};`, t('feature.cropCalc.none'));
    tile.appendChild(label);

    const noneRef = { tile, dot: label, label, value: null as string | null, color: ACCENT, gradient: undefined };
    tiles.push(noneRef);

    const applyNone = (active: boolean) => {
      tile.style.borderColor = active ? PILL_ACTIVE_BORDER : MUT_INACTIVE_BORDER;
      tile.style.background = active ? PILL_ACTIVE_BG : MUT_INACTIVE_BG;
      label.style.color = active ? TEXT : MUTED;
    };

    tile.addEventListener('mouseenter', () => { if (activeValue !== null) { tile.style.background = HOVER_BG; tile.style.borderColor = 'var(--qpm-accent-border)'; } });
    tile.addEventListener('mouseleave', () => { if (activeValue !== null) { tile.style.background = MUT_INACTIVE_BG; tile.style.borderColor = MUT_INACTIVE_BORDER; } });
    tile.addEventListener('click', () => {
      activeValue = null;
      for (const t of tiles) {
        if (t.value === null) applyNone(true);
        else applyState(t, false);
      }
      onChange(null);
    });

    noneRef.tile = tile;
    container.appendChild(tile);
  }

  // Mutation tiles
  for (const opt of options) {
    const tile = el('button', [
      'padding:4px 8px',
      'border-radius:8px',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'gap:6px',
      'transition:background .15s,border-color .15s,color .15s',
      `border:1px solid ${MUT_INACTIVE_BORDER}`,
      `background:${MUT_INACTIVE_BG}`,
      'font-family:inherit',
    ].join(';'));
    tile.type = 'button';
    tile.title = opt.displayName;

    const dot = el('div', `width:10px;height:10px;border-radius:50%;flex-shrink:0;transition:background .15s;background:${opt.gradient ?? opt.color}`);
    const label = el('div', `font-size:12px;font-weight:600;white-space:nowrap;transition:color .15s;color:${MUTED}`, `${opt.displayName} ×${opt.multiplier}`);
    tile.append(dot, label);

    const ref: TileRef = { tile, dot, label, value: opt.value, color: opt.color, gradient: opt.gradient };
    tiles.push(ref);

    tile.addEventListener('mouseenter', () => { if (activeValue !== opt.value) { tile.style.background = `${opt.color}18`; tile.style.borderColor = `${opt.color}55`; } });
    tile.addEventListener('mouseleave', () => { if (activeValue !== opt.value) { tile.style.background = MUT_INACTIVE_BG; tile.style.borderColor = MUT_INACTIVE_BORDER; } });
    tile.addEventListener('click', () => {
      activeValue = opt.value;
      for (const t of tiles) {
        if (t.value === null) {
          t.tile.style.borderColor = MUT_INACTIVE_BORDER;
          t.tile.style.background = MUT_INACTIVE_BG;
          t.label.style.color = MUTED;
        } else {
          applyState(t, t.value === activeValue);
        }
      }
      onChange(opt.value);
    });

    container.appendChild(tile);
  }

  const setActive = (value: string | null) => {
    activeValue = value;
    for (const t of tiles) {
      if (t.value === null) {
        t.tile.style.borderColor = value === null ? PILL_ACTIVE_BORDER : MUT_INACTIVE_BORDER;
        t.tile.style.background = value === null ? PILL_ACTIVE_BG : MUT_INACTIVE_BG;
        t.label.style.color = value === null ? TEXT : MUTED;
      } else {
        applyState(t, t.value === value);
      }
    }
  };

  return { container, setActive };
}
