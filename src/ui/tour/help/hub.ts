import type { HelpPanelDefinition } from '../types';

export const hubHelp: HelpPanelDefinition = {
  windowId: 'qpm-hub',
  groups: [
    {
      id: 'navigation',
      label: 'Navigation',
      cards: [
        {
          id: 'groups',
          icon: { kind: 'emoji', value: '\uD83E\uDDED' },
          title: 'Feature groups',
          body: 'Use the icon bar to switch between Trackers, Items, Garden, Config, and Tools.',
          showMeSelector: '[data-tour="hub-nav"]',
        },
        {
          id: 'home',
          icon: { kind: 'emoji', value: '\uD83C\uDFE0' },
          title: 'Home tiles',
          body: 'The home icon returns to your customizable quick-launch tile grid.',
          showMeSelector: '[data-tour="hub-home-btn"]',
        },
        {
          id: 'remembered',
          icon: { kind: 'emoji', value: '\uD83D\uDD16' },
          title: 'Last group remembered',
          body: 'QPM remembers your last visited group across sessions.',
        },
      ],
    },
    {
      id: 'cards',
      label: 'Cards',
      cards: [
        {
          id: 'expandable',
          icon: { kind: 'emoji', value: '\uD83D\uDD3D' },
          title: 'Expandable cards',
          body: 'Click a card header to expand it inline for full controls.',
          showMeSelector: '[data-tour="hub-cards"]',
        },
        {
          id: 'pop-out',
          icon: { kind: 'emoji', value: '\u2197\uFE0F' },
          title: 'Pop-out windows',
          body: 'Expanded cards show a pop-out arrow to detach them into their own draggable window.',
        },
        {
          id: 'launcher',
          icon: { kind: 'emoji', value: '\uD83D\uDD13' },
          title: 'Launcher cards',
          body: 'Some features open directly in their own window. Click the card or the Open button.',
        },
        {
          id: 'show-hide',
          icon: { kind: 'emoji', value: '\uD83C\uDFA8' },
          title: 'Show/hide features',
          body: 'Click the slider icon in the group header to toggle individual features on or off.',
          showMeSelector: '[data-tour="hub-visibility"]',
        },
      ],
    },
  ],
};
