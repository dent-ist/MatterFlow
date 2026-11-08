import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, ADMIN_NAV_ITEMS } from '../layout/nav-items';
import { iconForPath } from '../layout/section-icons';
import { ICONS, pageIcon, tabIcon } from './tab-icons';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('tab icons (LC-10, theme guide 11.3)', () => {
  it('every entry is a PrimeIcons class', () => {
    for (const [key, icon] of Object.entries(ICONS)) expect(icon, key).toMatch(/^pi-[a-z-]+$/);
  });

  it('one concept has one icon: Activity, Activities and History; Assets and Asset; Overview and Summary', () => {
    expect(tabIcon('Activity')).toBe(tabIcon('Activities'));
    expect(tabIcon('History')).toBe(tabIcon('Activity'));
    expect(tabIcon('Assets')).toBe(tabIcon('asset'));
    expect(tabIcon('Overview')).toBe(tabIcon('Summary'));
    expect(tabIcon('Due soon and overdue')).toBe('pi-clock');
  });

  it('the Dashboard Summary tab has its own icon, the record Summary and Overview tabs keep the home icon (D-17)', () => {
    expect(tabIcon('dashboard-summary')).toBe('pi-objects-column');
    expect(tabIcon('summary')).toBe('pi-home');
    expect(tabIcon('overview')).toBe('pi-home');
    expect(pageIcon('dashboard')).toBe('pi pi-home');
  });

  it('the Task Types tab is the Task Types page icon, never the Asset Types icon of the menu (#1133)', () => {
    expect(tabIcon('task-types')).toBe(ICONS['page-task-types']);
    expect(tabIcon('task-types')).not.toBe(ICONS['page-asset-types']);
    expect(tabIcon('types')).toBe(ICONS['page-asset-types']);
  });

  it('the navigation, the page tile and the registry are one source: every nav item and section icon is a registry page icon', () => {
    const pages = new Set(
      Object.entries(ICONS)
        .filter(([k]) => k.startsWith('page-'))
        .map(([, v]) => 'pi ' + v),
    );
    for (const item of [...NAV_ITEMS, ...ADMIN_NAV_ITEMS]) {
      expect(pages.has(item.icon), item.label).toBe(true);
      expect(iconForPath(item.path), item.label).toBe(item.icon);
    }
  });

  it('one icon is one concept: a registry icon used by two keys must be listed as the same concept or as a known repeat', () => {
    // Same concept under two names: allowed.
    const same: string[][] = [
      ['summary', 'overview', 'page-dashboard'],
      ['tasks', 'task', 'linked-tasks', 'page-my-work'],
      ['projects', 'project', 'page-projects'],
      ['assets', 'asset', 'page-assets'],
      ['matters', 'matter', 'page-matters'],
      ['clients', 'client', 'page-clients'],
      ['activities', 'activity', 'history', 'page-audit-logs'],
      ['workflows', 'workflow'],
      ['runs', 'run-log'],
      ['swimlane', 'lane'],
      ['types', 'asset-types', 'page-asset-types'],
      ['task-types', 'page-task-types'],
      ['priorities', 'page-labels'],
      ['fields', 'page-custom-fields'],
      ['by-member', 'pods', 'page-pod-work'],
      ['request-form', 'form'],
    ];
    // Different concepts that share an icon today and never sit in one tab strip or beside one page tile; the page epics decide whether to split them.
    const known: string[][] = [
      ['form', 'request-form', 'reports'],
      ['notes', 'page-task-types', 'task-types'],
      ['page-profile', 'created-by-me'],
      ['page-access-pending', 'permissions'],
      ['holidays', 'priorities', 'page-labels'],
      ['unassigned', 'inputs'],
      ['used-by', 'link-roles'],
      ['all-open', 'steps'],
      ['metrics', 'page-reports'],
      // Epic #1298 (UI spec): the Matter Lists page and tab icons follow the concept they list; the Team tab and the Team Titles tab never sit in one strip.
      ['fields', 'page-custom-fields', 'page-matter-lists'],
      ['matters', 'matter', 'page-matters', 'matter-types'],
      ['team', 'team-titles'],
    ];
    const byIcon = new Map<string, string[]>();
    for (const [key, icon] of Object.entries(ICONS))
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), key]);
    const open: string[] = [];
    for (const [icon, keys] of byIcon) {
      if (keys.length < 2) continue;
      const covered = [...same, ...known].some((g) => keys.every((k) => g.includes(k)));
      if (!covered) open.push(`${icon}: ${keys.join(', ')}`);
    }
    expect(open).toEqual([]);
  });

  it('the strip of one page never repeats an icon: the tabs of the Dashboard, Task Types and Settings each differ', () => {
    const strips = {
      dashboard: ['dashboard-summary', 'breakdowns', 'trends', 'swimlane', 'users', 'calendar'],
      taskTypes: ['task-types', 'workflows', 'steps'],
      settings: ['branding', 'dashboard', 'holidays'],
    };
    for (const [page, keys] of Object.entries(strips)) {
      const icons = keys.map((k) => tabIcon(k));
      expect(new Set(icons).size, page).toBe(icons.length);
    }
    // ...and none repeats the tile of the page it sits on.
    expect(strips.dashboard.map(tabIcon)).not.toContain(ICONS['page-dashboard']);
    expect(
      strips.taskTypes.map(tabIcon).filter((i) => i === ICONS['page-task-types']),
    ).toHaveLength(1);
  });

  it('a tab strip never draws its own tab: only mf-tabs has role="tab" (the shared strip)', () => {
    const app = join(process.cwd(), 'src', 'app');
    const offenders = sources(app).filter(
      (f) =>
        !f.endsWith(join('shared', 'ui', 'tabs.ts')) &&
        /\srole="tab"/.test(readFileSync(f, 'utf8')),
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
