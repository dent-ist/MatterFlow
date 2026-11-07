import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  ReportViewLayout,
  ReportViewResponse,
  ReportViewsClient,
} from '../../api/generated/api-client';
import { NotificationService } from '../../core/notify/notification.service';
import { apiError, settle } from '../../shared/testing/org-testing';
import { ReportViewsMenu } from './report-views-menu';
import { ReportViewsStore } from './report-views-store';
import { aView } from './reports-testing';

type Mock = ReturnType<typeof vi.fn>;

const layout = (pageSize = 50): ReportViewLayout => ({
  columns: [{ name: 'Matter', hidden: false, width: undefined }],
  sort: [],
  filters: [],
  pageSize,
});

describe('ReportViewsMenu (#722)', () => {
  let api: Record<string, Mock>;
  let fixture: ComponentFixture<ReportViewsMenu>;
  let notify: NotificationService;
  let picked: (ReportViewResponse | null)[];
  let saved: ReportViewResponse[];
  let removed: number[];
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));
  const dialog = (sel: string): HTMLElement | null => document.body.querySelector<HTMLElement>(sel);
  const toasts = () => notify.toasts().map((t) => t.summary);

  async function create(
    views: ReportViewResponse[] = [],
    inputs: { appliedId?: number | null; modified?: boolean; limit?: number } = {},
  ): Promise<void> {
    api = {
      listReportViews: vi.fn().mockReturnValue(of({ views, limit: inputs.limit ?? 25 })),
      createReportView: vi.fn(),
      updateReportView: vi.fn(),
      deleteReportView: vi.fn().mockReturnValue(of(undefined)),
      setDefaultReportView: vi.fn(),
      clearDefaultReportView: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [ReportViewsStore, { provide: ReportViewsClient, useValue: api }],
    });
    notify = TestBed.inject(NotificationService);
    await TestBed.inject(ReportViewsStore).load(5);
    fixture = TestBed.createComponent(ReportViewsMenu);
    fixture.componentRef.setInput('reportId', 5);
    fixture.componentRef.setInput('reportName', 'Overdue tasks');
    fixture.componentRef.setInput('current', layout());
    fixture.componentRef.setInput('appliedId', inputs.appliedId ?? null);
    fixture.componentRef.setInput('modified', inputs.modified ?? false);
    picked = [];
    saved = [];
    removed = [];
    fixture.componentInstance.pick.subscribe((v) => picked.push(v));
    fixture.componentInstance.saved.subscribe((v) => saved.push(v));
    fixture.componentInstance.removed.subscribe((v) => removed.push(v));
    await settle(fixture);
  }

  const openMenu = async (): Promise<void> => {
    q('[data-views-trigger]').click();
    await settle(fixture);
  };
  const press = async (sel: string): Promise<void> => {
    q(sel).click();
    await settle(fixture);
  };
  const type = async (value: string): Promise<void> => {
    const input = dialog('#rv-view-name') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
  };
  const submit = async (): Promise<void> => {
    dialog('[data-panel-primary] button')!.click();
    await settle(fixture);
  };

  afterEach(() => {
    fixture?.destroy();
    document.body.querySelectorAll('.p-dialog-mask').forEach((n) => n.remove());
  });

  describe('keyboard focus (#726)', () => {
    const trigger = (): HTMLElement => q('[data-views-trigger]');

    it('puts focus back on the Saved Views button when an item closes the menu, because the item is gone', async () => {
      await create([aView({ viewId: 1, name: 'Mine' })]);
      await openMenu();
      q('[data-view-apply]').focus();
      await press('[data-view-apply]');
      expect(el().querySelector('[data-views-panel]')).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('returns focus to the Saved Views button when a dialog opened from the menu is cancelled (Save as New View, Rename, Delete)', async () => {
      await create([aView({ viewId: 1, name: 'Mine' })]);
      for (const [sel, dialogSel] of [
        ['[data-view-save-new]', '#rv-view-name'],
        ['[data-view-rename]', '#rv-view-name'],
        ['[data-view-delete]', '[data-view-delete-text]'],
      ] as const) {
        await openMenu();
        q(sel).focus();
        await press(sel);
        expect(dialog(dialogSel), sel).not.toBeNull();
        Array.from(document.body.querySelectorAll<HTMLElement>('.p-dialog button'))
          .find((b) => b.textContent!.trim() === 'Cancel')!
          .click();
        await settle(fixture);
        await new Promise((r) => setTimeout(r, 400));
        await settle(fixture);
        expect(document.activeElement, sel).toBe(trigger());
      }
    });
  });

  describe('the button', () => {
    it('says Saved Views when no view is applied, the name of the applied view, and "(modified)" after a change', async () => {
      await create([aView({ viewId: 1, name: 'Mine' })]);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Saved Views');
      expect(q('[data-views-trigger]').getAttribute('aria-haspopup')).toBe('true');
      fixture.componentRef.setInput('appliedId', 1);
      await settle(fixture);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Mine');
      expect(q('[data-views-trigger]').getAttribute('aria-label')).toBe('Saved Views: Mine');
      fixture.componentRef.setInput('modified', true);
      await settle(fixture);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Mine (modified)');
    });
  });

  describe('the menu', () => {
    it('lists Default first with a check when no view is applied, then one row per view with its name, the Default chip and the check on the applied one', async () => {
      await create(
        [aView({ viewId: 1, name: 'Weekly', isDefault: true }), aView({ viewId: 2, name: 'Zeta' })],
        { appliedId: 2 },
      );
      await openMenu();
      expect(q('[data-views-panel]').getAttribute('aria-label')).toBe('Saved Views');
      expect(all('.rv__name').map((n) => n.textContent!.trim())).toEqual([
        'Default',
        'Weekly',
        'Zeta',
      ]);
      expect(all('[data-view-default-chip]').map((c) => c.textContent!.trim())).toEqual([
        'Default',
      ]);
      expect(q('[data-view-default-row]').getAttribute('aria-current')).toBeNull();
      expect(all('[data-view-apply]').map((b) => b.getAttribute('aria-current'))).toEqual([
        null,
        'true',
      ]);
    });

    it('checks the Default row when no view is applied', async () => {
      await create([aView({ viewId: 1 })]);
      await openMenu();
      expect(q('[data-view-default-row]').getAttribute('aria-current')).toBe('true');
    });

    it('applies a view or the Default row by telling the grid, and closes', async () => {
      await create([aView({ viewId: 7, name: 'Mine' })]);
      await openMenu();
      await press('[data-view-apply]');
      expect(picked.map((v) => v?.viewId)).toEqual([7]);
      expect(el().querySelector('[data-views-panel]')).toBeNull();
      await openMenu();
      await press('[data-view-default-row]');
      expect(picked.at(-1)).toBeNull();
    });

    it('gives Rename and Delete icon buttons named for their view', async () => {
      await create([aView({ viewId: 7, name: 'Mine' })]);
      await openMenu();
      expect(q('[data-view-rename]').getAttribute('aria-label')).toBe('Rename Mine');
      expect(q('[data-view-delete]').getAttribute('aria-label')).toBe('Delete Mine');
    });

    it('says it could not load the views and offers Retry', async () => {
      await create();
      api['listReportViews'].mockReturnValue(throwError(() => new Error('down')));
      await TestBed.inject(ReportViewsStore).load(5);
      await openMenu();
      expect(q('[data-views-error]').textContent).toContain("Couldn't load saved views.");
      api['listReportViews'].mockReturnValue(of({ views: [aView({ name: 'Back' })], limit: 25 }));
      await press('[data-views-retry]');
      expect(q('[data-views-list]').textContent).toContain('Back');
    });
  });

  describe('Save View, Save as New View and the default', () => {
    it('has no Save View while no view is applied; Save as New View is always there', async () => {
      await create([aView()]);
      await openMenu();
      expect(el().querySelector('[data-view-save]')).toBeNull();
      expect(el().querySelector('[data-view-set-default]')).toBeNull();
      expect(q('[data-view-save-new]').textContent!.trim()).toBe('Save as New View...');
    });

    it('disables Save View with "No changes to save." until the grid differs from the applied view', async () => {
      await create([aView({ viewId: 1 })], { appliedId: 1, modified: false });
      await openMenu();
      expect(q('[data-view-save]').getAttribute('aria-disabled')).toBe('true');
      await press('[data-view-save]');
      expect(api['updateReportView']).not.toHaveBeenCalled();
      fixture.componentRef.setInput('modified', true);
      await settle(fixture);
      expect(q('[data-view-save]').getAttribute('aria-disabled')).toBeNull();
    });

    it('stores the current layout in the applied view, says "View saved." and tells the grid', async () => {
      const current = aView({ viewId: 1, name: 'Mine' });
      await create([current], { appliedId: 1, modified: true });
      api['updateReportView'].mockReturnValue(of({ ...current, layout: layout() }));
      await openMenu();
      await press('[data-view-save]');
      expect(api['updateReportView']).toHaveBeenCalledWith(5, 1, {
        name: undefined,
        layout: layout(),
      });
      expect(toasts()).toEqual(['View saved.']);
      expect(saved.map((v) => v.viewId)).toEqual([1]);
    });

    it('says "Couldn\'t save the view." with Retry when the update fails, and Retry tries again', async () => {
      await create([aView({ viewId: 1 })], { appliedId: 1, modified: true });
      api['updateReportView'].mockReturnValue(throwError(() => new Error('down')));
      await openMenu();
      await press('[data-view-save]');
      const toast = notify.toasts()[0];
      expect(toast.summary).toBe("Couldn't save the view.");
      expect(toast.action?.label).toBe('Retry');
      api['updateReportView'].mockReturnValue(of(aView({ viewId: 1 })));
      toast.action!.run();
      await settle(fixture);
      expect(api['updateReportView']).toHaveBeenCalledTimes(2);
      expect(toasts()).toContain('View saved.');
    });

    it('opens "Save View" with the field "View name (required)" prefilled "<Report name> view" and an unchecked default box', async () => {
      await create([aView()]);
      await openMenu();
      await press('[data-view-save-new]');
      expect(dialog('[data-panel-title]')!.textContent).toContain('Save View');
      const field = dialog('#rv-view-name') as HTMLInputElement;
      expect(field.value).toBe('Overdue tasks view');
      expect(dialog('label[for="rv-view-name"]')!.textContent).toContain('View name');
      expect(dialog('label[for="rv-view-name"]')!.textContent).toContain('(required)');
      const box = dialog('[data-view-make-default]') as HTMLInputElement;
      expect(box.checked).toBe(false);
      expect(dialog('.rv__check')!.textContent).toContain('Use as my default view');
      expect(el().querySelector('[data-views-panel]')).toBeNull();
    });

    it('creates the view with the current layout and the default choice, then says "View saved." and tells the grid', async () => {
      await create([aView()]);
      api['createReportView'].mockReturnValue(
        of(aView({ viewId: 9, name: 'Weekly', isDefault: true })),
      );
      await openMenu();
      await press('[data-view-save-new]');
      await type('Weekly');
      (dialog('[data-view-make-default]') as HTMLInputElement).click();
      await settle(fixture);
      await submit();
      expect(api['createReportView']).toHaveBeenCalledWith(5, {
        name: 'Weekly',
        layout: layout(),
        isDefault: true,
      });
      expect(toasts()).toEqual(['View saved.']);
      expect(saved.map((v) => v.viewId)).toEqual([9]);
      expect(dialog('.p-dialog')).toBeNull();
    });

    it('validates the name: empty, over 80 characters, and a name another view has in another case; nothing is sent', async () => {
      await create([aView({ viewId: 1, name: 'Weekly' })]);
      await openMenu();
      await press('[data-view-save-new]');
      await type('  ');
      await submit();
      expect(dialog('.mf-field__error')!.textContent).toContain('Enter a view name.');
      await type('x'.repeat(81));
      await submit();
      expect(dialog('.mf-field__error')!.textContent).toContain(
        'View name must be 80 characters or fewer.',
      );
      await type('WEEKLY');
      await submit();
      expect(dialog('.mf-field__error')!.textContent).toContain(
        'You already have a view with this name.',
      );
      expect(api['createReportView']).not.toHaveBeenCalled();
      await type('Fine');
      expect(dialog('.mf-field__error')).toBeNull();
    });

    it('puts the refusal of the server under the field: a name taken in the meantime', async () => {
      await create();
      api['createReportView'].mockReturnValue(apiError(409, { code: 'VIEW_NAME_EXISTS' }));
      await openMenu();
      await press('[data-view-save-new]');
      await submit();
      expect(dialog('.mf-field__error')!.textContent).toContain(
        'You already have a view with this name.',
      );
      expect(toasts()).toEqual([]);
    });

    it('shows the limit sentence in the dialog when the server says the limit is reached, and "Couldn\'t save the view." for any other failure', async () => {
      await create();
      api['createReportView'].mockReturnValue(apiError(409, { code: 'VIEW_LIMIT_REACHED' }));
      await openMenu();
      await press('[data-view-save-new]');
      await submit();
      expect(dialog('[data-panel-error]')!.textContent).toContain(
        'You can save up to 25 views for this report.',
      );
      api['createReportView'].mockReturnValue(throwError(() => new Error('down')));
      await submit();
      expect(dialog('[data-panel-error]')!.textContent).toContain("Couldn't save the view.");
      expect(saved).toEqual([]);
    });

    it('disables Save as New View with the limit sentence at 25 views and does not open the dialog', async () => {
      const views = Array.from({ length: 25 }, (_, i) =>
        aView({ viewId: i + 1, name: `View ${i + 1}` }),
      );
      await create(views);
      await openMenu();
      const button = q('[data-view-save-new]');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      button.click();
      await settle(fixture);
      expect(dialog('.p-dialog')).toBeNull();
    });

    it('sets the applied view as the default ("Default view set.") and removes the default ("Default view removed.")', async () => {
      await create([aView({ viewId: 1, name: 'Mine' })], { appliedId: 1 });
      api['setDefaultReportView'].mockReturnValue(
        of(aView({ viewId: 1, name: 'Mine', isDefault: true })),
      );
      await openMenu();
      await press('[data-view-set-default]');
      expect(api['setDefaultReportView']).toHaveBeenCalledWith(5, 1);
      expect(toasts()).toEqual(['Default view set.']);
      await openMenu();
      expect(el().querySelector('[data-view-set-default]')).toBeNull();
      expect(q('[data-view-default-chip]')).not.toBeNull();
      api['clearDefaultReportView'].mockReturnValue(of(aView({ viewId: 1, name: 'Mine' })));
      await press('[data-view-clear-default]');
      expect(api['clearDefaultReportView']).toHaveBeenCalledWith(5, 1);
      expect(toasts()).toEqual(['Default view set.', 'Default view removed.']);
      await openMenu();
      expect(q('[data-view-set-default]')).not.toBeNull();
    });

    it('offers neither default action for the Default row (no view applied)', async () => {
      await create([aView({ viewId: 1 })]);
      await openMenu();
      expect(el().querySelector('[data-view-set-default], [data-view-clear-default]')).toBeNull();
    });
  });

  describe('Rename and Delete', () => {
    it('renames in a dialog titled "Rename View" prefilled with the name, then says "View renamed."', async () => {
      await create([aView({ viewId: 1, name: 'Mine' }), aView({ viewId: 2, name: 'Other' })]);
      api['updateReportView'].mockReturnValue(of(aView({ viewId: 1, name: 'Better' })));
      await openMenu();
      await press('[data-view-rename]');
      expect(dialog('[data-panel-title]')!.textContent).toContain('Rename View');
      expect((dialog('#rv-view-name') as HTMLInputElement).value).toBe('Mine');
      expect(dialog('[data-panel-primary]')!.textContent!.trim()).toBe('Rename');
      expect(dialog('[data-view-make-default]')).toBeNull();
      await type('Better');
      await submit();
      expect(api['updateReportView']).toHaveBeenCalledWith(5, 1, {
        name: 'Better',
        layout: undefined,
      });
      expect(toasts()).toEqual(['View renamed.']);
    });

    it('refuses a rename to the name of another view but allows a change of case of its own name', async () => {
      await create([aView({ viewId: 1, name: 'Mine' }), aView({ viewId: 2, name: 'Other' })]);
      api['updateReportView'].mockReturnValue(of(aView({ viewId: 1, name: 'MINE' })));
      await openMenu();
      await press('[data-view-rename]');
      await type('other');
      await submit();
      expect(dialog('.mf-field__error')!.textContent).toContain('You already have a view');
      expect(api['updateReportView']).not.toHaveBeenCalled();
      await type('MINE');
      await submit();
      expect(api['updateReportView']).toHaveBeenCalledTimes(1);
    });

    it('asks before it deletes: "Delete \\"<name>\\"? This can\'t be undone.", then deletes, says "View deleted." and tells the grid', async () => {
      await create([aView({ viewId: 4, name: 'Mine' })]);
      await openMenu();
      await press('[data-view-delete]');
      expect(dialog('.p-dialog-title')!.textContent).toContain('Delete View');
      expect(dialog('[data-view-delete-text]')!.textContent).toContain(
        'Delete "Mine"? This can\'t be undone.',
      );
      expect(api['deleteReportView']).not.toHaveBeenCalled();
      const confirm = Array.from(
        document.body.querySelectorAll<HTMLElement>('.p-dialog button'),
      ).find((b) => b.textContent!.trim() === 'Delete View')!;
      confirm.click();
      await settle(fixture);
      expect(api['deleteReportView']).toHaveBeenCalledWith(5, 4);
      expect(toasts()).toEqual(['View deleted.']);
      expect(removed).toEqual([4]);
    });

    it('keeps the view when Delete is cancelled', async () => {
      await create([aView({ viewId: 4, name: 'Mine' })]);
      await openMenu();
      await press('[data-view-delete]');
      const cancel = Array.from(
        document.body.querySelectorAll<HTMLElement>('.p-dialog button'),
      ).find((b) => b.textContent!.trim() === 'Cancel')!;
      cancel.click();
      await settle(fixture);
      expect(api['deleteReportView']).not.toHaveBeenCalled();
      expect(removed).toEqual([]);
    });
  });
});
