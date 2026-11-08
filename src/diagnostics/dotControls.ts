// Diagnostics-window controls for the titlebar dot preferences (dotPreferences.ts).

import { t } from '../i18n';
import { createToggle } from '../ui/components';
import { isDotEnabled, isSubsystemMuted, setDotEnabled, setSubsystemMuted } from './dotPreferences';
import type { Subsystem } from './types';

function rowTooltip(counted: boolean): string {
  if (!isDotEnabled()) return t('feature.diagnostics.dot.rowMasterOff');
  return counted ? t('feature.diagnostics.dot.rowCounted') : t('feature.diagnostics.dot.rowIgnored');
}

export function createSubsystemDotToggle(subsystem: Subsystem): HTMLElement {
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;align-items:center;';
  const toggle = createToggle({
    size: 'compact',
    checked: !isSubsystemMuted(subsystem),
    disabled: !isDotEnabled(),
    onChange: (counted) => {
      setSubsystemMuted(subsystem, !counted);
      wrap.title = rowTooltip(counted);
    },
  });
  toggle.input.setAttribute('aria-label', t('feature.diagnostics.dot.rowAria', { subsystem }));
  wrap.title = rowTooltip(!isSubsystemMuted(subsystem));
  // The row itself copies details on click; keep toggle clicks out of that.
  wrap.addEventListener('click', (e) => { e.stopPropagation(); });
  wrap.appendChild(toggle.root);
  return wrap;
}

export function createDotFooter(): HTMLElement {
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:8px;padding-top:12px;border-top:1px solid var(--qpm-border);';

  const toggle = createToggle({
    size: 'compact',
    checked: isDotEnabled(),
    label: t('feature.diagnostics.dot.show'),
    onChange: (on) => { setDotEnabled(on); },
  });

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);line-height:1.45;padding-left:36px;';
  hint.textContent = t('feature.diagnostics.dot.hint');

  footer.append(toggle.root, hint);
  return footer;
}
