// src/ui/hubWindow/groups/configGroup.ts

import type { HubGroupDef, ExpandableCardConfig } from '../cards/types';
import { toggleWindow, windowLog } from '../../core/modalWindow';
import { t } from '../../../i18n';
import { startControllerStatus } from '../../panel/tileStatusesCore';
import { getDiagnosticsCard } from '../../../diagnostics/configCard';
import { getAlertCentreCard } from '../../../features/alertHub/centreCard';
import { areAlertsWipEnabled } from '../../../utils/wipFeatures';
import { getCamera3dCard } from '../../sections/camera3dSection';
import { getSpectatorCard } from '../../sections/spectatorSection';
import { getMultiStorageCard } from '../../sections/multiStorageSection';
import { getMultiShopCard } from '../../sections/multiShopSection';
import { getGameUpdateRefreshCard } from '../../sections/gameUpdateRefreshSection';
import { getKeybindsCard } from '../../input/keybindsWindow/card';

// ── Group definition ─────────────────────────────────────────────────────────

export function getConfigGroup(): HubGroupDef {
  const controllerCard: ExpandableCardConfig = {
    key: 'controller',
    label: t('hub.config.controller.label'),
    description: t('hub.config.controller.description'),
    icon: { kind: 'sprite', value: '🎮', spriteKey: 'sprite/ui/Touchpad', fallback: '🎮' },
    labelColor: '#60a5fa',
    tier: 'expandable',
    tile: {
      icon: '🎮',
      color: 'rgba(96, 125, 139, 0.28)',
      defaultStatus: '0 binds / medium / no gamepad',
      statusProvider: startControllerStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.config.controller.summary');
    },
    renderExpanded: (container) => {
      // overflow left to parent hub scroll container
      import('../../sections/controllerSection').then(({ createControllerSection }) => {
        container.appendChild(createControllerSection(null, null));
      }).catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:ctrl' }, e));
    },
    detachWindowId: 'utility-feature-controller',
    onDetach: () => {
      toggleWindow('utility-feature-controller', '🎮 Controller Settings', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../sections/controllerSection').then(({ createControllerSection }) => {
          root.appendChild(createControllerSection(null, null));
        }).catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:ctrl' }, e));
      }, '580px', '78vh');
    },
  };

  const npcDialogueCard: ExpandableCardConfig = {
    key: 'npc-dialogue',
    label: t('feature.npcDialogue.settingTitle'),
    description: t('feature.npcDialogue.settingCaption'),
    // eslint-disable-next-line qpm/no-emoji-in-ui -- CardConfig.icon renders via renderIcon; kind:'emoji' is the fallback path used by every emoji tile card in this file (resetToursCard).
    icon: { kind: 'emoji', value: '💬' },
    tier: 'expandable',
    tile: {
      // eslint-disable-next-line qpm/no-emoji-in-ui -- TileMeta.icon renders via textContent (src/ui/panel/tileGrid.ts:146); no sprite path exists for tile icons yet — matches every other tile in this file.
      icon: '💬',
      // eslint-disable-next-line qpm/no-hardcoded-colors -- TileMeta.color is a per-feature rgba tint applied at render time (src/ui/panel/tileGrid.ts:127-129); no design token for tile tints exists — matches the established pattern for expandable tiles.
      color: 'rgba(143, 130, 255, 0.28)',
      defaultStatus: '—',
    },
    renderSummary: (el) => {
      // eslint-disable-next-line qpm/no-hardcoded-colors -- Tile summary muted-text alpha; matches every renderSummary in this file.
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      import('../../../features/npcDialogue').then(({ getNpcDialogueSettings }) => {
        el.textContent = getNpcDialogueSettings().enabled ? t('common.enabled') : t('common.disabled');
      }).catch(() => { /* silent */ });
    },
    renderExpanded: (container) => {
      import('../../sections/npcDialogueSection').then(({ createNpcDialogueSection }) => {
        container.appendChild(createNpcDialogueSection());
      }).catch((e) => windowLog.warn('QPM-UI-002', { what: 'lazy:npcDialogue' }, e));
    },
    detachWindowId: 'config-npc-dialogue',
    onDetach: () => {
      // eslint-disable-next-line qpm/no-emoji-in-ui -- Window title emoji matches the tile icon and the pattern used by every other detached expandable in this file (controller / shopKeybinds / panelShortcut).
      toggleWindow('config-npc-dialogue', `💬 ${t('feature.npcDialogue.settingTitle')}`, (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../sections/npcDialogueSection').then(({ createNpcDialogueSection }) => {
          root.appendChild(createNpcDialogueSection());
        }).catch((e) => windowLog.warn('QPM-UI-002', { what: 'lazy:npcDialogueDetach' }, e));
      }, '520px', '70vh');
    },
  };

  const resetToursCard: ExpandableCardConfig = {
    key: 'reset-tours',
    label: t('hub.config.resetTours.label', undefined, 'Tutorials'),
    description: t('hub.config.resetTours.description', undefined, 'Reset all guided tours so they show again'),
    icon: { kind: 'emoji', value: '?' },
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.config.resetTours.summary', undefined, 'Replay first-time walkthroughs');
    },
    renderExpanded: (container) => {
      container.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

      // ── Toggle row ──
      const toggleRow = document.createElement('div');
      toggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0 2px;';

      const toggleLabel = document.createElement('div');
      toggleLabel.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
      const toggleTitle = document.createElement('span');
      toggleTitle.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.9);font-weight:500;';
      toggleTitle.textContent = 'Show guided tours';
      const toggleSub = document.createElement('span');
      toggleSub.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);';
      toggleSub.textContent = 'Auto-play walkthroughs when opening features for the first time';
      toggleLabel.appendChild(toggleTitle);
      toggleLabel.appendChild(toggleSub);

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:#8f82ff;';

      import('../../tour').then(({ getToursEnabled, setToursEnabled }) => {
        toggle.checked = getToursEnabled();
        toggle.addEventListener('change', () => {
          setToursEnabled(toggle.checked);
        });
      });

      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(toggle);
      container.appendChild(toggleRow);

      // ── Divider ──
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:rgba(120,130,170,0.15);';
      container.appendChild(divider);

      // ── Note ──
      const note = document.createElement('div');
      note.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.6);line-height:1.45;padding:0 2px;';
      note.textContent = t('hub.config.resetTours.note', undefined, 'This resets progress for all guided tours. They will show again the next time you open each window.');
      container.appendChild(note);

      // ── Reset button ──
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t('hub.config.resetTours.button', undefined, 'Reset all tutorials');
      btn.style.cssText = [
        'padding:8px 16px',
        'font-size:13px',
        'font-weight:600',
        'border-radius:8px',
        'cursor:pointer',
        'border:1px solid rgba(255,100,100,0.35)',
        'background:rgba(255,100,100,0.12)',
        'color:#ff8888',
        'transition:all 0.15s',
        'align-self:flex-start',
      ].join(';');
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255,100,100,0.2)';
        btn.style.borderColor = 'rgba(255,100,100,0.5)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(255,100,100,0.12)';
        btn.style.borderColor = 'rgba(255,100,100,0.35)';
      });
      btn.addEventListener('click', () => {
        import('../../tour').then(({ resetAllTours }) => {
          resetAllTours();
          btn.textContent = t('hub.config.resetTours.done', undefined, 'Done — tours will replay on next open');
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'default';
        });
      });
      container.appendChild(btn);
    },
  };

  return {
    id: 'config',
    label: t('hub.config.label'),
    icon: { kind: 'emoji', value: '⚙️' },
    cards: [
      controllerCard, getKeybindsCard(), getMultiStorageCard(), getMultiShopCard(), npcDialogueCard, getCamera3dCard(),
      getSpectatorCard(), getGameUpdateRefreshCard(), ...(areAlertsWipEnabled() ? [getAlertCentreCard()] : []), getDiagnosticsCard(), resetToursCard,
    ],
  };
}
