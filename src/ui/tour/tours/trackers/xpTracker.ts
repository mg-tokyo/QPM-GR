import type { TourDefinition } from '../../types';

export const xpTrackerTour: TourDefinition = {
  windowId: 'trackers-v2-xp',
  label: 'XP Tracker',
  category: 'trackers',
  version: 1,
  steps: [
    {
      id: 'summary',
      selector: '[data-tour="xp-summary"]',
      title: 'XP rate at a glance',
      body: 'Shows your team\'s total XP per hour — base rate plus ability bonuses. Current weather is shown since some abilities depend on it.',
      placement: 'bottom',
    },
    {
      id: 'pet-cards',
      selector: '[data-tour="xp-pet-cards"]',
      title: 'Track each pet\'s progress',
      body: 'Every active pet shows its STR level, XP progress bar, time to next level, time to max, and feeds needed per level.',
      placement: 'auto',
    },
    {
      id: 'time-chips',
      resolve: (body) => body.querySelector<HTMLElement>('.qpm-xp-time-chips'),
      title: 'Time estimates and potions',
      body: 'Countdowns to next level and max STR. If you have XP Potions, hover the potion chip to preview its effect on the progress bar.',
      placement: 'auto',
      waitFor: '.qpm-xp-time-chips',
    },
    {
      id: 'near-max',
      selector: '[data-tour="xp-near-max"]',
      title: 'Find pets close to max',
      body: 'Expand to see all your pets — active, inventory, and hutch — sorted by how close they are to max. You can swap them into active slots directly.',
      placement: 'top',
    },
  ],
};
