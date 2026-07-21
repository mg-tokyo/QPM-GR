// ESLint flat config — mechanical enforcement of .claude/rules/*.
//
// Escape hatch: `// eslint-disable-next-line <rule-id> -- <reason>` — the
// `-- <reason>` is mandatory by convention. Never disable a rule file-wide.
// Legacy debt baseline: eslint-suppressions.json (generated with
// `npx eslint --suppress-all src`; shrink with `npx eslint --prune-suppressions src`
// after fixing legacy violations). Only NEW violations fail the gate.
// Type-aware linting is deliberately OFF (performance — this runs in a Stop hook).
import tseslint from 'typescript-eslint';
import qpm from './scripts/eslint-rules/index.mjs';

const jotaiBridgeRestriction = {
  group: ['**/core/jotaiBridge'],
  importNames: ['getAtomByLabel'],
  message:
    'New game-state access goes through stateTree.select/subscribe (src/core/stateTree.ts) ' +
    'or atomRegistry — not direct atom labels. See .claude/docs/atom-migration.md.',
};

export default [
  { ignores: ['dist/**', 'scraped-data/**', 'scripts/**', '.claude/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: { qpm },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'setInterval', message: 'Use visibleInterval/criticalInterval from src/utils/timerManager.ts — never raw setInterval.' },
        { name: 'GM_getValue', message: 'Use the storage wrapper (src/utils/storage.ts) — never raw GM_* calls.' },
        { name: 'GM_setValue', message: 'Use the storage wrapper (src/utils/storage.ts) — never raw GM_* calls.' },
        { name: 'GM_deleteValue', message: 'Use the storage wrapper (src/utils/storage.ts) — never raw GM_* calls.' },
        { name: 'GM_listValues', message: 'Use the storage wrapper (src/utils/storage.ts) — never raw GM_* calls.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'setInterval', message: 'Use visibleInterval/criticalInterval from src/utils/timerManager.ts.' },
        { property: 'sendMessage', message: 'WS sends go through sendRoomAction (src/websocket/api.ts) — never MagicCircle_RoomConnection.sendMessage directly.' },
        { property: 'trySendMessageNow', message: 'WS sends go through sendRoomAction (src/websocket/api.ts).' },
      ],
      'no-restricted-imports': ['error', { patterns: [jotaiBridgeRestriction] }],
      'max-lines': ['error', { max: 750, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            jotaiBridgeRestriction,
            {
              group: ['**/catalogs/gameCatalogs'],
              message: 'UI uses safe wrappers from src/utils/catalogHelpers.ts — never raw gameCatalogs.',
            },
          ],
        },
      ],
      'qpm/no-hardcoded-colors': 'error',
      'qpm/no-emoji-in-ui': 'error',
      'qpm/no-inline-ui-strings': 'error',
    },
  },
  {
    files: ['src/features/**/*.ts'],
    rules: { 'qpm/no-inline-ui-strings': 'error' },
  },
  {
    files: ['src/services/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Aries/service HTTP goes through GM_xmlhttpRequest (integrations.md §2) — never fetch.' },
        { name: 'setInterval', message: 'Use visibleInterval/criticalInterval from src/utils/timerManager.ts.' },
      ],
    },
  },
  // ---- Exemptions (later objects win for matching files) ----
  {
    files: ['src/utils/timerManager.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/utils/storage.ts', 'src/services/storage.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['src/websocket/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/core/**/*.ts', 'src/debug/**/*.ts', 'src/main.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/ui/core/panelStyles.ts'],
    rules: { 'qpm/no-hardcoded-colors': 'off' },
  },
];
