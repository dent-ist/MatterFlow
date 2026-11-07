import { convertToParamMap } from '@angular/router';
import {
  buildRequest,
  defaultValues,
  displayDate,
  groupDigits,
  initialValues,
  isIsoDate,
  parseNumber,
  summaryParts,
  urlParams,
  validate,
} from './report-params';
import { aParam } from './reports-testing';

const map = (params: Record<string, string | string[]>) => convertToParamMap(params);

describe('the parameters of a report run (#719)', () => {
  describe('starting values', () => {
    it('start from the server defaults, which the server resolved for this person and day', () => {
      const defs = [
        aParam({ name: 'FROM', type: 'date', default: '2026-11-01' as never }),
        aParam({
          name: 'SPAN',
          type: 'dateRange',
          default: { from: '2026-11-01', to: '2026-11-30' } as never,
        }),
        aParam({
          name: 'PODS',
          type: 'lookup',
          lookupKind: 'pod',
          multiple: true,
          default: [3, 4] as never,
        }),
        aParam({ name: 'OPEN', type: 'yesNo', default: true as never }),
        aParam({ name: 'MIN', type: 'number', default: 5 as never }),
        aParam({ name: 'STATUS', type: 'multi', default: ['Open'] as never }),
      ];
      expect(defaultValues(defs)).toEqual({
        FROM: '2026-11-01',
        SPAN: { from: '2026-11-01', to: '2026-11-30' },
        PODS: [
          { id: 3, label: '' },
          { id: 4, label: '' },
        ],
        OPEN: 'yes',
        MIN: '5',
        STATUS: ['Open'],
      });
    });

    it('an optional yes/no starts on Any, a required one on neither answer', () => {
      expect(defaultValues([aParam({ name: 'A', type: 'yesNo' })])).toEqual({ A: 'any' });
      expect(defaultValues([aParam({ name: 'A', type: 'yesNo', required: true })])).toEqual({
        A: '',
      });
    });

    it('the address wins over the default, by name in any letter case, and repeats a name for a list', () => {
      const defs = [
        aParam({ name: 'FROM', type: 'date', default: '2026-11-01' as never }),
        aParam({ name: 'STATUS', type: 'multi' }),
        aParam({ name: 'SPAN', type: 'dateRange' }),
        aParam({ name: 'CLIENT', type: 'lookup', lookupKind: 'client' }),
        aParam({ name: 'OPEN', type: 'yesNo' }),
      ];
      const values = initialValues(
        defs,
        map({
          from: '2026-01-05',
          STATUS: ['Open', 'Closed'],
          'SPAN.from': '2026-02-01',
          'span.to': '2026-02-28',
          CLIENT: '17',
          OPEN: 'false',
        }),
      );
      expect(values).toEqual({
        FROM: '2026-01-05',
        STATUS: ['Open', 'Closed'],
        SPAN: { from: '2026-02-01', to: '2026-02-28' },
        CLIENT: [{ id: 17, label: '' }],
        OPEN: 'no',
      });
    });

    it('ignores an id that is not a number and takes one id for a single lookup', () => {
      const defs = [aParam({ name: 'C', type: 'lookup', lookupKind: 'client' })];
      expect(initialValues(defs, map({ C: ['x', '5', '6'] }))).toEqual({
        C: [{ id: 5, label: '' }],
      });
    });
  });

  describe('the address of a run', () => {
    it('round trips: what urlParams writes, initialValues reads back', () => {
      const defs = [
        aParam({ name: 'FROM', type: 'date' }),
        aParam({ name: 'SPAN', type: 'dateRange' }),
        aParam({ name: 'STATUS', type: 'multi' }),
        aParam({ name: 'PODS', type: 'lookup', lookupKind: 'pod', multiple: true }),
        aParam({ name: 'OPEN', type: 'yesNo' }),
        aParam({ name: 'MIN', type: 'number' }),
        aParam({ name: 'TEXT', type: 'text' }),
        aParam({ name: 'ONE', type: 'single' }),
      ];
      const values = {
        FROM: '2026-03-01',
        SPAN: { from: '2026-04-01', to: '2026-04-30' },
        STATUS: ['A', 'B'],
        PODS: [
          { id: 1, label: 'Pod One' },
          { id: 2, label: 'Pod Two' },
        ],
        OPEN: 'yes',
        MIN: '12.5',
        TEXT: 'hello world',
        ONE: 'x',
      };
      const params = urlParams(defs, values);
      expect(params['SPAN.from']).toBe('2026-04-01');
      expect(params['OPEN']).toBe('true');
      const back = initialValues(
        defs,
        map(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null)) as never),
      );
      expect(back).toEqual({
        ...values,
        PODS: [
          { id: 1, label: '' },
          { id: 2, label: '' },
        ],
      });
    });

    it('removes a parameter that has nothing in it (null)', () => {
      const defs = [aParam({ name: 'A', type: 'text' }), aParam({ name: 'B', type: 'yesNo' })];
      expect(urlParams(defs, { A: '  ', B: 'any' })).toEqual({ A: null, B: null });
    });
  });

  describe('validation (spec 3.3, fixed sentences)', () => {
    const one = (def: Parameters<typeof aParam>[0], value: never) =>
      validate([aParam(def)], { [def!.name ?? 'NAME']: value });

    it('asks for what is required: Enter for text, number and date, Select for lists and lookups', () => {
      expect(
        one({ name: 'NAME', type: 'text', label: 'Client Name', required: true }, '' as never),
      ).toEqual({
        NAME: 'Enter Client Name.',
      });
      expect(
        one({ name: 'N', type: 'number', label: 'Minimum', required: true }, '' as never),
      ).toEqual({
        N: 'Enter Minimum.',
      });
      expect(one({ name: 'D', type: 'date', label: 'Start', required: true }, '' as never)).toEqual(
        {
          D: 'Enter Start.',
        },
      );
      expect(
        one({ name: 'S', type: 'single', label: 'Status', required: true }, '' as never),
      ).toEqual({
        S: 'Select Status.',
      });
      expect(
        one({ name: 'M', type: 'multi', label: 'Statuses', required: true }, [] as never),
      ).toEqual({
        M: 'Select Statuses.',
      });
      expect(
        one(
          { name: 'L', type: 'lookup', label: 'Client', required: true, lookupKind: 'client' },
          [] as never,
        ),
      ).toEqual({
        L: 'Select Client.',
      });
      expect(one({ name: 'Y', type: 'yesNo', label: 'Open', required: true }, '' as never)).toEqual(
        {
          Y: 'Select Open.',
        },
      );
    });

    it('lets an optional empty value through', () => {
      expect(
        validate([aParam({ name: 'A', type: 'text' }), aParam({ name: 'B', type: 'number' })], {
          A: '',
          B: '',
        }),
      ).toEqual({});
    });

    it('checks numbers: a number, a whole number, and the range', () => {
      const def = { name: 'N', type: 'number', label: 'Hours', min: 1, max: 24 } as const;
      expect(one(def, 'abc' as never)).toEqual({ N: 'Hours must be a number.' });
      expect(one(def, '30' as never)).toEqual({ N: 'Hours must be between 1 and 24.' });
      expect(one(def, '0' as never)).toEqual({ N: 'Hours must be between 1 and 24.' });
      expect(one(def, '1,5' as never)).toEqual({}); // commas are thousands marks: 15
      expect(one(def, '12.5' as never)).toEqual({});
      expect(one({ ...def, integerOnly: true }, '12.5' as never)).toEqual({
        N: 'Hours must be a whole number.',
      });
      expect(one({ name: 'N', type: 'number', label: 'Hours', min: 1 }, '0' as never)).toEqual({
        N: 'Hours must be at least 1.',
      });
    });

    it('checks dates and the order of a range', () => {
      expect(one({ name: 'D', type: 'date', label: 'Start' }, '2026-02-30' as never)).toEqual({
        D: 'Start must be a date (MM/DD/YYYY).',
      });
      expect(
        one({ name: 'R', type: 'dateRange', label: 'Period' }, {
          from: '2026-05-02',
          to: '2026-05-01',
        } as never),
      ).toEqual({
        R: 'From must be on or before To.',
      });
      expect(
        one({ name: 'R', type: 'dateRange', label: 'Period' }, {
          from: '2026-05-01',
          to: '',
        } as never),
      ).toEqual({});
      expect(
        one({ name: 'R', type: 'dateRange', label: 'Period', required: true }, {
          from: '2026-05-01',
          to: '',
        } as never),
      ).toEqual({
        R: 'Enter Period.',
      });
    });

    it('checks the length of text (400 unless the report says) and the size of a list (200 unless the report says)', () => {
      expect(one({ name: 'T', type: 'text', label: 'Note' }, 'x'.repeat(401) as never)).toEqual({
        T: 'Note must be 400 characters or fewer.',
      });
      expect(
        one({ name: 'T', type: 'text', label: 'Note', maxLength: 5 }, 'abcdef' as never),
      ).toEqual({
        T: 'Note must be 5 characters or fewer.',
      });
      expect(
        one({ name: 'M', type: 'multi', label: 'Statuses' }, Array(201).fill('a') as never),
      ).toEqual({
        M: 'Select 200 or fewer.',
      });
      expect(
        one({ name: 'M', type: 'multi', label: 'Statuses', maxSelected: 2 }, [
          'a',
          'b',
          'c',
        ] as never),
      ).toEqual({
        M: 'Select 2 or fewer.',
      });
    });
  });

  describe('the run request', () => {
    it('sends numbers as numbers, dates as text, a range as { from, to }, lists as arrays, yes/no as booleans and lookups as ids', () => {
      const defs = [
        aParam({ name: 'N', type: 'number' }),
        aParam({ name: 'D', type: 'date' }),
        aParam({ name: 'R', type: 'dateRange' }),
        aParam({ name: 'T', type: 'text' }),
        aParam({ name: 'S', type: 'single', valueType: 'int' }),
        aParam({ name: 'M', type: 'multi', valueType: 'text' }),
        aParam({ name: 'MI', type: 'multi', valueType: 'int' }),
        aParam({ name: 'Y', type: 'yesNo' }),
        aParam({ name: 'C', type: 'lookup', lookupKind: 'client' }),
        aParam({ name: 'P', type: 'lookup', lookupKind: 'pod', multiple: true }),
      ];
      const request = buildRequest(defs, {
        N: '1,234.5',
        D: '2026-01-02',
        R: { from: '2026-01-01', to: '2026-01-31' },
        T: '  padded  ',
        S: '7',
        M: ['a', 'b'],
        MI: ['1', '2'],
        Y: 'no',
        C: [{ id: 9, label: 'Nine' }],
        P: [
          { id: 1, label: 'x' },
          { id: 2, label: 'y' },
        ],
      });
      expect(request).toEqual({
        N: 1234.5,
        D: '2026-01-02',
        R: { from: '2026-01-01', to: '2026-01-31' },
        T: 'padded',
        S: 7,
        M: ['a', 'b'],
        MI: [1, 2],
        Y: false,
        C: 9,
        P: [1, 2],
      });
    });

    it('leaves out a parameter with nothing in it so the server uses its default', () => {
      const defs = [
        aParam({ name: 'A', type: 'text' }),
        aParam({ name: 'B', type: 'yesNo' }),
        aParam({ name: 'C', type: 'multi' }),
      ];
      expect(buildRequest(defs, { A: '', B: 'any', C: [] })).toEqual({});
    });
  });

  describe('the summary bar', () => {
    it('says label and value for each parameter that has one, with option words and MM/DD/YYYY dates', () => {
      const defs = [
        aParam({ name: 'R', type: 'dateRange', label: 'Period' }),
        aParam({
          name: 'S',
          type: 'multi',
          label: 'Status',
          options: [
            { value: 'o', label: 'Open' },
            { value: 'c', label: 'Closed' },
          ],
        }),
        aParam({ name: 'Y', type: 'yesNo', label: 'Billable' }),
        aParam({ name: 'X', type: 'text', label: 'Empty' }),
        aParam({ name: 'C', type: 'lookup', lookupKind: 'client', label: 'Client' }),
      ];
      expect(
        summaryParts(defs, {
          R: { from: '2026-01-01', to: '2026-03-31' },
          S: ['o', 'c'],
          Y: 'yes',
          X: '',
          C: [{ id: 3, label: '00017 Acme' }],
        }),
      ).toEqual([
        'Period 01/01/2026 to 03/31/2026',
        'Status Open, Closed',
        'Billable Yes',
        'Client 00017 Acme',
      ]);
    });

    it('counts a long list instead of listing it, and uses fetched labels for choices from the report', () => {
      const defs = [aParam({ name: 'S', type: 'multi', label: 'Status', choicesSource: 'query' })];
      expect(summaryParts(defs, { S: ['a', 'b', 'c', 'd'] })).toEqual(['Status 4 selected']);
      expect(summaryParts(defs, { S: ['a'] }, { S: { a: 'Alpha' } })).toEqual(['Status Alpha']);
    });
  });

  describe('small helpers', () => {
    it('reads numbers with thousands marks and refuses text', () => {
      expect(parseNumber('1,234.50')).toBe(1234.5);
      expect(parseNumber('-3')).toBe(-3);
      expect(parseNumber('.5')).toBe(0.5);
      expect(parseNumber('1e5')).toBeNull();
      expect(parseNumber('')).toBeNull();
    });

    it('puts thousands commas into a number text and leaves other text alone', () => {
      expect(groupDigits('1234567.5')).toBe('1,234,567.5');
      expect(groupDigits('-1234')).toBe('-1,234');
      expect(groupDigits('12')).toBe('12');
      expect(groupDigits('abc')).toBe('abc');
    });

    it('knows a real ISO date and shows it as MM/DD/YYYY', () => {
      expect(isIsoDate('2026-02-28')).toBe(true);
      expect(isIsoDate('2026-02-30')).toBe(false);
      expect(isIsoDate('02/28/2026')).toBe(false);
      expect(displayDate('2026-02-28')).toBe('02/28/2026');
    });
  });
});
