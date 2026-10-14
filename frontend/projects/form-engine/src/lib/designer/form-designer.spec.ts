import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DesignerDefinition, DesignerField } from './designer-model';
import { FormDesigner } from './form-designer';

describe('FormDesigner', () => {
  let fixture: ComponentFixture<FormDesigner>;
  let latest: DesignerDefinition;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  async function stable(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function create(
    fields: DesignerField[] = [],
    inputs: { readOnly?: boolean; saved?: DesignerDefinition } = {},
  ): Promise<void> {
    fixture = TestBed.createComponent(FormDesigner);
    fixture.componentRef.setInput('definition', { fields });
    if (inputs.readOnly) fixture.componentRef.setInput('readOnly', true);
    if (inputs.saved) fixture.componentRef.setInput('saved', inputs.saved);
    latest = { fields };
    fixture.componentInstance.definitionChange.subscribe((d) => (latest = d));
    await stable();
  }

  async function type(sel: string, value: string, event = 'input'): Promise<void> {
    const input = q<HTMLInputElement>(sel);
    input.value = value;
    input.dispatchEvent(new Event(event, { bubbles: true }));
    await stable();
  }

  async function click(sel: string): Promise<void> {
    q(sel).click();
    await stable();
  }

  async function choose(sel: string, value: string): Promise<void> {
    const select = q<HTMLSelectElement>(sel);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await stable();
  }

  async function pick(text: string): Promise<void> {
    const input = Array.from(el().querySelectorAll<HTMLLabelElement>('label.fd__check'))
      .find((l) => [text, text + '...'].includes(l.textContent!.trim()))!
      .querySelector('input')!;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await stable();
  }

  async function addField(control: string, label: string): Promise<void> {
    await click(`[data-add="${control}"]`);
    await type('[data-slot="label"]', label);
  }

  const previewField = (key: string): HTMLElement | null =>
    el().querySelector(`mf-dynamic-form [data-field="${key}"]`);

  const tick = async (key: string): Promise<void> => {
    previewField(key)!.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    await stable();
  };

  it('adds fields from the palette and derives a stable key from the label', async () => {
    await create();
    expect(el().textContent).toContain('No fields yet. Add your first field from the palette.');
    await addField('TEXT', 'Requestor name');
    expect(latest.fields).toHaveLength(1);
    expect(latest.fields[0]).toMatchObject({ key: 'requestor_name', control: 'TEXT' });
    // Hand-edited keys stop following the label.
    await type('[data-slot="key"]', 'req_name', 'change');
    await type('[data-slot="label"]', 'Requester');
    expect(latest.fields[0].key).toBe('req_name');
  });

  it('offers no file upload control in the palette', async () => {
    await create();
    expect(el().querySelector('[data-add*="FILE"]')).toBeNull();
    expect(el().querySelectorAll('[data-add]').length).toBe(14);
  });

  it('builds the baseline 8.3 example and the preview applies its rules', async () => {
    await create();
    await addField('CHECKBOX', 'Requires OCR?');
    await addField('SELECT', 'OCR Language');
    await type('[data-option-label="0"]', 'English');
    await type('[data-option-label="1"]', 'Spanish');
    expect(latest.fields[1].options?.map((o) => o.key)).toEqual(['english', 'spanish']);

    await pick('Show only when');
    expect(latest.fields[1].showWhen).toEqual({ op: 'isTrue', field: 'requires_ocr' });
    await pick('Required when');
    expect(latest.fields[1].requiredWhen).toEqual({ op: 'isTrue', field: 'requires_ocr' });

    await addField('CHECKBOX', 'Contains Encrypted Files?');
    await addField('TEXT', 'Password Instructions');
    await pick('Show only when');
    await choose('[data-slot="showWhen"] select[aria-label$="field"]', 'contains_encrypted_files');
    await pick('Required when');
    await choose(
      '[data-slot="requiredWhen"] select[aria-label$="field"]',
      'contains_encrypted_files',
    );

    expect(latest.fields[3].showWhen).toEqual({ op: 'isTrue', field: 'contains_encrypted_files' });
    expect(latest.fields[3].requiredWhen).toEqual({
      op: 'isTrue',
      field: 'contains_encrypted_files',
    });
    expect(el().querySelector('[data-valid]')).not.toBeNull();

    // Preview: dependent fields stay hidden until their checkbox is ticked.
    expect(previewField('ocr_language')).toBeNull();
    expect(previewField('password_instructions')).toBeNull();
    await tick('requires_ocr');
    expect(previewField('ocr_language')).not.toBeNull();
    expect(previewField('ocr_language')!.textContent).toContain('(required)');
    await tick('contains_encrypted_files');
    expect(previewField('password_instructions')!.textContent).toContain('(required)');
  });

  it('reorders fields with the move buttons and announces the new position', async () => {
    await create([
      { key: 'a', control: 'TEXT', label: 'A' },
      { key: 'b', control: 'TEXT', label: 'B' },
      { key: 'c', control: 'TEXT', label: 'C' },
    ]);
    expect(q<HTMLButtonElement>('[data-move="up-0"]').disabled).toBe(true);
    await click('[data-move="down-0"]');
    expect(latest.fields.map((f) => f.key)).toEqual(['b', 'a', 'c']);
    expect(q('[data-move="up-0"]').getAttribute('aria-label')).toBe('Move B up');
    expect(q('[role=status]').textContent).toContain('position 2 of 3');
    await click('[data-move="up-2"]');
    expect(latest.fields.map((f) => f.key)).toEqual(['b', 'c', 'a']);
  });

  it('blocks deleting a field that rules use and lists the dependents', async () => {
    await create([
      { key: 'a', control: 'CHECKBOX', label: 'A' },
      { key: 'b', control: 'TEXT', label: 'B', showWhen: { op: 'isTrue', field: 'a' } },
    ]);
    await click('[data-delete="0"]');
    expect(latest.fields).toHaveLength(2);
    expect(q('.fd__canvas [role=alert]').textContent).toContain("Can't delete A");
    expect(q('.fd__canvas [role=alert]').textContent).toContain('B (visibility rule)');
    await click('[data-delete="1"]');
    expect(latest.fields.map((f) => f.key)).toEqual(['a']);
  });

  it('locks keys and types of fields that were already saved', async () => {
    const fields: DesignerField[] = [{ key: 'notes', control: 'TEXT', label: 'Notes' }];
    await create(fields, { saved: { fields } });
    await click('[data-row="0"]');
    expect(q<HTMLInputElement>('[data-slot="key"]').disabled).toBe(true);
    expect(q<HTMLSelectElement>('[data-slot="control"]').disabled).toBe(true);
    await type('[data-slot="label"]', 'Case notes');
    expect(latest.fields[0]).toMatchObject({ key: 'notes', label: 'Case notes' });
  });

  it('edits help text, required, default and validation', async () => {
    await create([{ key: 'qty', control: 'NUMBER', label: 'Quantity' }]);
    await click('[data-row="0"]');
    await type('textarea[id$="-help"]', 'How many?');
    await pick('Always');
    await type('input[id$="-default"]', '3', 'change');
    await type('input[id$="-min"]', '1', 'change');
    await type('input[id$="-max"]', '10', 'change');
    expect(latest.fields[0]).toMatchObject({
      helpText: 'How many?',
      required: true,
      defaultValue: 3,
      validation: { min: 1, max: 10 },
    });
    await type('input[id$="-max"]', '0', 'change');
    expect(q('[data-slot="validation"]').textContent).toContain(
      'The minimum is greater than the maximum.',
    );
    await type('input[id$="-max"]', '', 'change');
    expect(latest.fields[0].validation).toEqual({ min: 1 });
  });

  it('shows rule errors next to the offending rule and field, and blocks the preview', async () => {
    await create([
      { key: 'a', control: 'CHECKBOX', label: 'A', showWhen: { op: 'isTrue', field: 'b' } },
      { key: 'b', control: 'CHECKBOX', label: 'B', showWhen: { op: 'isTrue', field: 'a' } },
    ]);
    expect(el().querySelectorAll('.fd__problems').length).toBe(2);
    expect(q('[data-issue="CIRCULAR_DEPENDENCY"]').textContent).toContain(
      'These fields depend on each other: A -> B -> A. Remove one rule.',
    );
    await click('[data-row="0"]');
    expect(q('[data-slot="showWhen"] .rb__errors').textContent).toContain(
      'These fields depend on each other',
    );
    expect(el().querySelector('[data-preview-blocked]')).not.toBeNull();
    expect(el().querySelector('mf-dynamic-form')).toBeNull();
  });

  it('shows unknown references and jumps to the field from the validation panel', async () => {
    await create([
      { key: 'a', control: 'TEXT', label: 'A' },
      { key: 'b', control: 'TEXT', label: 'B', showWhen: { op: 'eq', field: 'ghost', value: 'x' } },
    ]);
    const issue = q('[data-issue="UNKNOWN_FIELD_REFERENCE"]');
    expect(issue.textContent).toContain('uses a field that does not exist');
    issue.querySelector<HTMLButtonElement>('button')!.click();
    await stable();
    expect(q('[data-row="1"]').getAttribute('aria-current')).toBe('true');
  });

  it('reports empty option lists and invalid patterns', async () => {
    await create([
      { key: 'pick', control: 'SELECT', label: 'Pick', options: [] },
      { key: 'code', control: 'TEXT', label: 'Code', validation: { pattern: '(' } },
    ]);
    expect(q('[data-issue="EMPTY_OPTIONS"]').textContent).toContain('Add at least one option.');
    expect(q('[data-issue="INVALID_PATTERN"]').textContent).toContain(
      'not a valid regular expression',
    );
  });

  it('is read only when readOnly is set: no palette or edit buttons, controls disabled', async () => {
    await create([{ key: 'a', control: 'TEXT', label: 'A' }], { readOnly: true });
    expect(el().querySelector('[data-add]')).toBeNull();
    expect(el().querySelector('[data-move], [data-delete]')).toBeNull();
    await click('[data-row="0"]');
    expect(q<HTMLFieldSetElement>('fieldset.fd__fieldset').disabled).toBe(true);
  });

  it('gives every control an accessible name', async () => {
    await create([
      { key: 'a', control: 'SELECT', label: 'A', options: [{ key: 'x', label: 'X' }] },
      { key: 'b', control: 'TEXT', label: 'B', showWhen: { op: 'eq', field: 'a', value: 'x' } },
    ]);
    await click('[data-row="1"]');
    const unnamed = Array.from(
      el().querySelectorAll<HTMLElement>(
        '.fd__props input, .fd__props select, .fd__props textarea, button',
      ),
    ).filter((c) => {
      const labelled = c.id && el().querySelector(`label[for="${c.id}"]`);
      return (
        !labelled && !c.closest('label') && !c.getAttribute('aria-label') && !c.textContent?.trim()
      );
    });
    expect(unnamed).toEqual([]);
  });
});
