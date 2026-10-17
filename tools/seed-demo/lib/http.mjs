// Minimal JSON client for the MatterFlow API with the Dev-auth headers, a per-user request pacer and retries.
// Uses the global fetch of Node 22+. Nothing here talks to the database: the seeder only uses the public HTTP API.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export { sleep };

export class ApiError extends Error {
  constructor(method, path, status, body) {
    super(
      `${method} ${path} -> ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    );
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
  get code() {
    return typeof this.body === 'object' && this.body ? this.body.code : undefined;
  }
}

/**
 * Keeps each acting user under the API's per-user budgets (defaults: 120 task writes and 30 comment writes per minute; the limits are
 * fixed windows of one minute, so the pacer works with a sliding window and stays below them).
 */
export class Pacer {
  constructor({ taskWrites = 100, commentWrites = 25 } = {}) {
    this.limits = { task: taskWrites, comment: commentWrites };
    this.stamps = new Map();
  }

  async wait(user, kind) {
    const key = `${user.toLowerCase()}|${kind}`;
    const limit = this.limits[kind];
    for (;;) {
      const now = Date.now();
      const list = (this.stamps.get(key) ?? []).filter((t) => now - t < 60_000);
      if (list.length < limit) {
        list.push(now);
        this.stamps.set(key, list);
        return;
      }
      this.stamps.set(key, list);
      await sleep(Math.max(250, 60_000 - (now - list[0]) + 50));
    }
  }
}

function budgetKind(method, path) {
  if (method === 'GET' || method === 'HEAD') return null;
  if (!path.startsWith('/api/v1/tasks')) return null;
  return path.includes('/comments') ? 'comment' : 'task';
}

/**
 * True for the answers that mean "the database picked this request as a deadlock victim" (409 "Another change was in progress", or a 500).
 * Only reads are repeated here: the server can fail a write after it committed (a duplicate Task showed up that way), so a write is
 * repeated by its caller, which first checks what exists (see `withRecheck` and `isAmbiguous`).
 */
function isTransient(method, status, body) {
  if (method !== 'GET') return false;
  if (status === 409) {
    return (
      body?.code === 'CONCURRENCY_CONFLICT' &&
      String(body?.detail ?? '').includes('Another change was in progress')
    );
  }
  return status === 500 && body?.code === 'INTERNAL_ERROR';
}

/** A failed write whose outcome is unknown (the server may have committed before it failed) or a stale version: the caller re-reads and decides. */
export function isAmbiguous(error) {
  return (
    error instanceof ApiError &&
    (error.status === 500 || (error.status === 409 && error.code === 'CONCURRENCY_CONFLICT'))
  );
}

export class Api {
  /**
   * @param {string} base  API origin, e.g. http://localhost:5080
   * @param {string} user  Dev-auth account sent as X-Dev-User
   * @param {Pacer} pacer  shared pacer
   * @param {{ dryRun?: boolean, stats?: { retries429: number, retriesTransient: number, calls: number } }} options
   */
  constructor(base, user, pacer, options = {}) {
    this.base = base.replace(/\/+$/, '');
    this.user = user;
    this.pacer = pacer;
    this.dryRun = !!options.dryRun;
    this.stats = options.stats ?? { retries429: 0, retriesTransient: 0, calls: 0 };
  }

  as(user) {
    return new Api(this.base, user, this.pacer, { dryRun: this.dryRun, stats: this.stats });
  }

  async raw(method, path, body) {
    const kind = budgetKind(method, path);
    for (let attempt = 0; ; attempt++) {
      if (kind) await this.pacer.wait(this.user, kind);
      this.stats.calls++;
      const response = await fetch(this.base + path, {
        method,
        headers: {
          'X-Dev-User': this.user,
          'X-MatterFlow-Client': 'web',
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      if (response.status === 429 && attempt < 12) {
        const retryAfter = Number(response.headers.get('retry-after')) || 5;
        this.stats.retries429++;
        await sleep(Math.min(retryAfter, 65) * 1000 + 250);
        continue;
      }
      if (isTransient(method, response.status, parsed) && attempt < 6) {
        this.stats.retriesTransient++;
        await sleep(300 * (attempt + 1) + Math.floor(Math.random() * 300));
        continue;
      }
      return { status: response.status, body: parsed };
    }
  }

  /** Performs the call and returns the parsed body; throws ApiError on a non-2xx answer. In dry-run mode writes are refused. */
  async call(method, path, body) {
    if (this.dryRun && method !== 'GET') throw new Error(`dry-run: refusing ${method} ${path}`);
    const result = await this.raw(method, path, body);
    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(method, path, result.status, result.body);
    }
    return result.body;
  }

  get(path) {
    return this.call('GET', path);
  }
  post(path, body) {
    return this.call('POST', path, body ?? {});
  }
  put(path, body) {
    return this.call('PUT', path, body ?? {});
  }
  delete(path) {
    return this.call('DELETE', path);
  }

  /** Reads every page of a paged list (`{ items, total, page, pageSize }`). */
  async getAll(path, pageSize = 100) {
    const items = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; ; page++) {
      const result = await this.get(`${path}${sep}page=${page}&pageSize=${pageSize}`);
      items.push(...result.items);
      if (items.length >= result.total || result.items.length === 0) return items;
    }
  }
}

/**
 * Runs `job(attempt)` and repeats it (up to `tries` times) when it fails with an ambiguous answer. The job must re-read whatever it needs, so
 * a repeat after a write that did commit sees the new state instead of writing twice.
 */
export async function withRecheck(job, tries = 4) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await job(attempt);
    } catch (error) {
      if (!isAmbiguous(error) || attempt >= tries - 1) throw error;
      await sleep(400 * (attempt + 1) + Math.floor(Math.random() * 400));
    }
  }
}
