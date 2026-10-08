export interface SliderRowOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Every input tick (live preview). */
  onChange?: (value: number) => void;
  /** Once per committed value (pointer release, keyboard step): persist here. */
  onCommit?: (value: number) => void;
  formatFn?: (value: number) => string;
  disabled?: boolean;
  /** Label column in px (default 60); 'auto' sizes it to the label on one line. */
  labelWidth?: number | 'auto';
}

export interface SliderRowControl {
  root: HTMLElement;
  setValue: (value: number) => void;
  setDisabled: (value: boolean) => void;
}

export function createSliderRowControl(opts: SliderRowOptions): SliderRowControl {
  const { label, min, max, step, value, onChange, onCommit, formatFn, disabled = false, labelWidth = 60 } = opts;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);flex-shrink:0;' +
    (labelWidth === 'auto' ? 'white-space:nowrap;' : `width:${labelWidth}px;`);
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
    onChange?.(v);
  });
  if (onCommit) range.addEventListener('change', () => onCommit(parseFloat(range.value)));

  row.append(labelEl, range, numEl);

  const setDisabled = (v: boolean): void => {
    range.disabled = v;
    row.style.opacity = v ? '0.5' : '1';
  };
  if (disabled) setDisabled(true);

  return {
    root: row,
    setValue: (v) => { range.value = String(v); numEl.textContent = fmt(v); },
    setDisabled,
  };
}

export function createSliderRow(opts: SliderRowOptions): HTMLElement {
  return createSliderRowControl(opts).root;
}
