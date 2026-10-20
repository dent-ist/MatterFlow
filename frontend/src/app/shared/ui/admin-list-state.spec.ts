import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorReferenceStore } from '../../core/http/error-reference-store';
import { ListFilters } from '../filters/list-filters';
import { AdminColumn, adminListState, adminListView } from './admin-list-state';
import { LoadState } from './data-table';
import { GridBody } from './grid-body';
import { RecordCardDef, RecordCardList } from './record-card-list';

describe('adminListView (#575)', () => {
  it('names the six views', () => {
    expect(adminListView({ state: 'loading', rows: 0, filtered: false })).toBe('loading');
    expect(adminListView({ state: 'forbidden', rows: 0, filtered: true })).toBe('forbidden');
    expect(adminListView({ state: 'error', rows: 3, filtered: false })).toBe('error');
    expect(adminListView({ state: 'ready', rows: 0, filtered: false })).toBe('empty');
    expect(adminListView({ state: 'ready', rows: 0, filtered: true })).toBe('no-match');
    expect(adminListView({ state: 'ready', rows: 2, filtered: true })).toBe('rows');
  });
});

describe('adminListState (#575)', () => {
  it('derives empty, filtered, hidden and the view from the page signals', () => {
    TestBed.runInInjectionContext(() => {
      const state = signal<LoadState>('loading');
      const rows = signal<readonly string[]>([]);
      const active = signal(0);
      const hidden = signal(0);
      const ls = adminListState({
        state,
        rows,
        filters: { activeCount: active } as unknown as ListFilters,
        hidden,
      });
      expect(ls.view()).toBe('loading');
      state.set('ready');
      expect(ls.view()).toBe('empty');
      expect(ls.empty()).toBe(true);
      active.set(1);
      hidden.set(3);
      expect(ls.filtered()).toBe(true);
      expect(ls.view()).toBe('no-match');
      expect(ls.hidden()).toBe(3);
      rows.set(['a']);
      expect(ls.view()).toBe('rows');
      expect(ls.empty()).toBe(false);
      state.set('error');
      expect(ls.view()).toBe('error');
    });
  });

  it('takes a row count or an array, and a list without filters is never filtered', () => {
    TestBed.runInInjectionContext(() => {
      const ls = adminListState({ state: signal<LoadState>('ready'), rows: signal(0) });
      expect(ls.filtered()).toBe(false);
      expect(ls.hidden()).toBe(0);
      expect(ls.view()).toBe('empty');
      const f = signal(true);
      const ls2 = adminListState({
        state: signal<LoadState>('ready'),
        rows: signal<readonly unknown[]>([]),
        filtered: f,
      });
      expect(ls2.view()).toBe('no-match');
    });
  });
});

const SPEC: readonly AdminColumn[] = [
  { cls: 'mf-cell-name', bone: '12rem' },
  { cls: 'mf-cell-num', bone: '2rem', drop: 1100 },
  { cls: 'mf-cell-actions', bone: '1.5rem' },
];

@Component({
  imports: [GridBody, RecordCardList, RecordCardDef],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Assets</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody
        mfGridBody
        noun="asset types"
        [state]="state()"
        [columnSpec]="spec"
        [errorRef]="ref()"
      ></tbody>
    </table>
    <mf-record-card-list noun="asset types" [state]="state()" [errorRef]="ref()">
      <ng-template [mfRecordCard]="[]"></ng-template>
    </mf-record-card-list>
  `,
})
class Host {
  readonly state = signal<LoadState>('loading');
  readonly ref = signal<string | null>(null);
  readonly spec = SPEC;
}

describe('grid body on the real columns (#575)', () => {
  function create() {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }

  it('builds the skeleton from the column spec: count, bone widths, cell classes and data-drop', () => {
    const f = create();
    const row = (f.nativeElement as HTMLElement).querySelector('tbody tr[data-skeleton]')!;
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells.map((c) => c.className)).toEqual([
      'mf-cell-name',
      'mf-cell-num',
      'mf-cell-actions',
    ]);
    expect(cells.map((c) => c.getAttribute('data-drop'))).toEqual([null, '1100', null]);
    expect(
      Array.from(row.querySelectorAll<HTMLElement>('.gb-bone')).map((b) => b.style.width),
    ).toEqual(['12rem', '2rem', '1.5rem']);
    expect(
      (f.nativeElement as HTMLElement)
        .querySelector('tbody td[data-loading]')!
        .getAttribute('colspan'),
    ).toBe('3');
  });

  it('shows an explicit reference on an error, in the table and in the cards', () => {
    const f = create();
    f.componentInstance.state.set('error');
    f.componentInstance.ref.set('abc-123');
    f.detectChanges();
    const refs = (f.nativeElement as HTMLElement).querySelectorAll('[data-error-reference] code');
    expect(Array.from(refs).map((r) => r.textContent)).toEqual(['abc-123', 'abc-123']);
  });

  it('falls back to the last reference the server sent', () => {
    const f = create();
    TestBed.inject(ErrorReferenceStore).reference.set('from-server');
    f.componentInstance.state.set('error');
    f.detectChanges();
    expect(
      (f.nativeElement as HTMLElement).querySelector('tbody [data-error-reference] code')
        ?.textContent,
    ).toBe('from-server');
  });
});
