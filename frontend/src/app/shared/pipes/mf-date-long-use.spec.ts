import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for D-60 (#1146, #1147): the long date form (`mfDateLong`, "October 12, 2026, 10:23 PM EDT" (the FULL month)) is for tooltips and accessible names only. A template that prints it
 * in a cell, a field, a chip or a feed fails here; what those show is `mfNum` (`MM/DD hh:mm AM/PM`).
 */
const APP = join(process.cwd(), 'src', 'app');

/** Files that still print the long form (none since part 2, #1147; a new entry needs a reason). */
const PENDING: string[] = [];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return (name.endsWith('.ts') && !name.endsWith('.spec.ts')) || name.endsWith('.html')
      ? [path]
      : [];
  });
}

describe('the long date pipe', () => {
  it('is used only inside title and aria-label bindings', () => {
    const offenders: string[] = [];
    for (const file of sources(APP)) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\[(?:attr\.)?(?:title|aria-label)\]="[^"]*"/g, '');
      if (/\|\s*mfDateLong\b/.test(text)) offenders.push(relative(APP, file).replace(/\\/g, '/'));
    }
    expect(offenders.filter((f) => !PENDING.includes(f))).toEqual([]);
  });

  it('has no Angular date pipe with a month-name pattern in a template (d MMM y, MMM d, MMMM)', () => {
    const offenders: string[] = [];
    for (const file of sources(APP)) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\[(?:attr\.)?(?:title|aria-label)\]="[^"]*"/g, '');
      if (/\|\s*date\s*:\s*'[^']*MMM/.test(text)) {
        offenders.push(relative(APP, file).replace(/\\/g, '/'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no pending exceptions', () => {
    expect(PENDING.length).toBe(0);
  });
});
