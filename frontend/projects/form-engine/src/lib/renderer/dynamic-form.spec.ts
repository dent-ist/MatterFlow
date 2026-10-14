import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DynamicForm } from './dynamic-form';
import { MF_ASSET_PICKER } from './reference-picker';
import { FormDefinition } from '../rules/types';

const OCR_FORM: FormDefinition = {
  fields: [
    { key: 'requires_ocr', control: 'CHECKBOX', label: 'Requires OCR?' },
    {
      key: 'ocr_language',
      control: 'SELECT',
      label: 'OCR language',
      showWhen: { op: 'isTrue', field: 'requires_ocr' },
      requiredWhen: { op: 'isTrue', field: 'requires_ocr' },
      options: [
        { key: 'eng', label: 'English' },
        { key: 'spa', label: 'Spanish' },
      ],
    },
    { key: 'notes', control: 'TEXT', label: 'Notes', required: true },
  ],
};

@Component({
  selector: 'mf-test-asset-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" [id]="inputId()" (click)="value.set(42)">
    Pick {{ value() ?? 'none' }}
  </button>`,
})
class TestAssetPicker {
  readonly value = model<number | null>(null);
  readonly inputId = input('');
}

describe('DynamicForm', () => {
  let fixture: ComponentFixture<DynamicForm>;
  const el = (): HTMLElement => fixture.nativeElement;
  const field = (key: string): HTMLElement | null => el().querySelector(`[data-field="${key}"]`);

  async function create(
    definition: FormDefinition,
    values: Record<string, unknown> = {},
    inputs: { readOnly?: boolean } = {},
  ): Promise<void> {
    fixture = TestBed.createComponent(DynamicForm);
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('values', values);
    if (inputs.readOnly) fixture.componentRef.setInput('readOnly', true);
    await fixture.whenStable();
  }

  const stable = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('toggling a checkbox shows and hides the dependent field', async () => {
    await create(OCR_FORM);
    expect(field('ocr_language')).toBeNull();

    const checkbox =
      field('requires_ocr')!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    checkbox.click();
    await stable();
    expect(field('ocr_language')).not.toBeNull();
    expect(field('ocr_language')!.textContent).toContain('(required)');

    field('requires_ocr')!.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    await stable();
    expect(field('ocr_language')).toBeNull();
  });

  it('does not emit values of hidden fields', async () => {
    await create(OCR_FORM, { requires_ocr: true, ocr_language: 'eng', notes: 'n' });
    const emitted: Record<string, unknown>[] = [];
    fixture.componentInstance.valuesChange.subscribe((v) => emitted.push(v));

    field('requires_ocr')!.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    await stable();

    expect(emitted.at(-1)).toEqual({ requires_ocr: false, notes: 'n' });
    expect(fixture.componentInstance.evaluation().visible['ocr_language']).toBe(false);
  });

  it('shows required errors from the copy deck after validate()', async () => {
    await create(OCR_FORM);
    expect(el().textContent).not.toContain('Enter Notes.');

    const result = fixture.componentInstance.validate();
    await stable();

    expect(result.errors).toEqual([{ fieldKey: 'notes', code: 'REQUIRED' }]);
    expect(field('notes')!.querySelector('[role=alert]')!.textContent).toContain('Enter Notes.');
    expect(field('notes')!.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the required error once a value is typed', async () => {
    await create(OCR_FORM);
    fixture.componentInstance.validate();
    await stable();
    const input = field('notes')!.querySelector<HTMLInputElement>('input')!;
    input.value = 'Some notes';
    input.dispatchEvent(new Event('input'));
    await stable();
    expect(field('notes')!.querySelector('[role=alert]')).toBeNull();
    expect(fixture.componentInstance.validate().errors).toEqual([]);
  });

  it('shows a format error for a bad URL after the field is left', async () => {
    await create({ fields: [{ key: 'site', control: 'URL', label: 'Website' }] });
    const input = field('site')!.querySelector<HTMLInputElement>('input')!;
    input.value = 'example.com';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await stable();
    expect(field('site')!.textContent).toContain(
      'Enter a valid web address starting with http:// or https://.',
    );
  });

  it('renders values as text in read-only mode', async () => {
    await create(
      OCR_FORM,
      { requires_ocr: true, ocr_language: 'spa', notes: 'Rush' },
      { readOnly: true },
    );
    expect(el().querySelector('input, select, textarea, p-select, p-checkbox')).toBeNull();
    expect(field('requires_ocr')!.textContent).toContain('Yes');
    expect(field('ocr_language')!.textContent).toContain('Spanish');
    expect(field('notes')!.textContent).toContain('Rush');
    expect(el().textContent).not.toContain('(required)');
  });

  it('maps server errors onto fields', async () => {
    await create(OCR_FORM, { notes: 'x' });
    fixture.componentRef.setInput('serverErrors', [
      { fieldKey: 'notes', message: 'Server says no.' },
    ]);
    await stable();
    expect(field('notes')!.textContent).toContain('Server says no.');
  });

  it('refuses to render an invalid definition', async () => {
    await create({
      fields: [
        { key: 'a', control: 'TEXT' },
        { key: 'a', control: 'TEXT' },
      ],
    });
    expect(el().querySelector('[role=alert]')!.textContent).toContain('DUPLICATE_FIELD_KEY');
  });

  it('renders every catalog control without throwing', async () => {
    await create({
      fields: [
        { key: 'sec', control: 'SECTION_HEADING', label: 'Details' },
        { key: 'hint', control: 'HELP_TEXT', label: 'Fill this in.' },
        { key: 't', control: 'TEXT', label: 'Text', section: 'sec' },
        { key: 'ta', control: 'TEXTAREA', label: 'Multi' },
        { key: 'n', control: 'NUMBER', label: 'Number' },
        { key: 'c', control: 'CHECKBOX', label: 'Check' },
        { key: 's', control: 'SELECT', label: 'Select', options: [{ key: 'a' }] },
        { key: 'r', control: 'RADIO', label: 'Radio', options: [{ key: 'a' }, { key: 'b' }] },
        { key: 'm', control: 'MULTISELECT', label: 'Multi select', options: [{ key: 'a' }] },
        { key: 'd', control: 'DATE', label: 'Date' },
        { key: 'dt', control: 'DATETIME', label: 'Date time' },
        { key: 'u', control: 'URL', label: 'Web' },
        { key: 'as', control: 'ASSET_REF', label: 'Asset' },
        { key: 'us', control: 'USER_REF', label: 'User' },
      ],
    });
    expect(el().querySelectorAll('.mf-field').length).toBe(12);
    expect(el().querySelector('h3')!.textContent).toContain('Details');
    expect(el().textContent).toContain('Fill this in.');
  });

  it('hosts a pluggable asset picker and emits its selection', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: MF_ASSET_PICKER, useValue: TestAssetPicker }],
    });
    await create({ fields: [{ key: 'src', control: 'ASSET_REF', label: 'Source asset' }] });
    const emitted: Record<string, unknown>[] = [];
    fixture.componentInstance.valuesChange.subscribe((v) => emitted.push(v));

    field('src')!.querySelector<HTMLButtonElement>('button')!.click();
    await stable();

    expect(emitted.at(-1)).toEqual({ src: 42 });
    expect(field('src')!.textContent).toContain('Pick 42');
  });
});
