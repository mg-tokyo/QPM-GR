import { debounceCancelable } from '../../utils/scheduling/debounce';

export interface SearchInputOptions {
  placeholder?: string;
  onInput?: (value: string) => void;
  debounceMs?: number;
  value?: string;
}

interface SearchInputResult {
  root: HTMLElement;
  input: HTMLInputElement;
  getValue: () => string;
  setValue: (value: string) => void;
  clear: () => void;
  destroy: () => void;
}

export function createSearchInput(options: SearchInputOptions = {}): SearchInputResult {
  const {
    placeholder = 'Search...',
    onInput,
    debounceMs = 200,
    value = '',
  } = options;

  const root = document.createElement('div');
  root.style.cssText = 'position:relative;width:100%;';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'qpm-input';
  input.placeholder = placeholder;
  input.value = value;
  input.style.cssText +=
    'width:100%;box-sizing:border-box;' +
    'padding-left:28px;';
  root.appendChild(input);

  // Search icon (CSS circle + line)
  const iconWrap = document.createElement('div');
  iconWrap.style.cssText =
    'position:absolute;left:8px;top:50%;transform:translateY(-50%);' +
    'width:14px;height:14px;pointer-events:none;opacity:0.5;';
  iconWrap.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
    '<circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5"/>' +
    '<line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    '</svg>';
  iconWrap.style.color = 'var(--qpm-text-muted)';
  root.appendChild(iconWrap);

  const cleanups: Array<() => void> = [];

  if (onInput) {
    if (debounceMs > 0) {
      const debounced = debounceCancelable(
        (val: string) => onInput(val),
        debounceMs,
      );
      const handler = (): void => debounced(input.value);
      input.addEventListener('input', handler);
      cleanups.push(() => {
        input.removeEventListener('input', handler);
        debounced.cancel();
      });
    } else {
      const handler = (): void => onInput(input.value);
      input.addEventListener('input', handler);
      cleanups.push(() => input.removeEventListener('input', handler));
    }
  }

  function getValue(): string {
    return input.value;
  }

  function setValue(v: string): void {
    input.value = v;
  }

  function clear(): void {
    input.value = '';
    onInput?.('');
  }

  function destroy(): void {
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  }

  return { root, input, getValue, setValue, clear, destroy };
}
