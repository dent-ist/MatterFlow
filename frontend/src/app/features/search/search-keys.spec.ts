import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No new or changed keyboard shortcuts in this phase (owner decision, #420; #478, #481). The key bindings of the search files are compared with
 * the baseline taken when the Search UX epic started: the header box (Ctrl+K lives in the shell, not here), its listbox keys and Enter on an
 * option. A page may add buttons, links and a skip link (no binding), never a key handler.
 */
// The test runs from the frontend folder.
const dirs = ['src/app/features/search', 'src/app/shared/search'].map((d) =>
  join(process.cwd(), d),
);
const sources: Record<string, string> = {};
for (const dir of dirs)
  for (const name of readdirSync(dir))
    if (name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      sources[join(dir, name)] = readFileSync(join(dir, name), 'utf8');

function bindings(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [path, text] of Object.entries(sources)) {
    const found = [
      ...text.matchAll(/\((?:document:|window:)?key(?:down|up|press)[\w.]*\)/g),
      ...text.matchAll(/@HostListener\([^)]*key[^)]*\)/g),
      ...text.matchAll(/case '((?:Arrow|Home|End|Enter|Escape|Tab|PageUp|PageDown)\w*)':/g),
    ].map((m) => m[0]);
    if (found.length > 0) out[path.replace(/^.*\/(shared|features)\//, '$1/')] = found;
  }
  return out;
}

describe('search key bindings (baseline, #420)', () => {
  it('are exactly the ones of the header box', () => {
    expect(bindings()).toEqual({
      'shared/search/global-search.ts': [
        '(keydown)',
        '(keydown.enter)',
        '(keydown.enter)',
        '(keydown.enter)',
        "case 'ArrowDown':",
        "case 'ArrowUp':",
        "case 'Home':",
        "case 'End':",
        "case 'Enter':",
        "case 'Escape':",
        "case 'Tab':",
      ],
    });
  });
});
