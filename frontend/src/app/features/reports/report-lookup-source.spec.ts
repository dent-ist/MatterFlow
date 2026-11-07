import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReportChoicesClient } from '../../api/generated/api-client';
import { ReportLookupSource } from './report-lookup-source';

type Mock = ReturnType<typeof vi.fn>;

describe('ReportLookupSource (#719, decision 13: the reports-owned endpoint)', () => {
  let api: { getReportLookup: Mock };
  let source: ReportLookupSource;
  const target = { reportId: 7, parameter: 'CLIENT' };

  beforeEach(() => {
    api = {
      getReportLookup: vi
        .fn()
        .mockReturnValue(of([{ id: 9, label: '00017 Acme', extra: 'ignored' }])),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ReportChoicesClient, useValue: api }],
    });
    source = TestBed.inject(ReportLookupSource);
  });

  it('knows which kinds are found by typing and which are shown whole', () => {
    expect(['matter', 'client', 'user'].map((k) => source.isSearched(k))).toEqual([
      true,
      true,
      true,
    ]);
    expect(['pod', 'role', 'taskType', undefined].map((k) => source.isSearched(k))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('searches through the report and parameter with the trimmed text and take 25, keeping the id and the label only', async () => {
    const found = await source.search(target, ' ac ');
    expect(found).toEqual([{ id: 9, label: '00017 Acme' }]);
    expect(api.getReportLookup).toHaveBeenCalledWith(7, 'CLIENT', 'ac', 25, undefined);
  });

  it('asks without text for the first rows when the text is empty', async () => {
    await source.search(target, '   ');
    expect(api.getReportLookup).toHaveBeenCalledWith(7, 'CLIENT', undefined, 25, undefined);
  });

  it('lists a short kind (pods, roles, task types) in one call with take 50', async () => {
    api.getReportLookup.mockReturnValue(of([{ id: 1, label: 'Pod A' }]));
    expect(await source.list({ reportId: 7, parameter: 'POD' })).toEqual([
      { id: 1, label: 'Pod A' },
    ]);
    expect(api.getReportLookup).toHaveBeenCalledTimes(1);
    expect(api.getReportLookup).toHaveBeenCalledWith(7, 'POD', undefined, 50, undefined);
  });

  it('resolves the words of ids from an address or a default in one call; an unknown id is simply absent', async () => {
    api.getReportLookup.mockReturnValue(of([{ id: 9, label: '00017 Acme' }]));
    expect(await source.labels(target, [9, 5, 9])).toEqual([{ id: 9, label: '00017 Acme' }]);
    expect(api.getReportLookup).toHaveBeenCalledTimes(1);
    expect(api.getReportLookup).toHaveBeenCalledWith(7, 'CLIENT', undefined, undefined, [9, 5]);
    expect(await source.labels(target, [])).toEqual([]);
    expect(api.getReportLookup).toHaveBeenCalledTimes(1);
  });

  it('sends more than 200 ids in several calls (the server takes 200 at most)', async () => {
    api.getReportLookup.mockReturnValue(of([]));
    await source.labels(
      target,
      Array.from({ length: 450 }, (_, i) => i + 1),
    );
    expect(api.getReportLookup.mock.calls.map((c) => (c[4] as number[]).length)).toEqual([
      200, 200, 50,
    ]);
  });

  it('uses no other endpoint than the report lookup', () => {
    // The module is the single reader: the app lookup clients are not even injectable here.
    expect(Object.keys(api)).toEqual(['getReportLookup']);
  });

  it('rejects with the HTTP error when the server refuses, so the control can show its own message', async () => {
    api.getReportLookup.mockReturnValue(throwError(() => new Error('403')));
    await expect(source.search(target, '')).rejects.toThrow('403');
    await expect(source.labels(target, [1])).rejects.toThrow('403');
  });
});
