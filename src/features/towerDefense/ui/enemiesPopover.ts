import { getPetSpriteWithMutations } from '../../../sprite-v2/compat';
import { t } from '../../../i18n';
import { ALL_BALLOON_IDS, getBalloonDef } from '../data/balloonDefs';
import type { BalloonId } from '../types';

export interface EnemiesPopoverHandle {
  readonly root: HTMLElement;
  toggle: () => void;
  close: () => void;
  destroy: () => void;
}

export function createEnemiesPopover(): EnemiesPopoverHandle {
  const root = document.createElement('div');
  root.className = 'qpm-td-enemies-popover';
  root.hidden = true;

  const title = document.createElement('div');
  title.className = 'qpm-td-enemies-title';
  title.textContent = t('feature.towerDefense.enemies.title');
  root.appendChild(title);

  const list = document.createElement('div');
  list.className = 'qpm-td-enemies-list';
  root.appendChild(list);

  for (const id of ALL_BALLOON_IDS) {
    list.appendChild(buildRow(id));
  }

  let outsideHandler: ((e: MouseEvent) => void) | null = null;

  function open(): void {
    root.hidden = false;
    if (outsideHandler) return;
    outsideHandler = (e) => {
      const target = e.target;
      if (target instanceof Node && root.contains(target)) return;
      close();
    };
    // Deferred so the click that opened it doesn't immediately close it.
    setTimeout(() => {
      if (outsideHandler) document.addEventListener('mousedown', outsideHandler, true);
    }, 0);
  }

  function close(): void {
    root.hidden = true;
    if (outsideHandler) {
      document.removeEventListener('mousedown', outsideHandler, true);
      outsideHandler = null;
    }
  }

  function toggle(): void {
    if (root.hidden) open(); else close();
  }

  function destroy(): void {
    close();
    try { root.remove(); } catch { /* already gone */ }
  }

  return { root, toggle, close, destroy };
}

function buildRow(id: BalloonId): HTMLElement {
  const def = getBalloonDef(id);
  const row = document.createElement('div');
  row.className = 'qpm-td-enemies-row';

  const iconSlot = document.createElement('div');
  iconSlot.className = 'qpm-td-enemies-icon';
  const overlays = def.mutationOverlay ? [def.mutationOverlay] : [];
  const canvas = getPetSpriteWithMutations(def.spriteName, overlays);
  if (canvas) {
    canvas.className = 'qpm-td-enemies-icon-canvas';
    iconSlot.appendChild(canvas);
  }

  const body = document.createElement('div');
  body.className = 'qpm-td-enemies-body';

  const name = document.createElement('div');
  name.className = 'qpm-td-enemies-name';
  name.textContent = def.displayName;
  body.appendChild(name);

  const stats = document.createElement('div');
  stats.className = 'qpm-td-enemies-stats';
  stats.textContent = t('feature.towerDefense.enemies.hpSpeed', { hp: def.hp, speed: def.speed.toFixed(1) });
  body.appendChild(stats);

  const pop = document.createElement('div');
  pop.className = 'qpm-td-enemies-meta';
  pop.textContent = t('feature.towerDefense.enemies.popReward', { reward: def.popReward });
  body.appendChild(pop);

  if ((def.armorDR ?? 0) > 0) {
    const armor = document.createElement('div');
    armor.className = 'qpm-td-enemies-meta';
    armor.textContent = t('feature.towerDefense.enemies.armor', { pct: Math.round((def.armorDR ?? 0) * 100) });
    body.appendChild(armor);
  }

  if (def.immunities.length > 0) {
    const immune = document.createElement('div');
    immune.className = 'qpm-td-enemies-meta';
    immune.textContent = t('feature.towerDefense.enemies.immune', { types: def.immunities.join(', ') });
    body.appendChild(immune);
  }

  if (def.children.length > 0) {
    const splits = document.createElement('div');
    splits.className = 'qpm-td-enemies-meta';
    splits.textContent = t('feature.towerDefense.enemies.splits', { list: def.children.map((c) => getBalloonDef(c).displayName).join(', ') });
    body.appendChild(splits);
  }

  row.append(iconSlot, body);
  return row;
}
