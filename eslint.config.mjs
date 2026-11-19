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
  group: ['**/core/jotaiBridge', '**/core/jotaiBridge/*'],
  importNames: ['getAtomByLabel', 'findAtomsByLabel', 'subscribeAtom', 'readAtomValue', 'writeAtomValue', 'getCachedStore', 'ensureJotaiStore'],
  message:
    'Game state is read through src/core/gameState (or the atomRegistry barrel) — never raw atoms. ' +
    'See .claude/rules/state/atoms.md. Debug-only dynamic-label code is exempt by file override.',
};

// Every userscript API name a manager can hand the script (SMM's wrapper parameter list,
// Starweaver-Mod-Manager src/mods/bundle.ts GM_BINDINGS). Only src/utils/gm.ts may name them:
// SMM passes them as parameters, so a property lookup or a second declaration misses them.
const GM_NAMES = [
  'GM', 'GM_info', 'GM_addStyle', 'GM_addElement', 'GM_getResourceText', 'GM_getResourceURL',
  'GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues', 'GM_setValues', 'GM_getValues',
  'GM_deleteValues', 'GM_xmlhttpRequest', 'GM_openInTab', 'GM_registerMenuCommand',
  'GM_unregisterMenuCommand', 'GM_download', 'GM_addValueChangeListener',
  'GM_removeValueChangeListener', 'unsafeWindow',
];
const GM_MESSAGE =
  'Userscript APIs go through the GM access layer (src/utils/gm.ts): gmLegacyStorage, gmXhr/gmHttpRequest, ' +
  'gmOpenInTab, gmInfo, gmUnsafeWindow (pageWindow from src/core/pageContext.ts for the page). Storage goes through src/utils/storage.ts.';
const gmGlobalRestrictions = GM_NAMES.map((name) => ({ name, message: GM_MESSAGE }));
const GM_NAME_RE = '/^(GM|GM_\\w+|unsafeWindow)$/';
const gmSyntaxRestrictions = [
  // globalThis.GM_x, window.GM_x, (x as any).GM_x, x.unsafeWindow
  { selector: `MemberExpression > Identifier.property[name=${GM_NAME_RE}]`, message: GM_MESSAGE },
  // window['GM_x']
  { selector: `MemberExpression[computed=true] > Literal.property[value=${GM_NAME_RE}]`, message: GM_MESSAGE },
  // A local `declare const GM_x` turns the global into a module binding no-restricted-globals cannot see.
  { selector: `VariableDeclarator > Identifier.id[name=${GM_NAME_RE}]`, message: GM_MESSAGE },
  { selector: `TSDeclareFunction > Identifier.id[name=${GM_NAME_RE}]`, message: GM_MESSAGE },
];
const setIntervalRestriction = {
  name: 'setInterval',
  message: 'Use visibleInterval/criticalInterval from src/utils/timerManager.ts — never raw setInterval.',
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
      'no-restricted-globals': ['error', setIntervalRestriction, ...gmGlobalRestrictions],
      'no-restricted-syntax': ['error', ...gmSyntaxRestrictions],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'setInterval', message: 'Use visibleInterval/criticalInterval from src/utils/timerManager.ts.' },
        { property: 'sendMessage', message: 'WS sends go through sendRoomAction (src/websocket/api.ts) — never MagicCircle_RoomConnection.sendMessage directly.' },
        { property: 'trySendMessageNow', message: 'WS sends go through sendRoomAction (src/websocket/api.ts).' },
      ],
      'no-restricted-imports': ['error', { patterns: [jotaiBridgeRestriction] }],
      'max-lines': ['error', { max: 750, skipBlankLines: false, skipComments: false }],
      // Reactive first: sanctioned pollers need a written reason (CLAUDE.md "Reactive first").
      'qpm/polling-needs-justification': 'error',
    },
  },
  {
    // Game data comes from catalogs/atoms/bundle text, never literals (architecture.md).
    // Scope is deliberately feature/UI/store: core, catalogs, websocket, sprite-v2 and
    // rive-engine hold genuine protocol/asset tables.
    files: ['src/features/**/*.ts', 'src/ui/**/*.ts', 'src/store/**/*.ts'],
    rules: { 'qpm/no-literal-domain-lists': 'error' },
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
        { name: 'fetch', message: 'Aries/service HTTP goes through gmHttpRequest in src/utils/gm.ts (integrations.md §2) — never fetch.' },
        setIntervalRestriction,
        ...gmGlobalRestrictions,
      ],
    },
  },
  // ---- Exemptions (later objects win for matching files) ----
  {
    files: ['src/utils/timerManager.ts'],
    rules: {
      'no-restricted-globals': ['error', ...gmGlobalRestrictions],
      'no-restricted-properties': 'off',
      'qpm/polling-needs-justification': 'off',
    },
  },
  {
    // The GM access layer and its wrapper-simulation test are the only files that name the userscript API.
    files: ['src/utils/gm.ts', 'src/utils/gm.test.ts'],
    rules: { 'no-restricted-globals': ['error', setIntervalRestriction], 'no-restricted-syntax': 'off' },
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
    files: ['src/rive-engine/runtimeCapture.ts', 'src/ui/stats/statsHubWindow/eggsTab.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/ui/core/panelStyles.ts'],
    rules: { 'qpm/no-hardcoded-colors': 'off' },
  },
];
