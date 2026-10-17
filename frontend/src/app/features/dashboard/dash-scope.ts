import { Injectable, computed, inject, signal } from '@angular/core';
import { DashboardClient, DashboardScopePod } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { QuietRequests } from '../../core/http/interceptors';

/**
 * The page-wide Scope of the Dashboard (UX review 2, P1, #89): which Tasks every number on the page is about. One value for every tab,
 * `all` (every Task, including those with no Pod), `mine` (the union of the viewer's own Pods; the server resolves it from membership) or one
 * Pod id. It means the Task's Pod field, exactly the Task Queue `pod` filter, so a count equals its drill-through.
 *
 * Address: `?pod=all|mine|<id>`. The default is not written. The default is `mine` for anyone who is a member of at least one active Pod, else
 * `all` (membership only, never role names; the server says which in `GET /dashboard/scopes`). The last explicit choice made with the control
 * is remembered per user in this browser; the address wins over the memory and never overwrites it. An address that names a Pod the person
 * may not see falls back to the default and leaves a note.
 */
export const SCOPE_PARAM = 'pod';
/** The Pod filter the Users tab used to own (`upod`); read once into `pod` and rewritten. */
export const LEGACY_USERS_POD_PARAM = 'upod';

export const SCOPE_ALL = 'all';
export const SCOPE_MINE = 'mine';

const STORAGE_PREFIX = 'mf.dashboard.scope.v1.';

/** The scope an address value names (`all`, `mine` or a positive Pod id), or null when it is none of them. */
export function parseScope(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === SCOPE_ALL || v === SCOPE_MINE) return v;
  return /^[1-9]\d{0,8}$/.test(v) ? v : null;
}

/**
 * The scope an old link meant: `pod` (the Swimlane Pod filter, which was a Pod id too), else `upod` (the Users Pod filter). Read once; the
 * page rewrites the address with a single `pod`.
 */
export function scopeFromAddress(get: (key: string) => string | null): string | null {
  const named = get(SCOPE_PARAM);
  if (named !== null && named !== '') return named;
  const legacy = get(LEGACY_USERS_POD_PARAM);
  return legacy !== null && legacy !== '' ? legacy : null;
}

export interface ScopeOption {
  value: string;
  label: string;
  /** Own Pods come first; the others sit under "Other pods". */
  group: 'general' | 'mine' | 'other';
}

@Injectable({ providedIn: 'root' })
export class DashScope {
  private readonly api = inject(DashboardClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);

  private loadedFor: number | null = null;
  /** The choices of the Scope select: null until the server answered. */
  private readonly hasPods = signal(false);
  private readonly defaultFromServer = signal<string>(SCOPE_ALL);
  private readonly pods = signal<readonly DashboardScopePod[]>([]);
  private readonly state = signal<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  /** What the address named (a syntactically valid value), or null. */
  private readonly named = signal<string | null>(null);
  /** The last explicit choice made with the control, per user. */
  private readonly remembered = signal<string | null>(null);

  /** True once the choices are known (or could not be read): nothing on the page is read before, so the first read already has the right scope. */
  readonly ready = computed(() => this.state() === 'ready' || this.state() === 'failed');
  /** The person is a member of at least one active Pod ("My pods" is offered). */
  readonly inPod = computed(() => this.hasPods());
  readonly defaultScope = computed(() => (this.hasPods() ? this.defaultFromServer() : SCOPE_ALL));
  readonly options = computed<ScopeOption[]>(() => {
    const out: ScopeOption[] = [{ value: SCOPE_ALL, label: 'All pods', group: 'general' }];
    if (this.hasPods()) out.push({ value: SCOPE_MINE, label: 'My pods', group: 'general' });
    for (const p of this.pods()) {
      out.push({ value: String(p.podId), label: p.name, group: p.isMine ? 'mine' : 'other' });
    }
    return out;
  });

  /** Whether the person may use this value (when the choices could not be read, any well-formed value is tried and the server decides). */
  isValid(value: string): boolean {
    if (this.state() === 'failed') return parseScope(value) !== null;
    return this.options().some((o) => o.value === value);
  }

  /** The address names a scope the person cannot use (a Pod they may not see, or `mine` without a Pod). */
  readonly rejected = computed(() => {
    const n = this.named();
    return this.ready() && n !== null && !this.isValid(n) ? n : null;
  });

  /** The scope in effect: the address, else the remembered choice, else the default; an unusable address or memory falls back to the default. */
  readonly scope = computed<string>(() => {
    const n = this.named();
    if (n !== null && this.isValid(n)) return n;
    if (n === null) {
      const r = this.remembered();
      if (r !== null && this.isValid(r)) return r;
    }
    return this.defaultScope();
  });

  /** `all` is in effect (no Pod filter). */
  readonly isAll = computed(() => this.scope() === SCOPE_ALL);

  /** The text of the control for the scope in effect ("All pods", "My pods", the Pod's name). */
  readonly label = computed(() => this.labelOf(this.scope()));

  labelOf(value: string): string {
    return this.options().find((o) => o.value === value)?.label ?? `Pod ${value}`;
  }

  /** The Pod ids the Task Queue is filtered by for a number of this scope: none for `all`, the person's Pods for `mine` (`0`, which matches nothing, when they have none), else the Pod. */
  readonly podIds = computed<number[]>(() => {
    const s = this.scope();
    if (s === SCOPE_ALL) return [];
    if (s === SCOPE_MINE) {
      const mine = this.pods()
        .filter((p) => p.isMine)
        .map((p) => p.podId);
      return mine.length > 0 ? mine : [0];
    }
    return [Number(s)];
  });

  /** The Task Queue's `pod` query parameter for a number of this scope (undefined for `all`). */
  queueParam(): string[] | undefined {
    const ids = this.podIds();
    return ids.length > 0 ? ids.map(String) : undefined;
  }

  /** Reads the choices of the signed-in user (once per user). Never rejects: without them the page works with All pods. */
  ensureLoaded(): void {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor === userId) return;
    this.loadedFor = userId;
    this.remembered.set(this.read(userId));
    this.state.set('loading');
    const start = () =>
      this.api.getDashboardScopes().subscribe({
        next: (choices) => {
          if (this.loadedFor !== userId) return;
          this.hasPods.set(choices.hasPods);
          this.defaultFromServer.set(choices.defaultScope);
          this.pods.set(choices.pods);
          this.state.set('ready');
        },
        error: () => {
          if (this.loadedFor !== userId) return;
          this.state.set('failed');
        },
      });
    this.quiet.runInline(start);
  }

  /** Called whenever the query parameters change. */
  applyAddress(get: (key: string) => string | null): void {
    const raw = scopeFromAddress(get);
    const next = raw === null ? null : parseScope(raw);
    // A value that is not even well-formed counts as one the person cannot use: it falls back to the default and leaves the note.
    this.named.set(raw !== null && next === null ? 'invalid' : next);
  }

  /** The person chose a scope with the control: it is remembered (the address shows it unless it is the default). */
  choose(value: string): void {
    this.remembered.set(value);
    this.save(value);
  }

  /** The value of `?pod=` that says `value`, or null when it is the default (the default is not written). */
  addressValue(value: string): string | null {
    return value === this.defaultScope() ? null : value;
  }

  private storageKey(userId: number): string {
    return STORAGE_PREFIX + userId;
  }

  private read(userId: number): string | null {
    try {
      return parseScope(localStorage.getItem(this.storageKey(userId)));
    } catch {
      return null;
    }
  }

  private save(value: string): void {
    try {
      localStorage.setItem(this.storageKey(this.loadedFor ?? 0), value);
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
