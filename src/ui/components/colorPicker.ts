export function createColorPicker(value: string, onChange: (value: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  input.style.cssText = 'width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0;';
  input.addEventListener('input', () => onChange(input.value));
  return input;
}
