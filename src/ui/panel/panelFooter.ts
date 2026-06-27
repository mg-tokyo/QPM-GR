// src/ui/panel/panelFooter.ts
import { log } from '../../utils/logger';
import { showToast } from '../core/panelHelpers';
import { CHANGELOG } from '../sections/changelog';
import { IS_MAC } from '../pets/petsWindow/constants';
import { t } from '../../i18n';

export interface PanelFooterResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderPanelFooter(): PanelFooterResult {
  const footer = document.createElement('div');
  footer.className = 'qpm-panel-footer';

  const row = document.createElement('div');
  row.className = 'qpm-panel-footer__row';

  const changelogToggle = document.createElement('button');
  changelogToggle.type = 'button';
  changelogToggle.className = 'qpm-panel-footer__toggle';
  changelogToggle.textContent = t('panel.footer.changelog');
  changelogToggle.title = t('panel.footer.changelogTooltip');
  changelogToggle.setAttribute('aria-expanded', 'false');

  const actions = document.createElement('div');
  actions.className = 'qpm-panel-footer__actions';

  const resetBtn = buildFooterButton(t('panel.footer.resetWindows'), t('panel.footer.resetWindowsTooltip'), async () => {
    try {
      const { resetAllWindowLayouts } = await import('../core/modalWindow');
      resetAllWindowLayouts();
      const previous = resetBtn.textContent;
      resetBtn.textContent = t('panel.footer.resetDone');
      showToast(t('panel.footer.resetToast'));
      window.setTimeout(() => { resetBtn.textContent = previous; }, 1400);
    } catch (err) {
      log('Reset windows failed', err);
      showToast(t('panel.footer.resetFailed'));
    }
  });

  const importBtn = buildFooterButton(t('panel.footer.import'), t('panel.footer.importTooltip'), () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      if (!confirm(t('panel.footer.importConfirm'))) return;
      try {
        const { importFromFile } = await import('../../services/backupService');
        const result = await importFromFile(file);
        if (result.ok) {
          showToast(t('panel.footer.importSuccess', { count: result.keysWritten }));
          if (result.warnings.length) log('Import warnings:', result.warnings);
        } else {
          showToast(t('panel.footer.importError', { reason: result.warnings[0] ?? 'unknown error' }));
        }
      } catch (err) {
        log('Import failed', err);
        showToast(t('panel.footer.importFailed'));
      }
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });

  const exportBtn = buildFooterButton(t('panel.footer.export'), t('panel.footer.exportTooltip'), async () => {
    try {
      const { downloadBackup } = await import('../../services/backupService');
      downloadBackup();
      showToast(t('panel.footer.exportToast'));
    } catch (err) {
      log('Export failed', err);
      showToast(t('panel.footer.exportFailed'));
    }
  });

  const aboutBtn = document.createElement('button');
  aboutBtn.type = 'button';
  aboutBtn.className = 'qpm-panel-footer__icon-btn';
  aboutBtn.title = t('panel.footer.aboutTooltip');
  aboutBtn.textContent = 'ℹ\uFE0E';
  aboutBtn.addEventListener('click', () => {
    void (async () => {
      try {
        const { toggleWindow } = await import('../core/modalWindow');
        const { renderAboutContent } = await import('../sections/aboutWindow');
        toggleWindow('about-window', 'ℹ About QPM', (root) => {
          renderAboutContent(root);
        }, '320px', '540px');
      } catch (err) {
        log('About window failed', err);
      }
    })();
  });

  const keybindHint = document.createElement('span');
  keybindHint.className = 'qpm-panel-footer__keybind-hint';
  keybindHint.textContent = IS_MAC ? t('panel.footer.keybindHintMac') : t('panel.footer.keybindHint');

  actions.append(resetBtn, importBtn, exportBtn, aboutBtn);
  row.append(changelogToggle, keybindHint, actions);
  footer.appendChild(row);

  // Hide the inline hint when the panel is too narrow to fit it
  let isNarrow = false;
  const ro = new ResizeObserver(() => {
    const fixedWidth = changelogToggle.offsetWidth + actions.offsetWidth + 24;
    const narrow = row.offsetWidth < fixedWidth + 100;
    if (narrow !== isNarrow) {
      isNarrow = narrow;
      keybindHint.style.display = narrow ? 'none' : '';
    }
  });
  ro.observe(row);

  const changelog = buildChangelogPanel();
  changelog.style.display = 'none';
  footer.appendChild(changelog);

  let expanded = false;
  changelogToggle.addEventListener('click', () => {
    expanded = !expanded;
    changelogToggle.setAttribute('aria-expanded', String(expanded));
    changelogToggle.textContent = expanded ? t('panel.footer.hideChangelog') : t('panel.footer.changelog');
    changelog.style.display = expanded ? '' : 'none';
  });

  return {
    element: footer,
    cleanup: () => { ro.disconnect(); footer.remove(); },
  };
}

function buildFooterButton(label: string, title: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qpm-panel-footer__button';
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', () => { void onClick(); });
  return btn;
}

function buildChangelogPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'qpm-panel-footer__changelog';

  for (const entry of CHANGELOG.slice(0, 5)) {
    const item = document.createElement('div');
    item.className = 'qpm-panel-footer__changelog-item';

    const version = document.createElement('strong');
    version.textContent = `v${entry.version}`;
    item.appendChild(version);

    const list = document.createElement('ul');
    list.style.cssText = 'margin:2px 0 0;padding:0 0 0 16px;';
    for (const note of entry.notes) {
      const li = document.createElement('li');
      li.textContent = note;
      list.appendChild(li);
    }
    item.appendChild(list);
    panel.appendChild(item);
  }

  return panel;
}
