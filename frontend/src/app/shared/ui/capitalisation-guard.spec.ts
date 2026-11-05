import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for D-20 (#1149): "click it or name it = Title Case; read it = sentence case". A button label, a page heading, a dialog title, a column heading and a one-line
 * button text in a template must be Title Case (minor words "a, an, and, as, at, for, in, of, on, or, the, to" stay lowercase except first and last). Text with a
 * sentence full stop, a placeholder or a tooltip is not checked. A word that is data and not a name goes into `ALLOWED` with the reason.
 */
const APP = join(process.cwd(), 'src', 'app');
const MINOR = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'vs',
]);

/** Strings that are allowed to differ (the reason in the comment). */
const ALLOWED = new Set<string>([
  'Rows per page', // D-20: the pager label is read, not clicked
]);

export function isTitleCase(text: string): boolean {
  const head = text.replace(/\s+\(.*$/, '');
  const words = head.split(/\s+/).filter(Boolean);
  return words.every((word, i) => {
    const core = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!core || !/^[A-Za-z]/.test(core) || /[./]/.test(core)) return true;
    if (/^v\d*$/.test(core) || core.toLowerCase() === 'vs') return true;
    const minor = MINOR.has(core.toLowerCase()) && i > 0 && i < words.length - 1;
    return minor ? /^[a-z]/.test(core) : /^[A-Z]/.test(core);
  });
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sources(path);
    return (name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.includes('testing') &&
      !name.includes('fixtures')) ||
      name.endsWith('.html')
      ? [path]
      : [];
  });
}

const CHANNELS: { name: string; pattern: RegExp }[] = [
  { name: 'p-button label', pattern: /<p-button\b[^>]*?\slabel="([^"{}]+)"/g },
  { name: 'page heading', pattern: /<mf-page-header\b[^>]*?\sheading="([^"{}]+)"/g },
  { name: 'dialog title', pattern: /<mf-form-dialog\b[^>]*?\stitle="([^"{}]+)"/g },
  { name: 'dialog button', pattern: /<mf-form-dialog\b[^>]*?\sprimaryLabel="([^"{}]+)"/g },
  { name: 'button text', pattern: /<button\b[^>]*>\s*([A-Za-z][^<>{}\n]*?)\s*<\/button>/g },
  { name: 'column heading', pattern: /<th\b[^>]*>\s*([A-Za-z][^<>{}\n]*?)\s*<\/th>/g },
];

describe('capitalisation of what is clicked or named (D-20, #1149)', () => {
  it('knows Title Case', () => {
    expect(isTitleCase('Clear Filters')).toBe(true);
    expect(isTitleCase('Mark All as Read')).toBe(true);
    expect(isTitleCase('Expected Turnaround (days)')).toBe(true);
    expect(isTitleCase('Clear filters')).toBe(false);
    expect(isTitleCase('Assign To Me')).toBe(false);
  });

  it('every button label, page heading, dialog title and column heading is Title Case', () => {
    const offenders: string[] = [];
    for (const file of sources(APP)) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      for (const { name, pattern } of CHANNELS) {
        for (const match of text.matchAll(pattern)) {
          const label = match[1].trim();
          if (label.length > 45 || /[.?!:]$/.test(label) || ALLOWED.has(label)) continue;
          if (!isTitleCase(label)) {
            offenders.push(`${relative(APP, file).replace(/\\/g, '/')}: ${name} "${label}"`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
