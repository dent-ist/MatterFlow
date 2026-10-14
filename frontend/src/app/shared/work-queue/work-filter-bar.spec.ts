import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  BuiltInViewKey,
  ChipNames,
  OPEN_STATUSES,
  QueueFilters,
  emptyFilters,
} from './queue-filters';
import { SEARCH_DEBOUNCE_MS, WorkFilterBar } from './work-filter-bar';
import { provideLookups } from './work-queue-testing';

const names: ChipNames = {
  statusLabel: (c) => c,
  priorityLabel: (id) => `P${id}`,
  podName: (id) => `Pod ${id}`,
  userName: (id) => (id === 9 ? 'Me' : `User ${id}`),
  clientName: (id) => `Client ${id}`,
  matterName: (id) => `Matter ${id}`,
  projectName: (id) => `Project ${id}`,
  typeName: (id) => `Type ${id}`,
  workflowName: (id) => `Workflow ${id}`,
};

describe('WorkFilterBar', () => {
  let fixture: ComponentFixture<WorkFilterBar>;
  let changes: QueueFilters[];
  let views: BuiltInViewKey[];
  let cleared: number;
  const el = () => fixture.nativeElement as HTMLElement;

  async function create(
    filters: QueueFilters = emptyFilters(),
    inputs: Record<string, unknown> = {},
  ) {
    TestBed.configureTestingModule({ providers: [...provideLookups()] });
    fixture = TestBed.createComponent(WorkFilterBar);
    fixture.componentRef.setInput('filters', filters);
    fixture.componentRef.setInput('names', names);
    fixture.componentRef.setInput('userId', 9);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    changes = [];
    views = [];
    cleared = 0;
    fixture.componentInstance.filtersChange.subscribe((f) => changes.push(f));
    fixture.componentInstance.viewSelect.subscribe((v) => views.push(v));
    fixture.componentInstance.clearAll.subscribe(() => cleared++);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const openPanel = () => {
    el().querySelector<HTMLButtonElement>('.fb-button')!.click();
    fixture.detectChanges();
  };
  const type = (selector: string, value: string) => {
    const input = el().querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  afterEach(() => vi.useRealTimers());

  it('debounces the search box and emits the final text once', async () => {
    await create();
    vi.useFakeTimers();
    type('#fb-q', 'de');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50);
    type('#fb-q', ' dedup ');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes.length).toBe(1);
    expect(changes[0].q).toBe('dedup');
  });

  it('searches at once on Enter and does not search twice', async () => {
    await create();
    vi.useFakeTimers();
    const box = el().querySelector<HTMLInputElement>('#fb-q')!;
    box.value = 'TSK-10';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(changes.map((c) => c.q)).toEqual(['TSK-10']);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(changes.length).toBe(1);
  });

  it('labels the search box and shows how many filters are active', async () => {
    await create({ ...emptyFilters(), status: [...OPEN_STATUSES], overdue: true });
    expect(el().querySelector('label[for="fb-q"]')!.textContent).toContain('Search title or ref');
    expect(el().querySelector('.fb-button')!.textContent).toContain('Filters (2)');
  });

  it('opens and closes the filter panel and tells assistive technology', async () => {
    await create();
    const button = el().querySelector<HTMLButtonElement>('.fb-button')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(el().querySelector('#fb-panel')).toBeNull();
    openPanel();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('#fb-panel')).not.toBeNull();
  });

  it('toggles statuses and priorities from labelled checkboxes', async () => {
    await create();
    openPanel();
    const labels = Array.from(el().querySelectorAll('.fb-check')).map((l) => l.textContent?.trim());
    expect(labels).toEqual(
      expect.arrayContaining(['New', 'In Progress', 'On Hold', 'Completed', 'Cancelled']),
    );
    expect(labels).toEqual(expect.arrayContaining(['Critical', 'High', 'Normal', 'Low']));

    const check = (label: string) =>
      Array.from(el().querySelectorAll<HTMLLabelElement>('.fb-check'))
        .find((l) => l.textContent?.trim() === label)!
        .querySelector('input')!;
    check('On Hold').click();
    check('High').click();
    expect(changes[0].status).toEqual(['ON_HOLD']);
    expect(changes[1].priority).toEqual([2]);
  });

  it('sets assignee to me or unassigned, and the overdue and ASAP tri-states', async () => {
    await create();
    openPanel();
    const select = (id: string, value: string) => {
      const s = el().querySelector<HTMLSelectElement>(id)!;
      s.value = value;
      s.dispatchEvent(new Event('change'));
    };
    select('#fb-assignee', 'me');
    select('#fb-assignee', 'unassigned');
    select('#fb-overdue', 'yes');
    select('#fb-asap', 'no');
    expect(changes[0]).toMatchObject({ assignee: [9], unassigned: false });
    expect(changes[1]).toMatchObject({ assignee: [], unassigned: true });
    expect(changes[2].overdue).toBe(true);
    expect(changes[3].asap).toBe(false);
  });

  it('sets the Pod and date filters, and clears a date', async () => {
    await create(
      { ...emptyFilters(), dueFrom: '2026-01-01' },
      { pods: [{ id: 4, name: 'Pod A' }] },
    );
    openPanel();
    const pod = el().querySelector<HTMLSelectElement>('#fb-pod')!;
    pod.value = '4';
    pod.dispatchEvent(new Event('change'));
    const from = el().querySelector<HTMLInputElement>('#fb-due-from')!;
    from.value = '';
    from.dispatchEvent(new Event('change'));
    expect(changes[0].pod).toEqual([4]);
    expect(changes[1].dueFrom).toBeNull();
  });

  it('leaves out the parts the page does not want', async () => {
    await create(emptyFilters(), { hidden: ['pod', 'assignee', 'status'] });
    openPanel();
    expect(el().querySelector('#fb-pod')).toBeNull();
    expect(el().querySelector('#fb-assignee')).toBeNull();
    expect(Array.from(el().querySelectorAll('legend')).map((l) => l.textContent)).toEqual([
      'Priority',
    ]);
  });

  it('lists a removable chip per filter and Clear all filters', async () => {
    await create({ ...emptyFilters(), priority: [1], pod: [4], overdue: true });
    const chips = Array.from(el().querySelectorAll('.fb-chip')).map((c) => c.textContent?.trim());
    expect(chips).toEqual(['Priority: P1', 'Pod: Pod 4', 'Overdue only']);

    const remove = el().querySelector<HTMLButtonElement>('.fb-chip-x')!;
    expect(remove.getAttribute('aria-label')).toBe('Remove filter Priority: P1');
    remove.click();
    expect(changes[0].priority).toEqual([]);
    expect(changes[0].pod).toEqual([4]);

    Array.from(el().querySelectorAll<HTMLButtonElement>('.fb-clear'))[0].click();
    expect(cleared).toBe(1);
  });

  it('shows no chip list when nothing is filtered', async () => {
    await create();
    expect(el().querySelector('.fb-chips')).toBeNull();
  });

  it('offers the quick views, marks the active one and emits the choice', async () => {
    await create(
      { ...emptyFilters(), status: [...OPEN_STATUSES], overdue: true },
      { showViews: true, viewContext: { userId: 9, primaryPodId: null, recentFrom: '2026-09-14' } },
    );
    const buttons = Array.from(el().querySelectorAll<HTMLButtonElement>('.fb-view'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'All open',
      'Unassigned',
      'My Pod',
      'Created by me',
      'Overdue',
      'Recently completed',
    ]);
    const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((b) => b.textContent?.trim())).toEqual(['Overdue']);
    expect(buttons[2].disabled).toBe(true); // no primary Pod

    buttons[1].click();
    expect(views).toEqual(['unassigned']);
  });

  it('does not render quick views unless asked to', async () => {
    await create();
    expect(el().querySelector('.fb-views')).toBeNull();
  });
});
