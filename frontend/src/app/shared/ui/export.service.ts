import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiError } from '../../core/http/api-error';
import { firstValueFrom } from 'rxjs';
import { ExportFormat } from './list-export';
import type { ExportResult } from './export-menu';

/** A refusal the person can act on ("This list has 12,400 tasks. An export carries at most 10,000: narrow the filters"). */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

/** The message of a problem-details body that came back as text (the export asks for `text`, so the error body is not parsed for us). */
function problemMessage(error: unknown): string | null {
  const raw: unknown =
    error instanceof ApiError
      ? error.response.error
      : error instanceof HttpErrorResponse
        ? error.error
        : null;
  if (error instanceof ApiError && error.problem?.detail) return error.problem.detail;
  if (typeof raw !== 'string') return null;
  try {
    const body = JSON.parse(raw) as {
      detail?: string;
      errors?: Record<string, { message: string }[]>;
    };
    return Object.values(body.errors ?? {})[0]?.[0]?.message ?? body.detail ?? null;
  } catch {
    return null;
  }
}

/**
 * The server side of the Export menu (PM v2, #879). `taskQueue` asks `GET /api/v1/task-queue/export` for the same filters and sort as the screen
 * (every page, at most 10,000 rows; the server audits it). `log` records an export the browser built itself from rows the person already sees.
 * Plain `HttpClient`, so it never pulls the generated client into the chunk that uses it.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly http = inject(HttpClient);

  async taskQueue(
    query: Record<string, string | string[] | null | undefined>,
    format: ExportFormat,
  ): Promise<ExportResult> {
    let params = new HttpParams().set('format', format);
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === '') continue;
      for (const v of Array.isArray(value) ? value : [value]) params = params.append(key, v);
    }
    let response;
    try {
      response = await firstValueFrom(
        this.http.get('/api/v1/task-queue/export', {
          params,
          responseType: 'text',
          observe: 'response',
        }),
      );
    } catch (error) {
      const message = problemMessage(error);
      throw message ? new ExportError(message) : error;
    }
    const rows = Number(response.headers.get('X-Export-Rows') ?? 0);
    return { text: response.body ?? '', rows: Number.isFinite(rows) ? rows : 0 };
  }

  /** Best effort: the export has already happened, so a failed log is not shown as a failed export. */
  async log(
    surface: string,
    format: ExportFormat,
    rowCount: number,
    filters: string,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/api/v1/exports/log', {
          surface,
          format: format === 'csv' ? 'csv' : 'text',
          rowCount,
          filters: filters.slice(0, 500),
        }),
      );
    } catch {
      // The list was exported; the audit line is missing and the server log has the failed call.
    }
  }
}
