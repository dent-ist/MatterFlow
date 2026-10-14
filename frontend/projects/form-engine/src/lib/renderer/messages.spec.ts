import contractSchema from '../../../../../../contracts/form-rules.schema.json';
import contractMessages from '../../../../../../contracts/form-rules.messages.json';
import { FormField } from '../rules/types';
import {
  FORM_MESSAGES,
  definitionMessage,
  validationMessage,
  validationMessageKey,
} from './messages';

const defs = (contractSchema as unknown as { $defs: Record<string, { enum: string[] }> }).$defs;
const fieldCodes = defs['errorCode'].enum;
const definitionCodes = defs['definitionErrorCode'].enum;

describe('form-rules messages', () => {
  it('is a verbatim copy of contracts/form-rules.messages.json', () => {
    expect(FORM_MESSAGES).toEqual(
      (contractMessages as unknown as { messages: Record<string, string> }).messages,
    );
  });

  it('has a message for every field and definition error code', () => {
    const codes = new Set(Object.keys(FORM_MESSAGES).map((k) => k.split('.')[0]));
    for (const code of [...fieldCodes, ...definitionCodes]) expect(codes).toContain(code);
  });

  it('resolves every field error code to an existing key for every control', () => {
    const controls = [
      'TEXT',
      'URL',
      'NUMBER',
      'DATE',
      'DATETIME',
      'CHECKBOX',
      'SELECT',
      'USER_REF',
    ];
    for (const control of controls) {
      for (const code of fieldCodes) {
        const field = { key: 'f', control, label: 'Thing' } as FormField;
        expect(FORM_MESSAGES[validationMessageKey(field, code as never)]).toBeDefined();
        expect(validationMessage(field, code as never)).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('renders copy-deck wording', () => {
    const text: FormField = { key: 'notes', control: 'TEXT', label: 'Notes' };
    const url: FormField = { key: 'site', control: 'URL', label: 'Site' };
    const pick: FormField = { key: 'owner', control: 'USER_REF', label: 'Owner' };
    expect(validationMessage(text, 'REQUIRED')).toBe('Enter notes.');
    expect(validationMessage(pick, 'REQUIRED')).toBe('Select an owner.');
    expect(validationMessage(url, 'INVALID_TYPE')).toBe(
      'Enter a valid web address starting with http:// or https://.',
    );
    expect(validationMessage(text, 'INVALID_TYPE')).toBe('Enter a valid notes.');
  });

  it('reads naturally for labels written as nouns or questions (UAT2-09)', () => {
    const select = (label: string): FormField => ({ key: 'f', control: 'SELECT', label });
    const text = (label: string): FormField => ({ key: 'f', control: 'TEXT', label });
    expect(validationMessage(select('Category'), 'REQUIRED')).toBe('Select a category.');
    expect(validationMessage(text('What is needed'), 'REQUIRED')).toBe('Enter what is needed.');
    expect(validationMessage(text('Approximate size (GB)'), 'REQUIRED')).toBe(
      'Enter approximate size (GB).',
    );
    expect(validationMessage(select('What is driving the due date?'), 'REQUIRED')).toBe(
      'Select an option for: what is driving the due date.',
    );
  });

  it('fills range and length placeholders', () => {
    const qty = (validation: FormField['validation']): FormField => ({
      key: 'qty',
      control: 'NUMBER',
      validation,
    });
    expect(validationMessage(qty({ min: 1, max: 5 }), 'OUT_OF_RANGE')).toBe(
      'Enter a value from 1 to 5.',
    );
    expect(validationMessage(qty({ min: 1 }), 'OUT_OF_RANGE')).toBe('Enter a value of 1 or more.');
    expect(validationMessage(qty({ max: 5, min: null }), 'OUT_OF_RANGE')).toBe(
      'Enter a value of 5 or less.',
    );
    const text: FormField = { key: 't', control: 'TEXT', validation: { maxLength: 8 } };
    expect(validationMessage(text, 'TOO_LONG')).toBe('Use at most 8 characters.');
  });

  it('prefers the field patternMessage for PATTERN only', () => {
    const field: FormField = {
      key: 'code',
      control: 'TEXT',
      label: 'Code',
      validation: { pattern: '^a$', patternMessage: 'Use digits only.' },
    };
    expect(validationMessage(field, 'PATTERN')).toBe('Use digits only.');
    expect(validationMessage({ ...field, validation: { pattern: '^a$' } }, 'PATTERN')).toBe(
      'Enter code in the expected format.',
    );
  });

  it('renders definition messages with field and cycle', () => {
    expect(definitionMessage('NO_OPTIONS')).toBe('Add at least one option.');
    expect(definitionMessage('SELF_REFERENCE', { field: 'Owner' })).toBe(
      "Owner can't depend on itself.",
    );
    expect(definitionMessage('CIRCULAR_DEPENDENCY', { cycle: 'A -> B -> A' })).toBe(
      'These fields depend on each other: A -> B -> A. Remove one rule.',
    );
  });
});
