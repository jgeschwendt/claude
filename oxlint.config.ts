import { defineConfig, namingConvention } from '@jlg/oxlint';

/**
Claude Code's hook payload fields, a snake_case wire format the mod matches on
*/
const wireFields = '^(file_path|notification_type|tool_use_id)$';

export default defineConfig({
  ignorePatterns: [
    '**/*.d.ts',
    'docs/**',
    'node_modules',
    'plugins/*/.claude-plugin/types/**',
    // workflow scripts run in Claude Code's workflow runtime (injected globals, top-level return), not as modules
    'workflows/**',
  ],
  overrides: [
    {
      files: ['plugins/**/*.{ts,tsx}'],
      rules: {
        // `$.classic.Notification(...)` is a mods API name, not a constructor. (2026-11-05)
        'eslint/new-cap': ['error', { capIsNewExceptionPattern: String.raw`^\$\.classic\.` }],
        // the mods API matches hooks on Claude Code's snake_case payload fields. (2026-11-05)
        'eslint-js/camelcase': ['error', { allow: [wireFields] }],
        // the React preset (react is a dependency, for skills/show) makes every .tsx function a declaration; the mod's
        // hooks are expressions, the base's default. (2026-11-23)
        'func-style': ['error', 'expression'],
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
      // the runner other hook files call with `$`: past an import the engine follows `$` only
      // into a function declaration (`claude plugin validate`: "$ is passed to \"run\", a name bound to a function
      // expression, outside the hook's own file"), so every function there is one. (2026-11-06)
      files: ['plugins/*/hooks/sandman.ts'],
      rules: { 'func-style': ['error', 'declaration'] },
    },
    {
      // the launchd plist's DOCTYPE names Apple's DTD by its fixed HTTP URL, and the daemon speaks plain HTTP over its Unix socket. (2026-11-23)
      files: ['skills/show/**/*.{ts,tsx}'],
      rules: { 'unicorn-js/prefer-https': 'off' },
    },
    {
      files: ['skills/show/**/*.tsx'],
      plugins: ['jsx-a11y'],
      rules: {
        // hud's `hud:open` event takes the card's place as `x` and `y`; options replace the base's, so its checkGeneric is restated. (2026-11-23)
        'id-length': ['error', { checkGeneric: false, exceptions: ['x', 'y'] }],
        // react-dom's entry points are subpaths (`react-dom/client`, `react-dom/server`) with no root export for them. (2026-11-23)
        'import-js/no-internal-modules': 'off',
        // a chart is inline SVG with role="img"; the `img` tag cannot hold drawn marks. (2026-11-23)
        'jsx-a11y/prefer-tag-over-role': 'off',
        // show's page has no translation layer: its literal text is the UI. (2026-11-23)
        'react/jsx-no-literals': 'off',
        // status lines, thread messages and chart rows are positional snapshots with no id; a list is replaced whole, never reordered. (2026-11-23)
        'react/no-array-index-key': 'off',
        // a figure is SVG the local agent authored for the form; React has no other way to take markup as a string. (2026-11-24)
        'react/no-danger': 'off',
        // the page's four components are one tree that hydrates as a unit, each a few lines; a file apiece would only scatter it. (2026-11-23)
        'react/no-multi-comp': 'off',
        // fast refresh is a dev-server feature; show serves a built bundle and has none, and the daemon imports the page's `publish` and `selectorOf`. (2026-11-23)
        'react/only-export-components': 'off',
      },
    },
    {
      // the page hydrates in the owner's browser, where Temporal is not in every engine: Date stays. (2026-11-23)
      files: ['skills/show/page.tsx'],
      rules: { 'unicorn-js/prefer-temporal': 'off' },
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
