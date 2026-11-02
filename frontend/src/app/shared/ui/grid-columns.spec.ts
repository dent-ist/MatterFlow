import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GridColumns } from './grid-columns';
import { GridColumnDef, GridPrefs, shownKeys } from './grid-prefs';

const DEFS: GridColumnDef[] = [
  { key: 'ref', label: 'Ref', locked: true, pinned: true },
  { key: 'type', label: 'Type' },
  { key: 'title', label: 'Title', locked: true },
  { key: 'project', label: 'Project', defaultHidden: true },
  { key: 'due', label: 'Due' },
];

@Component({
  imports: [GridColumns],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-grid-columns
    [defs]="defs"
    [prefs]="prefs()"
    (prefsChange)="prefs.set($event)"
    (resetColumns)="resets = resets + 1; prefs.set({ order: [], visible: null })"
  />`,
})
class Host {
  readonly defs = DEFS;
  readonly prefs = signal<GridPrefs>({ order: [], visible: null });
  resets = 0;
}

describe('GridColumns menu (MD-28, #1032)', () => {
  async function start() {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-grid-columns]')!
      .click();
    f.detectChanges();
    return f;
  }
  const q = (f: { nativeElement: HTMLElement }, s: string) =>
    f.nativeElement.querySelector<HTMLElement>(s)!;

  it('lists every column, locks Ref and Title and offers moves only for shown, unpinned columns', async () => {
    const f = await start();
    const rows = Array.from((f.nativeElement as HTMLElement).querySelectorAll('[data-row]')).map(
      (r) => r.getAttribute('data-row'),
    );
    expect(rows).toEqual(['ref', 'type', 'title', 'project', 'due']);
    expect((q(f, '[data-column="ref"]') as HTMLInputElement).disabled).toBe(true);
    expect((q(f, '[data-column="title"]') as HTMLInputElement).disabled).toBe(true);
    expect(q(f, '[data-column="project"]')).not.toBeNull();
    expect(f.nativeElement.querySelector('[data-move="ref:left"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-move="project:left"]')).toBeNull();
    expect(q(f, '[data-move="type:left"]').getAttribute('aria-label')).toBe('Move Type left');
  });

  it('moves a column with the buttons and announces it', async () => {
    const f = await start();
    q(f, '[data-move="due:left"]').click();
    f.detectChanges();
    expect(shownKeys(DEFS, f.componentInstance.prefs())).toEqual(['ref', 'type', 'due', 'title']);
    expect(q(f, '[data-grid-columns-status]').textContent).toContain('Due moved left');
  });

  it('shows and hides a column', async () => {
    const f = await start();
    const box = q(f, '[data-column="project"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(shownKeys(DEFS, f.componentInstance.prefs())).toContain('project');
    const due = q(f, '[data-column="due"]') as HTMLInputElement;
    due.checked = false;
    due.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(shownKeys(DEFS, f.componentInstance.prefs())).not.toContain('due');
  });

  it('resets to the default order and visibility', async () => {
    const f = await start();
    q(f, '[data-move="due:left"]').click();
    f.detectChanges();
    q(f, '[data-grid-columns-reset]').click();
    f.detectChanges();
    expect(f.componentInstance.resets).toBe(1);
    expect(shownKeys(DEFS, f.componentInstance.prefs())).toEqual(['ref', 'type', 'title', 'due']);
  });
});
