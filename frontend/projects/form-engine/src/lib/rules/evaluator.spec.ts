import schema from '../../../../../../contracts/form-rules.schema.json';
import vectorFile from '../../../../../../contracts/form-rules.vectors.json';
import { evaluateForm, isValidRuleShape, validateDefinition } from './evaluator';
import { EvaluationMode, FormField } from './types';

interface Vector {
  name: string;
  mode?: EvaluationMode;
  schema: { fields: FormField[] };
  values: Record<string, unknown>;
  expected: Record<string, unknown> & { definitionValid: boolean };
}

// The vectors file is the shared contract: it is imported unchanged, never copied.
const vectors = (vectorFile as unknown as { vectors: Vector[] }).vectors;

describe('form-rules conformance vectors', () => {
  it('loads the contract vectors (76: 60 evaluation, 16 definition-invalid)', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(76);
  });

  for (const vec of vectors) {
    it(vec.name, () => {
      const codes = validateDefinition(vec.schema.fields);
      if (!vec.expected.definitionValid) {
        expect([...codes].sort()).toEqual(
          [...(vec.expected['definitionErrors'] as string[])].sort(),
        );
        return;
      }
      expect(codes).toEqual([]);
      const actual = evaluateForm(vec.schema.fields, vec.values, vec.mode ?? 'submit');
      expect(actual.visible).toEqual(vec.expected['visible']);
      expect(actual.required).toEqual(vec.expected['required']);
      expect(actual.options).toEqual(vec.expected['options']);
      expect(actual.errors).toEqual(vec.expected['errors']);
      expect(actual.normalized).toEqual(vec.expected['normalized']);
    });
  }
});

describe('rule shape check', () => {
  it('accepts the schema examples', () => {
    for (const ex of (schema as unknown as { examples: unknown[] }).examples) {
      expect(isValidRuleShape(ex)).toBe(true);
    }
  });

  it.each([
    [{ op: 'xor', args: [] }],
    [{ op: 'and', args: [] }],
    [{ op: 'eq', field: 'Bad-Key', value: 1 }],
    [{ op: 'eq', field: 'a' }],
    [{ op: 'in', field: 'a', value: 'x' }],
    [{ op: 'eq', field: 'a', value: ['x'] }],
    [{ op: 'isTrue', field: 'a', value: true }],
    [{ op: 'not', args: [{ op: 'isTrue', field: 'a' }] }],
    [{ op: 'eq', field: 'a', value: null }],
    [{ op: 'eq', field: 'a', value: { x: 1 } }],
    [null],
  ])('rejects %j', (rule) => {
    expect(isValidRuleShape(rule)).toBe(false);
  });
});
