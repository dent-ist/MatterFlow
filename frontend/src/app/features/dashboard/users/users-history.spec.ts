import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DashboardBoardClient, UserHistory } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { DashScope } from '../dash-scope';
import { UsersHistory } from './users-history';

function history(over: Partial<UserHistory> = {}): UserHistory {
  return {
    userId: 7,
    displayName: 'Ana Bell',
    isActive: true,
    asOfUtc: '2026-11-03T12:00:00Z',
    zoneId: 'America/New_York',
    windowMonths: 3,
    windowFromUtc: '2026-08-03T00:00:00Z',
    durationBasis: 'WORKING',
    durationUnit: 'MINUTES',
    minSampleSize: 5,
    totalCompleted: 17,
    types: [
      {
        taskTypeId: 1,
        name: 'Review',
        iconKey: 'eye',
        isActive: true,
        completed: 12,
        sampleSize: 12,
        medianMinutes: 200,
        firmSampleSize: 90,
        firmMedianMinutes: 150,
        ratio: 1.33,
      },
      {
        taskTypeId: 2,
        name: 'Processing',
        iconKey: 'cpu-2',
        isActive: true,
        completed: 3,
        sampleSize: 3,
        medianMinutes: undefined,
        firmSampleSize: 40,
        firmMedianMinutes: 100,
        ratio: undefined,
      },
    ],
    months: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      completed: i,
    })),
    onTime: { onTime: 9, late: 1, sampleSize: 10, rate: 0.9 },
    ...over,
  };
}

describe('UsersHistory', () => {
  let calls: unknown[][];

  function create(panel: 'types' | 'trend', result: unknown = of(history())) {
    calls = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: DashScope, useValue: { scope: () => 'all' } },
        {
          provide: DashboardBoardClient,
          useValue: {
            getDashboardUserHistory: (...args: unknown[]) => {
              calls.push(args);
              return result;
            },
          },
        },
      ],
    });
    const f = TestBed.createComponent(UsersHistory);
    f.componentRef.setInput('userId', 7);
    f.componentRef.setInput('panel', panel);
    f.detectChanges();
    return f;
  }
  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;

  it('Task types: reads 3 months with the page scope, shows the table with neutral comparison and "Not enough tasks yet"', () => {
    const f = create('types');
    expect(calls[0]).toEqual([7, 3, 'all']);
    const rows = el(f).querySelectorAll('[data-type-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('3.3 h');
    expect(rows[0].querySelector('[data-compare]')!.textContent).toContain('1.3x firm median');
    expect(rows[0].querySelector('[data-compare] .sr-only')!.textContent).toContain(
      'Longer than the firm median',
    );
    expect(rows[1].querySelector('[data-median]')!.textContent).toContain('Not enough tasks yet');
    expect(rows[1].querySelector('[data-compare]')).toBeNull();
    expect(el(f).querySelector('[data-basis]')!.textContent).toContain('working time');
  });

  it('Task types: the 12 months button reads again', () => {
    const f = create('types');
    el(f).querySelector<HTMLButtonElement>('[data-window="12"]')!.click();
    f.detectChanges();
    expect(calls[1]).toEqual([7, 12, 'all']);
  });

  it('Trend: reads 12 months, draws 12 bars with numbers, the on-time sentence and a table', () => {
    const f = create('trend');
    expect(calls[0]).toEqual([7, 12, 'all']);
    expect(el(f).querySelectorAll('[data-trend-bars] .bar')).toHaveLength(12);
    expect(el(f).querySelector('[data-ontime]')!.textContent).toContain(
      '9 of 10 tasks on time (90%)',
    );
    expect(el(f).querySelectorAll('[data-trend-table] tbody tr')).toHaveLength(12);
  });

  it('says so for a person outside the scope (404) and shows Retry on another error', () => {
    const missing = create(
      'types',
      throwError(() => new ApiError(404, 'NOT_FOUND', 'x', undefined, undefined as never)),
    );
    expect(el(missing).querySelector('[data-history-missing]')).not.toBeNull();
    TestBed.resetTestingModule();
    const broken = create(
      'types',
      throwError(() => new Error('boom')),
    );
    expect(el(broken).querySelector('[data-history-error]')).not.toBeNull();
  });
});
