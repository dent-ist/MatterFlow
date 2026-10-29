import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { MattersClient, MyMattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, profileOf, provideFakeMe } from '../../../core/auth/auth-testing';
import { ViewStateService } from '../../../core/views/view-state.service';
import { ManagedMatters } from '../managed-matters';
import { DEFAULT_FILTERS, MmFilters } from '../my-matters-filters';
import { BreakdownTab, breakdownCountName, breakdownTotalLine, focusNote } from './breakdown-tab';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BreakdownTab],
  template: `<mf-mm-breakdown-tab [filters]="filters()" />`,
  providers: [ManagedMatters],
})
class Host {
  readonly filters = signal<MmFilters>(DEFAULT_FILTERS);
}

const type = (id: number, name: string, open: number, overdue: number) => ({
  taskTypeId: id,
  name,
  iconKey: 'file-text',
  colourKey: null,
  open,
  overdue,
  onHold: 0,
  atRisk: 0,
  query: `type=${id}`,
  overdueQuery: `type=${id}&overdue=true`,
});

const cell = (taskTypeId: number, open: number, overdue: number, matter: number) => ({
  taskTypeId,
  open,
  overdue,
  onHold: 0,
  atRisk: 0,
  query: `matter=${matter}&type=${taskTypeId}`,
  overdueQuery: `matter=${matter}&type=${taskTypeId}&overdue=true`,
});

function answer(matters: number, view = 'matrix') {
  const rows = Array.from({ length: matters }, (_, i) => ({
    matterId: i + 1,
    matterRef: `9000${i + 1}`,
    matterName: `Matter ${i + 1}`,
    clientName: 'Acme',
    open: 4,
    overdue: i === 0 ? 1 : 0,
    onHold: 0,
    atRisk: 0,
    cells: [cell(1, 3, i === 0 ? 1 : 0, i + 1), cell(2, 1, 0, i + 1)],
  }));
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    view,
    status: 'open',
    types: [type(1, 'Production', 3 * matters, 1), type(2, 'Review', matters, 0)],
    typeTotal: 2,
    rows: view === 'types' ? [] : rows,
    matterTotal: matters,
    page: 1,
    pageSize: 50,
    totals: {
      open: 4 * matters,
      overdue: 1,
      onHold: 0,
      atRisk: 0,
      query: 'q',
      overdueQuery: 'q&overdue=true',
    },
  };
}

describe('Breakdown helpers', () => {
  it('names a count for a screen reader, with the overdue part only when something is late', () => {
    expect(breakdownCountName('90001, Review', 3, 1, 'open')).toBe(
      '90001, Review: 3 open, 1 overdue',
    );
    expect(breakdownCountName('90001, Review', 3, 0, 'on hold')).toBe('90001, Review: 3 on hold');
  });

  it('writes the total as one plain line and the Focus note with the right number', () => {
    expect(breakdownTotalLine(24, 9, 'open')).toBe('24 open, 9 overdue');
    expect(breakdownTotalLine(24, 0, 'open')).toBe('24 open');
    expect(focusNote(1)).toBe('Focus: 1 task type');
    expect(focusNote(3)).toBe('Focus: 3 task types');
  });
});

describe('BreakdownTab (issues #911, #912, #907)', () => {
  let api: { getMyMattersBreakdown: ReturnType<typeof vi.fn> };

  async function open(url: string, matters: number, focus: number[] = []) {
    api = {
      getMyMattersBreakdown: vi
        .fn()
        .mockImplementation((view: string) => of(answer(matters, view))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'my-matters', component: Host }]),
        provideFakeMe(new FakeMeApi(profileOf({ permissions: ['Task.View', 'Matter.View'] }))),
        { provide: MyMattersClient, useValue: api },
        {
          provide: ViewStateService,
          useValue: {
            cached: vi.fn().mockReturnValue({ types: focus }),
            load: vi.fn().mockResolvedValue({ types: focus }),
            save: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
          },
        },
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

  it('one matter: one row, no All matters row, no toggle, one visible control (Options), only the types in use', async () => {
    const h = await open('/my-matters?tab=breakdown', 1);
    const panel = root(h).querySelector('[data-panel=breakdown]')!;
    expect(panel.querySelectorAll('[data-bd-row]')).toHaveLength(1);
    expect(panel.querySelector('tfoot')).toBeNull();
    expect(panel.querySelector('[data-bd-view]')).toBeNull();
    expect(panel.querySelectorAll('button:not([data-export]), summary')).toHaveLength(1);
    expect(panel.querySelector('summary [data-options-count]')).toBeNull();
    expect(
      Array.from(panel.querySelectorAll('thead th')).map((t) => t.textContent!.trim()),
    ).toEqual(['Matter', 'Production', 'Review', 'Total']);
    // The sentences are gone: the caption is for screen readers only.
    expect(panel.querySelector('caption')!.classList.contains('mf-sr-only')).toBe(true);
    expect(panel.querySelector('[data-bd-summary]')).toBeNull();
    // A stale address for the other view still shows the matter row.
    expect(api.getMyMattersBreakdown.mock.calls[0][0]).toBe('matrix');
  });

  it('several matters: the toggle, an All matters row, one number per cell and a header on one line', async () => {
    const h = await open('/my-matters?tab=breakdown', 3);
    const panel = root(h).querySelector('[data-panel=breakdown]')!;
    expect(panel.querySelectorAll('[data-bd-view]')).toHaveLength(2);
    expect(panel.querySelector('tfoot [data-bd-totals]')!.textContent).toContain('All matters');
    const first = panel.querySelector('tbody tr')!;
    expect(first.querySelectorAll('a[data-bd-cell]')).toHaveLength(2);
    const late = first.querySelector('a[data-bd-cell]')!;
    expect(late.getAttribute('aria-label')).toBe('90001, Production: 3 open, 1 overdue');
    expect(late.querySelector('[data-bd-overdue]')!.getAttribute('aria-hidden')).toBe('true');
    expect(panel.querySelector('thead th[data-bd-col]')!.getAttribute('title')).toBe('Production');
  });

  it('"On hold only" is a checkbox inside Options, with Export beside it', async () => {
    const h = await open('/my-matters?tab=breakdown&bstatus=onHold', 3);
    const panel = root(h).querySelector('[data-panel=breakdown]')!;
    const box = panel.querySelector<HTMLInputElement>(
      'details[data-options] input[data-bd-onhold]',
    )!;
    expect(box.checked).toBe(true);
    expect(panel.querySelector('details[data-options] [data-export=csv]')).not.toBeNull();
    expect(panel.querySelector('[data-options-count]')!.textContent!.trim()).toBe('1');
    expect(api.getMyMattersBreakdown.mock.calls[0][1]).toBe('onHold');
  });

  it('follows the Focus: the task types are sent and a note says how many', async () => {
    const h = await open('/my-matters?tab=breakdown', 3, [1, 2]);
    expect(api.getMyMattersBreakdown.mock.calls[0][2]).toEqual([1, 2]);
    expect(root(h).querySelector('[data-bd-focus]')!.textContent!.trim()).toBe(
      'Focus: 2 task types',
    );
  });

  it('without a Focus it asks for every task type and draws no note', async () => {
    const h = await open('/my-matters?tab=breakdown', 3);
    expect(root(h).querySelector('[data-bd-focus]')).toBeNull();
    expect(api.getMyMattersBreakdown.mock.calls[0][2]).toBeUndefined();
  });
});
