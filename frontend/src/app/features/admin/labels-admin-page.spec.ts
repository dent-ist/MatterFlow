import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PrioritiesClient, StatusLabelsClient } from '../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakePrioritiesClient, FakeStatusLabelsClient } from '../../core/lookups/lookups-testing';
import { ADMIN_ROUTES } from './admin.routes';
import { LABEL_TAB_TEXT } from './labels-admin-page';

/** The Labels page (#593): one route, two counted tabs on the admin list shell. */
describe('Labels page on the admin list shell (#593)', () => {
  let harness: RouterTestingHarness;
  let api: FakePrioritiesClient;
  let statusApi: FakeStatusLabelsClient;
  const SLOW = 20_000;
  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const tabs = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[role="tab"]'));
  const tabText = (): string[] => tabs().map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
  const crumbs = (): string[] =>
    Array.from(el().querySelectorAll('nav[aria-label="Breadcrumb"] li')).map((li) =>
      li.textContent!.trim(),
    );

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  async function open(
    url: string,
    permissions: Permission[],
    prepare: (client: FakePrioritiesClient) => void = () => undefined,
  ): Promise<Router> {
    api = new FakePrioritiesClient();
    prepare(api);
    statusApi = new FakeStatusLabelsClient();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'admin', children: ADMIN_ROUTES },
            { path: '403', children: [] },
          ],
          withComponentInputBinding(),
        ),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: PrioritiesClient, useValue: api },
        { provide: StatusLabelsClient, useValue: statusApi },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    return TestBed.inject(Router);
  }

  it(
    'shows the crumb, the title, one description line and the counted tabs Priorities (4) and Status labels (5)',
    async () => {
      await open('/admin/priorities', ['Priority.Manage', 'StatusLabel.Manage']);

      expect(crumbs()).toEqual(['Administration', 'Labels']);
      expect(el().querySelector('h1')!.textContent).toContain('Labels');
      expect(el().textContent).toContain(LABEL_TAB_TEXT.priorities);
      expect(tabText()).toEqual(['Priorities (4)', 'Status labels (5)']);
      expect(
        tabs()
          .filter((t) => t.getAttribute('aria-selected') === 'true')
          .map((t) => t.textContent),
      ).toEqual([tabs()[0].textContent]);
      expect(el().querySelector('mf-priorities-page')).not.toBeNull();
      expect(el().querySelector('nav.tabs')).toBeNull();
    },
    SLOW,
  );

  it(
    'counts only the ACTIVE priorities',
    async () => {
      await open('/admin/priorities', ['Priority.Manage', 'StatusLabel.Manage'], (client) => {
        client.rows = client.rows.map((r) => (r.id === 4 ? { ...r, isActive: false } : r));
      });
      expect(tabText()[0]).toBe('Priorities (3)');
    },
    SLOW,
  );

  it(
    'switches to Status labels without leaving the page, with its own description and no New priority action',
    async () => {
      const router = await open('/admin/priorities', ['Priority.Manage', 'StatusLabel.Manage']);
      expect(el().querySelector('[data-new]')).not.toBeNull();

      tabs()[1].click();
      await settle();

      expect(router.url).toBe('/admin/status-labels');
      expect(el().querySelector('mf-status-labels-page')).not.toBeNull();
      expect(el().textContent).toContain(LABEL_TAB_TEXT['status-labels']);
      expect(el().querySelector('[data-new]')).toBeNull();
    },
    SLOW,
  );

  it(
    'opens New priority through ?edit=new from the one primary action',
    async () => {
      const router = await open('/admin/priorities', ['Priority.Manage']);
      (el().querySelector('[data-new] button, button[data-new]') as HTMLElement).click();
      await settle();
      expect(router.url).toBe('/admin/priorities?edit=new');
      expect(document.body.querySelector('[data-lookup-title]')!.textContent).toContain(
        'New priority',
      );
    },
    SLOW,
  );

  it(
    'gives a person with one tab no tab strip and sends the other tab to it',
    async () => {
      const router = await open('/admin/status-labels', ['Priority.Manage']);
      expect(router.url).toBe('/admin/priorities');
      expect(tabs()).toEqual([]);
      expect(el().querySelector('mf-priorities-page')).not.toBeNull();
      expect(statusApi.calls).toEqual([]);
    },
    SLOW,
  );

  it(
    'shows the 403 page to a person who may use neither tab',
    async () => {
      const router = await open('/admin/priorities', ['Task.View']);
      expect(router.url).toBe('/403');
    },
    SLOW,
  );

  it('keeps every description within the one-line limit of the header', () => {
    for (const text of Object.values(LABEL_TAB_TEXT)) expect(text.length).toBeLessThanOrEqual(90);
  });
});
