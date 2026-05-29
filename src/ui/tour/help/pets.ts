import type { HelpPanelDefinition } from '../types';

export const petManagerHelp: HelpPanelDefinition = {
  windowId: 'qpm-pets-manager',
  groups: [
    {
      id: 'teams',
      label: 'Teams',
      cards: [
        {
          id: 'create-team',
          icon: { kind: 'emoji', value: '+' },
          title: 'Create a new team',
          body: 'Hit + New Team to make a preset group of 3 pets you can apply to your garden instantly.',
        },
        {
          id: 'compare',
          icon: { kind: 'emoji', value: '\u2696' },
          title: 'Compare teams side by side',
          body: 'See two teams head-to-head with ability breakdowns to find the best combo.',
          showMeSelector: '[data-tour="mgr-compare"]',
        },
        {
          id: 'import',
          icon: { kind: 'emoji', value: '\u2B07' },
          title: 'Import from Aries',
          body: 'Pull your existing team setups from Aries Mod with one click.',
          showMeSelector: '[data-tour="mgr-import"]',
        },
      ],
    },
    {
      id: 'editor',
      label: 'Editor',
      cards: [
        {
          id: 'assign-pets',
          icon: { kind: 'emoji', value: '\uD83D\uDC3E' },
          title: 'Assign pets to slots',
          body: 'Click the swap icon on any slot to pick a pet from your collection.',
          showMeSelector: '.qpm-slots',
        },
        {
          id: 'keybind',
          icon: { kind: 'emoji', value: '\u2328' },
          title: 'Set a keybind',
          body: 'Bind a key combo to apply this team instantly from anywhere \u2014 no window needed.',
          showMeSelector: '.qpm-editor__keybind-row',
        },
        {
          id: 'diet',
          icon: { kind: 'emoji', value: '\u2699' },
          title: 'Customize diet',
          body: 'Use the gear icon on each pet to control which foods it eats.',
        },
        {
          id: 'snapshot',
          icon: { kind: 'emoji', value: '\uD83D\uDCF7' },
          title: 'Save current layout',
          body: "Snapshot your active garden pets as this team's lineup.",
        },
      ],
    },
  ],
};

export const petOptimizerHelp: HelpPanelDefinition = {
  windowId: 'qpm-pets-optimizer',
  groups: [
    {
      id: 'analysis',
      label: 'Analysis',
      cards: [
        {
          id: 'modes',
          icon: { kind: 'emoji', value: '\uD83C\uDFAF' },
          title: 'Specialist vs Slot Efficiency',
          body: 'Specialist ranks each pet by its single best ability. Slot Efficiency considers all abilities and how pets combine across your 3 slots.',
          showMeSelector: '[data-tour="optimizer-mode"]',
        },
        {
          id: 'recommendations',
          icon: { kind: 'emoji', value: '\uD83D\uDCA1' },
          title: 'Keep / Sell / Review',
          body: 'Green = safe to keep, Red = safe to sell, Yellow = needs your judgement. Summary badges show totals.',
          showMeSelector: '[data-tour="optimizer-summary"]',
        },
      ],
    },
    {
      id: 'filtering',
      label: 'Filtering',
      cards: [
        {
          id: 'group-filter',
          icon: { kind: 'emoji', value: '\uD83D\uDD0D' },
          title: 'Filter by ability family',
          body: 'Focus on a specific group like Harvest Speed or Growth Rate to see only relevant pets.',
          showMeSelector: '[data-tour="optimizer-group-filter"]',
        },
        {
          id: 'family-nav',
          icon: { kind: 'emoji', value: '\uD83D\uDCCD' },
          title: 'Jump to a family',
          body: 'Use the sticky nav bar to scroll directly to any ability family in the results.',
          showMeSelector: '[data-tour="optimizer-nav"]',
        },
      ],
    },
  ],
};
