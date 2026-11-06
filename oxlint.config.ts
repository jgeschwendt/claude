import { defineConfig, namingConvention } from '@jlg/oxlint';

/**
Claude Code's hook payload fields, a snake_case wire format the mod matches on
*/
const wireFields = '^(file_path|notification_type|tool_use_id)$';

export default defineConfig({
  ignorePatterns: ['**/*.d.ts', 'docs/**', 'node_modules', 'plugins/*/.claude-plugin/types/**'],
  overrides: [
    {
      files: ['plugins/**/*.{ts,tsx}'],
      rules: {
        // `$.classic.Notification(...)` is a mods API name, not a constructor. (2026-11-05)
        'eslint/new-cap': ['error', { capIsNewExceptionPattern: String.raw`^\$\.classic\.` }],
        // the mods API matches hooks on Claude Code's snake_case payload fields. (2026-11-05)
        'eslint-js/camelcase': ['error', { allow: [wireFields] }],
        // a hook is `($, e, next) =>` and JSX compiles against the global `h`; options replace the base's, so its checkGeneric is restated. (2026-11-05)
        'id-length': ['error', { checkGeneric: false, exceptions: ['$', 'e', 'h'] }],
        // `claude-code` and `claude-code/testing` are ambient declarations the engine lays under .claude-plugin/types; `./gauge` resolves to a .tsx the resolver does not see. (2026-11-05)
        'import-js/no-unresolved': 'off',
        // a hook's handlers type `$`, `e` and `next` from the generated mods API, whose types are not readonly. (2026-11-05)
        'typescript/prefer-readonly-parameter-types': 'off',
        // the same payload fields as camelcase's; options replace the base's, so its .tsx entries are restated. (2026-11-05)
        'typescript-js/naming-convention': [
          'warn',
          {
            filter: { match: true, regex: wireFields },
            format: ['snake_case'],
            selector: 'objectLiteralProperty',
          },
          ...namingConvention.tsx,
        ],
        // a hook's `.catch` handler is `($, e, next) =>`, not a promise rejection handler: its first parameter is the context. (2026-11-05)
        'unicorn/catch-error-name': ['error', { ignore: [String.raw`^\$$`] }],
        // `$.clock.every(ms, fn)` is the mods API timer, not an array method taking thisArg. (2026-11-05)
        'unicorn/no-array-method-this-argument': 'off',
        // `e` is the mods API's event parameter, not an abbreviation of error. (2026-11-05)
        'unicorn-js/name-replacements': ['error', { ignore: ['^e$'] }],
        // `on(…).catch(handler)` registers a hook's error handler, a mods API call with no awaitable form. (2026-11-05)
        'unicorn-js/prefer-await': 'off',
      },
    },
    {
      // the runner and the System One client other hook files call with `$`: past an import the engine follows `$` only
      // into a function declaration (`claude plugin validate`: "$ is passed to \"run\", a name bound to a function
      // expression, outside the hook's own file"), so every function there is one. (2026-11-06)
      files: ['plugins/*/hooks/{judge,sandman}.ts'],
      rules: { 'func-style': ['error', 'declaration'] },
    },
    {
      // the gate script prints each step's result; console is its output. (2026-11-05)
      files: ['scripts/**/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
  rules: {
    // the base turns this off (one import per module, type names inline), yet oxlint 1.91.0 reports it; restated here until the base catches up. (2026-11-05)
    'import/consistent-type-specifier-style': 'off',
  },
});
