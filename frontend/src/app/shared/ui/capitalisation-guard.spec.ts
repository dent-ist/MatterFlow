import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '../layout/nav-items';
import { DASHBOARD_TAB_LABELS } from '../../features/dashboard/dashboard-prefs';
import { TAB_LABELS as MY_WORK_TABS } from '../../features/my-work/pages/my-work-page';
import { TAB_LABELS as MY_MATTERS_TABS } from '../../features/my-matters/ui/mm-scope';
import { LABEL_TABS } from '../../features/admin/labels-tabs';

/**
 * Guard for D-20 (#1149): "click it or name it = Title Case; read it = sentence case". A button label, a page heading, a dialog title, a column heading and a one-line
 * button text in a template must be Title Case (minor words stay lowercase except as the first word: a, an, and, as, at, but, by, for, from, in, into, of, on, or, per, the, to, via, vs, with). Text with a
 * sentence full stop, a placeholder or a tooltip is not checked. A word that is data and not a name goes into `ALLOWED` with the reason.
 */
const APP = join(process.cwd(), 'src', 'app');
const MINOR = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'via',
  'vs',
  'with',
]);

/** Strings that are allowed to differ (the reason in the comment). */
const ALLOWED = new Set<string>([
  'Rows per page', // D-20: the pager label is read, not clicked
  'Choose the unit', // a prompt row of a dropdown (placeholder wording, sentence case)
  'Choose a unit', // same
  'Choose a client', // same
  'Choose a matter', // same
]);

export function isTitleCase(text: string): boolean {
  const head = text.replace(/\s+\(.*$/, '');
  const words = head.split(/\s+/).filter(Boolean);
  return words.every((word, i) => {
    const core = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!core || !/^[A-Za-z]/.test(core) || /[./]/.test(core)) return true;
    if (/^v\d*$/.test(core) || core.toLowerCase() === 'vs') return true;
    const minor = MINOR.has(core.toLowerCase()) && i > 0;
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
  {
    name: 'icon button text',
    pattern: /<button\b[^>]*>\s*<i\b[^>]*><\/i>\s*([A-Za-z][^<>{}\n]*?)\s*<\/button>/g,
  },
  { name: 'column heading', pattern: /<th\b[^>]*>\s*([A-Za-z][^<>{}\n]*?)\s*<\/th>/g },
];

describe('capitalisation of what is clicked or named (D-20, #1149)', () => {
  it('knows Title Case', () => {
    expect(isTitleCase('Clear Filters')).toBe(true);
    expect(isTitleCase('Mark All as Read')).toBe(true);
    expect(isTitleCase('Expected Turnaround (days)')).toBe(true);
    expect(isTitleCase('Clear filters')).toBe(false);
    expect(isTitleCase('Assign To Me')).toBe(false);
    expect(isTitleCase('Produced by Us')).toBe(true);
    expect(isTitleCase('Coverage by Pod')).toBe(true);
    expect(isTitleCase('Created By Me')).toBe(false);
    expect(isTitleCase('By Member')).toBe(true);
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

  // Spec 15.1 (#1222): the fixed words of a dropdown option and of a filter's "all" value are Title Case ("All Pods", "Any Date", "Last 30 Days").
  // Names of people, pods, matters and admin-edited labels come from data and are not in the source as literals.
  const OPTION_PATTERNS: RegExp[] = [
    /\{\s*(?:key|value|id)\s*:\s*[^,{}]+,\s*label:\s*'([^']+)'/g,
    /\b(?:allLabel|emptyLabel)\s*:\s*'([^']+)'/g,
    /\b(?:allLabel|emptyLabel)="([^"]+)"/g,
    /\blabel: '([^']+)', (?:group|heading|count|icon|tone|sub|dot|lock|typeChip|stateIcon)/g,
    /<option\b[^>]*>\s*([^<>{}\n]{2,45}?)\s*<\/option>/g,
  ];

  it('every fixed dropdown option label and every "all" value is Title Case (spec 15.1, #1222)', () => {
    const offenders: string[] = [];
    for (const file of sources(APP)) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const pattern of OPTION_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          const label = match[1].trim();
          if (label.length > 45 || /[.?!:]$/.test(label) || ALLOWED.has(label)) continue;
          if (/^(Choose|Select) /.test(label) || label.includes(': ')) continue; // a prompt row, or a rule written as a sentence
          if (!isTitleCase(label)) {
            offenders.push(`${relative(APP, file).replace(/\\/g, '/')}: option "${label}"`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every navigation item, route title and tab label is Title Case (#1150)', () => {
    const labels = [
      ...NAV_ITEMS.map((n) => n.label),
      ...Object.values(DASHBOARD_TAB_LABELS),
      ...Object.values(MY_WORK_TABS),
      ...Object.values(MY_MATTERS_TABS),
      ...LABEL_TABS.map((t) => t.label),
    ];
    const offenders = labels.filter((label) => !isTitleCase(label));
    for (const file of sources(APP).filter((f) => f.endsWith('.routes.ts'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\btitle: '([^']+)'/g)) {
        if (!isTitleCase(match[1])) {
          offenders.push(`${relative(APP, file).replace(/\\/g, '/')}: route title "${match[1]}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
