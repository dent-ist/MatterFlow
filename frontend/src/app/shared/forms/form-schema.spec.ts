import { FormFieldModel } from '../../api/generated/api-client';
import { toFormDefinition } from './form-schema';

describe('toFormDefinition', () => {
  it('maps server fields to the renderer shape and drops absent and null members', () => {
    const fields = [
      {
        key: 'format',
        label: 'Format',
        control: 'SELECT',
        required: true,
        helpText: 'Pick one',
        section: 'general',
        validation: null,
        showWhen: { op: 'isTrue', field: 'scanned' },
        requiredWhen: null,
        isFilterable: true,
        options: [
          { key: 'pdf', label: 'PDF', availableWhen: null },
          { key: 'docx', label: 'Word', availableWhen: { op: 'isTrue', field: 'scanned' } },
        ],
      },
      { key: 'notes', label: 'Notes', control: 'TEXTAREA', required: false, options: [] },
    ] as unknown as FormFieldModel[];

    const definition = toFormDefinition({ fields });

    expect(definition.fields[0]).toEqual({
      key: 'format',
      control: 'SELECT',
      label: 'Format',
      helpText: 'Pick one',
      required: true,
      section: 'general',
      showWhen: { op: 'isTrue', field: 'scanned' },
      options: [
        { key: 'pdf', label: 'PDF' },
        { key: 'docx', label: 'Word', availableWhen: { op: 'isTrue', field: 'scanned' } },
      ],
    });
    expect(definition.fields[1]).toEqual({ key: 'notes', control: 'TEXTAREA', label: 'Notes' });
  });
});
