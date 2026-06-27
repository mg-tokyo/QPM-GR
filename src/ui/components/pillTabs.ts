import { t } from '../../i18n';

export function createPillTabs(
  labels: string[],
  activeIndex: number,
  onSelect: (index: number) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;padding:0 2px;';

  for (let i = 0; i < labels.length; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const lbl = labels[i]!;
    btn.textContent = t(lbl) || lbl;
    const active = i === activeIndex;
    btn.style.cssText = [
      'padding:5px 12px',
      'font-size:11px',
      'border-radius:14px',
      'cursor:pointer',
      'border:1px solid',
      'transition:all 0.12s',
      active
        ? 'background:rgba(143,130,255,0.25);border-color:rgba(143,130,255,0.55);color:#c8c0ff;font-weight:600;'
        : 'background:rgba(143,130,255,0.06);border-color:rgba(143,130,255,0.15);color:rgba(224,224,224,0.5);',
    ].join(';');
    btn.addEventListener('click', () => onSelect(i));
    row.appendChild(btn);
  }
  return row;
}
