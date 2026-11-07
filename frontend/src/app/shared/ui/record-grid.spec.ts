import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../testing/org-testing';
import { RecordCell, RecordGrid, RecordGridColumn, RecordGridState } from './record-grid';
import { columnWidthsKey, loadColumnWidths } from './resizable-columns';

interface Row {
  id: number;
  name: string;
  archived: boolean;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alpha', archived: false },
  { id: 2, name: 'Beta', archived: false },
  { id: 3, name: 'Gamma', archived: true },
  { id: 4, name: 'Delta', archived: true },
];

@Component({
  imports: [RecordGrid, RecordCell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-record-grid
      label="Test list"
      noun="things"
      [grid]="grid"
      [rows]="rows()"
      [rowKey]="key"
      loadState="ready"
      [empty]="false"
      [groupBy]="groupBy"
      [collapsedGroups]="collapsed()"
      [rowClass]="rowClass"
      [rowClickable]="clickable()"
      [actions]="true"
      (rowClick)="clicked.push($event.id)"
      (groupToggle)="toggled.push($event.key + ':' + $event.open)"
    >
      <ng-template mfCell="name" let-r
        ><td data-name>{{ r.name }}</td></ng-template
      >
      <ng-template mfCell="actions" let-r><td class="mf-col-actions">...</td></ng-template>
    </mf-record-grid>
  `,
})
class Host {
  protected readonly defs = signal<readonly RecordGridColumn[]>([
    { key: 'name', label: 'Name', locked: true, width: '100%' },
  ]);
  readonly grid = new RecordGridState('spec-grid', this.defs);
  readonly rows = signal<Row[]>(ROWS);
  readonly collapsed = signal<readonly string[]>([]);
  readonly clickable = signal(true);
  readonly clicked: number[] = [];
  readonly toggled: string[] = [];
  readonly key = (r: Row): number => r.id;
  readonly groupBy = (r: Row) => (r.archived ? { key: 'archived', label: 'Archived' } : null);
  readonly rowClass = (r: Row): string | null => (r.archived ? 'is-inactive' : null);
}

describe('record grid extension points (#1245)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideFakeMe(new FakeMeApi(withPermissions()))],
    });
  });

  function mount() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('draws a group header row with the label and the count, and the rows of the group below it', () => {
    const { el } = mount();
    const head = el.querySelector('tr.rg-group') as HTMLElement;
    expect(head.textContent?.replace(/\s+/g, ' ').trim()).toBe('Archived (2)');
    expect(head.querySelector('th')?.getAttribute('scope')).toBe('colgroup');
    expect(head.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((r) => r.className);
    expect(rows.length).toBe(5);
    expect(rows[2]).toContain('rg-group');
  });

  it('collapses and opens a group with the button and reports it', () => {
    const { fixture, el, host } = mount();
    const button = el.querySelector('tr.rg-group button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
    button.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr').length).toBe(5);
    expect(host.toggled).toEqual(['archived:false', 'archived:true']);
  });

  it('starts a group closed when the page asks for it', () => {
    const { fixture, el, host } = mount();
    host.collapsed.set(['archived']);
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
    expect(el.querySelector('tr.rg-group button')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the widths of the grid current: setWidths stores them and the signal says them, an empty map and Reset Width forget them (#722)', () => {
    const { host } = mount();
    const key = columnWidthsKey('spec-grid', undefined);
    expect(host.grid.widths()).toEqual({});
    host.grid.setWidths({ name: 240 });
    expect(host.grid.widths()).toEqual({ name: 240 });
    expect(loadColumnWidths(key)).toEqual({ name: 240 });
    expect(host.grid.widthsVersion()).toBe(1);
    host.grid.setWidths({});
    expect(host.grid.widths()).toEqual({});
    expect(localStorage.getItem(key)).toBeNull();
    host.grid.setWidths({ name: 300 });
    host.grid.resetWidths();
    expect(host.grid.widths()).toEqual({});
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('gives a row the class names of rowClass', () => {
    const { el } = mount();
    const marked = Array.from(el.querySelectorAll('tbody tr.is-inactive')).map(
      (r) => r.querySelector('[data-name]')?.textContent,
    );
    expect(marked).toEqual(['Gamma', 'Delta']);
  });

  it('emits rowClick for a click on the row and for Enter and Space on the focused row', () => {
    const { fixture, el, host } = mount();
    const row = el.querySelectorAll<HTMLElement>('tbody tr:not(.rg-group)')[1];
    expect(row.getAttribute('tabindex')).toBe('0');
    row.querySelector<HTMLElement>('[data-name]')?.click();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();
    expect(host.clicked).toEqual([2, 2, 2]);
  });

  it('does not emit rowClick for a click on a button or when the row is not clickable', () => {
    const { fixture, el, host } = mount();
    el.querySelector<HTMLElement>('tr.rg-group button')?.click();
    expect(host.clicked).toEqual([]);
    host.clickable.set(false);
    fixture.detectChanges();
    el.querySelectorAll<HTMLElement>('tbody tr:not(.rg-group)')[0]
      .querySelector<HTMLElement>('[data-name]')
      ?.click();
    expect(host.clicked).toEqual([]);
  });
});

@Component({
  imports: [RecordGrid, RecordCell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-record-grid
      label="Icon list"
      noun="things"
      [grid]="grid"
      [rows]="rows"
      [rowKey]="key"
      loadState="ready"
      [empty]="false"
    >
      <ng-template mfCell="star" let-r
        ><td data-star>{{ r.name }}</td></ng-template
      >
      <ng-template mfCell="name" let-r
        ><td>{{ r.name }}</td></ng-template
      >
    </mf-record-grid>
  `,
})
class IconHost {
  protected readonly defs = signal<readonly RecordGridColumn[]>([
    { key: 'star', label: 'Favourite', locked: true, pinned: true, iconOnly: true, width: '44px' },
    { key: 'name', label: 'Name', locked: true, width: '100%' },
  ]);
  readonly grid = new RecordGridState('spec-icon-grid', this.defs);
  readonly rows = ROWS.slice(0, 2);
  readonly key = (r: Row): number => r.id;
}

describe('record grid icon-only column (#723)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideFakeMe(new FakeMeApi(withPermissions()))],
    });
  });

  it('reads the heading to a screen reader without drawing it, and opts the column out of resize and reorder', () => {
    const fixture = TestBed.createComponent(IconHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const head = el.querySelector<HTMLElement>('th[data-col="star"]');
    expect(head?.querySelector('.pg-sr')?.textContent?.trim()).toBe('Favourite');
    expect(head?.hasAttribute('data-no-resize')).toBe(true);
    expect(head?.hasAttribute('data-no-reorder')).toBe(true);
    expect(el.querySelector('th[data-col="name"]')?.hasAttribute('data-no-resize')).toBe(false);
    expect(el.querySelectorAll('td[data-star]').length).toBe(2);
  });
});
