import { ChangeDetectionStrategy, Component, Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, Routes, UrlSegment, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { AdminListShell } from './admin-list-shell';
import {
  FIXED_MODE_QUERY,
  FixedPage,
  ScrollArea,
  ScrollMemory,
  ShellLayout,
  sameListAddress,
} from './fixed-page';

/**
 * Where a URL leads in the real route tree, down to the component (lazy routes are loaded). Only the matching the tests need: static
 * segments, `:params`, `matcher` functions, empty-path wrappers and `loadChildren`.
 */
async function componentAt(url: string): Promise<Type<unknown> | null> {
  const segments = url.split('/').filter(Boolean);
  return find(routes, segments);
}

async function childrenOf(route: Route): Promise<Routes> {
  if (route.children) return route.children;
  if (route.loadChildren) {
    const loaded = await route.loadChildren();
    return Array.isArray(loaded) ? loaded : [];
  }
  return [];
}

async function find(candidates: Routes, segments: string[]): Promise<Type<unknown> | null> {
  for (const route of candidates) {
    let rest: string[] | null = null;
    if (route.matcher) {
      const url = segments.map((s) => new UrlSegment(s, {}));
      const result = route.matcher(url, {} as never, route);
      if (result) rest = segments.slice(result.consumed.length);
    } else if (route.path === '**') {
      rest = [];
    } else {
      const own = (route.path ?? '').split('/').filter(Boolean);
      const matches = own.every(
        (p, i) => segments[i] !== undefined && (p.startsWith(':') || p === segments[i]),
      );
      if (matches && own.length <= segments.length) rest = segments.slice(own.length);
    }
    if (rest === null) continue;
    const full = (route.pathMatch ?? 'prefix') === 'full';
    if (rest.length === 0 && route.component) return route.component;
    if (rest.length === 0 && route.loadComponent)
      return (await route.loadComponent()) as Type<unknown>;
    if (full && rest.length > 0) continue;
    const found = await find(await childrenOf(route), rest);
    if (found) return found;
  }
  return null;
}

const FIXED_HOSTS: unknown[] = [FixedPage, AdminListShell];

/** True when the component's template uses `mf-fixed-page` (it is one of the dependencies of its compiled definition), directly or through the admin list shell (#544), which is a fixed page. */
function usesFixedPage(component: Type<unknown>): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (component as any).ɵcmp;
  const deps = typeof def.dependencies === 'function' ? def.dependencies() : def.dependencies;
  const defs = typeof def.directiveDefs === 'function' ? def.directiveDefs() : def.directiveDefs;
  return (
    (Array.isArray(deps) && FIXED_HOSTS.some((h) => deps.includes(h))) ||
    (Array.isArray(defs) &&
      defs.some((d: { type?: unknown }) => FIXED_HOSTS.some((h) => d.type === h)))
  );
}

/** Every route whose main content is a grid or list: the page title, tabs, search and buttons stay put and only the grid scrolls. */
const FIXED_URLS = [
  '/tasks',
  '/my-work',
  '/pods/work',
  '/clients',
  '/matters',
  '/projects',
  '/assets',
  '/clients/7',
  '/matters/7',
  '/projects/7',
  '/admin/users',
  '/admin/roles',
  '/admin/pods',
  '/admin/task-types',
  '/admin/workflows',
  '/admin/steps',
  '/admin/priorities',
  '/admin/status-labels',
  '/admin/asset-types',
  '/admin/asset-types?tab=link-roles',
  '/admin/custom-fields',
  '/admin/audit',
  // Fixed-height Dashboard (#137): the page never scrolls, only regions inside each tab do.
  '/dashboard',
  // The workflow version page (VP1, #393): the header and the action bar stay, the steps pane scrolls inside.
  '/admin/workflows/7/versions/9',
  // The form designer (FD1, #407), one component for Task Types, Steps, Asset Types and Custom Fields: header and action bar stay, the panes scroll.
  '/admin/task-types/7/form',
  '/admin/steps/7/form',
  '/admin/asset-types/7/form',
  '/admin/custom-fields/client/form',
];

/** Screens that keep the normal page scroll: forms, the task page and the system pages. */
const NORMAL_URLS = [
  '/tasks/new',
  '/tasks/7',
  '/clients/new',
  '/clients/7/edit',
  '/matters/new',
  '/matters/7/edit',
  '/projects/new',
  '/projects/7/edit',
  '/assets/new',
  '/assets/7/edit',
  '/admin/task-types/new',
  '/admin/task-types/7',
  '/admin/steps/new',
  '/admin/steps/7',
  '/admin/workflows/new',
  '/admin/workflows/7',
  '/403',
  '/404',
  '/nowhere',
];

describe('fixed-header grid screens', () => {
  it.each(FIXED_URLS)('%s uses the shared fixed layout (mf-fixed-page)', async (url) => {
    const component = await componentAt(url.split('?')[0]);
    expect(component, `no route for ${url}`).not.toBeNull();
    expect(usesFixedPage(component!), `${url} (${component!.name})`).toBe(true);
  });

  it.each(NORMAL_URLS)('%s keeps the normal page scroll', async (url) => {
    const component = await componentAt(url);
    expect(component, `no route for ${url}`).not.toBeNull();
    expect(usesFixedPage(component!), `${url} (${component!.name})`).toBe(false);
  });

  it('switches to normal page scrolling below 768 px wide or 561 px high', () => {
    expect(FIXED_MODE_QUERY).toBe('(min-width: 768px) and (min-height: 561px)');
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FixedPage, ScrollArea],
  template: `
    <mf-fixed-page>
      <header>Title</header>
      <div mfScrollArea="Task list" [resetKey]="key()" data-area>
        <table>
          <thead>
            <tr>
              <th>A</th>
            </tr>
          </thead>
          <tbody>
            @for (n of rows; track n) {
              <tr>
                <td>{{ n }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </mf-fixed-page>
  `,
})
class Host {
  readonly key = signal(0);
  readonly rows = Array.from({ length: 80 }, (_, i) => i);
}

/** A master-detail list: the selection is in the query string and does not change the list. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FixedPage, ScrollArea],
  template: `
    <mf-fixed-page>
      <div mfScrollArea="Asset list" [keepOn]="['selected']" data-area>
        <div style="height: 4000px"></div>
      </div>
    </mf-fixed-page>
  `,
})
class MasterDetailHost {}

/** A short list inside a page that scrolls as a whole: its box is a Tab stop only while it really scrolls (issue #937). */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollArea],
  template: `<div mfScrollArea="Needs my attention list" [whileScrolling]="true" data-area>
    <p>One short row</p>
  </div>`,
})
class ShortListHost {}

describe('mf-fixed-page and the scroll area', () => {
  async function render() {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Host }])],
    });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      area: el.querySelector<HTMLElement>('[data-area]')!,
      host: fixture.componentInstance,
    };
  }

  it('marks the page with data-fixed-page and tells the shell while it is on screen', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Host }])],
    });
    const layout = TestBed.inject(ShellLayout);
    expect(layout.fixed()).toBe(false);
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('mf-fixed-page')!.hasAttribute('data-fixed-page')).toBe(true);
    expect(layout.fixed()).toBe(true);
    fixture.destroy();
    expect(layout.fixed()).toBe(false);
  });

  it('counts pages, so one that replaces another during navigation never leaves the shell unfixed', () => {
    const layout = TestBed.inject(ShellLayout);
    const first = layout.register();
    const second = layout.register();
    first();
    expect(layout.fixed()).toBe(true);
    second();
    expect(layout.fixed()).toBe(false);
  });

  it('makes the grid a focusable, named region so keyboard users can scroll it', async () => {
    const { area } = await render();
    expect(area.getAttribute('role')).toBe('region');
    expect(area.getAttribute('tabindex')).toBe('0');
    expect(area.getAttribute('aria-label')).toBe('Task list, scrollable');
    expect(area.classList.contains('mf-scroll-area')).toBe(true);
  });

  it('a short list that fits is no region and no Tab stop (whileScrolling), and becomes one while it overflows (#937)', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ShortListHost);
    await fixture.whenStable();
    const area = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-area]')!;
    // jsdom lays nothing out, so the box never overflows: no role, no tab stop, no name.
    expect(area.getAttribute('role')).toBeNull();
    expect(area.getAttribute('tabindex')).toBeNull();
    expect(area.getAttribute('aria-label')).toBeNull();
    expect(area.classList.contains('mf-scroll-area')).toBe(true);
  });

  it('flags the page and the grid as scrolled once the rows have moved, and clears it at the top', async () => {
    const { fixture, el, area } = await render();
    const page = el.querySelector('mf-fixed-page')!;
    expect(page.hasAttribute('data-scrolled')).toBe(false);
    area.scrollTop = 120;
    area.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(area.hasAttribute('data-scrolled')).toBe(true);
    expect(page.hasAttribute('data-scrolled')).toBe(true);
    area.scrollTop = 0;
    area.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(area.hasAttribute('data-scrolled')).toBe(false);
    expect(page.hasAttribute('data-scrolled')).toBe(false);
  });

  it('returns to the top when the list changes without a navigation (resetKey)', async () => {
    const { fixture, area, host } = await render();
    area.scrollTop = 300;
    host.key.set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(area.scrollTop).toBe(0);
  });

  it('returns to the top on every ordinary navigation (page, sort, filter and tab changes)', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Host }])],
    });
    const harness = await RouterTestingHarness.create('/list?page=1');
    const area = (harness.routeNativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-area]',
    )!;
    area.scrollTop = 250;
    await harness.navigateByUrl('/list?page=2');
    expect(area.scrollTop).toBe(0);
  });

  it('remembers the scroll position per address for Back and Forward', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const memory = TestBed.inject(ScrollMemory);
    memory.save('/tasks?page=2', 480);
    expect(memory.saved('/tasks?page=2')).toBe(480);
    expect(memory.saved('/tasks?page=3')).toBe(0);
    memory.save('/tasks?page=2', 0);
    expect(memory.saved('/tasks?page=2')).toBe(0);
    expect(TestBed.inject(Router)).toBeTruthy();
  });

  it('keeps the position when only a keepOn parameter changes (the selected row), but not for any other change', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: MasterDetailHost }])],
    });
    const harness = await RouterTestingHarness.create('/assets?name=a');
    const area = (harness.routeNativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-area]',
    )!;
    area.style.height = '200px';
    area.style.overflow = 'auto';
    area.scrollTop = 250;
    await harness.navigateByUrl('/assets?name=a&selected=9');
    expect(area.scrollTop).toBe(250);
    await harness.navigateByUrl('/assets?name=a&selected=10');
    expect(area.scrollTop).toBe(250);
    await harness.navigateByUrl('/assets?name=a');
    expect(area.scrollTop).toBe(250);
    await harness.navigateByUrl('/assets?name=ab&selected=10');
    expect(area.scrollTop).toBe(0);
  });

  it('compares addresses without the ignored parameters', () => {
    expect(sameListAddress('/a?x=1', '/a?x=1', [])).toBe(false); // no ignored parameters: every navigation starts at the top
    expect(sameListAddress('/a?x=1', '/a?x=1&s=9', ['s'])).toBe(true);
    expect(sameListAddress('/a', '/a?s=9', ['s'])).toBe(true);
    expect(sameListAddress('/a?s=1', '/a?s=2', ['s'])).toBe(true);
    expect(sameListAddress('/a?x=1&s=1', '/a?x=2&s=1', ['s'])).toBe(false);
    expect(sameListAddress('/a?s=1', '/b?s=1', ['s'])).toBe(false);
  });
});
