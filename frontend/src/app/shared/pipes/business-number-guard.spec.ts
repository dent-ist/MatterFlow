import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard for issue #1392 (epic #1389): a client number and a matter number are shown with exactly 5 digits on every screen. The API already returns them padded (a database
 * check, `BusinessNumber`, and the API guard test `BusinessNumberResponsesTests`), so the screen only has to keep it that way. This spec fails on source code that could show one
 * differently:
 *
 *  1. A client number or matter number (`clientNumber`, `matterNumber`) put into a template interpolation, a text binding or a string built in code without
 *     `| businessNumber` or `formatBusinessNumber(...)` (`shared/pipes/matter-ref.pipe.ts`). A CM Number (`matterRef`) is the database's own computed text of two padded
 *     numbers (and `mf-matter-ref` / `| matterRef` pads it again), so it needs no wrapper.
 *  2. A number conversion of one of them (`Number(x.clientNumber)`, `parseInt(...)`, a unary plus): it drops the leading zeros.
 *  3. An example number in a placeholder, help text, label or title that is not 5 digits ("343 or Acme", "343-12"): examples are `00343` and `00343-00012`.
 *
 * A new exception needs the designer or the owner: add it to ALLOWED with the reason.
 */
const APP = join(process.cwd(), 'src', 'app');
const SKIP_DIRS = new Set(['generated', 'testing', 'fixtures']);

/** Files that may handle the numbers themselves, with the reason. Keys are paths below `src/app`. */
const ALLOWED: Readonly<Record<string, string>> = {
  'shared/pipes/matter-ref.pipe.ts': 'the helper itself',
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) sources(full, out);
    } else if (/\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const NUMBER_FIELD = /\b(clientNumber|matterNumber)\b/;
const WRAPPED = /businessNumber|formatBusinessNumber|formatMatterRef/;

type Kind = 'interpolation' | 'literal' | 'binding';

/** The expressions of a source: `{{ ... }}`, `${ ... }` and the value of a `[binding]="..."`, each with the line it starts on. */
function expressions(text: string): { expr: string; line: number; kind: Kind }[] {
  const found: { expr: string; line: number; kind: Kind }[] = [];
  const patterns: [RegExp, Kind][] = [
    [/\{\{([\s\S]*?)\}\}/g, 'interpolation'],
    [/\$\{([^}]*)\}/g, 'literal'],
    [/\[[\w.-]+\]="([^"]*)"/g, 'binding'],
  ];
  for (const [pattern, kind] of patterns) {
    for (const m of text.matchAll(pattern)) {
      found.push({ expr: m[1], line: text.slice(0, m.index).split('\n').length, kind });
    }
  }
  return found;
}

const files = sources(APP).map((full) => ({
  path: relative(APP, full).split('\\').join('/'),
  text: readFileSync(full, 'utf8'),
}));

describe('client and matter numbers are always shown with 5 digits (#1392)', () => {
  it('finds the source files to scan', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('a client or matter number in text goes through businessNumber / formatBusinessNumber', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (ALLOWED[f.path]) continue;
      for (const { expr, line, kind } of expressions(f.text)) {
        // A binding that only passes the value on (`[value]="m"`) is not text; a concatenation or a literal in a binding is.
        const isText = kind !== 'binding' || /['"`+]/.test(expr);
        // The name of the field as a string (`fieldError('matterNumber')`) is not a number.
        const shown = expr.replace(/['"`](?:clientNumber|matterNumber)['"`]/g, '');
        if (isText && NUMBER_FIELD.test(shown) && !WRAPPED.test(shown)) {
          bad.push(`${f.path}:${line}: ${expr.trim().replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(bad, 'use `| businessNumber` or formatBusinessNumber() on these').toEqual([]);
  });

  it('nothing converts a client or matter number to a JavaScript number', () => {
    const bad: string[] = [];
    const conversion =
      /(?<![\w$])(?:Number|parseInt|parseFloat)\(\s*[^)]*\b(?:clientNumber|matterNumber)\b|(?<![\w)\]])\+\s*[\w$.?]*\b(?:clientNumber|matterNumber)\b/;
    for (const f of files) {
      if (ALLOWED[f.path]) continue;
      f.text.split('\n').forEach((lineText, i) => {
        if (conversion.test(lineText)) bad.push(`${f.path}:${i + 1}: ${lineText.trim()}`);
      });
    }
    expect(bad, 'a number conversion drops the leading zeros').toEqual([]);
  });

  it('example numbers in placeholders, help text, labels and titles have 5 digits', () => {
    const bad: string[] = [];
    // An attribute that is text for people, and a number or pair of numbers in it that is not 5 digits (dates, ranges such as "1 to 5 digits" and "1-50 of 143" are not examples).
    const attribute = /\b(?:placeholder|help|hint|title|label|aria-label|description)="([^"]*)"/g;
    const pair = /(?<![\w.:/-])(\d{1,5})-(\d{1,5})(?![\w-])/g;
    const lead = /^\d{1,4}\s+(?:or|and)\b/;
    for (const f of files) {
      if (ALLOWED[f.path]) continue;
      for (const m of f.text.matchAll(attribute)) {
        const value = m[1];
        const line = f.text.slice(0, m.index).split('\n').length;
        const wrong =
          [...value.matchAll(pair)].some((p) => p[1].length !== 5 || p[2].length !== 5) ||
          (m[0].startsWith('placeholder') && lead.test(value));
        if (wrong && !/\bof \d|\bto \d/.test(value)) bad.push(`${f.path}:${line}: ${m[0]}`);
      }
    }
    expect(bad, 'write the example as 00343 or 00343-00012').toEqual([]);
  });
});
