import type { TourDefinition } from '../../types';

export const turtleTimerTour: TourDefinition = {
  windowId: 'trackers-v2-turtle',
  label: 'Turtle Timer',
  category: 'trackers',
  version: 1,
  steps: [
    {
      id: 'summary',
      selector: '[data-tour="turtle-summary"]',
      title: 'Your turtle fleet at a glance',
      body: 'Shows how many turtles you have, how many need feeding, and how many are missing stats data.',
      placement: 'bottom',
    },
    {
      id: 'tabs',
      selector: '[data-tour="turtle-tabs"]',
      title: 'Switch between plants and eggs',
      body: 'Track plant growth speed and egg hatching speed separately — each has its own countdown and turtle list.',
      placement: 'bottom',
    },
    {
      id: 'focus',
      selector: '[data-tour="turtle-focus"]',
      title: 'Choose which slot to track',
      body: 'Pick latest-finishing, earliest-finishing, or a specific plant or egg to focus the countdown on.',
      placement: 'bottom',
    },
    {
      id: 'eta',
      selector: '[data-tour="turtle-dynamic"]',
      title: 'Live countdown with turtle boost',
      body: 'See adjusted time remaining, how much time your turtles are saving, and what the natural ETA would be without them.',
      placement: 'top',
    },
    {
      id: 'contributions',
      selector: '[data-tour="turtle-contributions"]',
      title: 'See each turtle\'s impact',
      body: 'Lists every turtle\'s boost rate per hour and hunger level. Keep them fed to maintain the speed boost.',
      placement: 'top',
    },
  ],
};
