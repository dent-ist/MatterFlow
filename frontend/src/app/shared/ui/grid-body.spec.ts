import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoadState } from './data-table';
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
        (retry)="retried = retried + 1"
        (clear)="cleared = cleared + 1"
      >
        <button mfEmptyAction type="button">New client</button>
        <tr data-row>
          <td>Acme</td>
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
  retried = 0;
  cleared = 0;
}

describe('GridBody', () => {
  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }
  const el = (f: { nativeElement: HTMLElement }) => f.nativeElement;

  it('shows the rows when ready and not empty', () => {
    const f = create();
    expect(el(f).querySelector('tbody [data-row]')).not.toBeNull();
    expect(el(f).querySelector('[data-loading], [data-error], [data-empty]')).toBeNull();
  });

  it('keeps the header and shows one full-width row while loading', () => {
    const f = create();
    f.componentInstance.state.set('loading');
    f.detectChanges();
    const cell = el(f).querySelector('tbody td[data-loading]')!;
    expect(cell.getAttribute('colspan')).toBe('2');
    expect(cell.getAttribute('role')).toBe('status');
    expect(cell.textContent).toContain('Loading clients...');
    expect(el(f).querySelector('thead th')).not.toBeNull();
    expect(el(f).querySelector('[data-row]')).toBeNull();
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
});
