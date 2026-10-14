import { validateDefinition } from '../rules/evaluator';
import { FormControl, FormField } from '../rules/types';
import {
  CONTROL_CATALOG,
  DesignerField,
  dependentsOf,
  diagnoseDefinition,
  diffDefinitions,
  hasErrors,
  isInputControl,
  makeLeaf,
  moveItem,
  normalizeRule,
  operatorsFor,
  slugFieldKey,
  summarizeRule,
  toRuntimeDefinition,
} from './designer-model';

const ocr = (): DesignerField[] => [
  { key: 'requires_ocr', control: 'CHECKBOX', label: 'Requires OCR?' },
  {
    key: 'ocr_language',
    control: 'SELECT',
    label: 'OCR Language',
    options: [
      { key: 'eng', label: 'English' },
      { key: 'spa', label: 'Spanish' },
    ],
    showWhen: { op: 'isTrue', field: 'requires_ocr' },
    requiredWhen: { op: 'isTrue', field: 'requires_ocr' },
  },
];

describe('operators', () => {
  const ops = (c: FormControl): string[] => operatorsFor(c).map((o) => o.op);

  it('offers only the operators the contract allows per control', () => {
    expect(ops('CHECKBOX')).toEqual(['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty']);
    expect(ops('TEXT')).toEqual(['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty']);
    expect(ops('MULTISELECT')).toEqual(['contains', 'isEmpty', 'isNotEmpty']);
    expect(ops('DATETIME')).toEqual(['isEmpty', 'isNotEmpty']);
    expect(ops('NUMBER')).toContain('gte');
    expect(ops('TEXT')).not.toContain('gt');
    expect(ops('SECTION_HEADING')).toEqual([]);
  });

  it('has no file upload control', () => {
    expect(CONTROL_CATALOG.map((c) => c.control).join()).not.toMatch(/FILE/);
  });

  it('every offered operator yields a rule the library accepts', () => {
    for (const { control } of CONTROL_CATALOG.filter((c) => isInputControl(c.control))) {
      const target: FormField = { key: 'target', control, options: [{ key: 'a' }, { key: 'b' }] };
      for (const { op } of operatorsFor(control)) {
        const leaf = makeLeaf(target, undefined, op);
        const owner: FormField = { key: 'owner', control: 'TEXT', showWhen: leaf };
        const codes = validateDefinition([target, owner]);
        // Literals that need the author's input (text, date, empty lists) are the only allowed gaps.
        const blank =
          'value' in leaf &&
          (leaf.value === '' || (Array.isArray(leaf.value) && leaf.value.length === 0));
        if (!blank) expect(codes, `${control}/${op}`).toEqual([]);
      }
    }
  });

  it('keeps operator and value when switching to another field of the same type', () => {
    const a: FormField = { key: 'a', control: 'NUMBER' };
    const b: FormField = { key: 'b', control: 'NUMBER' };
    const leaf = makeLeaf(a, { op: 'gt', field: 'a', value: 5 });
    expect(leaf).toEqual({ op: 'gt', field: 'a', value: 5 });
    expect(makeLeaf(b, leaf)).toEqual({ op: 'gt', field: 'b', value: 0 });
    expect(makeLeaf(a, { op: 'isTrue', field: 'x' })).toMatchObject({ op: 'eq', field: 'a' });
  });
});

describe('diagnoseDefinition', () => {
  it('accepts the baseline example', () => {
    expect(diagnoseDefinition(ocr())).toEqual([]);
  });

  it('reports a cycle with the copy-deck message on the rules involved', () => {
    const fields: DesignerField[] = [
      { key: 'a', control: 'CHECKBOX', label: 'A', showWhen: { op: 'isTrue', field: 'b' } },
      { key: 'b', control: 'CHECKBOX', label: 'B', showWhen: { op: 'isTrue', field: 'a' } },
    ];
    const issues = diagnoseDefinition(fields);
    const cycle = issues.filter((i) => i.code === 'CIRCULAR_DEPENDENCY');
    expect(cycle.length).toBe(2);
    expect(cycle[0].slot).toBe('showWhen');
    expect(cycle[0].message).toBe(
      'These fields depend on each other: A -> B -> A. Remove one rule.',
    );
    expect(hasErrors(issues)).toBe(true);
  });

  it('reports unknown references, self references and mismatches on the right rule', () => {
    const fields: DesignerField[] = [
      { key: 'a', control: 'TEXT', label: 'A', showWhen: { op: 'eq', field: 'ghost', value: 'x' } },
      { key: 'b', control: 'TEXT', label: 'B', requiredWhen: { op: 'eq', field: 'b', value: 'x' } },
    ];
    const by = (code: string) => diagnoseDefinition(fields).find((i) => i.code === code);
    expect(by('UNKNOWN_FIELD_REFERENCE')).toMatchObject({ fieldKey: 'a', slot: 'showWhen' });
    expect(by('SELF_REFERENCE')).toMatchObject({ fieldKey: 'b', slot: 'requiredWhen' });

    const bad: DesignerField[] = [
      { key: 't', control: 'TEXT', label: 'T' },
      {
        key: 'u',
        control: 'TEXT',
        label: 'U',
        showWhen: { op: 'gt', field: 't', value: 'a' } as never,
      },
    ];
    expect(diagnoseDefinition(bad).find((i) => i.code === 'OPERATOR_TYPE_MISMATCH')).toMatchObject({
      fieldKey: 'u',
      slot: 'showWhen',
    });
  });

  it('flags an option that a rule uses but the list no longer has', () => {
    const fields = ocr();
    fields.push({
      key: 'x',
      control: 'TEXT',
      label: 'X',
      showWhen: { op: 'eq', field: 'ocr_language', value: 'fra' },
    });
    expect(diagnoseDefinition(fields)).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_OPTION_REFERENCE', fieldKey: 'x' }),
    );
  });

  it('flags designer-level problems', () => {
    const fields: DesignerField[] = [
      { key: 'Bad Key', control: 'TEXT', label: 'T' },
      { key: 'pick', control: 'SELECT', label: 'Pick', options: [] },
      { key: 'rx', control: 'TEXT', label: 'Rx', validation: { pattern: '(' } },
      { key: 'n', control: 'NUMBER', label: 'N', validation: { min: 5, max: 1 } },
      { key: 'dup', control: 'TEXT', label: 'D1' },
      { key: 'dup', control: 'TEXT', label: 'D2' },
    ];
    const codes = diagnoseDefinition(fields).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'INVALID_KEY',
        'EMPTY_OPTIONS',
        'INVALID_PATTERN',
        'INVALID_RANGE',
        'DUPLICATE_FIELD_KEY',
      ]),
    );
  });

  it('warns about an empty form without blocking', () => {
    const issues = diagnoseDefinition([]);
    expect(issues[0].code).toBe('NO_FIELDS');
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('helpers', () => {
  it('derives unique stable keys from labels', () => {
    const f: FormField[] = [{ key: 'requires_ocr', control: 'CHECKBOX' }];
    expect(slugFieldKey('Requires OCR?', [])).toBe('requires_ocr');
    expect(slugFieldKey('Requires OCR?', f)).toBe('requires_ocr_2');
    expect(slugFieldKey('2nd pass', [])).toBe('f_2nd_pass');
    expect(slugFieldKey('???', [])).toBe('field');
  });

  it('moves items and finds dependents', () => {
    expect(moveItem([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(dependentsOf(ocr(), 'requires_ocr').map((d) => d.where)).toEqual([
      'showWhen',
      'requiredWhen',
    ]);
    expect(dependentsOf(ocr(), 'ocr_language')).toEqual([]);
  });

  it('summarizes rules in plain language and collapses single-child groups', () => {
    const fields = ocr();
    expect(summarizeRule(fields[1].showWhen!, fields)).toBe('Requires OCR? is checked');
    expect(
      summarizeRule(
        {
          op: 'or',
          args: [
            { op: 'isTrue', field: 'requires_ocr' },
            {
              op: 'and',
              args: [
                { op: 'eq', field: 'ocr_language', value: 'eng' },
                { op: 'isEmpty', field: 'requires_ocr' },
              ],
            },
          ],
        },
        fields,
      ),
    ).toBe(
      'Requires OCR? is checked or (OCR Language equals "English" and Requires OCR? is empty)',
    );
    expect(normalizeRule({ op: 'and', args: [{ op: 'isTrue', field: 'a' }] })).toEqual({
      op: 'isTrue',
      field: 'a',
    });
  });

  it('diffs definitions and strips designer metadata', () => {
    const before = ocr();
    const after: DesignerField[] = [
      { ...before[1], label: 'Language' },
      { key: 'notes', control: 'TEXT', defaultValue: 'hi' },
    ];
    expect(diffDefinitions(before, after)).toEqual({
      added: ['notes'],
      removed: ['requires_ocr'],
      changed: ['ocr_language'],
    });
    expect(toRuntimeDefinition(after).fields[1]).not.toHaveProperty('defaultValue');
  });
});
