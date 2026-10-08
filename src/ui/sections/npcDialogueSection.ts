import { createToggle } from '../components';
import { t } from '../../i18n';
import {
  getNpcDialogueDiagnostics,
  getNpcDialogueSettings,
  LINE_IDS,
  restartCompanionInjector,
  setNpcDialogueCompanionInject,
  setNpcDialogueEnabled,
  setNpcDialogueLineEnabled,
} from '../../features/npcDialogue';

export function createNpcDialogueSection(): HTMLElement {
  const root = document.createElement('div');
  root.dataset.qpmSection = 'npc-dialogue';
  root.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  const status = document.createElement('div');
  status.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);';
  status.textContent = getNpcDialogueDiagnostics().companion
    ? t('feature.npcDialogue.statusCompanion')
    : t('feature.npcDialogue.statusNative');
  root.appendChild(status);

  const caption = document.createElement('div');
  caption.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);line-height:1.4;';
  caption.textContent = t('feature.npcDialogue.settingCaption');
  root.appendChild(caption);

  const settings = getNpcDialogueSettings();
  const lineToggles = LINE_IDS.map((id) => createToggle({
    size: 'compact',
    checked: settings.lines[id],
    disabled: !settings.enabled,
    label: t(`feature.npcDialogue.lineLabel.${id}`),
    onChange: (v) => setNpcDialogueLineEnabled(id, v),
  }));

  const companionToggle = createToggle({
    size: 'compact',
    checked: settings.companionInject,
    disabled: !settings.enabled,
    label: t('feature.npcDialogue.companionInject.label'),
    onChange: (v) => {
      setNpcDialogueCompanionInject(v);
      restartCompanionInjector();
    },
  });
  const companionCaption = document.createElement('div');
  companionCaption.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);line-height:1.4;';
  companionCaption.textContent = t('feature.npcDialogue.companionInject.caption');

  root.appendChild(createToggle({
    checked: settings.enabled,
    label: t('feature.npcDialogue.enable'),
    onChange: (v) => {
      setNpcDialogueEnabled(v);
      for (const lt of lineToggles) lt.setDisabled(!v);
      companionToggle.setDisabled(!v);
    },
  }).root);
  root.appendChild(companionToggle.root);
  root.appendChild(companionCaption);
  for (const lt of lineToggles) root.appendChild(lt.root);

  return root;
}
