import { detailsSummary, requestFieldCount } from './details-summary';

describe('details summary (#307)', () => {
  it('counts only request-form values that have something in them', () => {
    expect(
      requestFieldCount({
        formValues: { a: 'x', b: '', c: '  ', d: null, e: [], f: ['x'], g: 0, h: false, i: {} },
      }),
    ).toBe(4);
    expect(requestFieldCount({ formValues: undefined })).toBe(0);
  });

  it('reads Requestor name and the number of request fields', () => {
    expect(
      detailsSummary({ requestorName: 'Dana W-M', formValues: { a: 'x', b: 'y', c: 'z' } }),
    ).toBe('Requestor Dana W-M · 3 request fields');
  });

  it('says "field" for one and leaves out a part there is nothing to say about', () => {
    expect(detailsSummary({ requestorName: 'Dana', formValues: { a: 'x' } })).toBe(
      'Requestor Dana · 1 request field',
    );
    expect(detailsSummary({ requestorName: 'Dana', formValues: {} })).toBe('Requestor Dana');
    expect(detailsSummary({ requestorName: ' ', formValues: { a: 'x' } })).toBe('1 request field');
    expect(detailsSummary(null)).toBe('');
  });
});
