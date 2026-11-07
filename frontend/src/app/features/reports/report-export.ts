import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QuietRequests } from '../../core/http/interceptors';
import { formatInt } from '../../shared/ui/number-format';
import { columnRef } from './report-result-query';

/** What a finished export tells the page: the file name the server chose, how many data rows it holds and whether the result was cut at the row limit. */
export interface ReportExport {
  readonly fileName: string;
  readonly rows: number;
  readonly truncated: boolean;
}

/**
 * The query of an export: the grid's sort (`#3:asc`), its filter text (columns as `#<index>`) and the visible columns in their order, the same arguments
 * the rows endpoint got. `columns` are POSITIONS in the result's `columns` array (#1291): two columns of one name are two positions, and the file
 * writes each under its own name.
 */
export interface ReportExportQuery {
  readonly sort?: string;
  readonly filter?: string;
  readonly columns: readonly number[];
}

/** The file name of a `Content-Disposition` header (`filename*=UTF-8''...` first, then `filename="..."`), or the fallback. */
export function fileNameOf(header: string | null, fallback = 'report.csv'): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return sanitize(decodeURIComponent(star[1].trim())) || fallback;
    } catch {
      // A malformed escape: fall through to the plain form.
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(header);
  const plain = /filename\s*=\s*([^;]+)/.exec(header);
  const raw = quoted ? quoted[1].replace(/\\(.)/g, '$1') : plain?.[1].trim();
  return (raw ? sanitize(raw) : '') || fallback;
}

/** A name the browser may use for a download: no path, no control characters. */
function sanitize(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/\u0000-\u001f]/g, '_').trim();
}

/** The message of the toast after a download (spec 5.3): "Exported 143 rows to CSV." or "Exported 50,000 rows (truncated)." */
export function exportedText(rows: number, truncated: boolean): string {
  const noun = rows === 1 ? 'row' : 'rows';
  return truncated
    ? `Exported ${formatInt(rows)} ${noun} (truncated).`
    : `Exported ${formatInt(rows)} ${noun} to CSV.`;
}

/** Saves a blob as a file in the browser (an object URL on an anchor with `download`; no cookie link, no hidden frame). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The CSV export of a report result (#721, spec section 5): `GET /api/v1/reports/runs/{runId}/export.csv` as an authorised request (the app's own
 * `HttpClient`, so the interceptors add what every call carries), the file as a blob. The generated client cannot do this (it reads the body as JSON), and
 * a plain link would carry no credentials. A refusal arrives as an `ApiError` with the problem details (the interceptor reads the blob body): 404 and 410
 * mean the result is gone, 400 an unreadable sort, filter or column. Failures are quiet here (no toast of the interceptor): the grid says what happened.
 */
@Injectable({ providedIn: 'root' })
export class ReportExportService {
  private readonly http = inject(HttpClient);
  private readonly quiet = inject(QuietRequests);

  /** The address of the export of a run. One `columns=#<position>` per exported column in file order, each encoded on its own (`#` becomes `%23`). */
  url(runId: string, query: ReportExportQuery): string {
    const parts: string[] = [];
    if (query.sort) parts.push(`sort=${encodeURIComponent(query.sort)}`);
    if (query.filter) parts.push(`filter=${encodeURIComponent(query.filter)}`);
    for (const c of query.columns) parts.push(`columns=${encodeURIComponent(columnRef(c))}`);
    const base = `/api/v1/reports/runs/${encodeURIComponent(runId)}/export.csv`;
    return parts.length > 0 ? `${base}?${parts.join('&')}` : base;
  }

  /** Asks for the file, saves it and reports what the server said about it. Throws the `ApiError` of a refusal. */
  async download(runId: string, query: ReportExportQuery): Promise<ReportExport> {
    const response: HttpResponse<Blob> = await this.quiet.run(() =>
      firstValueFrom(
        this.http.get(this.url(runId, query), { observe: 'response', responseType: 'blob' }),
      ),
    );
    const blob = response.body ?? new Blob([], { type: 'text/csv' });
    const fileName = fileNameOf(response.headers.get('Content-Disposition'));
    saveBlob(blob, fileName);
    const rows = Number(response.headers.get('X-Export-Rows'));
    return {
      fileName,
      rows: Number.isFinite(rows) ? rows : 0,
      truncated: response.headers.get('X-Export-Truncated')?.toLowerCase() === 'true',
    };
  }
}
