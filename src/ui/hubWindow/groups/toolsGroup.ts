// src/ui/hubWindow/groups/toolsGroup.ts

import type { HubGroupDef, LauncherCardConfig } from '../cards/types';
import { toggleWindow } from '../../modalWindow';
import { log } from '../../../utils/logger';
import { TEXTURE_MANIPULATOR_ENABLED } from '../../../features/textureSwapper';

function openExternalUrl(url: string): void {
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
    label: 'Guide',
    description: 'Magic Garden Money Making Guide by bella',
    icon: { kind: 'sprite', value: '📖', spriteKey: 'sprite/ui/Book', fallback: '📖' },
    tier: 'launcher',
    renderSummary: (el) => { el.textContent = 'In-app money making guide'; },
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
    label: 'MG Decor Layout Customiser',
    description: 'Design and preview different decor layouts',
    icon: { kind: 'sprite', value: '🏰', spriteKey: 'sprite/decor/Castle', fallback: '🏰' },
    tier: 'launcher',
    renderSummary: (el) => { el.textContent = 'External tool — opens in new tab'; },
    onOpen: () => openExternalUrl('https://ryandt2305-cpu.github.io/MG-Decor-Layout-Customiser/'),
  };

  const spriteCustomiserCard: LauncherCardConfig = {
    key: 'sprite-customizer',
    label: 'MG Sprite Customiser V2',
    description: 'Customise in-game sprites and create scenes/GIFs',
    icon: { kind: 'sprite', value: '🖼️', spriteKey: 'sprite/pet/Cat', fallback: '🖼️' },
    tier: 'launcher',
    renderSummary: (el) => { el.textContent = 'External tool — opens in new tab'; },
    onOpen: () => openExternalUrl('https://ryandt2305-cpu.github.io/MG-Sprite-Customiser-V2/'),
  };

  const celestialCard: LauncherCardConfig = {
    key: 'celestial-layout',
    label: 'Celestial Position Calculator',
    description: 'Calculate celestial positions for binding coverage',
    icon: { kind: 'sprite', value: '🌟', spriteKey: 'sprite/plant/Celestial', fallback: '🌟' },
    tier: 'launcher',
    renderSummary: (el) => { el.textContent = 'External tool — opens in new tab'; },
    onOpen: () => openExternalUrl('https://ryandt2305-cpu.github.io/Celestial-Position-Layout-Calculator/'),
  };

  const cards: LauncherCardConfig[] = [guideCard, decorLayoutCard, spriteCustomiserCard, celestialCard];

  if (TEXTURE_MANIPULATOR_ENABLED) {
    const textureCard: LauncherCardConfig = {
      key: 'texture-manipulator',
      label: 'Texture Manipulator',
      description: 'Cosmetic texture overrides for sprites and UI',
      icon: { kind: 'sprite', value: '🖌️', spriteKey: 'sprite/ui/Paint', fallback: '🖌️' },
      tier: 'launcher',
      renderSummary: (el) => { el.textContent = 'Tint, swap, or replace any sprite'; },
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
    label: 'Tools',
    icon: { kind: 'sprite', value: '🔗', spriteKey: 'sprite/ui/Wrench', fallback: '🔗' },
    cards,
  };
}
