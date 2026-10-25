import type { FormDefinition, FormField } from 'form-engine';
import { isReusableField, reusableAnswers } from './last-answers';

const select = (key: string, label: string, options = ['a', 'b']): FormField => ({
  key,
  label,
  control: 'SELECT',
  options: options.map((o) => ({ key: o, label: o })),
});

describe('last answers of a task type (#819)', () => {
  it('offers only list answers', () => {
    expect(isReusableField(select('category', 'Category'))).toBe(true);
    expect(isReusableField({ key: 'driver', label: 'Driver', control: 'RADIO' })).toBe(true);
    for (const control of [
      'TEXT',
      'TEXTAREA',
      'NUMBER',
      'CHECKBOX',
      'MULTISELECT',
      'DATE',
      'DATETIME',
      'URL',
      'ASSET_REF',
      'USER_REF',
    ] as const) {
      expect(isReusableField({ key: 'x', label: 'X', control }), control).toBe(false);
    }
  });

  it('never offers a field that speaks of privilege or confidentiality, whatever its control', () => {
    for (const label of [
      'Privilege status',
      'Contains privileged material?',
      'Confidential',
      'Attorney work product',
      'Legal hold',
      'Sensitive data',
    ]) {
      expect(isReusableField(select('k', label)), label).toBe(false);
    }
    expect(isReusableField(select('privilege_flag', 'Flag'))).toBe(false);
  });

  it('takes the previous answers whose option still exists, in form order', () => {
    const definition: FormDefinition = {
      fields: [
        select('category', 'Category', ['legal', 'ops']),
        { key: 'notes', label: 'Notes', control: 'TEXT' },
        select('driver', 'What is driving the due date?', ['court', 'client']),
        select('privilege', 'Privilege', ['yes', 'no']),
        select('gone', 'Gone option', ['x']),
      ],
    };
    const result = reusableAnswers(definition, {
      category: 'ops',
      notes: 'call Ann on 555-0100',
      driver: 'court',
      privilege: 'yes',
      gone: 'removed',
    });
    expect(result.values).toEqual({ category: 'ops', driver: 'court' });
    expect(result.labels).toEqual(['Category', 'What is driving the due date?']);
  });

  it('copes with no form, no previous values and odd values', () => {
    expect(reusableAnswers(null, { a: 'b' }).values).toEqual({});
    expect(reusableAnswers({ fields: [select('a', 'A')] }, null).values).toEqual({});
    expect(reusableAnswers({ fields: [select('a', 'A')] }, { a: 5 }).values).toEqual({});
    expect(reusableAnswers({ fields: [select('a', 'A')] }, { a: '' }).values).toEqual({});
  });
});
