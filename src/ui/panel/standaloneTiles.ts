// src/ui/panel/standaloneTiles.ts
// Standalone tile registrations for features that have no hub card.

import { registerTile } from './tileRegistry';
import { startPublicRoomsStatus } from './tileStatusesCore';
import { windowLog } from '../core/modalWindow';
import { t } from '../../i18n';

export function registerStandaloneTiles(): void {
  registerTile({
    id: 'public-rooms',
    icon: '🌐',
    label: t('tile.publicRooms.label'),
    color: 'rgba(233, 30, 99, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('public-rooms', `🌐 ${t('tile.publicRooms.label')}`, (root) => {
          import('../standalone/publicRoomsWindow')
            .then(({ renderPublicRoomsWindow }) => renderPublicRoomsWindow(root))
            .catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:publicRooms', id: 'public-rooms' }, e));
        }, '950px', '85vh');
      });
    },
    defaultStatus: '0 rooms / 0 players',
    statusProvider: startPublicRoomsStatus,
  });
}
