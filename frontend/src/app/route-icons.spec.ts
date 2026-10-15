import { Route, UrlSegment } from '@angular/router';
import { routes } from './app.routes';
import { ADMIN_NAV_ITEMS, NAV_ITEMS } from './shared/layout/nav-items';
import { iconForPath } from './shared/layout/section-icons';

interface Page {
  url: string;
  title: unknown;
}

/** Every routed page of the app (lazy children resolved), as the URL it is reached at. Parameters become `1`. */
async function pagesOf(list: readonly Route[], base: string): Promise<Page[]> {
  const pages: Page[] = [];
  for (const r of list) {
    if (r.redirectTo !== undefined) continue;
    let own = (r.path ?? '').replace(/:[A-Za-z]+/g, '1');
    const candidates: string[] = [];
    if (r.matcher) {
      for (const probe of ['users', 'roles', 'task-types', 'workflows', 'steps']) {
        if (r.matcher([new UrlSegment(probe, {})], null as never, r)) candidates.push(probe);
      }
    } else candidates.push(own === '**' ? '404' : own);
    own = candidates[0] ?? '';
    const children = r.children ?? (r.loadChildren ? ((await r.loadChildren()) as Route[]) : null);
    for (const c of candidates) {
      const url = [base, c].filter(Boolean).join('/');
      if (children) pages.push(...(await pagesOf(children, url)));
      else if (r.component || r.loadComponent) pages.push({ url: '/' + url, title: r.title });
    }
  }
  return pages;
}

describe('page header icons: every routed page belongs to a section with an icon', () => {
  it('gives each route of the app the icon of its section', async () => {
    const pages = await pagesOf(routes, '');
    expect(pages.length).toBeGreaterThan(30);
    const missing = pages.filter((p) => iconForPath(p.url) === null).map((p) => p.url);
    expect(missing).toEqual([]);
  });

  it('uses the navigation icon for the section index and its detail pages', () => {
    for (const item of [...NAV_ITEMS, ...ADMIN_NAV_ITEMS]) {
      expect(iconForPath(item.path)).toBe(item.icon);
      expect(iconForPath(item.path + '/42/edit')).toBe(item.icon);
      for (const also of item.alsoActive ?? []) expect(iconForPath(also)).toBe(item.icon);
    }
  });

  it('gives the three Task Types tabs, their create/edit pages and the step and workflow pages one icon', () => {
    const icon = 'pi pi-file-edit';
    for (const path of [
      '/admin/task-types',
      '/admin/task-types/new',
      '/admin/task-types/4/form',
      '/admin/workflows',
      '/admin/workflows/new',
      '/admin/workflows/3/versions/7',
      '/admin/steps',
      '/admin/steps/new',
      '/admin/steps/9/form',
    ]) {
      expect(iconForPath(path), path).toBe(icon);
    }
  });

  it('keeps Pod Work, Pods, Assets and the asset types apart, and handles the special screens', () => {
    expect(iconForPath('/pods/work')).toBe('pi pi-users');
    expect(iconForPath('/admin/pods')).toBe('pi pi-sitemap');
    expect(iconForPath('/assets/5')).toBe('pi pi-database');
    expect(iconForPath('/admin/asset-types')).toBe('pi pi-tags');
    expect(iconForPath('/tasks/new')).toBe('pi pi-plus');
    expect(iconForPath('/tasks/17')).toBe('pi pi-list-check');
    expect(iconForPath('/search?q=x')).toBe('pi pi-search');
    expect(iconForPath('/tasks-old')).toBeNull();
    expect(iconForPath('/')).toBeNull();
  });
});
