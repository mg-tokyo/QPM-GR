import type { HelpPanelDefinition } from '../types';

export const xpTrackerHelp: HelpPanelDefinition = {
  windowId: 'trackers-v2-xp',
  groups: [
    {
      id: 'xp-tracking',
      label: 'XP Tracking',
      cards: [
        {
          id: 'how-xp-works',
          icon: { kind: 'emoji', value: '\u2728' },
          title: 'How XP works',
          body: 'Your team earns a base 3,600 XP per hour. Pets with XP abilities add bonus XP on top of that. The summary strip shows the full breakdown.',
          showMeSelector: '[data-tour="xp-summary"]',
        },
        {
          id: 'progress-cards',
          icon: { kind: 'emoji', value: '\uD83D\uDCCA' },
          title: 'Progress cards',
          body: 'Each card shows a pet\'s current STR level, XP progress bar, percentage to next level, and max STR. Fully levelled pets show a star badge.',
          showMeSelector: '[data-tour="xp-pet-cards"]',
        },
        {
          id: 'time-estimates',
          icon: { kind: 'emoji', value: '\u23F1\uFE0F' },
          title: 'Time estimates',
          body: 'Time chips show countdowns to the next STR level and max. Feeds per level tells you how many feeds are needed before the next level-up.',
        },
      ],
    },
    {
      id: 'near-max',
      label: 'Near Max',
      cards: [
        {
          id: 'near-max-scanner',
          icon: { kind: 'emoji', value: '\uD83C\uDFC6' },
          title: 'Near-max scanner',
          body: 'Scans your active team, inventory, and hutch for pets close to max level. Results are sorted by XP remaining — closest to max first.',
          showMeSelector: '[data-tour="xp-near-max"]',
        },
        {
          id: 'swap-pets',
          icon: { kind: 'emoji', value: '\uD83D\uDD04' },
          title: 'Swap pets in',
          body: 'Hit Swap on an inventory or hutch pet to pick an active slot. The tracker sends the swap automatically — no need to open your inventory.',
        },
        {
          id: 'xp-potions',
          icon: { kind: 'emoji', value: '\uD83E\uDDEA' },
          title: 'XP Potions',
          body: 'If you have XP Potions, a potion chip appears on eligible pets. Hover it to preview the XP gain on the progress bar, click to use.',
        },
      ],
    },
  ],
};

export const cropBoostHelp: HelpPanelDefinition = {
  windowId: 'crop-boost-tracker',
  groups: [
    {
      id: 'tracking',
      label: 'Tracking',
      cards: [
        {
          id: 'how-boosts-work',
          icon: { kind: 'emoji', value: '\uD83D\uDC3E' },
          title: 'How crop boosts work',
          body: 'Pets with a crop size ability randomly increase crop size each minute. Only one boost fires per proc — they don\'t stack.',
        },
        {
          id: 'progress-stats',
          icon: { kind: 'emoji', value: '\uD83D\uDCCA' },
          title: 'Progress overview',
          body: 'The stats card shows total crops, how many are at max, how many still need boosts, and your completion percentage.',
          showMeSelector: '[data-tour="cropboost-stats"]',
        },
        {
          id: 'time-estimates',
          icon: { kind: 'emoji', value: '\u23F0' },
          title: 'Time estimates',
          body: 'Time ranges are based on your boost pets\' proc rates. The range shows best-case to worst-case scenarios — RNG means actual times vary.',
          showMeSelector: '[data-tour="cropboost-estimate"]',
        },
        {
          id: 'boost-pets',
          icon: { kind: 'emoji', value: '\uD83D\uDC3E' },
          title: 'Boost pets',
          body: 'The header lists which pets are contributing crop size boosts and their effective percentage per proc.',
          showMeSelector: '[data-tour="cropboost-pets"]',
        },
      ],
    },
    {
      id: 'filtering',
      label: 'Filtering',
      cards: [
        {
          id: 'species-filter',
          icon: { kind: 'emoji', value: '\uD83C\uDF3B' },
          title: 'Filter by species',
          body: 'Use the dropdown to show only one crop type. The table and estimates update to match.',
          showMeSelector: '[data-tour="cropboost-filter"]',
        },
        {
          id: 'detail-toggle',
          icon: { kind: 'emoji', value: '\uD83D\uDCCB' },
          title: 'Simple vs detailed',
          body: 'Simple view shows next-boost time ranges. Detailed view adds percentile breakdowns and received-vs-needed counts.',
          showMeSelector: '[data-tour="cropboost-toggle"]',
        },
      ],
    },
  ],
};
