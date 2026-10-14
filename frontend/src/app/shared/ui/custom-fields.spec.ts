import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsClient } from '../../api/generated/api-client';
import { DOCUMENT_FIELDS, aFormVersion } from '../testing/asset-testing';
import { ok, settle } from '../testing/org-testing';
import {
  CustomFieldsEditor,
  CustomFieldsView,
  customFieldsProblems,
  splitFormErrors,
} from './custom-fields';

@Component({
  imports: [CustomFieldsEditor, CustomFieldsView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-custom-fields-editor [versionId]="versionId" [values]="values" />
    <mf-custom-fields-view data-view [versionId]="versionId" [values]="values" />
  `,
})
class Host {
  versionId: number | null = 21;
  values: Record<string, unknown> = {};
  readonly editor = viewChild.required(CustomFieldsEditor);
}

describe('custom fields editor and view', () => {
  let forms: { getFormVersionSchema: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(versionId: number | null, values: Record<string, unknown> = {}) {
    forms = { getFormVersionSchema: vi.fn().mockReturnValue(ok(aFormVersion(DOCUMENT_FIELDS))) };
    TestBed.configureTestingModule({ providers: [{ provide: FormsClient, useValue: forms }] });
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.versionId = versionId;
    fixture.componentInstance.values = values;
    await settle(fixture);
  }

  it('renders the published form under a Custom fields heading', async () => {
    await create(21);

    expect(forms.getFormVersionSchema).toHaveBeenCalledWith(21);
    const section = el().querySelector('fieldset[data-custom-fields]')!;
    expect(section.textContent).toContain('Custom fields');
    expect(section.textContent).toContain('Workspace ID');
  });

  it('renders nothing when there is no published form', async () => {
    await create(null);

    expect(forms.getFormVersionSchema).not.toHaveBeenCalled();
    expect(el().querySelector('[data-custom-fields]')).toBeNull();
    expect(fixture.componentInstance.editor().collect()).toEqual({
      invalid: false,
      invalidFields: [],
      values: undefined,
    });
  });

  it('collects values on create, reporting invalid required fields', async () => {
    await create(21);
    const editor = fixture.componentInstance.editor();

    const blocked = editor.collect();
    expect(blocked.invalid).toBe(true);
    expect(blocked.invalidFields).toEqual(['Workspace ID: Enter workspace ID.']);
    expect(customFieldsProblems(blocked)).toEqual(['Workspace ID: Enter workspace ID.']);

    const input = el().querySelector<HTMLInputElement>('fieldset input[type=text]')!;
    input.value = 'WS-1';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);

    expect(editor.collect()).toEqual({
      invalid: false,
      invalidFields: [],
      values: { workspace_id: 'WS-1' },
    });
  });

  it('collects a patch on edit with null for cleared known values', async () => {
    await create(21, { workspace_id: 'WS-1', notes: 'old' });
    const editor = fixture.componentInstance.editor();
    const input = el().querySelector<HTMLInputElement>('fieldset input[type=text]')!;
    input.value = 'WS-1';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);

    const result = editor.collect({ workspace_id: 'WS-1', notes: 'old' });

    expect(result.invalid).toBe(false);
    expect(result.values).toMatchObject({ workspace_id: 'WS-1' });
  });

  it('does not validate or send an untouched custom-fields section of an existing record', async () => {
    await create(21, {});
    const editor = fixture.componentInstance.editor();

    expect(editor.collect({})).toEqual({ invalid: false, invalidFields: [], values: undefined });
    expect(el().querySelector('[aria-invalid="true"]')).toBeNull();

    // Entering any value touches the section: the required fields must now be satisfied and are highlighted.
    const notes = el().querySelector<HTMLTextAreaElement>('fieldset textarea')!;
    notes.value = 'x';
    notes.dispatchEvent(new Event('input'));
    await settle(fixture);
    const touched = editor.collect({});
    expect(touched.invalid).toBe(true);
    expect(touched.invalidFields).toEqual(['Workspace ID: Enter workspace ID.']);
    await settle(fixture);
    expect(el().querySelector('input[aria-invalid="true"]')).not.toBeNull();
  });

  it('shows stored values read-only in the view', async () => {
    await create(21, { workspace_id: 'WS-9' });

    const view = el().querySelector('[data-view]')!;
    expect(view.textContent).toContain('Custom fields');
    expect(view.textContent).toContain('WS-9');
    expect(view.querySelector('input')).toBeNull();
  });

  it('splits server errors into record and custom field errors', () => {
    expect(splitFormErrors({ name: 'Bad', 'form:notes': 'Too long' })).toEqual({
      base: { name: 'Bad' },
      form: [{ fieldKey: 'notes', message: 'Too long' }],
    });
  });
});
