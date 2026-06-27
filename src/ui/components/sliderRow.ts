export interface SliderRowOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  formatFn?: (value: number) => string;
}

export function createSliderRow(opts: SliderRowOptions): HTMLElement {
  const { label, min, max, step, value, onChange, formatFn } = opts;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);width:60px;flex-shrink:0;';
  labelEl.textContent = label;

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  range.style.cssText = 'flex:1;accent-color:#8f82ff;';

  const fmt = formatFn ?? ((v: number) => `${Math.round(v * 100)}%`);
  const numEl = document.createElement('span');
  numEl.style.cssText = 'font-size:11px;color:#c8c0ff;width:40px;text-align:right;flex-shrink:0;';
  numEl.textContent = fmt(value);

  range.addEventListener('input', () => {
    const v = parseFloat(range.value);
    numEl.textContent = fmt(v);
    onChange(v);
  });

  row.append(labelEl, range, numEl);
  return row;
}
