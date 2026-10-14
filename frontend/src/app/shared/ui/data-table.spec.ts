import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ListState, LoadState, SortHeader, StatusFilter } from './data-table';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SortHeader, ListState, StatusFilter],
  template: `
    <table>
      <thead>
        <tr>
          <th mfSort="name" [sort]="sort()" defaultSort="name" (sorted)="sorts.push($event)">
            Name
          </th>
          <th mfSort="count" [sort]="sort()" defaultSort="name" (sorted)="sorts.push($event)">
            Count
          </th>
        </tr>
      </thead>
    </table>
    <mf-status-filter inputId="st" inactiveLabel="Archived" [value]="'active'" />
    <mf-list-state
      noun="things"
      [state]="state()"
      [empty]="empty()"
      [filtered]="filtered()"
      (retry)="retries = retries + 1"
      (clear)="clears = clears + 1"
    >
      <button mfEmptyAction type="button">New thing</button>
      <p data-content>the table</p>
    </mf-list-state>
  `,
})
class Host {
  sort = signal<string | undefined>(undefined);
  state = signal<LoadState>('ready');
  empty = signal(false);
  filtered = signal(false);
  sorts: string[] = [];
  retries = 0;
  clears = 0;
}

describe('data table pieces', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const th = (i: number) => el().querySelectorAll('th')[i];

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  describe('sortable header', () => {
    it('is a real button inside the column header with aria-sort on the cell', () => {
      expect(th(0).getAttribute('scope')).toBe('col');
      expect(th(0).querySelector('button')!.textContent).toContain('Name');
      expect(th(0).getAttribute('aria-sort')).toBe('ascending'); // the default sort
      expect(th(1).getAttribute('aria-sort')).toBe('none');
    });

    it('announces descending and moves to the next sort when activated (keyboard Enter also clicks)', () => {
      fixture.componentInstance.sort.set('-name');
      fixture.detectChanges();
      expect(th(0).getAttribute('aria-sort')).toBe('descending');

      th(0).querySelector('button')!.click();
      th(1).querySelector('button')!.click();
      expect(fixture.componentInstance.sorts).toEqual(['name', 'count']);
    });
  });

  describe('status filter', () => {
    it('offers Active, the inactive word of the list, and All', () => {
      const options = Array.from(el().querySelectorAll('#st option')).map((o) => o.textContent);
      expect(options).toEqual(['Active', 'Archived', 'All']);
    });
  });

  describe('list state', () => {
    const host = () => fixture.componentInstance;
    const update = (fn: () => void) => {
      fn();
      fixture.detectChanges();
    };

    it('shows the table when ready', () => {
      expect(el().querySelector('[data-content]')).not.toBeNull();
    });

    it('shows skeleton rows with a status for assistive technology while loading', () => {
      update(() => host().state.set('loading'));
      expect(el().querySelector('[data-content]')).toBeNull();
      const loading = el().querySelector('[data-loading]')!;
      expect(loading.getAttribute('role')).toBe('status');
      expect(loading.getAttribute('aria-busy')).toBe('true');
      expect(loading.textContent).toContain('Loading things...');
      expect(loading.querySelectorAll('.ls__row').length).toBe(5);
    });

    it('shows an inline alert with Retry on error', () => {
      update(() => host().state.set('error'));
      const alert = el().querySelector('[role=alert]')!;
      expect(alert.textContent).toContain("Couldn't load things.");
      alert.querySelector('button')!.click();
      expect(host().retries).toBe(1);
    });

    it('says nothing exists yet, with the page action, when the list is empty', () => {
      update(() => host().empty.set(true));
      const empty = el().querySelector('[data-empty=none]')!;
      expect(empty.textContent).toContain('No things yet.');
      expect(empty.textContent).toContain('New thing');
      expect(el().querySelector('[data-content]')).toBeNull();
    });

    it('says nothing matches, with Clear filters, when the empty list is filtered', () => {
      update(() => {
        host().empty.set(true);
        host().filtered.set(true);
      });
      const empty = el().querySelector('[data-empty=filtered]')!;
      expect(empty.textContent).toContain('No things match these filters.');
      Array.from(empty.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Clear filters'))!
        .click();
      expect(host().clears).toBe(1);
    });
  });
});
