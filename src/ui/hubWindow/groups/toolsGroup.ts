// src/ui/hubWindow/groups/toolsGroup.ts

import type { HubGroupDef, LauncherCardConfig } from '../cards/types';
import { toggleWindow } from '../../modalWindow';
import { log } from '../../../utils/logger';
import { TEXTURE_MANIPULATOR_ENABLED } from '../../../features/textureSwapper';
import { t } from '../../../i18n';

export function openExternalUrl(url: string): void {
  const gmOpen = (globalThis as Record<string, unknown>).GM_openInTab as
    ((url: string, opts?: Record<string, unknown>) => unknown) | undefined;
  if (typeof gmOpen === 'function') {
    try { gmOpen(url, { active: true }); return; } catch { /* fallback */ }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function getToolsGroup(): HubGroupDef {
  const guideCard: LauncherCardConfig = {
    key: 'guide',
    label: t('hub.tools.guide.label'),
    description: t('hub.tools.guide.description'),
    icon: { kind: 'sprite', value: '📖', spriteKey: 'sprite/ui/JournalStamp', fallback: '📖' },
    labelColor: '#93c5fd',
    tier: 'launcher',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.tools.guide.summary');
    },
    onOpen: () => {
      toggleWindow('guide-window', '📖 Guide', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../sections/guideSection').then(({ createGuideSection }) => {
          root.appendChild(createGuideSection());
        }).catch(e => log('⚠️ Failed to load Guide', e));
      }, '700px', '85vh');
    },
  };

  const decorLayoutCard: LauncherCardConfig = {
    key: 'decor-layout',
    label: t('hub.tools.decorLayout.label'),
    description: t('hub.tools.decorLayout.description'),
    icon: { kind: 'sprite', value: '🏰', spriteKey: 'sprite/decor/MiniWizardTower', fallback: '🏰' },
    labelColor: '#c4b5fd',
    tier: 'launcher',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.tools.decorLayout.summary');
    },
    onOpen: () => openExternalUrl('https://mg-tokyo.github.io/MG-Decor-Layout-Customiser/'),
  };

  const spriteCustomiserCard: LauncherCardConfig = {
    key: 'sprite-customizer',
    label: t('hub.tools.spriteCustomiser.label'),
    description: t('hub.tools.spriteCustomiser.description'),
    icon: { kind: 'sprite', value: '🖼️', spriteKey: 'sprite/pet/Butterfly', spriteMutations: ['Rainbow'], fallback: '🖼️' },
    labelColor: '#f9a8d4',
    tier: 'launcher',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.tools.spriteCustomiser.summary');
    },
    onOpen: () => openExternalUrl('https://mg-tokyo.github.io/MG-Sprite-Customiser-V2/'),
  };

  const celestialCard: LauncherCardConfig = {
    key: 'celestial-layout',
    label: t('hub.tools.celestial.label'),
    description: t('hub.tools.celestial.description'),
    icon: { kind: 'sprite', value: '🌟', spriteKey: 'sprite/plant/DawnCelestialCrop', fallback: '🌟' },
    labelColor: '#fde68a',
    tier: 'launcher',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.tools.celestial.summary');
    },
    onOpen: () => openExternalUrl('https://mg-tokyo.github.io/Celestial-Position-Layout-Calculator/'),
  };

  const cards: LauncherCardConfig[] = [guideCard, decorLayoutCard, spriteCustomiserCard, celestialCard];

  if (TEXTURE_MANIPULATOR_ENABLED) {
    const textureCard: LauncherCardConfig = {
      key: 'texture-manipulator',
      label: t('hub.tools.textureManipulator.label'),
      description: t('hub.tools.textureManipulator.description'),
      icon: { kind: 'sprite', value: '🖌️', spriteKey: 'sprite/item/RainbowPotion', fallback: '🖌️' },
      labelColor: '#86efac',
      tier: 'launcher',
      renderSummary: (el) => {
        el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
        el.textContent = t('hub.tools.textureManipulator.summary');
      },
      onOpen: () => {
        import('../../textureSwapperWindow').then(({ openTextureSwapperWindow }) => {
          openTextureSwapperWindow();
        }).catch(e => log('⚠️ Failed to open Texture Manipulator', e));
      },
    };
    cards.push(textureCard);
  }

  return {
    id: 'tools',
    label: t('hub.tools.label'),
    icon: {
      kind: 'sprite', value: '🔧', fallback: '🔧',
      bunched: [
        { spriteKey: 'sprite/item/Shovel', offsetX: -10, scale: 1.0 },
        { spriteKey: 'sprite/item/WateringCan', offsetX: 3, offsetY: -2, scale: 1.0 },
        { spriteKey: 'sprite/item/PlanterPot', offsetX: 12, offsetY: 2, scale: 0.9 },
      ],
    },
    cards,
  };
}
