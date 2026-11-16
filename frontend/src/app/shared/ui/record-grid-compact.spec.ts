import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../testing/org-testing';
import { LoadState } from './data-table';
import { RecordCell, RecordGrid, RecordGridColumn, RecordGridState } from './record-grid';

@Component({
  imports: [RecordGrid, RecordCell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-record-grid
      label="Test list"
      noun="things"
      [grid]="grid"
      [compact]="compact()"
      [skeletonRows]="10"
      [rows]="[]"
      loadState="loading"
      [empty]="false"
    >
      <ng-template mfCell="name" let-r
        ><td>{{ r }}</td></ng-template
      >
    </mf-record-grid>
  `,
})
class Host {
  protected readonly defs = signal<readonly RecordGridColumn[]>([
    { key: 'name', label: 'Name', locked: true, width: '100%', sort: 'name' },
  ]);
  readonly grid = new RecordGridState('compact-spec-grid', this.defs);
  readonly compact = signal(true);
  readonly state: LoadState = 'loading';
}

describe('record grid, compact (D-03c, #1396)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideFakeMe(new FakeMeApi(withPermissions()))],
    });
  });

  function mount() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('is a frame without a border of its own and draws the skeleton rows asked for (10) under the real heading', () => {
    const { el } = mount();
    const frame = el.querySelector('mf-grid-frame')!;
    expect(frame.classList).toContain('gf--inline');
    expect(el.querySelectorAll('tr[data-skeleton]').length).toBe(10);
    expect(el.querySelector('thead th')!.textContent).toContain('Name');
  });

  it('has headings that do not sort, move or resize (those belong to the full view)', () => {
    const { fixture, el } = mount();
    const th = el.querySelector('thead th[data-col="name"]')!;
    expect(th.querySelector('button')).toBeNull();
    expect(th.hasAttribute('data-no-resize')).toBe(true);
    expect(th.hasAttribute('data-no-reorder')).toBe(true);
    fixture.componentInstance.compact.set(false);
    fixture.detectChanges();
    expect(el.querySelector('thead th[data-col="name"] button')).not.toBeNull();
  });

  it('keeps the ordinary frame when it is not compact', () => {
    const { fixture, el } = mount();
    fixture.componentInstance.compact.set(false);
    fixture.detectChanges();
    expect(el.querySelector('mf-grid-frame')!.classList).not.toContain('gf--inline');
    expect(el.querySelectorAll('tr[data-skeleton]').length).toBe(10);
  });
});
