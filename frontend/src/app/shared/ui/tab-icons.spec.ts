import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TAB_ICONS, tabIcon } from './tab-icons';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('tab icons (LC-10, theme guide 11.3)', () => {
  it('every entry is a PrimeIcons class', () => {
    for (const [key, icon] of Object.entries(TAB_ICONS)) expect(icon, key).toMatch(/^pi-[a-z-]+$/);
  });

  it('one concept has one icon: Activity, Activities and History; Assets and Asset; Overview and Summary', () => {
    expect(tabIcon('Activity')).toBe(tabIcon('Activities'));
    expect(tabIcon('History')).toBe(tabIcon('Activity'));
    expect(tabIcon('Assets')).toBe(tabIcon('asset'));
    expect(tabIcon('Overview')).toBe(tabIcon('Summary'));
    expect(tabIcon('Due soon and overdue')).toBe('pi-clock');
  });

  it('a tab strip never draws its own tab: only mf-tabs has role="tab" (the shared strip)', () => {
    const app = join(process.cwd(), 'src', 'app');
    const offenders = sources(app).filter(
      (f) =>
        !f.endsWith(join('shared', 'ui', 'tabs.ts')) && /role="tab"/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => f.replace(app, ''))).toEqual([]);
  });

  it('every file that builds a tab for mf-tabs gives it an icon (MfTab.icon is required; no literal tab without one)', () => {
    const app = join(process.cwd(), 'src', 'app');
    const bad: string[] = [];
    for (const f of sources(app)) {
      const text = readFileSync(f, 'utf8');
      if (!text.includes('<mf-tabs')) continue;
      if (!/tabIcon\(|icon:/.test(text) && !/MfTab/.test(text)) bad.push(f.replace(app, ''));
    }
    expect(bad).toEqual([]);
  });
});
