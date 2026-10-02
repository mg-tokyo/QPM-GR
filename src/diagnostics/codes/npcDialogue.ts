import type { ErrorCodeDefinition } from '../types';

// Keep in sync with CURRENT_VERSION in ../codes.ts (local copy avoids a
// circular import).
const V = '3.2.29';

export const NPC_DIALOGUE_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-NPC-001',
    subsystem: 'feature:npcDialogue',
    category: 'feature',
    severity: 'warn',
    title: 'NPC dialogue interceptor not installed',
    description: 'npcChatBubblesAtom did not resolve, or its write was not a function, so QPM lines cannot be served.',
    userAction: 'None needed — NPCs keep their normal lines. Report it if it persists after a game update.',
    devNotes: 'src/features/npcDialogue/index.ts tryInstall(). Check QPM_DEBUG_API.atoms.explain("npcChatBubbles").',
    sinceVersion: V,
    notifyUser: false,
  },
  {
    code: 'QPM-NPC-002',
    subsystem: 'feature:npcDialogue',
    category: 'feature',
    severity: 'info',
    title: 'Companion inject surface missing',
    description: 'startCompanionInjector() ran with the user opted in but window.Companion.say was missing at that moment — the idle-cycle injection cannot fire until Aries\'s Mod is running.',
    userAction: 'Install / enable Arie\'s Mod and its Companion, or turn the QPM setting off.',
    devNotes: 'src/features/npcDialogue/index.ts startInjector(). Console note only (log.info, no health-bus degrade): opted-in with Aries absent, or Aries loading after QPM, is a configuration state. The copy line carries it as `inject=on skipped=not-running`.',
    sinceVersion: V,
    notifyUser: false,
  },
];
