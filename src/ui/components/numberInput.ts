export interface NumberInputOptions {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  onChange?: (value: number) => void;
  label?: string;
  suffix?: string;
}

interface NumberInputResult {
  root: HTMLElement;
  input: HTMLInputElement;
  getValue: () => number;
  setValue: (value: number) => void;
}

export function createNumberInput(options: NumberInputOptions = {}): NumberInputResult {
  const {
    min,
    max,
    step = 1,
    value = 0,
    onChange,
    label,
    suffix,
  } = options;

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;align-items:center;gap:var(--qpm-space-4);';

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText =
      'font-size:var(--qpm-font-body);color:var(--qpm-text);' +
      'font-family:var(--qpm-font);white-space:nowrap;';
    root.appendChild(labelEl);
  }

  const inputWrap = document.createElement('div');
  inputWrap.style.cssText =
    'display:flex;align-items:center;gap:var(--qpm-space-2);';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'qpm-input';
  input.value = String(value);
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.step = String(step);
  input.style.cssText +=
    'width:64px;text-align:center;' +
    '-moz-appearance:textfield;';
  inputWrap.appendChild(input);

  if (suffix) {
    const suffixEl = document.createElement('span');
    suffixEl.textContent = suffix;
    suffixEl.style.cssText =
      'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);' +
      'font-family:var(--qpm-font);';
    inputWrap.appendChild(suffixEl);
  }

  root.appendChild(inputWrap);

  if (onChange) {
    input.addEventListener('change', () => {
      let val = parseFloat(input.value);
      if (isNaN(val)) val = value;
      if (min !== undefined && val < min) val = min;
      if (max !== undefined && val > max) val = max;
      input.value = String(val);
      onChange(val);
    });
  }

  function getValue(): number {
    const val = parseFloat(input.value);
    return isNaN(val) ? 0 : val;
  }

  function setValue(v: number): void {
    input.value = String(v);
  }

  return { root, input, getValue, setValue };
}
