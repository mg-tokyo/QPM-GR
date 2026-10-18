import { createButton } from '../../../ui/components';

// Line icons for the compact bar (PS1, 2026-10-09), the waypoint rows (PW1) and the photo strip (PS3): constant markup,
// never user text.
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICONS = {
  director: '<svg viewBox="0 0 24 24"><rect x="3" y="10" width="18" height="11" rx="2"/><path d="M3 10l2.5-5.5H21L18.5 10M9 4.5 6.5 10M15 4.5 12.5 10"/></svg>',
  waypoints: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><path d="M4 8h3.5l2-3h5l2 3H20v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  exit: CROSS,
  rename: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  remove: CROSS,
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
} as const;
export type SpecIcon = keyof typeof ICONS;

export const span = (cls: string, text = ''): HTMLSpanElement => {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
};

export function setLabel(btn: HTMLButtonElement, label: string): void {
  btn.title = label;
  btn.setAttribute('aria-label', label);
  const lbl = btn.querySelector('.qpm-spec-lbl');
  if (lbl) lbl.textContent = label;
}

// createButton bakes the disabled look in at creation; the arrows change state while the bar lives.
export function setEnabled(btn: HTMLButtonElement, on: boolean): void {
  if (btn.disabled === !on) return;
  btn.disabled = !on;
  btn.style.opacity = on ? '' : '0.5';
  btn.style.cursor = on ? 'pointer' : 'not-allowed';
}

// A mouse click leaves focus on the button, and Space or Enter would press it again while the keys fly the camera.
export function barButton(label: string, variant: 'secondary' | 'primary' | 'ghost', onClick: () => void): HTMLButtonElement {
  const btn = createButton(label, { variant, size: 'sm', onClick });
  btn.addEventListener('click', (e) => { if (e.detail > 0) btn.blur(); });
  return btn;
}

/** Label in the full bar, icon in the compact one; the caret shows in both. */
export function toolButton(icon: SpecIcon, label: string, variant: 'secondary' | 'primary' | 'ghost', onClick: () => void, caret = false): HTMLButtonElement {
  const btn = barButton('', variant, onClick);
  const ico = span('qpm-spec-ico');
  ico.innerHTML = ICONS[icon];
  btn.append(ico, span('qpm-spec-lbl', label));
  if (caret) btn.append(span('', '▾'));
  setLabel(btn, label);
  return btn;
}
