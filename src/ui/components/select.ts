export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function createSelect(
  options: SelectOption[],
  selected: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.style.cssText =
    'background:rgba(0,0,0,0.3);border:1px solid rgba(143,130,255,0.2);' +
    'color:#e0e0e0;border-radius:6px;padding:3px 6px;font-size:11px;';

  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === selected) o.selected = true;
    if (opt.disabled) o.disabled = true;
    sel.appendChild(o);
  }

  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
