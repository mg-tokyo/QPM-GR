// src/ui/panel/standaloneTiles.ts
// Standalone tile registrations for features that have no hub card.

import { registerTile } from './tileRegistry';
import { startPublicRoomsStatus, startJournalStatus } from './tileStatusesCore';
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

  registerTile({
    id: 'journal-checker',
    icon: '📔',
    label: t('tile.journalChecker.label'),
    color: 'rgba(121, 85, 72, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('journal-checker-window', `📔 ${t('tile.journalChecker.label')}`, (root) => {
          root.style.padding = '0';
          import('../journalChecker/index').then(({ createJournalCheckerSection }) => {
            root.appendChild(createJournalCheckerSection());
          }).catch(e => windowLog.warn('QPM-UI-002', { what: 'lazy:journalChecker', id: 'journal-checker-window' }, e));
        }, '900px', '90vh');
      });
    },
    defaultStatus: '0% / catalog loading',
    statusProvider: startJournalStatus,
  });
}
