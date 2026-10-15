import fs from 'node:fs';
import path from 'node:path';
import { APIRequestContext, request } from '@playwright/test';

export const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5190';

/** The bootstrap System Admin (`Bootstrap__SystemAdmins__0` in the stack). All setup runs as this user. */
export const ADMIN_USER = 'ke\\kekim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

/** True for the answers that mean "the database lost a deadlock, repeat the call" (see `Api.call`). */
export function isTransientConflict(result: RawResponse): boolean {
  if (result.status === 500) return result.body?.code === 'INTERNAL_ERROR';
  return (
    result.status === 409 &&
    result.body?.code === 'CONCURRENCY_CONFLICT' &&
    String(result.body?.detail ?? '').includes('Another change was in progress')
  );
}

export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: Json,
  ) {
    super(
      `${method} ${path} -> ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    );
  }

  /** The machine-readable `code` of the problem response (for example `DUPLICATE_NUMBER`). */
  get code(): string | undefined {
    return typeof this.body === 'object' ? this.body?.code : undefined;
  }
}

export interface RawResponse {
  status: number;
  body: Json;
}

/**
 * Thin JSON client for the MatterFlow API, acting as one Dev-auth user (`X-Dev-User`). Used for test setup and for the few
 * API-level assertions the scenarios call for (cross-matter rejection, permission denial). Every call that is not expected to
 * fail throws with the response body, so a broken fixture points at the cause rather than at a later assertion.
 */
export class Api {
  private constructor(
    private readonly ctx: APIRequestContext,
    readonly user: string,
  ) {}

  /** `timeZone` is sent as `X-Time-Zone`, the way the app does for the viewer's browser zone. */
  static async as(user: string = ADMIN_USER, options: { timeZone?: string } = {}): Promise<Api> {
    const ctx = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        'X-Dev-User': user,
        'X-MatterFlow-Client': 'web',
        ...(options.timeZone ? { 'X-Time-Zone': options.timeZone } : {}),
      },
    });
    return new Api(ctx, user);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  /** Performs the call and returns status and parsed body without throwing (for negative checks). */
  async raw(method: string, path: string, body?: unknown): Promise<RawResponse> {
    const response = await this.ctx.fetch(path, {
      method,
      data: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    });
    const text = await response.text();
    let parsed: Json = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: response.status(), body: parsed };
  }

  /** Multipart upload of one local file under the given form field (used for the .eml parser). */
  async upload(apiPath: string, field: string, filePath: string): Promise<RawResponse> {
    const response = await this.ctx.post(apiPath, {
      multipart: {
        [field]: {
          name: path.basename(filePath),
          mimeType: 'application/octet-stream',
          buffer: fs.readFileSync(filePath),
        },
      },
    });
    const text = await response.text();
    let parsed: Json = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: response.status(), body: parsed };
  }

  /**
   * Performs the call and returns the parsed body; throws on a non-2xx answer. A 500 `INTERNAL_ERROR` is retried once after a short
   * pause: on a cold database concurrent setup calls occasionally lose a SQL Server deadlock (see docs/qa/e2e-findings.md, E2E-F3),
   * the transaction is rolled back and the same call succeeds. The retry is logged so it stays visible.
   */
  async call<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    let result = await this.raw(method, path, body);
    // A SQL Server deadlock victim is rolled back as a whole and succeeds when repeated. The API answers it with 409 CONCURRENCY_CONFLICT
    // and "Another change was in progress..." (a stale row version has a different message and is never retried), older builds with 500.
    // Setup calls retry up to twice with a growing pause; every retry is logged so it stays visible.
    for (let retry = 1; retry <= 2 && isTransientConflict(result); retry++) {
      console.warn(
        `[e2e] ${method} ${path} -> ${result.status} ${result.body?.code}, retry ${retry} of 2`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500 * retry));
      result = await this.raw(method, path, body);
    }
    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(method, path, result.status, result.body);
    }
    return result.body as T;
  }

  get<T = Json>(path: string): Promise<T> {
    return this.call<T>('GET', path);
  }
  post<T = Json>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('POST', path, body ?? {});
  }
  put<T = Json>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('PUT', path, body ?? {});
  }
  delete<T = Json>(path: string): Promise<T> {
    return this.call<T>('DELETE', path);
  }
}
