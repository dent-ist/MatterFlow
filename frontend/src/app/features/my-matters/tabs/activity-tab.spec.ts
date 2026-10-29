import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { MattersClient, MyMattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, profileOf, provideFakeMe } from '../../../core/auth/auth-testing';
import { ManagedMatters } from '../managed-matters';
import { DEFAULT_FILTERS, MmFilters } from '../my-matters-filters';
import { ACTIVITY_TAB_PAGE, ActivityTab } from './activity-tab';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityTab],
  template: `<mf-mm-activity-tab [filters]="filters()" />`,
  providers: [ManagedMatters],
})
class Host {
  readonly filters = signal<MmFilters>(DEFAULT_FILTERS);
}

const item = (eventId: number, over: object = {}) => ({
  eventId,
  occurredAtUtc: '2026-10-23T13:42:00Z',
  kind: 'STATUS_CHANGED',
  actorName: 'Dana Rao',
  matterId: 5,
  matterRef: '90001-80001',
  matterName: 'Merger',
  clientName: 'Acme',
  taskId: 7,
  taskNumber: 'TSK-7',
  taskTitle: 'Privilege log',
  to: 'ON_HOLD',
  isUnread: false,
  ...over,
});

function answer(items: object[], total = items.length, unread = 0) {
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T18:00:00Z',
    sinceUtc: '2026-09-23T18:00:00Z',
    seenEventId: 0,
    latestEventId: 99,
    unreadCount: unread,
    total,
    hasMore: total > items.length,
    items,
  };
}

describe('ActivityTab (the grid, issue #946)', () => {
  let api: {
    getMyMattersActivity: ReturnType<typeof vi.fn>;
    markMyMattersActivitySeen: ReturnType<typeof vi.fn>;
  };

  async function open(url: string, items: object[], total = items.length, matters = 3) {
    api = {
      getMyMattersActivity: vi.fn().mockReturnValue(of(answer(items, total, 1))),
      markMyMattersActivitySeen: vi.fn().mockReturnValue(of({ seenEventId: 99, seenAtUtc: 'x' })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'my-matters', component: Host }]),
        provideFakeMe(new FakeMeApi(profileOf({ permissions: ['Task.View', 'Matter.View'] }))),
        { provide: MyMattersClient, useValue: api },
        {
          provide: MattersClient,
          useValue: {
            listMatters: vi.fn().mockReturnValue(
              of({
                items: Array.from({ length: matters }, (_, i) => ({
                  matterId: i + 1,
                  clientId: 1,
                })),
                total: matters,
              }),
            ),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(url, Host);
    await h.fixture.whenStable();
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
    return h;
  }

  const root = (h: { fixture: { nativeElement: unknown } }) =>
    h.fixture.nativeElement as HTMLElement;

  it('is a table with one event a row: When (a sort button), Who, What, Task and, with several matters, Matter', async () => {
    const h = await open('/my-matters', [
      item(12, { isUnread: true }),
      item(9, {
        kind: 'COMMENTED',
        actorName: 'Priya Rao',
        taskId: 8,
        taskNumber: 'TSK-8',
        taskTitle: 'Review',
        to: undefined,
      }),
    ]);
    const table = root(h).querySelector('table[data-activity-table]')!;
    expect(
      Array.from(table.querySelectorAll('thead th')).map((t) => t.textContent!.trim()),
    ).toEqual(['When', 'Who', 'What', 'Task', 'Matter']);
    expect(table.querySelector('th[data-sort-when]')!.getAttribute('aria-sort')).toBe('descending');
    const rows = Array.from(table.querySelectorAll('[data-activity-row]'));
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('[data-col=who]')!.textContent!.trim()).toBe('Dana Rao');
    expect(rows[0].querySelector('[data-col=what]')!.textContent!.trim()).toBe('Put on hold');
    expect(rows[0].querySelector('[data-col=task] a')!.textContent!.trim()).toBe(
      'TSK-7 Privilege log',
    );
    expect(rows[0].querySelector('[data-col=task] a')!.getAttribute('href')).toContain('/tasks/7');
    expect(rows[0].querySelector('[data-new-word]')!.textContent).toBe('New');
    expect(rows[1].querySelector('[data-col=what]')!.textContent!.trim()).toBe('Commented');
    expect(rows[1].querySelector('[data-new-word]')).toBeNull();
    expect(rows[1].querySelector('[data-col=matter]')!.textContent).toContain('Merger');
    expect(table.querySelector('caption')!.textContent).toContain('newest first');
  });

  it('asks for 25 events, newest first, and leaves the Matter column out for a person with one matter', async () => {
    const h = await open('/my-matters', [item(12)], 1, 1);
    expect(api.getMyMattersActivity.mock.calls[0][0]).toBe(ACTIVITY_TAB_PAGE);
    expect(ACTIVITY_TAB_PAGE).toBe(25);
    expect(api.getMyMattersActivity.mock.calls[0][4]).toBeUndefined(); // dir
    expect(
      Array.from(root(h).querySelectorAll('thead th')).map((t) => t.textContent!.trim()),
    ).toEqual(['When', 'Who', 'What', 'Task']);
  });

  it('sorts oldest first from the address and pages with the shared pager', async () => {
    const h = await open('/my-matters?asort=when&apage=2', [item(3), item(2)], 27);
    const call = api.getMyMattersActivity.mock.calls[0];
    expect(call[4]).toBe('asc');
    expect(call[5]).toBe(2);
    expect(root(h).querySelector('th[data-sort-when]')!.getAttribute('aria-sort')).toBe(
      'ascending',
    );
    expect(root(h).querySelector('[data-range]')!.textContent).toContain('26-27 of 27');
    root(h).querySelector<HTMLButtonElement>('th[data-sort-when] button')!.click();
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).not.toContain('asort');
    expect(TestBed.inject(Router).url).not.toContain('apage');
  });

  it('keeps Kind and Unread only inside the Options menu, with their number on its button', async () => {
    const h = await open('/my-matters?kind=COMPLETED', [item(12)]);
    const panel = root(h).querySelector('[data-panel=activity-tab]')!;
    expect(panel.querySelectorAll('details[data-options]')).toHaveLength(1);
    expect(panel.querySelector('details[data-options] [data-filter=kind]')).not.toBeNull();
    expect(panel.querySelector('details[data-options] [data-filter=unread]')).not.toBeNull();
    expect(panel.querySelector('[data-options-count]')!.textContent!.trim()).toBe('1');
    expect(api.getMyMattersActivity.mock.calls[0][1]).toEqual(['COMPLETED']);
  });

  it('says what is empty, with a filter or without', async () => {
    const h = await open('/my-matters?unread=true', []);
    expect(root(h).querySelector('[data-empty]')!.textContent).toContain('matches these filters');
  });

  it('marks everything read up to the newest event of the answer', async () => {
    const h = await open('/my-matters', [item(12, { isUnread: true })]);
    root(h).querySelector<HTMLButtonElement>('[data-mark-all-read]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(api.markMyMattersActivitySeen).toHaveBeenCalledWith({ upToEventId: 99 });
    expect(root(h).querySelector('[data-new-word]')).toBeNull();
  });
});
