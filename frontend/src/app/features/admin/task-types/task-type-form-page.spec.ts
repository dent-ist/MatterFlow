import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';

import { apiError } from '../../../core/lookups/lookups-testing';
import {
  LeaveConfirmService,
  unsavedChangesGuard,
} from '../../../shared/guards/unsaved-changes.guard';
import { FormDesignerApi } from './form-designer-api';
import { InMemoryFormDesignerApi } from './in-memory-form-designer-api';
import { TaskTypeFormPage } from './task-type-form-page';

describe('TaskTypeFormPage', () => {
  let fixture: ComponentFixture<TaskTypeFormPage>;
  let api: InMemoryFormDesignerApi;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = el()): T =>
    root.querySelector<T>(sel)!;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  const button = (label: string, root: ParentNode = el()): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('p-button button')).find(
      (b) => b.textContent!.trim() === label,
    );

  async function press(label: string, root: ParentNode = el()): Promise<void> {
    button(label, root)!.click();
    await settle();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        InMemoryFormDesignerApi,
        { provide: FormDesignerApi, useExisting: InMemoryFormDesignerApi },
      ],
    });
    api = TestBed.inject(InMemoryFormDesignerApi);
    fixture = TestBed.createComponent(TaskTypeFormPage);
    await settle();
  });

  it('renders when the router leaves parentCrumbs undefined (routes without that data key, e.g. Custom Fields and Task Types)', async () => {
    fixture.componentRef.setInput('parentCrumbs', undefined);
    await settle();
    expect(q('[data-status]').textContent).toContain('Published v1');
    expect(el().querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull();
  });

  it('opens the published version read-only with a Create new draft action', async () => {
    expect(q('[data-status]').textContent).toContain('Published v1');
    expect(q('[data-readonly-banner]').textContent).toContain("can't be edited");
    expect(el().querySelector('[data-add]')).toBeNull();
    expect(button('Save draft')).toBeUndefined();
    expect(button('Publish...')).toBeUndefined();
    expect(button('Create new draft')).toBeDefined();
    // The baseline example is shown and works in the preview.
    expect(el().querySelector('mf-dynamic-form [data-field="requires_ocr"]')).not.toBeNull();
  });

  it('creates a draft from the published version, edits and saves it', async () => {
    await press('Create new draft');
    expect(q('[data-status]').textContent).toContain('Draft v2');
    expect(q('[data-status]').textContent).toContain('published: v1');
    expect(el().querySelector('[data-add]')).not.toBeNull();
    expect(button('Save draft')!.disabled).toBe(true);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

    q('[data-add="TEXT"]').click();
    await settle();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    expect(button('Save draft')!.disabled).toBe(false);

    await press('Save draft');
    expect(q('[role=status]:not(.fd__sr)').textContent).toContain('Draft v2 saved.');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    const saved = await new Promise<number>((resolve) =>
      api.getVersion('data-processing', 'v2').subscribe((v) => resolve(v.definition.fields.length)),
    );
    expect(saved).toBe(5);
  });

  it('publishes through a dialog that shows the diff, then locks the version', async () => {
    await press('Create new draft');
    q('[data-add="TEXT"]').click();
    await settle();
    await press('Save draft');
    await press('Publish...');

    const dialog = q('[data-dialog="publish"]', document.body);
    // The primary action has focus; the Version note stays reachable (#362).
    expect(document.activeElement?.textContent?.trim()).toBe('Publish v2');
    expect(dialog.querySelector('#ttf-note')).not.toBeNull();
    expect(dialog.textContent).toContain('Added: Text');
    expect(dialog.textContent).toContain('Existing tasks keep form version 1');
    expect(dialog.textContent).toContain("Published versions can't be edited.");

    await press('Publish v2', document.body);
    expect(q('[data-status]').textContent).toContain('Published v2');
    expect(q('[data-readonly-banner]')).not.toBeNull();
    const rows = Array.from(el().querySelectorAll('.ttf__table tbody tr')).map((r) =>
      r.textContent!.replace(/\s+/g, ' '),
    );
    expect(rows[0]).toContain('Published');
    expect(rows[1]).toContain('Retired');
  });

  it('blocks publishing while the definition has errors', async () => {
    await press('Create new draft');
    q('[data-add="SELECT"]').click();
    await settle();
    for (let i = 0; i < 2; i++) {
      q<HTMLButtonElement>('button[aria-label^="Remove option"]').click();
      await settle();
    }
    expect(q('[data-issue="EMPTY_OPTIONS"]').textContent).toContain('Add at least one option.');
    expect(button('Publish...')!.disabled).toBe(true);
  });

  it('asks before discarding unsaved changes when switching versions', async () => {
    await press('Create new draft');
    q('[data-add="TEXT"]').click();
    await settle();
    const v1 = Array.from(el().querySelectorAll<HTMLButtonElement>('.ttf__link')).find(
      (b) => b.textContent!.trim() === 'v1',
    )!;
    v1.click();
    await settle();
    expect(q('[data-dialog="discard"]', document.body)).not.toBeNull();
    await press('Keep editing', document.body);
    expect(q('[data-status]').textContent).toContain('Draft v2');

    v1.click();
    await settle();
    await press('Discard changes', document.body);
    expect(q('[data-status]').textContent).toContain('Published v1');
  });

  it('shows the server publish validation errors inline and keeps the draft editable', async () => {
    await press('Create new draft');
    q('[data-add="TEXT"]').click();
    await settle();
    await press('Save draft');
    vi.spyOn(api, 'publish').mockReturnValue(
      throwError(() =>
        apiError(400, 'PUBLISH_VALIDATION_FAILED', 'The form cannot be published: 2 problem(s).', {
          'form:requires_ocr': [
            { code: 'INVALID_FIELD_KEY', message: 'The server rejects this key.' },
          ],
          form: [{ code: 'SCHEMA_VIOLATION', message: 'The server found a form-level problem.' }],
        }),
      ),
    );
    await press('Publish...');
    await press('Publish v2', document.body);

    expect(q('[role=alert]').textContent).toContain('The server found 2 problems');
    const issues = el().querySelector('.fd__issue-list')!.textContent!;
    expect(issues).toContain('The server rejects this key.');
    expect(issues).toContain('The server found a form-level problem.');
    expect(q('[data-status]').textContent).toContain('Draft v2');
    expect(button('Save draft')).toBeDefined();

    // Editing clears the server's issues until the next publish attempt.
    q('[data-add="TEXT"]').click();
    await settle();
    expect(el().querySelector('.fd__issue-list')?.textContent ?? '').not.toContain(
      'The server rejects this key.',
    );
  });

  it('offers a conflict dialog when the draft changed under the editor', async () => {
    await press('Create new draft');
    q('[data-add="TEXT"]').click();
    await settle();
    const save = vi
      .spyOn(api, 'saveDraft')
      .mockReturnValue(
        throwError(() => apiError(409, 'CONCURRENCY_CONFLICT', 'Someone else changed this.')),
      );
    await press('Save draft');

    expect(q('[data-dialog="conflict"]', document.body)).not.toBeNull();
    expect(el().querySelector('[role=alert]')).toBeNull();

    // Keep my changes: the latest version is reloaded but the local edits stay.
    save.mockRestore();
    await press('Keep my changes', document.body);
    expect(document.body.querySelector('[data-dialog="conflict"]')).toBeNull();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    expect(q('[role=status]:not(.fd__sr)').textContent).toContain('Your edits are kept');
    await press('Save draft');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('reloads the latest draft and drops local edits from the conflict dialog', async () => {
    await press('Create new draft');
    q('[data-add="TEXT"]').click();
    await settle();
    vi.spyOn(api, 'saveDraft').mockReturnValue(
      throwError(() => apiError(409, 'CONCURRENCY_CONFLICT', 'Someone else changed this.')),
    );
    await press('Save draft');
    await press('Reload latest', document.body);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('retires a published version after confirmation', async () => {
    await press('Retire version');
    expect(q('[data-dialog="retire"]', document.body)).not.toBeNull();
    // The dialog opens on its primary action and uses the shared wording (#362).
    expect(document.activeElement?.textContent?.trim()).toBe('Retire v1');
    await press('Retire v1', document.body.querySelector('[data-dialog="retire"]')!);
    expect(q('[data-status]').textContent).toContain('Retired v1');
  });
});

describe('unsavedChangesGuard', () => {
  function run(dirty: boolean): unknown {
    return TestBed.runInInjectionContext(() =>
      unsavedChangesGuard({ hasUnsavedChanges: () => dirty }, null!, null!, null!),
    );
  }

  it('lets clean screens go without asking', () => {
    expect(run(false)).toBe(true);
    expect(TestBed.inject(LeaveConfirmService).open()).toBe(false);
  });

  it('asks in the themed dialog when dirty and honours the answer', async () => {
    const service = TestBed.inject(LeaveConfirmService);
    const stay = run(true) as Promise<boolean>;
    expect(service.open()).toBe(true);
    service.answer(false);
    expect(await stay).toBe(false);
    expect(service.open()).toBe(false);

    const leave = run(true) as Promise<boolean>;
    service.answer(true);
    expect(await leave).toBe(true);
  });
});
