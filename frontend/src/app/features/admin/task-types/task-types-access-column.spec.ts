import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { StubWorkflowLookup, WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { ddSelect } from '../../../testing/dropdown-testing.spec-util';
import { InMemoryTaskTypesApi } from './in-memory-task-types-api';
import { TaskTypesPage } from './task-types-page';
import { TaskTypesApi } from './task-types-api';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
  await fixture.whenStable();
}

/**
 * The Access column, filter, sort, strip chip and banner of the Task Types list (#1402). Three types: Alpha (open), Bravo (restricted to Attorney and Partner, with
 * Partner the only role that can edit) and Charlie (restricted, but only to the inactive Vendor Liaison role).
 */
describe('TaskTypesPage: Access (#1402)', () => {
  let fixture: ComponentFixture<TaskTypesPage>;
  let api: InMemoryTaskTypesApi;
  const el = (): HTMLElement => fixture.nativeElement;
  const row = (name: string): HTMLElement =>
    el().querySelector(`td[data-row="${name}"]`)!.closest('tr')!;
  const names = (): string[] =>
    Array.from(el().querySelectorAll('tbody td[data-row]')).map((c) => c.getAttribute('data-row')!);

  async function create(name: string, canView: number[], canEdit: number[] = []): Promise<void> {
    const t = await new Promise<{ id: number; rowVersion: string }>((r) =>
      api.create({ name, description: undefined }).subscribe(r),
    );
    if (canView.length || canEdit.length) api.setAccess(t.id, { canView, canEdit });
  }

  async function open(enforced: boolean): Promise<void> {
    api = new InMemoryTaskTypesApi();
    api.enforced = enforced;
    await create('Alpha', []);
    await create('Bravo', [1, 4], [4]);
    await create('Charlie', [6]);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: TaskTypesApi, useValue: api },
        { provide: WorkflowLookup, useClass: StubWorkflowLookup },
        provideFakeMe(new FakeMeApi(withPermissions('TaskType.Manage', 'Workflow.Manage'))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
  }

  afterEach(() => document.body.querySelectorAll('.mf-tip, .dd-panel').forEach((n) => n.remove()));

  describe('the column', () => {
    beforeEach(() => open(true));

    it('comes after Request Form, and Target (Days) is hidden by default', () => {
      const heads = Array.from(el().querySelectorAll('thead tr:first-child th')).map((th) =>
        th.textContent!.trim(),
      );
      expect(heads).toEqual([
        'Name',
        'Default Workflow',
        'Request Form',
        'Access',
        'Workflows',
        'Status',
        'Actions',
      ]);
    });

    it('says Everyone in plain muted words for an open type', () => {
      const cell = row('Alpha').querySelector('[data-access]')!;
      expect(cell.textContent!.trim()).toBe('Everyone');
      expect(cell.querySelector('button')).toBeNull();
      expect(cell.querySelector('.muted')).not.toBeNull();
    });

    it('shows a slate lock chip "Restricted N" with the number of roles that can view', () => {
      const chip = row('Bravo').querySelector<HTMLButtonElement>('[data-access-chip]')!;
      expect(chip.textContent!.replace(/\s+/g, ' ').trim()).toBe('Restricted 2');
      expect(chip.querySelector('.pi-lock')).not.toBeNull();
      expect(chip.querySelector('[data-tone="neutral"]')).not.toBeNull();
      expect(chip.getAttribute('aria-label')).toContain('Bravo');
    });

    it('turns amber with a triangle when every View role is inactive', () => {
      const chip = row('Charlie').querySelector('[data-access-chip]')!;
      expect(chip.querySelector('[data-tone="warning"]')).not.toBeNull();
      expect(chip.querySelector('.pi-exclamation-triangle')).not.toBeNull();
    });

    it('lists the three lists in the tooltip, on focus too', async () => {
      const chip = row('Bravo').querySelector<HTMLButtonElement>('[data-access-chip]')!;
      chip.dispatchEvent(new Event('focus'));
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 700));
      const tip = document.body.querySelector('[role=tooltip]')!;
      expect(tip.textContent).toContain('Can View: Attorney, Partner');
      expect(tip.textContent).toContain('Can Edit: Partner');
      expect(tip.textContent).toContain('Can Be Assigned: no extra limit');
      expect(tip.textContent).not.toContain('not enforced');
    });

    it('opens the Access tab of the type from the chip, remembering the row', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      row('Bravo').querySelector<HTMLButtonElement>('[data-access-chip]')!.click();
      const [commands, extras] = navigate.mock.calls[0];
      expect(commands[0]).toBe('/admin/task-types');
      expect(extras).toMatchObject({ queryParams: { tab: 'access' } });
    });

    it('has no banner while the server enforces the rules', () => {
      expect(el().querySelector('[data-not-enforced-banner]')).toBeNull();
    });
  });

  describe('the filter, the sort and the strip', () => {
    beforeEach(() => open(true));

    it('filters by Access with All Access, Everyone and Restricted', async () => {
      expect(ddSelect(el(), 'Filter by Access').value).toBe('');
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/admin/task-types?access=restricted');
      await settle(fixture);
      expect(names()).toEqual(['Bravo', 'Charlie']);
      expect(ddSelect(el(), 'Filter by Access').value).toBe('restricted');
      await router.navigateByUrl('/admin/task-types?access=everyone');
      await settle(fixture);
      expect(names()).toEqual(['Alpha', 'Data Processing']);
    });

    it('sorts Restricted first on the first click of the heading (the busiest first, like the counts)', async () => {
      expect(el().querySelector('th[data-col="access"] button')).not.toBeNull();
      fixture.componentRef.setInput('sort', '-access');
      await settle(fixture);
      expect(names().slice(0, 2)).toEqual(['Bravo', 'Charlie']);
    });

    it('counts Restricted in the strip and the chip puts the filter in the address', async () => {
      const item = el().querySelector('[data-strip-item="restricted"]')!;
      expect(item.querySelector('.n')!.textContent!.trim()).toBe('2');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { status: null, form: null, access: 'restricted', usable: null, page: null },
        queryParamsHandling: 'merge',
      });
    });
  });

  describe('while the server does not enforce the rules', () => {
    beforeEach(() => open(false));

    it('shows the amber banner with the number of restricted types', () => {
      const banner = el().querySelector('[data-not-enforced-banner]')!;
      expect(banner.textContent!.replace(/\s+/g, ' ')).toContain(
        'Access rules are saved but not enforced yet. 2 restricted task types are still visible to everyone until Task Type Access is switched on.',
      );
      expect(banner.querySelector('.pi-exclamation-triangle')).not.toBeNull();
    });

    it('adds "Saved, but not enforced yet." to the tooltip', async () => {
      const chip = row('Bravo').querySelector<HTMLButtonElement>('[data-access-chip]')!;
      chip.dispatchEvent(new Event('focus'));
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 700));
      expect(document.body.querySelector('[role=tooltip]')!.textContent).toContain(
        'Saved, but not enforced yet.',
      );
    });
  });

  it('has no banner when no type is restricted, even with the switch off', async () => {
    api = new InMemoryTaskTypesApi();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: TaskTypesApi, useValue: api },
        { provide: WorkflowLookup, useClass: StubWorkflowLookup },
        provideFakeMe(new FakeMeApi(withPermissions('TaskType.Manage', 'Workflow.Manage'))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
    expect(el().querySelector('[data-not-enforced-banner]')).toBeNull();
    expect(el().querySelector('[data-access-chip]')).toBeNull();
  });
});
