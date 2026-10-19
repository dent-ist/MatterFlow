import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { MattersClient, ProjectsClient, TaskQueueClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import {
  FakeMeApi,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../testing/org-testing';
import { ScopedTasks } from './scoped-tasks';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
  provideQueueChoices,
} from './work-queue-testing';

const SUMMARY = { openTasks: 9, overdue: 3, dueSoon: 1, asap: 1, onHold: 1 };

describe('ScopedTasks', () => {
  let queue: { getTaskQueue: ReturnType<typeof vi.fn> };
  let matters: { getMatterSummary: ReturnType<typeof vi.fn> };
  let projects: { getProjectSummary: ReturnType<typeof vi.fn> };
  let query: ReturnType<typeof fakeQuery>;
  let navigate: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ScopedTasks>;
  const el = (): HTMLElement => fixture.nativeElement;
  const text = (e: Element | null): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function create(
    permissions: Permission[],
    inputs: Record<string, unknown> = {},
    params: Record<string, string> = {},
  ): Promise<void> {
    localStorage.clear();
    query = fakeQuery();
    query.set(params);
    queue = {
      getTaskQueue: vi
        .fn()
        .mockReturnValue(ok(pageOf([aRow({ projectId: 3, projectName: 'Wave 1' })]))),
    };
    matters = { getMatterSummary: vi.fn().mockReturnValue(ok({ matterId: 7, ...SUMMARY })) };
    projects = { getProjectSummary: vi.fn().mockReturnValue(ok({ projectId: 3, ...SUMMARY })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: TaskQueueClient, useValue: queue },
        { provide: MattersClient, useValue: matters },
        { provide: ProjectsClient, useValue: projects },
        ...provideLookups(),
        ...provideQueueChoices(),
        ...provideClock('2026-10-14T15:00:00Z', 'America/Chicago'),
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(ScopedTasks);
    fixture.componentRef.setInput('matterId', 7);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await settle(fixture);
  }

  /** Arguments of the last task-queue request, by the generated client's order (group first). */
  const args = () => queue.getTaskQueue.mock.lastCall!;
  const STATUS = 2;
  const ASAP = 18;
  const OVERDUE = 19;
  const DUE_FROM = 16;
  const DUE_TO = 17;

  const items = () => Array.from(el().querySelectorAll<HTMLElement>('button[data-strip-item]'));

  it('shows the five strip items in toggle mode above the grid, from the matter summary', async () => {
    await create(['Task.View']);
    expect(matters.getMatterSummary).toHaveBeenCalledWith(7);
    expect(items().map((b) => text(b))).toEqual([
      'Open 9',
      'Overdue 3',
      'Due soon 1',
      'ASAP 1',
      'On hold 1',
    ]);
    // Open is the grid's default and shows as pressed; no other item does.
    expect(items().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    const strip = el().querySelector('mf-summary-strip')!;
    const table = el().querySelector('mf-task-table')!;
    expect(strip.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks a project summary for a project grid', async () => {
    await create(['Task.View'], { projectId: 3 });
    expect(projects.getProjectSummary).toHaveBeenCalledWith(3);
    expect(matters.getMatterSummary).not.toHaveBeenCalled();
  });

  it('has no strip and asks for no numbers without Task.View', async () => {
    await create([]);
    expect(el().querySelector('mf-summary-strip')).toBeNull();
    expect(matters.getMatterSummary).not.toHaveBeenCalled();
    expect(el().querySelector('[data-no-access=tasks]')).not.toBeNull();
  });

  it('a click puts the view in the address, a second click and Open take it out; sort and other filters stay', async () => {
    await create(['Task.View']);
    items()[1].click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { view: 'overdue' },
      queryParamsHandling: 'merge',
    });
    query.set({ view: 'overdue' });
    await settle(fixture);
    expect(items()[1].getAttribute('aria-pressed')).toBe('true');
    expect(items()[0].getAttribute('aria-pressed')).toBe('false');
    items()[1].click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { view: null },
      queryParamsHandling: 'merge',
    });
    // Another item replaces the pressed one; Open clears.
    items()[3].click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { view: 'asap' },
      queryParamsHandling: 'merge',
    });
    items()[0].click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { view: null },
      queryParamsHandling: 'merge',
    });
  });

  it('loads the grid with the filters of the view in the address, as the Task Queue quick view does', async () => {
    await create(['Task.View'], {}, { view: 'overdue' });
    expect(args()[STATUS]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
    expect(args()[OVERDUE]).toBe(true);
    expect(args()[ASAP]).toBeUndefined();

    query.set({ view: 'onHold' });
    await settle(fixture);
    expect(args()[STATUS]).toEqual(['ON_HOLD']);
    expect(args()[OVERDUE]).toBeUndefined();

    query.set({ view: 'dueSoon' });
    await settle(fixture);
    expect(args()[STATUS]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
    expect(args()[ASAP]).toBe(false);
    expect(args()[OVERDUE]).toBe(false);
    expect(args()[DUE_FROM]).toBeUndefined();
    expect(args()[DUE_TO]).toBe('2026-10-16');

    query.set({ view: 'asap' });
    await settle(fixture);
    expect(args()[ASAP]).toBe(true);
  });

  it('ignores an unknown view', async () => {
    await create(['Task.View'], {}, { view: 'nonsense' });
    expect(args()[OVERDUE]).toBeUndefined();
    expect(args()[ASAP]).toBeUndefined();
    expect(items()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('says which total it is: a pressed view counts as narrowed for the page tab count', async () => {
    const loaded = vi.fn();
    await create(['Task.View'], {}, { view: 'overdue' });
    fixture.componentInstance.loaded.subscribe(loaded);
    await fixture.componentInstance.load();
    expect(loaded).toHaveBeenLastCalledWith({ total: 1, filtered: true });
    query.reset();
    await settle(fixture);
    expect(loaded).toHaveBeenLastCalledWith({ total: 1, filtered: false });
  });

  it('reports the open count of the summary for the page tab', async () => {
    const opened = vi.fn();
    localStorage.clear();
    await create(['Task.View']);
    fixture.componentInstance.opened.subscribe(opened);
    // A second summary (after an edit) is reported again.
    fixture.componentRef.setInput('matterId', 8);
    await settle(fixture);
    expect(opened).toHaveBeenCalledWith(9);
  });

  it('shows the Project column only for a matter that has projects', async () => {
    await create(['Task.View'], { projectCount: 0 });
    expect(el().querySelector('th[data-col=project], [data-col=project]')).toBeNull();
    expect(text(el().querySelector('thead'))).not.toContain('Project');

    TestBed.resetTestingModule();
    await create(['Task.View'], { projectCount: 2 });
    expect(text(el().querySelector('thead'))).toContain('Project');
  });

  it('draws the project name on one line with a tooltip, a link with Project.View', async () => {
    await create(['Task.View', 'Project.View'], { projectCount: 2 });
    const cell = el().querySelector('mf-project-cell')!;
    expect(text(cell)).toBe('Wave 1');
    expect(cell.querySelector('a')!.getAttribute('title')).toBe('Wave 1');
    expect(cell.querySelector('a')!.getAttribute('href')).toBe('/projects/3');

    TestBed.resetTestingModule();
    await create(['Task.View'], { projectCount: 2 });
    expect(el().querySelector('mf-project-cell a')).toBeNull();
    expect(el().querySelector('mf-project-cell span')!.getAttribute('title')).toBe('Wave 1');
  });

  it('task links carry the origin and name their list for Back: a matter grid and a project grid (T9, #324)', async () => {
    await create(['Task.View']);
    const link = el().querySelector<HTMLAnchorElement>('a.wt-title')!;
    expect(link.getAttribute('href')).toContain('from=matter');
    expect(link.getAttribute('data-row-list')).toBe('matter-tasks');
    expect(link.getAttribute('data-row-key')).toBe(String(aRow().taskId));
    TestBed.resetTestingModule();
    await create(['Task.View'], { projectId: 3 });
    const project = el().querySelector<HTMLAnchorElement>('a.wt-title')!;
    expect(project.getAttribute('href')).toContain('from=project');
    expect(project.getAttribute('data-row-list')).toBe('project-tasks');
  });

  it('disables Status while a view is pressed, and Due for Due soon', async () => {
    await create(['Task.View'], {}, { view: 'dueSoon' });
    fixture.componentInstance['filters'].open.set(true);
    await settle(fixture);
    const disabled = Array.from(
      el().querySelectorAll('[data-filter-disabled], [aria-disabled=true]'),
    );
    expect(disabled.length).toBeGreaterThan(0);
  });
});
