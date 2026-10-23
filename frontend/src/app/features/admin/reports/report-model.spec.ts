import {
  DetectedPlaceholder,
  ParamDef,
  defaultKeywords,
  definitionProblems,
  listParameters,
  placeholderNames,
  reconcile,
  titleCase,
  toRequestParameters,
  withType,
} from './report-model';

const ph = (name: string, isBuiltIn = false): DetectedPlaceholder => ({
  name,
  displayName: name,
  line: 1,
  column: 1,
  occurrences: 1,
  isBuiltIn,
});

describe('report model', () => {
  it('writes names as labels and knows which placeholders a definition answers', () => {
    expect(titleCase('DUE_DATE')).toBe('Due date');
    expect(titleCase('A')).toBe('A');
    expect(placeholderNames({ name: 'PERIOD', type: 'dateRange' })).toEqual([
      'PERIOD_FROM',
      'PERIOD_TO',
    ]);
    expect(placeholderNames({ name: 'X', type: 'text' })).toEqual(['X']);
  });

  describe('reconcile', () => {
    it('adds a text definition for each new placeholder, never for a built-in one', () => {
      const r = reconcile([], [ph('CLIENT'), ph('TODAY', true), ph('DUE_DATE')]);
      expect(r.defs.map((d) => [d.name, d.type, d.label])).toEqual([
        ['CLIENT', 'text', 'Client'],
        ['DUE_DATE', 'text', 'Due date'],
      ]);
      expect(r.added).toEqual(['CLIENT', 'DUE_DATE']);
      expect(r.unused.size).toBe(0);
    });

    it('keeps the author’s definitions and reports the ones the query no longer uses', () => {
      const mine: ParamDef = { name: 'PODS', type: 'multi', label: 'My pods', isRequired: true };
      const r = reconcile([mine, { name: 'OLD', type: 'text', label: 'Old' }], [ph('PODS')]);
      expect(r.defs).toHaveLength(2);
      expect(r.defs[0]).toBe(mine);
      expect([...r.unused]).toEqual(['OLD']);
      expect(r.added).toEqual([]);
    });

    it('proposes one date range for X_FROM and X_TO', () => {
      const r = reconcile([], [ph('PERIOD_FROM'), ph('PERIOD_TO')], ['PERIOD']);
      expect(r.defs.map((d) => [d.name, d.type])).toEqual([['PERIOD', 'dateRange']]);
      expect(r.unused.size).toBe(0);
    });

    it('turns two untouched text definitions into the range, but leaves ones the author changed alone', () => {
      const untouched = reconcile([], [ph('PERIOD_FROM')]).defs;
      expect(untouched).toHaveLength(1);
      const both = reconcile(untouched, [ph('PERIOD_FROM'), ph('PERIOD_TO')], ['PERIOD']);
      expect(both.defs.map((d) => d.name)).toEqual(['PERIOD']);

      const edited: ParamDef[] = [{ name: 'PERIOD_FROM', type: 'date', label: 'Start' }];
      const kept = reconcile(edited, [ph('PERIOD_FROM'), ph('PERIOD_TO')], ['PERIOD']);
      expect(kept.defs.map((d) => d.name)).toEqual(['PERIOD_FROM', 'PERIOD_TO']);
    });

    it('treats the two halves of a range definition as used', () => {
      const range: ParamDef = { name: 'PERIOD', type: 'dateRange', label: 'Period' };
      const r = reconcile([range], [ph('PERIOD_FROM'), ph('PERIOD_TO')], ['PERIOD']);
      expect(r.defs).toEqual([range]);
      expect(r.unused.size).toBe(0);
    });
  });

  describe('toRequestParameters', () => {
    it('drops the unused ones and the settings a type does not use', () => {
      const defs: ParamDef[] = [
        {
          name: ' pods ',
          type: 'multi',
          label: ' Pods ',
          valueType: 'int',
          optionsKind: 'query',
          optionsSql: 'SELECT 1',
          options: [{ value: 'a', label: 'A' }],
          min: 3,
          isRequired: true,
          maxSelected: 5,
        },
        {
          name: 'N',
          type: 'number',
          label: 'N',
          min: 1,
          max: 9,
          integerOnly: true,
          lookupKind: 'pod',
        },
        { name: 'GONE', type: 'text', label: 'Gone' },
        { name: 'T', type: 'text', label: 'T', maxLength: 20, optionsKind: 'fixed' },
        {
          name: 'L',
          type: 'lookup',
          label: 'L',
          lookupKind: 'client',
          lookupMulti: true,
          maxSelected: 4,
        },
      ];

      const out = toRequestParameters(defs, new Set(['GONE']));

      expect(out.map((d) => d.name)).toEqual(['PODS', 'N', 'T', 'L']);
      expect(out[0]).toEqual({
        name: 'PODS',
        type: 'multi',
        label: 'Pods',
        isRequired: true,
        valueType: 'int',
        optionsKind: 'query',
        optionsSql: 'SELECT 1',
        maxSelected: 5,
      });
      expect(out[1]).toEqual({
        name: 'N',
        type: 'number',
        label: 'N',
        min: 1,
        max: 9,
        integerOnly: true,
      });
      expect(out[2]).toEqual({ name: 'T', type: 'text', label: 'T', maxLength: 20 });
      expect(out[3]).toEqual({
        name: 'L',
        type: 'lookup',
        label: 'L',
        lookupKind: 'client',
        lookupMulti: true,
        maxSelected: 4,
      });
    });

    it('trims a fixed list', () => {
      const out = toRequestParameters(
        [
          {
            name: 'A',
            type: 'single',
            label: 'A',
            optionsKind: 'fixed',
            options: [{ value: ' x ', label: ' X ' }],
          },
        ],
        new Set(),
      );
      expect(out[0].options).toEqual([{ value: 'x', label: 'X' }]);
      expect(out[0].valueType).toBe('text');
    });
  });

  it('names the list parameters for the analysis, with the element type', () => {
    expect(
      listParameters([
        { name: 'A', type: 'multi', label: 'A', valueType: 'int' },
        { name: 'B', type: 'multi', label: 'B' },
        { name: 'C', type: 'lookup', label: 'C', lookupMulti: true },
        { name: 'D', type: 'lookup', label: 'D' },
        { name: 'E', type: 'single', label: 'E' },
      ]),
    ).toEqual([
      { name: 'A', valueType: 'int' },
      { name: 'B', valueType: 'text' },
      { name: 'C', valueType: 'int' },
    ]);
  });

  describe('definitionProblems', () => {
    it('says what is missing in the author’s words and ignores unused definitions', () => {
      const problems = definitionProblems(
        [
          { name: 'A', type: 'text', label: ' ' },
          { name: 'B', type: 'lookup', label: 'B' },
          { name: 'C', type: 'single', label: 'C' },
          {
            name: 'D',
            type: 'single',
            label: 'D',
            optionsKind: 'fixed',
            options: [{ value: ' ', label: '' }],
          },
          { name: 'E', type: 'multi', label: 'E', optionsKind: 'query', optionsSql: ' ' },
          { name: 'F', type: 'number', label: 'F', min: 5, max: 1 },
          { name: 'G', type: 'text', label: '' },
        ],
        new Set(['G']),
      );

      expect(problems).toEqual([
        'Parameter A: enter a label.',
        'Parameter B: choose what the lookup searches.',
        'Parameter C: choose where the choices come from.',
        'Parameter D: add at least one choice.',
        'Parameter E: enter the SELECT that returns Value and Label.',
        'Parameter F: the lowest value is above the highest value.',
      ]);
    });

    it('accepts complete definitions', () => {
      expect(
        definitionProblems(
          [
            {
              name: 'A',
              type: 'single',
              label: 'A',
              optionsKind: 'fixed',
              options: [{ value: 'x', label: 'X' }],
            },
            { name: 'B', type: 'lookup', label: 'B', lookupKind: 'pod' },
          ],
          new Set(),
        ),
      ).toEqual([]);
    });
  });

  it('resets what a new type needs when the type changes and keeps name, label and help', () => {
    const next = withType(
      { name: 'A', type: 'text', label: 'Alpha', helpText: 'h', isRequired: true, maxLength: 9 },
      'single',
    );
    expect(next).toMatchObject({
      name: 'A',
      type: 'single',
      label: 'Alpha',
      helpText: 'h',
      isRequired: true,
      optionsKind: 'fixed',
      valueType: 'text',
    });
    expect(next.maxLength).toBeUndefined();
    expect(withType({ name: 'A', type: 'text', label: 'A' }, 'lookup').lookupKind).toBe('client');
  });

  it('offers the keywords the server understands for dates, ranges and pods', () => {
    expect(defaultKeywords({ name: 'D', type: 'date', label: 'D' }).map((k) => k.value)).toContain(
      'today',
    );
    expect(
      defaultKeywords({ name: 'D', type: 'dateRange', label: 'D' }).map((k) => k.value),
    ).toContain('thisMonth');
    expect(
      defaultKeywords({
        name: 'P',
        type: 'lookup',
        label: 'P',
        lookupKind: 'pod',
        lookupMulti: true,
      }).map((k) => k.value),
    ).toEqual(['myPods']);
    expect(
      defaultKeywords({ name: 'P', type: 'lookup', label: 'P', lookupKind: 'pod' }).map(
        (k) => k.value,
      ),
    ).toEqual(['myPod']);
    expect(
      defaultKeywords({ name: 'P', type: 'lookup', label: 'P', lookupKind: 'user' }).map(
        (k) => k.value,
      ),
    ).toEqual(['me']);
    expect(defaultKeywords({ name: 'T', type: 'text', label: 'T' })).toEqual([]);
  });
});
