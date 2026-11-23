#!/usr/bin/env bun
// fake.ts <lapse-ms> <max-name> <name…>: a stand-in for `claude agents` that pty.test.ts drives. It shows its pid and
// its parent's, quits on q, removes on a second ctrl+x inside the lapse, and renames in a field of at most max-name
// characters (0: ctrl+r opens none) that refuses a name already listed.
const NAME_WIDTH = 30;
const [lapse = '', max = '', ...names] = Bun.argv.slice(2);
const state = { at: 0, confirmed: -Infinity, field: '', mode: '' };
const keys: Record<string, () => void> = {
  '\r': () => {
    if (state.mode !== 'edit' || names.includes(state.field)) {
      return;
    }
    names[state.at] = state.field;
    state.mode = '';
  },
  '\u{12}': () => {
    if (Number(max) > 0) {
      Object.assign(state, { field: names[state.at], mode: 'edit' });
    }
  },
  '\u{15}': () => {
    state.field = '';
  },
  '\u{18}': () => {
    const isLapsed = Date.now() - state.confirmed >= Number(lapse);
    names.splice(state.at, isLapsed ? 0 : 1);
    Object.assign(state, {
      at: Math.min(state.at, names.length - 1),
      confirmed: isLapsed ? Date.now() : -Infinity,
      mode: isLapsed ? 'confirm' : '',
    });
  },
  '\u{1B}': () => {
    state.mode = '';
  },
  '\u{1B}[A': () => {
    state.at = Math.max(state.at - 1, 0);
  },
  '\u{1B}[B': () => {
    state.at = Math.min(state.at + 1, names.length - 1);
  },
  'q': () => process.exit(0),
};
const draw = (): void => {
  const rows = names.map((name, index) => {
    const isHere = index === state.at;
    const shown = isHere && state.mode === 'edit' ? state.field : name;
    const detail = isHere && state.mode === 'confirm' ? 'ctrl+x again to remove' : 'stopped';
    return `${isHere ? '❯' : ' '} · ${shown.padEnd(NAME_WIDTH)}  ${detail}`;
  });
  const footer = state.mode === 'edit' ? 'enter to save · esc to cancel' : 'ctrl+x to remove';
  const lines = [
    `pid ${process.pid} ${process.ppid}`,
    ...rows,
    '',
    '❯ describe a task for a new session',
    footer,
  ];
  process.stdout.write(`\u{1B}[H\u{1B}[2J${lines.join('\r\n')}`);
};
process.stdin.setRawMode(true);
draw();
await Array.fromAsync(process.stdin, (chunk: Buffer) => {
  const key = String(chunk);
  const type = (): void => {
    if (state.mode === 'edit') {
      state.field = `${state.field}${key}`.slice(0, Number(max));
    }
  };
  (keys[key] ?? type)();
  draw();
  return key;
});
