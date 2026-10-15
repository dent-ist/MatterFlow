import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { StepDefinitionsClient, WorkflowsClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { ADMIN_NAV_ITEMS } from '../../../shared/layout/nav-items';
import { iconForPath } from '../../../shared/layout/section-icons';
import { ADMIN_ROUTES } from '../admin.routes';

const empty = { items: [], total: 0, page: 1, pageSize: 25 };

describe('Workflows page tabs (Workflows, Workflow Steps)', () => {
  let harness: RouterTestingHarness;
  let steps: {
    listStepDefinitions: ReturnType<typeof vi.fn>;
    listStepTags: ReturnType<typeof vi.fn>;
  };
  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const tabs = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[role="tab"]'));
  const selected = (): string[] =>
    tabs()
      .filter((t) => t.getAttribute('aria-selected') === 'true')
      .map((t) => t.textContent!.trim());
  const crumbs = (): string[] =>
    Array.from(el().querySelectorAll('nav[aria-label="Breadcrumb"] li')).map((li) =>
      li.textContent!.trim(),
    );

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  async function open(url: string, ...permissions: Permission[]): Promise<Router> {
    steps = {
      listStepDefinitions: vi.fn().mockReturnValue(of(empty)),
      listStepTags: vi.fn().mockReturnValue(of([{ name: 'Relativity', stepCount: 2 }])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'admin', children: ADMIN_ROUTES },
            { path: '403', children: [] },
          ],
          withComponentInputBinding(),
        ),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        {
          provide: WorkflowsClient,
          useValue: { listWorkflows: vi.fn().mockReturnValue(of(empty)) },
        },
        { provide: StepDefinitionsClient, useValue: steps },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    return TestBed.inject(Router);
  }

  it('is one navigation item, Workflows, that stays highlighted on the steps URLs', () => {
    const labels = ADMIN_NAV_ITEMS.map((i) => i.label);
    expect(labels).toEqual([
      'Users',
      'Pods',
      'Task Types & Forms',
      'Workflows',
      'Labels',
      'Assets',
      'Custom Fields',
      'Audit Logs',
    ]);
    const item = ADMIN_NAV_ITEMS.find((i) => i.label === 'Workflows')!;
    expect(item.path).toBe('/admin/workflows');
    expect(item.alsoActive).toEqual(['/admin/steps']);
    expect(item.permissions).toEqual(['Workflow.Manage']);
    for (const path of ['/admin/steps', '/admin/steps/new', '/admin/steps/4/form']) {
      expect(iconForPath(path)).toBe(item.icon);
    }
  });

  it('opens the Workflows tab on /admin/workflows with the section icon and breadcrumb', async () => {
    await open('/admin/workflows', 'Workflow.Manage');
    expect(el().querySelector('h1')!.textContent).toContain('Workflows');
    expect(el().querySelector('[data-page-icon]')?.className).toContain('pi-share-alt');
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['Workflows', 'Workflow Steps']);
    expect(selected()).toEqual(['Workflows']);
    expect(crumbs()).toEqual(['Administration', 'Workflows']);
    expect(el().querySelector('#wf-search')).not.toBeNull();
    expect(el().querySelector('#step-search')).toBeNull();
    expect(
      Array.from(el().querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'New workflow',
      ),
    ).toBe(true);
  });

  it('opens the Workflow Steps tab on /admin/steps and keeps the address in step with the tab', async () => {
    const router = await open('/admin/steps', 'Workflow.Manage');
    expect(selected()).toEqual(['Workflow Steps']);
    expect(crumbs()).toEqual(['Administration', 'Workflows', 'Workflow Steps']);
    expect(el().querySelector('#step-search')).not.toBeNull();
    expect(
      Array.from(el().querySelectorAll('button')).some((b) => b.textContent?.trim() === 'New step'),
    ).toBe(true);
    expect(el().querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
      'workflows-admin-tab-steps',
    );

    tabs()[0].click();
    await settle();
    expect(router.url).toBe('/admin/workflows');
    expect(selected()).toEqual(['Workflows']);

    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(router.url).toBe('/admin/steps');
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0]);
  });

  it('hands the tag filter in the address to the step list', async () => {
    await open('/admin/steps?tags=Relativity&tags=QC&tagMatch=any&q=load', 'Workflow.Manage');
    expect(steps.listStepDefinitions).toHaveBeenLastCalledWith(
      undefined,
      'load',
      ['Relativity', 'QC'],
      'any',
      true,
      1,
      25,
    );
    const radios = Array.from(el().querySelectorAll<HTMLInputElement>('.tf__radio input'));
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
  });

  it('needs Workflow.Manage for both tabs', async () => {
    const router = await open('/admin/steps', 'Pod.Manage');
    expect(router.url).toBe('/403');
    await harness.navigateByUrl('/admin/workflows');
    await settle();
    expect(router.url).toBe('/403');
  });

  it('uses the page name plus the open tab as the document title', async () => {
    const titleOf = async (url: string) => {
      const router = TestBed.inject(Router);
      await harness.navigateByUrl(url);
      await settle();
      let route = router.routerState.snapshot.root;
      while (route.firstChild) route = route.firstChild;
      return route.title;
    };
    await open('/admin/workflows', 'Workflow.Manage');
    expect(await titleOf('/admin/workflows')).toBe('Workflows');
    expect(await titleOf('/admin/steps')).toBe('Workflows - Workflow Steps');
    expect(await titleOf('/admin/steps/new')).toBe('New step');
  });
});
