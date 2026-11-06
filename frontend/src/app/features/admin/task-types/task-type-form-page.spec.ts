import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';

import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
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
  const all = (sel: string, root: ParentNode = el()): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(sel));

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  /** A button of the header (`[data-page-actions]`) or of a dialog (`p-button`). */
  const button = (label: string, root: ParentNode = el()): HTMLButtonElement | undefined =>
    Array.from(
      root.querySelectorAll<HTMLButtonElement>('p-button button, [data-page-actions] button'),
    ).find((b) => b.textContent!.trim() === label);
  const disabled = (b: HTMLButtonElement | undefined): boolean =>
    !!b && (b.disabled || b.getAttribute('aria-disabled') === 'true');

  /** "Versions (n)": the first entry of the "..." menu of the header; it opens the drawer. */
  async function openVersions(): Promise<void> {
    q('[data-page-actions] button[data-overflow]').click();
    await settle();
    q('[role=menuitem][data-action="versions"]').click();
    await settle();
  }

  async function press(label: string, root: ParentNode = el()): Promise<void> {
    button(label, root)!.click();
    await settle();
  }

  /** Opens the Versions drawer and chooses a version in it. */
  async function chooseVersion(label: string): Promise<void> {
    await openVersions();
    const link = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[data-dialog="versions"] button'),
    ).find((b) => b.textContent!.trim() === label)!;
    link.click();
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
    expect(q('[data-status-badge]').textContent).toContain('Published v1');
    expect(el().querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull();
  });

  it('opens the published version read-only with a Create new draft action', async () => {
    expect(q('[data-status-badge]').textContent).toContain('Published v1');
    expect(q('[data-readonly-banner]').textContent).toContain("can't be edited");
    expect(el().querySelector('[data-add]')).toBeNull();
    expect(button('Save Draft')).toBeUndefined();
    expect(button('Publish...')).toBeUndefined();
    expect(button('Create New Draft')).toBeDefined();
    // The baseline example is shown and works in the preview.
    expect(el().querySelector('mf-dynamic-form [data-field="requires_ocr"]')).not.toBeNull();
  });

  it('creates a draft from the published version, edits and saves it', async () => {
    await press('Create New Draft');
    expect(q('[data-status-badge]').textContent).toContain('Draft v2');
    expect(q('[data-published-note]').textContent).toContain('published: v1');
    expect(el().querySelector('[data-add]')).not.toBeNull();
    expect(disabled(button('Save Draft'))).toBe(true);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

    q('[data-add="TEXT"]').click();
    await settle();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    expect(disabled(button('Save Draft'))).toBe(false);

    await press('Save Draft');
    expect(q('[data-notice]').textContent).toContain('Draft v2 saved.');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    const saved = await new Promise<number>((resolve) =>
      api.getVersion('data-processing', 'v2').subscribe((v) => resolve(v.definition.fields.length)),
    );
    expect(saved).toBe(5);
  });

  it('publishes through a dialog that shows the diff, then locks the version', async () => {
    await press('Create New Draft');
    q('[data-add="TEXT"]').click();
    await settle();
    await press('Save Draft');
    await press('Publish...');

    const dialog = q('[data-dialog="publish"]', document.body);
    // The primary action has focus; the Version note stays reachable (#362).
    expect(document.activeElement?.textContent?.trim()).toBe('Publish v2');
    expect(dialog.querySelector('#ttf-note')).not.toBeNull();
    expect(dialog.textContent).toContain('Added: Text');
    expect(dialog.textContent).toContain('Existing tasks keep form version 1');
    expect(dialog.textContent).toContain("Published versions can't be edited.");

    await press('Publish v2', document.body);
    expect(q('[data-status-badge]').textContent).toContain('Published v2');
    expect(q('[data-readonly-banner]')).not.toBeNull();
    await openVersions();
    const rows = Array.from(document.body.querySelectorAll('.ttf__table tbody tr')).map((r) =>
      r.textContent!.replace(/\s+/g, ' '),
    );
    expect(rows[0]).toContain('Published');
    expect(rows[1]).toContain('Retired');
  });

  it('Publish... with errors left shows the Validation tab instead of the dialog', async () => {
    await press('Create New Draft');
    q('[data-add="SELECT"]').click();
    await settle();
    for (let i = 0; i < 2; i++) {
      q<HTMLButtonElement>('button[aria-label^="Remove option"]').click();
      await settle();
    }
    expect(q('[data-issue="EMPTY_OPTIONS"]').textContent).toContain('Add at least one option.');
    // The button is not disabled without a reason: it explains and moves to the list of errors.
    expect(disabled(button('Publish...'))).toBe(false);
    await press('Publish...');
    expect(document.body.querySelector('[data-dialog="publish"]')).toBeNull();
    expect(q('[role=alert]').textContent).toMatch(/Fix \d+ errors? before publishing/);
    expect(q('[data-tab="issues"]').getAttribute('aria-selected')).toBe('true');
    expect(q('[data-panel="issues"]').hidden).toBe(false);
  });

  it('puts the version in the title as a badge with an icon, and the published version as muted text', async () => {
    const badge = q('mf-badge[data-status-badge]');
    expect(badge.textContent).toContain('Published v1');
    expect(badge.querySelector('i.pi')).not.toBeNull();
    expect(q('h1').contains(badge)).toBe(true);
    expect(el().querySelector('[data-published-note]')).toBeNull();
    await press('Create New Draft');
    expect(q('mf-badge[data-status-badge]').textContent).toContain('Draft v2');
    expect(q('[data-published-note]').textContent).toContain('(published: v1)');
  });

  it('is a fixed-height record page: one header with the version chip and the actions, Versions (n) in the "..." menu opening the drawer (D-44n)', async () => {
    expect(el().querySelector('mf-fixed-page')).not.toBeNull();
    expect(el().querySelector('mf-form-designer-bar')).toBeNull();
    expect(q('h1').textContent).toContain('Data Processing Form');
    expect(el().querySelectorAll('h1')).toHaveLength(1);
    expect(
      all('[data-page-actions] button[data-action]').map((b) => b.textContent!.trim()),
    ).toEqual(['Retire Version', 'Create New Draft']);
    expect(q('[data-action="new-draft"]').classList).toContain('mf-btn--primary');
    q('[data-page-actions] button[data-overflow]').click();
    await settle();
    const entries = all('[role=menuitem]').map((i) => i.textContent!.trim());
    expect(entries[0]).toContain('Versions (1)');
    expect(el().querySelector('.ttf__table')).toBeNull();
    q('[role=menuitem][data-action="versions"]').click();
    await settle();
    expect(document.body.querySelector('[data-dialog="versions"] .ttf__table')).not.toBeNull();
    expect(document.body.querySelector('mf-slide-panel')).not.toBeNull();
  });

  it('the read-only banner is the information banner, and the designer has the one tab strip', () => {
    const banner = q('[data-readonly-banner]');
    expect(banner.classList).toContain('pg-banner');
    expect(banner.classList).toContain('pg-banner--info');
    expect(banner.querySelector('i.pi')).not.toBeNull();
    expect(banner.textContent).toContain('Use Create New Draft to make changes.');
    expect(el().querySelectorAll('[role=tablist]')).toHaveLength(1);
  });

  it('shows Unsaved changes in the bar while the draft is dirty', async () => {
    await press('Create New Draft');
    expect(el().querySelector('[data-dirty]')).toBeNull();
    q('[data-add="TEXT"]').click();
    await settle();
    expect(q('[data-dirty]').textContent).toContain('Unsaved Changes');
  });

  it('a read-only version offers Open draft when a draft exists', async () => {
    await press('Create New Draft');
    await chooseVersion('v1');
    expect(q('mf-badge[data-status-badge]').textContent).toContain('Published v1');
    expect(button('Create New Draft')).toBeUndefined();
    await press('Open Draft v2');
    expect(q('mf-badge[data-status-badge]').textContent).toContain('Draft v2');
  });

  it('asks before discarding unsaved changes when switching versions', async () => {
    await press('Create New Draft');
    q('[data-add="TEXT"]').click();
    await settle();
    await chooseVersion('v1');
    expect(q('[data-dialog="discard"]', document.body)).not.toBeNull();
    await press('Keep Editing', document.body);
    expect(q('[data-status-badge]').textContent).toContain('Draft v2');

    await chooseVersion('v1');
    await press('Discard Changes', document.body);
    expect(q('[data-status-badge]').textContent).toContain('Published v1');
  });

  it('shows the server publish validation errors inline and keeps the draft editable', async () => {
    await press('Create New Draft');
    q('[data-add="TEXT"]').click();
    await settle();
    await press('Save Draft');
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
    expect(q('[data-status-badge]').textContent).toContain('Draft v2');
    expect(button('Save Draft')).toBeDefined();

    // Editing clears the server's issues until the next publish attempt.
    q('[data-add="TEXT"]').click();
    await settle();
    expect(el().querySelector('.fd__issue-list')?.textContent ?? '').not.toContain(
      'The server rejects this key.',
    );
  });

  it('offers a conflict dialog when the draft changed under the editor', async () => {
    await press('Create New Draft');
    q('[data-add="TEXT"]').click();
    await settle();
    const save = vi
      .spyOn(api, 'saveDraft')
      .mockReturnValue(
        throwError(() => apiError(409, 'CONCURRENCY_CONFLICT', 'Someone else changed this.')),
      );
    await press('Save Draft');

    expect(q('[data-dialog="conflict"]', document.body)).not.toBeNull();
    expect(el().querySelector('[role=alert]')).toBeNull();

    // Keep my changes: the latest version is reloaded but the local edits stay.
    save.mockRestore();
    await press('Keep My Changes', document.body);
    expect(document.body.querySelector('[data-dialog="conflict"]')).toBeNull();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    expect(q('[data-notice]').textContent).toContain('Your edits are kept');
    await press('Save Draft');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('reloads the latest draft and drops local edits from the conflict dialog', async () => {
    await press('Create New Draft');
    q('[data-add="TEXT"]').click();
    await settle();
    vi.spyOn(api, 'saveDraft').mockReturnValue(
      throwError(() => apiError(409, 'CONCURRENCY_CONFLICT', 'Someone else changed this.')),
    );
    await press('Save Draft');
    await press('Reload Latest', document.body);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('retires a published version after confirmation', async () => {
    await press('Retire Version');
    expect(q('[data-dialog="retire"]', document.body)).not.toBeNull();
    // The dialog opens on its primary action and uses the shared wording (#362).
    expect(document.activeElement?.textContent?.trim()).toBe('Retire v1');
    await press('Retire v1', document.body);
    expect(q('[data-status-badge]').textContent).toContain('Retired v1');
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

describe('TaskTypeFormPage for Asset Types and Custom Fields (#541)', () => {
  class NotFoundApi extends InMemoryFormDesignerApi {
    override getOwner(): ReturnType<InMemoryFormDesignerApi['getOwner']> {
      return throwError(() => apiError(404, 'NOT_FOUND', 'Gone.'));
    }
  }

  async function open(ownerLabel: string, sectionPath: string): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('AssetType.Manage', 'CustomField.Manage'))),
        { provide: FormDesignerApi, useClass: NotFoundApi },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(TaskTypeFormPage);
    fixture.componentRef.setInput('ownerLabel', ownerLabel);
    fixture.componentRef.setInput('sectionPath', sectionPath);
    fixture.componentRef.setInput('ownerId', '99999');
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('says it could not find the asset type, keeps the header and offers no Retry', async () => {
    const el = await open('Asset Type', '/admin/asset-types');
    expect(el.querySelector('h1')!.textContent?.trim()).toBe("We couldn't find that asset type.");
    expect(el.querySelector('[data-record-state="notFound"]')).not.toBeNull();
    expect(el.querySelector('[data-retry]')).toBeNull();
    expect(Array.from(el.querySelectorAll('nav li')).map((li) => li.textContent!.trim())).toEqual([
      'Administration',
      'Asset Types',
      'Asset type',
    ]);
  });

  it('says it could not find the object for Custom Fields', async () => {
    const el = await open('Object', '/admin/custom-fields');
    expect(el.querySelector('h1')!.textContent?.trim()).toBe("We couldn't find that object.");
    expect(el.querySelector('[data-back-link]')!.getAttribute('href')).toBe('/admin/custom-fields');
  });
});
