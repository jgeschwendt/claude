import { defineConfig } from '@jlg/oxfmt';

export default defineConfig({
  ignorePatterns: ['.stele/**', 'AGENTS.md', 'docs/**', 'plugins/*/.claude-plugin/types/**'],
  quoteProps: 'consistent',
});
