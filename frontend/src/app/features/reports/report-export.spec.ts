import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { QuietRequests } from '../../core/http/interceptors';
import { ReportExportService, exportedText, fileNameOf } from './report-export';

describe('CSV export of a report result (#721)', () => {
  describe('fileNameOf', () => {
    it('reads the quoted file name of the server', () => {
      expect(fileNameOf('attachment; filename="overdue-tasks-20261107-1405.csv"')).toBe(
        'overdue-tasks-20261107-1405.csv',
      );
      expect(fileNameOf('attachment; filename=plain.csv; size=3')).toBe('plain.csv');
    });

    it('prefers the encoded form and decodes it', () => {
      expect(
        fileNameOf(
          'attachment; filename="fallback.csv"; filename*=UTF-8\'\'Fr%C3%BChst%C3%BCck-20261107-1405.csv',
        ),
      ).toBe('Frühstück-20261107-1405.csv');
    });

    it('keeps a path out of the name and falls back when there is no name', () => {
      expect(fileNameOf('attachment; filename="../../evil.csv"')).toBe('.._.._evil.csv');
      expect(fileNameOf(null)).toBe('report.csv');
      expect(fileNameOf('attachment')).toBe('report.csv');
      expect(fileNameOf('attachment', 'other.csv')).toBe('other.csv');
    });
  });

  it('words the toast: rows with thousands commas, "to CSV", and "(truncated)" for a cut result', () => {
    expect(exportedText(143, false)).toBe('Exported 143 rows to CSV.');
    expect(exportedText(50000, true)).toBe('Exported 50,000 rows (truncated).');
    expect(exportedText(1, false)).toBe('Exported 1 row to CSV.');
    expect(exportedText(1234, false)).toBe('Exported 1,234 rows to CSV.');
  });

  describe('ReportExportService', () => {
    let service: ReportExportService;
    let http: HttpTestingController;
    let saved: { name: string; blob: Blob | null }[];

    beforeEach(() => {
      saved = [];
      let blob: Blob | null = null;
      URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:csv'));
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        saved.push({ name: this.download, blob });
      });
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      service = TestBed.inject(ReportExportService);
      http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => vi.restoreAllMocks());

    it('builds the address with the sort as %23<position>, the filter and one columns=%23<position> per visible column in order', () => {
      const url = service.url('run-9', {
        sort: '#2:desc',
        filter: '[{"column":"#1","op":"contains","value":"x y"}]',
        columns: [0, 1, 3],
      });
      expect(url).toBe(
        '/api/v1/reports/runs/run-9/export.csv?sort=%232%3Adesc' +
          '&filter=%5B%7B%22column%22%3A%22%231%22%2C%22op%22%3A%22contains%22%2C%22value%22%3A%22x%20y%22%7D%5D' +
          '&columns=%230&columns=%231&columns=%233',
      );
      expect(service.url('r', { columns: [] })).toBe('/api/v1/reports/runs/r/export.csv');
    });

    it('sends the second of two columns named Name as its own position, never the name (#1291)', () => {
      // Columns: Name (0), Name (1), Id (2). The person hid the first Name and moved Id before the second.
      expect(service.url('r', { columns: [2, 1] })).toBe(
        '/api/v1/reports/runs/r/export.csv?columns=%232&columns=%231',
      );
      expect(service.url('r', { columns: [0, 1, 2] })).toBe(
        '/api/v1/reports/runs/r/export.csv?columns=%230&columns=%231&columns=%232',
      );
    });

    it('asks as an authorised GET (the app HttpClient, a blob), saves the file under the name of Content-Disposition and reports the headers', async () => {
      const done = service.download('run-9', { sort: '#0:asc', columns: [0, 1] });
      const req = http.expectOne((r) => r.url.startsWith('/api/v1/reports/runs/run-9/export.csv'));
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['\ufeffMatter,Hours\r\n']), {
        headers: {
          'Content-Disposition': 'attachment; filename="overdue-tasks-20261107-1405-truncated.csv"',
          'X-Export-Rows': '50000',
          'X-Export-Truncated': 'true',
        },
      });
      await expect(done).resolves.toEqual({
        fileName: 'overdue-tasks-20261107-1405-truncated.csv',
        rows: 50000,
        truncated: true,
      });
      expect(saved).toHaveLength(1);
      expect(saved[0].name).toBe('overdue-tasks-20261107-1405-truncated.csv');
      const bytes = new Uint8Array(await saved[0].blob!.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    });

    it('says not truncated for X-Export-Truncated false and reads zero rows for a missing header', async () => {
      const done = service.download('r', { columns: [0] });
      http
        .expectOne(() => true)
        .flush(new Blob(['A\r\n']), {
          headers: {
            'Content-Disposition': 'attachment; filename="a.csv"',
            'X-Export-Truncated': 'false',
          },
        });
      await expect(done).resolves.toEqual({ fileName: 'a.csv', rows: 0, truncated: false });
    });

    it('turns off the toast of the interceptor while the request runs (the grid says what happened) and saves nothing for a refusal', async () => {
      const quiet = TestBed.inject(QuietRequests);
      const done = service.download('r', { columns: [0] });
      http
        .expectOne(() => true)
        .flush(new Blob(['{"code":"RESULT_EXPIRED"}']), {
          status: 410,
          statusText: 'Gone',
        });
      await expect(done).rejects.toMatchObject({ status: 410 });
      expect(saved).toHaveLength(0);
      expect(quiet.active).toBe(false);
    });
  });
});
