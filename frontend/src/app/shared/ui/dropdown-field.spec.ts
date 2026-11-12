import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dropdown, DropdownItem } from './dropdown';

const ITEMS: DropdownItem[] = [
  { value: '', label: 'None' },
  { value: 'a', label: 'Produced by Us' },
  { value: 'b', label: 'Received' },
];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dropdown],
  template: `
    <mf-dropdown id="flt" label="Filter" [items]="items" [value]="value()" />
    <mf-dropdown id="fld" label="Field" [items]="items" [value]="value()" field />
    <mf-dropdown
      id="fldnull"
      label="Field Null"
      [items]="items"
      [value]="value()"
      field
      [neutralValue]="null"
    />
  `,
})
class Host {
  readonly items = ITEMS;
  readonly value = signal('a');
}

/** Dropdowns that sit inside a form, a dialog or a record page (D-44r, #1264): every one is a white field. */
const FORM_FILES = [
  'app/shared/availability/absences/absence-dialog.ts',
  'app/shared/availability/time-zone-select.ts',
  'app/shared/availability/set-out-of-office-dialog.ts',
  'app/shared/work-queue/bulk-tasks-dialog.ts',
  'app/features/admin/task-types/task-type-edit-page.html',
  'app/features/admin/asset-types/asset-type-record-page.html',
  'app/features/admin/note-tags/note-tags-page.ts',
  'app/features/admin/holidays/holiday-dialog.ts',
  'app/features/admin/holidays/user-calendar-field.ts',
  'app/features/admin/holidays/holidays-admin.ts',
  'app/features/admin/priorities/priority-dialog.ts',
  'app/features/admin/roles/roles-page.html',
  'app/features/admin/reports/preview-panel.ts',
  'app/features/admin/reports/report-editor-page.html',
  'app/features/admin/reports/parameters-editor.ts',
  'app/features/tasks/detail/task-action-dialogs.ts',
  'app/features/tasks/detail/task-edit-dialog.ts',
  'app/features/tasks/panels/task-asset-links.ts',
  'app/features/tasks/create/create-task-page.html',
  'app/features/assets/pages/asset-form-page.ts',
  'app/features/matters/ui/matter-form.ts',
  'app/features/matters/ui/matter-managers-dialog.ts',
  'app/features/notes/notes-tab.ts',
  'app/features/my-matters/ui/event-dialog.ts',
];
/** Files that mix a filter toolbar and a form: the form dropdowns are found by their button id. */
const MIXED: Record<string, string[]> = {
  'app/features/productions/productions-tab.ts': ['pf-direction', 'pf-spec'],
};

const source = (file: string): string => readFileSync(join(process.cwd(), 'src', file), 'utf8');
const tags = (src: string): string[] => src.match(/<mf-dropdown\b[^>]*>/gs) ?? [];
const hasField = (tag: string): boolean => /\sfield(\s|\/|>)/.test(tag);

describe('Dropdown field (D-44r, #1264)', () => {
  it('a field dropdown with a value is a white field; a filter dropdown with a value is blue', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('mf-dropdown button.btn'));
    expect(buttons.length).toBe(3);
    expect(buttons[0].classList.contains('on')).toBe(true);
    expect(buttons[1].classList.contains('on')).toBe(false);
    expect(buttons[2].classList.contains('on')).toBe(false);
  });

  it('the blue fill is drawn only for .btn.on and never for a field', () => {
    const css = source('app/shared/ui/dropdown.ts');
    expect(css).toContain('[class.on]="highlighted() && !field()"');
    expect(css).toMatch(/\.btn\.on \{[^}]*background: var\(--mf-sem-info-bg\)/s);
  });

  it('every dropdown inside a form, dialog or record page is a field', () => {
    for (const file of FORM_FILES) {
      const found = tags(source(file));
      expect(found.length, file).toBeGreaterThan(0);
      for (const t of found) expect(hasField(t), `${file}: ${t.slice(0, 120)}`).toBe(true);
    }
    for (const [file, ids] of Object.entries(MIXED)) {
      for (const id of ids) {
        const t = tags(source(file)).find((x) => x.includes(`buttonId="${id}"`));
        expect(t, `${file} ${id}`).toBeDefined();
        expect(hasField(t!), `${file} ${id}`).toBe(true);
      }
    }
  });
});
