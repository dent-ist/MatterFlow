import { evaluateForm, validateDefinition } from './evaluator';
import { isPortablePattern } from './portable-pattern';
import { FormField } from './types';

/** Security review SEC-05: the TypeScript subset must reject the same backtracking hazards as the .NET one. */
describe('portable pattern subset: backtracking hazards', () => {
  it.each([
    '(a|aa)+$',
    '^(\\w|\\d)+$',
    '(a?){30}a{30}',
    '^(a+)+$',
    '^(a*)*$',
    '^(a{1,5}){1,5}$',
    '^(?:png|jpg)*$',
    '^(?:ab|cd){2}$',
    '^a*a*b$',
    '^[A-Z]+[0-9]*$',
    '^(?:ab)*(?:cd)+$',
  ])('rejects %s', (pattern) => {
    expect(isPortablePattern(pattern)).toBe(false);
  });

  it.each([
    '^(\\d{3}-){2}\\d{4}$',
    '^(?:png|jpg)?\\.[a-z]{3}$',
    '^(a+)?b$',
    '^\\d+\\.\\d+$',
    '^[A-Z]+\\d{1,10}$',
    '^.*foo.*bar.*$',
  ])('accepts %s', (pattern) => {
    expect(isPortablePattern(pattern)).toBe(true);
  });

  it('never runs a pattern outside the subset at evaluation time (no regex timeout in JavaScript)', () => {
    const fields: FormField[] = [
      { key: 'note', control: 'TEXT', validation: { pattern: '^(a|aa)*b$' } } as FormField,
    ];
    const started = Date.now();
    const result = evaluateForm(fields, { note: 'a'.repeat(60) + '!' }, 'submit');
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.errors).toEqual([{ fieldKey: 'note', code: 'PATTERN' }]);
    expect(validateDefinition(fields)).toEqual(['INVALID_PATTERN']);
  });
});

describe('platform default text length', () => {
  const fields = [
    { key: 't', control: 'TEXT' },
    { key: 'a', control: 'TEXTAREA' },
    { key: 'u', control: 'TEXT', validation: { maxLength: 5000 } },
  ] as FormField[];

  it('accepts the limits and rejects one more', () => {
    expect(
      evaluateForm(
        fields,
        { t: 'x'.repeat(1000), a: 'x'.repeat(20000), u: 'x'.repeat(4000) },
        'submit',
      ).errors,
    ).toEqual([]);
    expect(
      evaluateForm(fields, { t: 'x'.repeat(1001), a: 'x'.repeat(20001) }, 'submit').errors,
    ).toEqual([
      { fieldKey: 'a', code: 'TOO_LONG' },
      { fieldKey: 't', code: 'TOO_LONG' },
    ]);
  });
});
