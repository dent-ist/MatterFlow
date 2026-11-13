import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import {
  AssetLinkRolesClient,
  CurrentStatesClient,
  MatterCategoriesClient,
  MatterTypesClient,
  NoteTagsClient,
  OnHoldReasonsClient,
  PrioritiesClient,
  StatusLabelsClient,
  TeamTitlesClient,
  VendorAreasClient,
  VendorServicesClient,
} from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeAssetLinkRolesClient,
  FakePrioritiesClient,
  FakeStatusLabelsClient,
} from '../../../core/lookups/lookups-testing';
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
import { ADMIN_ROUTES } from '../admin.routes';
import { ADMIN_LISTS, AdminListKey } from './admin-lists';

const matterItem = (id: number, name: string, isActive = true) => ({
  id,
  name,
  sortOrder: id,
  isActive,
  rowVersion: `RV${id}`,
  inUseCount: 0,
});

/** The Lists page (epic #1314): one route, a catalogue of the lists the person may manage, the editor of the open one. */
describe('Administration > Lists page', () => {
  let harness: RouterTestingHarness;
  let calls: string[];
  const SLOW = 20_000;
  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(s: string): T | null => el().querySelector<T>(s);
  const options = (): HTMLElement[] =>
    Array.from(el().querySelectorAll<HTMLElement>('[role="option"]'));
  const optionText = (): string[] =>
    options().map((o) => o.textContent!.replace(/\s+/g, ' ').trim());
  const chip = (key: string): string =>
    el().querySelector(`[data-list="${key}"] [data-count]`)!.textContent!.trim();

  async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  const listing = (name: string, rows: unknown[]) =>
    vi.fn(() => {
      calls.push(name);
      return of(rows);
    });

  async function open(
    url: string,
    permissions: Permission[],
    tweak: (api: Record<string, unknown>) => void = () => undefined,
  ): Promise<Router> {
    calls = [];
    const priorities = new FakePrioritiesClient();
    const statuses = new FakeStatusLabelsClient();
    const roles = new FakeAssetLinkRolesClient();
    const api: Record<string, unknown> = {
      types: {
        listMatterTypes: listing('matter-types', [
          matterItem(1, 'Litigation'),
          matterItem(2, 'Antitrust'),
          matterItem(3, 'Retired', false),
        ]),
      },
      categories: {
        listMatterCategories: listing('matter-categories', [
          matterItem(1, 'Advisory'),
          matterItem(2, 'Dispute', false),
        ]),
      },
      states: { listCurrentStates: listing('current-states', [matterItem(1, 'Intake')]) },
      titles: { listTeamTitles: listing('team-titles', []) },
      services: {
        listVendorServices: listing('vendor-services', [matterItem(1, 'Hosting')]),
      },
      areas: { listVendorAreas: listing('vendor-areas', [matterItem(1, 'Northeast')]) },
      reasons: {
        listOnHoldReasons: listing('on-hold-reasons', [
          { id: 1, name: 'Waiting for client', sortOrder: 1, isActive: true, rowVersion: 'a' },
          { id: 2, name: 'Waiting for vendor', sortOrder: 2, isActive: false, rowVersion: 'b' },
        ]),
      },
      tags: {
        listNoteTags: vi.fn((includeInactive?: boolean) => {
          calls.push(`note-tags:${includeInactive}`);
          return of([
            {
              noteTagId: 1,
              name: 'Hot',
              colourKey: 'red',
              isActive: true,
              visibleNoteCount: 2,
              isInUse: true,
              rowVersion: 'a',
            },
            {
              noteTagId: 2,
              name: 'Old',
              colourKey: 'blue',
              isActive: false,
              visibleNoteCount: 0,
              isInUse: false,
              rowVersion: 'b',
            },
          ]);
        }),
      },
    };
    tweak(api);
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
        { provide: PrioritiesClient, useValue: priorities },
        { provide: StatusLabelsClient, useValue: statuses },
        { provide: AssetLinkRolesClient, useValue: roles },
        { provide: MatterTypesClient, useValue: api['types'] },
        { provide: MatterCategoriesClient, useValue: api['categories'] },
        { provide: CurrentStatesClient, useValue: api['states'] },
        { provide: TeamTitlesClient, useValue: api['titles'] },
        { provide: VendorServicesClient, useValue: api['services'] },
        { provide: VendorAreasClient, useValue: api['areas'] },
        { provide: OnHoldReasonsClient, useValue: api['reasons'] },
        { provide: NoteTagsClient, useValue: api['tags'] },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    await bodyReady();
    return TestBed.inject(Router);
  }

  /** The body of the open list loads lazily (`@defer`): wait until it is mounted and has asked for its rows. */
  async function bodyReady(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const body = el()?.querySelector('[data-list-body]');
      if (!body || body.querySelector('[data-list-body] > *:not(:empty), mf-status-labels-page'))
        break;
      await new Promise((r) => setTimeout(r, 50));
      harness.detectChanges();
    }
    await settle();
  }

  const ALL: Permission[] = [
    'MatterList.Manage',
    'Priority.Manage',
    'StatusLabel.Manage',
    'OnHoldReason.Manage',
    'AssetType.Manage',
    'Vendor.Manage',
    'CustomField.Manage',
  ];

  describe('the page', () => {
    it(
      'has the header, the catalogue with search, five groups and the editor of the open list',
      async () => {
        const router = await open('/admin/lists/priorities', ALL);
        expect(router.url).toBe('/admin/lists/priorities');
        expect(el().querySelector('h1')!.textContent).toContain('Lists');
        expect(el().textContent).toContain('The choices people pick from in forms and filters.');
        expect(
          Array.from(el().querySelectorAll('nav[aria-label="Breadcrumb"] li')).map((li) =>
            li.textContent!.trim(),
          ),
        ).toEqual(['Administration', 'Lists']);
        // Landmarks: the catalogue is an aside named Lists, the editor a region named by its H2.
        expect(q('aside')!.getAttribute('aria-label')).toBe('Lists');
        expect(q('[role="listbox"]')!.getAttribute('aria-label')).toBe('Lists');
        expect(
          Array.from(el().querySelectorAll('[role="group"]')).map((g) =>
            g.firstElementChild!.textContent!.trim(),
          ),
        ).toEqual(['Matter', 'Task', 'Notes', 'Assets', 'Vendors']);
        expect(options().map((o) => o.getAttribute('data-list'))).toEqual(
          ADMIN_LISTS.map((l) => l.key),
        );
        const editor = q('mf-list-editor')!;
        expect(editor.getAttribute('role')).toBe('region');
        expect(document.getElementById(editor.getAttribute('aria-labelledby')!)!.textContent).toBe(
          'Priorities',
        );
        expect(options().filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
        expect(q('[aria-selected="true"]')!.getAttribute('data-list')).toBe('priorities');
        // Search shows because the person manages more than four lists.
        expect(q('input[type="search"]')!.getAttribute('placeholder')).toBe('Find a list');
      },
      SLOW,
    );

    it(
      'shows the editor header: active count badge, the New button last, Shown on, the rule line',
      async () => {
        await open('/admin/lists/priorities', ALL);
        expect(q('h2')!.textContent).toBe('Priorities');
        expect(q('[data-active-count]')!.textContent).toContain('4 active');
        expect(q('[data-new]')!.textContent).toContain('New Priority');
        expect(q('[data-shown-on]')!.textContent).toBe(
          'Shown on: New Task form, task lists (column and filter), Task page.',
        );
        expect(q('[data-rule]')!.textContent).toContain(
          'Order priorities from most to least urgent. Exactly one is the default.',
        );
        expect(q('mf-priorities-page')).not.toBeNull();
      },
      SLOW,
    );

    it(
      'counts the ACTIVE items of every permitted list from its own GET, quietly, once',
      async () => {
        await open('/admin/lists/priorities', ALL);
        expect(chip('matter-types')).toBe('2');
        expect(chip('matter-categories')).toBe('1');
        expect(chip('current-states')).toBe('1');
        expect(chip('team-titles')).toBe('0');
        expect(chip('priorities')).toBe('4');
        // Status Labels have no isActive: all five rows count.
        expect(chip('status-labels')).toBe('5');
        expect(chip('on-hold-reasons')).toBe('1');
        expect(chip('note-tags')).toBe('1');
        expect(chip('link-roles')).toBe('4');
        // Note Tags are asked with includeInactive=true, the only parameter that endpoint takes, and every list is asked once.
        expect(calls.filter((c) => c.startsWith('note-tags'))).toEqual(['note-tags:true']);
        for (const key of [
          'matter-types',
          'matter-categories',
          'current-states',
          'team-titles',
          'on-hold-reasons',
        ]) {
          expect(
            calls.filter((c) => c === key),
            key,
          ).toHaveLength(1);
        }
        expect(optionText()[4]).toContain('Priorities');
      },
      SLOW,
    );

    it(
      'shows -- for a count that failed to load, without a toast or an error in the catalogue',
      async () => {
        await open('/admin/lists/priorities', ALL, (api) => {
          (api['states'] as { listCurrentStates: unknown }).listCurrentStates = vi.fn(() =>
            throwError(() => new Error('down')),
          );
        });
        expect(chip('current-states')).toBe('--');
        expect(chip('matter-types')).toBe('2');
        expect(document.body.querySelector('.p-toast-message')).toBeNull();
      },
      SLOW,
    );

    it(
      'switches list by click: the address follows, the editor changes, the catalogue stays',
      async () => {
        const router = await open('/admin/lists/priorities', ALL);
        const catalogue = q('mf-list-catalogue');
        el().querySelector<HTMLElement>('[data-list="on-hold-reasons"]')!.click();
        await settle();
        await bodyReady();
        expect(router.url).toBe('/admin/lists/on-hold-reasons');
        expect(q('mf-list-catalogue')).toBe(catalogue);
        expect(q('h2')!.textContent).toBe('On-Hold Reasons');
        expect(q('mf-on-hold-reasons-page')).not.toBeNull();
        expect(q('mf-priorities-page')).toBeNull();
        expect(q('[data-new]')!.textContent).toContain('New Reason');
        expect(document.title).toContain('Lists: On-Hold Reasons');
      },
      SLOW,
    );

    it(
      'gives Status Labels no New button',
      async () => {
        await open('/admin/lists/status-labels', ALL);
        expect(q('h2')!.textContent).toBe('Status Labels');
        expect(q('[data-new]')).toBeNull();
        expect(q('mf-status-labels-page')).not.toBeNull();
        // The five statuses have no active state: the badge counts statuses, not "active" ones.
        expect(q('[data-active-count]')!.textContent).toContain('5 statuses');
        expect(q('[data-active-count]')!.textContent).not.toContain('active');
      },
      SLOW,
    );

    it(
      'offers the Custom Fields pointer at the foot of the catalogue with CustomField.Manage only',
      async () => {
        await open('/admin/lists/priorities', ALL);
        const pointer = q('[data-fields-pointer]')!;
        expect(pointer.textContent).toContain('Need a new field instead?');
        const link = pointer.querySelector<HTMLAnchorElement>('a')!;
        expect(link.textContent).toContain('Open Custom Fields');
        expect(link.getAttribute('href')).toBe('/admin/custom-fields');
        TestBed.resetTestingModule();
        await open(
          '/admin/lists/priorities',
          ALL.filter((p) => p !== 'CustomField.Manage'),
        );
        expect(q('[data-fields-pointer]')).toBeNull();
      },
      SLOW,
    );
  });

  describe('permission views (UI spec 3.4)', () => {
    it(
      'shows two to four lists as a catalogue without the search box, with only the permitted groups',
      async () => {
        await open('/admin/lists/matter-types', ['MatterList.Manage']);
        expect(options().map((o) => o.getAttribute('data-list'))).toEqual([
          'matter-types',
          'matter-categories',
          'current-states',
          'team-titles',
        ]);
        expect(el().querySelectorAll('[role="group"]')).toHaveLength(1);
        expect(q('input[type="search"]')).toBeNull();
        expect(q('[data-active-count]')!.textContent).toContain('2 active');
        expect(q('[data-new]')!.textContent).toContain('New Matter Type');
      },
      SLOW,
    );

    it(
      'shows exactly one list as the editor alone: no catalogue, the H1 stays Lists',
      async () => {
        await open('/admin/lists/priorities', ['Priority.Manage', 'CustomField.Manage']);
        expect(q('aside')).toBeNull();
        expect(q('[role="listbox"]')).toBeNull();
        expect(q('h1')!.textContent).toContain('Lists');
        expect(q('h2')!.textContent).toBe('Priorities');
        // The pointer is one muted line at the foot of the editor pane, only with CustomField.Manage.
        expect(q('[data-fields-pointer]')!.textContent).toContain('Need a new field instead?');
        // Only the permitted list is ever requested.
        expect(calls).toEqual([]);
      },
      SLOW,
    );

    it(
      'treats Note Tags as StatusLabel.Manage and Link Roles as AssetType.Manage',
      async () => {
        await open('/admin/lists/note-tags', ['StatusLabel.Manage']);
        expect(options().map((o) => o.getAttribute('data-list'))).toEqual([
          'status-labels',
          'note-tags',
        ]);
        TestBed.resetTestingModule();
        await open('/admin/lists/link-roles', ['AssetType.Manage']);
        expect(q('aside')).toBeNull();
        expect(q('h2')!.textContent).toBe('Link Roles');
        expect(q('mf-asset-link-roles-page')).not.toBeNull();
      },
      SLOW,
    );

    it(
      'sends /admin/lists, an unknown key and a list the person may not manage to the first permitted list',
      async () => {
        let router = await open('/admin/lists', ['OnHoldReason.Manage', 'AssetType.Manage']);
        expect(router.url).toBe('/admin/lists/on-hold-reasons');
        TestBed.resetTestingModule();
        router = await open('/admin/lists/nope', ALL);
        expect(router.url).toBe('/admin/lists/matter-types');
        TestBed.resetTestingModule();
        router = await open('/admin/lists/priorities', ['MatterList.Manage']);
        expect(router.url).toBe('/admin/lists/matter-types');
      },
      SLOW,
    );

    it(
      'shows the 403 page to a person who manages no list',
      async () => {
        const router = await open('/admin/lists/priorities', ['Task.View']);
        expect(router.url).toBe('/403');
      },
      SLOW,
    );
  });

  describe('Find a list (UI spec 3.3)', () => {
    async function type(text: string): Promise<void> {
      const input = q<HTMLInputElement>('input[type="search"]')!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 350));
      await settle();
    }

    it(
      'matches the label, the group, the hint and the Shown on text, ignoring case, and hides empty groups',
      async () => {
        await open('/admin/lists/priorities', ALL);
        await type('PRIOR');
        expect(options().map((o) => o.getAttribute('data-list'))).toEqual(['priorities']);
        expect(el().querySelectorAll('[role="group"]')).toHaveLength(1);
        await type('matter form');
        expect(options().map((o) => o.getAttribute('data-list'))).toEqual([
          'matter-types',
          'matter-categories',
          'current-states',
        ]);
        await type('assets');
        expect(options().map((o) => o.getAttribute('data-list'))).toEqual(['link-roles']);
        // The open list stays open while the search hides it.
        expect(q('h2')!.textContent).toBe('Priorities');
        expect(q('[data-catalogue-live]')!.textContent!.trim()).toBe('1 list');
      },
      SLOW,
    );

    it(
      'says No list matches, and with CustomField.Manage points to Custom Fields',
      async () => {
        await open('/admin/lists/priorities', ALL);
        await type('zzz');
        expect(options()).toHaveLength(0);
        const box = q('[data-no-match]')!;
        expect(box.textContent).toContain('No list matches "zzz".');
        expect(box.textContent).toContain(
          'Looking for a new field on a client, matter or project? That is Custom Fields.',
        );
        expect(box.querySelector('a')!.textContent).toContain('Open Custom Fields');
        TestBed.resetTestingModule();
        await open(
          '/admin/lists/priorities',
          ALL.filter((p) => p !== 'CustomField.Manage'),
        );
        await type('zzz');
        expect(q('[data-no-match]')!.textContent).toContain(
          'Try the name of the dropdown or where it shows, such as "matter form".',
        );
        expect(q('[data-no-match] a')).toBeNull();
      },
      SLOW,
    );
  });

  describe('old addresses (UI spec 6.2 and 6.3)', () => {
    const OLD: [string, AdminListKey, string, Permission][] = [
      ['/admin/priorities', 'priorities', 'Priorities', 'Priority.Manage'],
      ['/admin/status-labels', 'status-labels', 'Status Labels', 'StatusLabel.Manage'],
      ['/admin/on-hold-reasons', 'on-hold-reasons', 'On-Hold Reasons', 'OnHoldReason.Manage'],
      ['/admin/note-tags', 'note-tags', 'Note Tags', 'StatusLabel.Manage'],
      ['/admin/matter-types', 'matter-types', 'Matter Types', 'MatterList.Manage'],
      ['/admin/current-states', 'current-states', 'Current States', 'MatterList.Manage'],
      ['/admin/team-titles', 'team-titles', 'Team Titles', 'MatterList.Manage'],
      ['/admin/asset-link-roles', 'link-roles', 'Link Roles', 'AssetType.Manage'],
      ['/admin/asset-types?tab=link-roles', 'link-roles', 'Link Roles', 'AssetType.Manage'],
    ];

    for (const [old, key, label, permission] of OLD) {
      it(
        `${old} goes to /admin/lists/${key} and says so once`,
        async () => {
          const router = await open(old, [permission]);
          // The marker is read once and leaves the address.
          expect(router.url).toBe(`/admin/lists/${key}`);
          const group = ADMIN_LISTS.find((l) => l.key === key)!.group;
          const banner = q('[data-moved-banner]')!;
          expect(banner.getAttribute('role')).toBe('status');
          expect(banner.classList.contains('pg-banner--info')).toBe(true);
          expect(banner.textContent).toContain(
            `${label} has moved here, under Lists > ${group}. Update your bookmark.`,
          );
          expect(q('h2')!.textContent).toBe(label);
        },
        SLOW,
      );
    }

    it(
      'keeps ?edit and nothing else, and opens the dialog of the row',
      async () => {
        const router = await open('/admin/priorities?edit=new&junk=1', ['Priority.Manage']);
        expect(router.url).toBe('/admin/lists/priorities?edit=new');
        expect(document.body.querySelector('[data-lookup-title]')!.textContent).toContain(
          'New Priority',
        );
        TestBed.resetTestingModule();
        const again = await open('/admin/asset-link-roles?edit=new', ['AssetType.Manage']);
        expect(again.url).toBe('/admin/lists/link-roles?edit=new');
      },
      SLOW,
    );

    it(
      'dismisses the notice with Dismiss and does not store it',
      async () => {
        await open('/admin/priorities', ['Priority.Manage', 'MatterList.Manage']);
        expect(q('[data-moved-banner]')).not.toBeNull();
        q<HTMLButtonElement>('[data-moved-banner] [data-dismiss]')!.click();
        await settle();
        expect(q('[data-moved-banner]')).toBeNull();
        // A new arrival at a Lists address (not an old one) shows no notice.
        TestBed.resetTestingModule();
        await open('/admin/lists/priorities', ['Priority.Manage', 'MatterList.Manage']);
        expect(q('[data-moved-banner]')).toBeNull();
      },
      SLOW,
    );

    it(
      'shows no notice and lands on the first list when the person may not manage the old list',
      async () => {
        const router = await open('/admin/priorities', ['MatterList.Manage']);
        expect(router.url).toBe('/admin/lists/matter-types');
        expect(q('[data-moved-banner]')).toBeNull();
      },
      SLOW,
    );

    it(
      'replaces the old address in the history, so Back does not loop',
      async () => {
        const router = await open('/admin/priorities', ['Priority.Manage', 'MatterList.Manage']);
        expect(router.url).toBe('/admin/lists/priorities');
        // Only the Lists address is in the browser history for this arrival (the old one was replaced).
        expect(history.length).toBeLessThan(5);
      },
      SLOW,
    );
  });

  describe('unsaved text (D-31)', () => {
    it(
      'asks the standard question when leaving with an edited dialog open, and not for an untouched one',
      async () => {
        const router = await open('/admin/lists/on-hold-reasons?edit=new', ALL);
        const ask = vi.spyOn(TestBed.inject(LeaveConfirmService), 'ask').mockResolvedValue(false);
        await router.navigateByUrl('/403');
        await settle();
        expect(ask).not.toHaveBeenCalled();
        expect(router.url).toBe('/403');
        TestBed.resetTestingModule();

        const second = await open('/admin/lists/on-hold-reasons?edit=new', ALL);
        const ask2 = vi.spyOn(TestBed.inject(LeaveConfirmService), 'ask').mockResolvedValue(false);
        const name = document.body.querySelector<HTMLInputElement>('input#on-hold-reason-name')!;
        name.value = 'Half typed';
        name.dispatchEvent(new Event('input'));
        await settle();
        await second.navigateByUrl('/403');
        await settle();
        expect(ask2).toHaveBeenCalledTimes(1);
        expect(second.url).toBe('/admin/lists/on-hold-reasons?edit=new');
        ask2.mockResolvedValue(true);
        await second.navigateByUrl('/403');
        await settle();
        expect(second.url).toBe('/403');
      },
      SLOW,
    );
  });

  describe('one smoke test per list', () => {
    for (const def of ADMIN_LISTS) {
      it(
        `${def.label}: opens, loads its rows and shows its header, sentence and rule`,
        async () => {
          const router = await open(`/admin/lists/${def.key}`, ALL);
          expect(router.url).toBe(`/admin/lists/${def.key}`);
          expect(q('h2')!.textContent).toBe(def.label);
          expect(q('[data-shown-on]')!.textContent).toBe(def.shownOn);
          expect(q('[data-rule]')!.textContent).toContain(def.rule);
          expect(q('[data-new]') !== null).toBe(def.newLabel !== null);
          expect(q('[data-active-count]')).not.toBeNull();
          expect(el().querySelectorAll('tbody tr, [role="row"]').length).toBeGreaterThan(0);
          expect(document.title).toContain(`Lists: ${def.label}`);
        },
        SLOW,
      );
    }
  });
});
