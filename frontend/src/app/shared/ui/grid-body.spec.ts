import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoadState } from './data-table';
import { ListFilters } from '../filters/list-filters';
import { GridBody } from './grid-body';

@Component({
  imports: [GridBody],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody
        mfGridBody
        noun="clients"
        [state]="state()"
        [empty]="empty()"
        [filtered]="filtered()"
        [columns]="2"
        [skeleton]="skeleton()"
        [filters]="listFilters()"
        (retry)="retried = retried + 1"
        (clear)="cleared = cleared + 1"
      >
        <button mfEmptyAction type="button">New client</button>
        <tr data-row>
          <td><a href="/clients/1">Acme</a></td>
          <td>Active</td>
        </tr>
      </tbody>
    </table>
  `,
})
class Host {
  readonly state = signal<LoadState>('ready');
  readonly empty = signal(false);
  readonly filtered = signal(false);
  readonly skeleton = signal<readonly string[]>(['7rem', '14rem']);
  readonly listFilters = signal<ListFilters | null>(null);
  retried = 0;
  cleared = 0;
}

describe('GridBody', () => {
  function create() {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }
  const el = (f: { nativeElement: HTMLElement }) => f.nativeElement;

  it('shows the rows when ready and not empty', () => {
    const f = create();
    expect(el(f).querySelector('tbody [data-row]')).not.toBeNull();
    expect(el(f).querySelector('[data-loading], [data-error], [data-empty]')).toBeNull();
  });

  it('keeps the header, shows five skeleton rows and one polite message while loading', () => {
    const f = create();
    f.componentInstance.state.set('loading');
    f.detectChanges();
    const cell = el(f).querySelector('tbody td[data-loading]')!;
    expect(cell.getAttribute('colspan')).toBe('2');
    expect(cell.getAttribute('role')).toBe('status');
    expect(cell.getAttribute('aria-busy')).toBe('true');
    expect(cell.textContent?.trim()).toBe('Loading clients');
    expect(el(f).querySelector('tbody')!.getAttribute('aria-busy')).toBe('true');
    const rows = el(f).querySelectorAll('tbody tr[data-skeleton]');
    expect(rows.length).toBe(5);
    expect(rows[0].getAttribute('aria-hidden')).toBe('true');
    expect(rows[0].querySelectorAll('td').length).toBe(2);
    expect(el(f).querySelector('thead th')).not.toBeNull();
    expect(el(f).querySelector('[data-row]')).toBeNull();
  });

  it('takes the bone width of each column from the page', () => {
    const f = create();
    f.componentInstance.skeleton.set(['4rem', '12rem']);
    f.componentInstance.state.set('loading');
    f.detectChanges();
    const bones = el(f)
      .querySelector('tr[data-skeleton]')!
      .querySelectorAll<HTMLElement>('.gb-bone');
    expect(Array.from(bones).map((b) => b.style.width)).toEqual(['4rem', '12rem']);
  });

  it('says the access is missing on a 403, without Retry', () => {
    const f = create();
    f.componentInstance.state.set('forbidden');
    f.detectChanges();
    const cell = el(f).querySelector('tbody td[data-forbidden]')!;
    expect(cell.textContent).toContain("You don't have access to clients.");
    expect(
      Array.from(el(f).querySelectorAll('button')).some((b) => b.textContent?.includes('Retry')),
    ).toBe(false);
  });

  it('moves focus to the first row link after a Retry that succeeds', async () => {
    const f = create();
    f.componentInstance.state.set('error');
    f.detectChanges();
    Array.from(el(f).querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Retry'))!
      .click();
    f.componentInstance.state.set('loading');
    f.detectChanges();
    f.componentInstance.state.set('ready');
    f.detectChanges();
    await f.whenStable();
    expect(document.activeElement).toBe(el(f).querySelector('[data-row] a'));
  });

  it('shows an alert with Retry inside the grid on error', () => {
    const f = create();
    f.componentInstance.state.set('error');
    f.detectChanges();
    expect(el(f).querySelector('tbody [role=alert]')?.textContent).toContain(
      "Couldn't load clients.",
    );
    Array.from(el(f).querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Retry'))!
      .click();
    expect(f.componentInstance.retried).toBe(1);
  });

  it('says there are none yet, with the projected action, when empty without filters', () => {
    const f = create();
    f.componentInstance.empty.set(true);
    f.detectChanges();
    const cell = el(f).querySelector('td[data-empty=none]')!;
    expect(cell.textContent).toContain('No clients yet.');
    expect(cell.textContent).toContain('New client');
    expect(el(f).querySelector('thead th')).not.toBeNull();
  });

  it('offers Clear filters when empty with filters active', () => {
    const f = create();
    f.componentInstance.empty.set(true);
    f.componentInstance.filtered.set(true);
    f.detectChanges();
    const cell = el(f).querySelector('td[data-empty=filtered]')!;
    expect(cell.textContent).toContain('No clients match these filters');
    expect(cell.textContent).not.toContain('New client');
    Array.from(cell.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Clear filters'))!
      .click();
    expect(f.componentInstance.cleared).toBe(1);
  });

  it('tells the filters bar while its filtered empty state offers Clear filters (one Clear filters at a time)', () => {
    const f = create();
    const flag = signal(false);
    f.componentInstance.listFilters.set({ emptyClear: flag } as unknown as ListFilters);
    f.detectChanges();
    expect(flag()).toBe(false);
    f.componentInstance.empty.set(true);
    f.componentInstance.filtered.set(true);
    f.detectChanges();
    expect(flag()).toBe(true);
    f.componentInstance.state.set('loading');
    f.detectChanges();
    expect(flag()).toBe(false);
    f.componentInstance.state.set('ready');
    f.detectChanges();
    expect(flag()).toBe(true);
    f.destroy();
    expect(flag()).toBe(false);
  });
});
