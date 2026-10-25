import { computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Scope, ScopeService, isScope } from './scope.service';

/** Whether the address says `<key>=true` for one of the page's own "on matters I manage" filters. */
export function namesOwnMatters(
  params: { get(name: string): string | null },
  own: readonly string[],
): boolean {
  return own.some((key) => params.get(key)?.toLowerCase() === 'true');
}

/** The query parameters of the page's own scope filters that the address carries, cleared: the scope says it now. */
function dropped(
  own: readonly string[],
  params: { has(name: string): boolean },
): Record<string, null> {
  return Object.fromEntries(own.filter((key) => params.has(key)).map((key) => [key, null]));
}

/**
 * The scope of one list page, bound to its address (`?scope=mine|all`). Create it in the page's injection context.
 *
 * The address wins: a link that carries filters of the list (a strip cell, a notification, a client's matters) and no `scope` means what
 * it says, so the remembered scope is never added to it (`value()` is `all`). A plain link opens on the remembered scope, and the page then
 * writes it into the address (a replacing navigation), so Back restores it and a filter typed afterwards does not turn the list into
 * "all" by turning the link into a deep one.
 *
 * A link may also say "on the matters I manage" with the list's own filter (`own`: the Task Queue's `managedByMe=true`, the Matters list's
 * `mine=true`; the My Matters strip builds such links). That is the `mine` scope, so the switch, the counts and the list agree: the page
 * replaces the address with `scope=mine` and drops that filter (the scope adds it again when it asks the API), and All then really is all.
 *
 * `plain` says whether the address, as it is now, is a plain link (no filter of the list). `hold` suspends writing the scope into the
 * address (the Task Queue is about to replace the address with the view it remembers and includes the scope itself).
 */
export class PageScope {
  private readonly service = inject(ScopeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  /** The switch applies to this person. */
  readonly active = this.service.eligible;
  /** "All" is offered. */
  readonly canAll = this.service.canAll;

  /** The scope in the address, or null (absent or not a scope). */
  readonly raw = computed<Scope | null>(() => {
    const raw = this.params().get('scope');
    return isScope(raw) ? raw : null;
  });

  /** The address carries no scope but names the matters the person manages with the page's own filter (`managedByMe=true`). */
  readonly named = computed(() => namesOwnMatters(this.params(), this.own));

  /** The scope in force: `mine` or `all`; null when the switch does not apply (the list is then what it always was). */
  readonly value = computed<Scope | null>(() => {
    if (!this.service.eligible()) return null;
    const raw = this.raw();
    if (raw) return this.service.clamp(raw);
    if (this.named()) return 'mine';
    return this.plain() ? this.service.defaultFor(this.pageKey) : 'all';
  });

  /** The list is limited to the matters the person manages. */
  readonly mine = computed(() => this.value() === 'mine');

  constructor(
    readonly pageKey: string,
    private readonly plain: () => boolean,
    hold: () => boolean = () => false,
    private readonly own: readonly string[] = [],
  ) {
    // The address names the scope in force on a plain link (and replaces a scope the person may not use). A link that carries filters
    // stays as it is.
    effect(() => {
      const value = this.value();
      const raw = this.params().get('scope');
      const named = raw === null && this.named();
      if (value === null || raw === value || hold() || (raw === null && !this.plain() && !named))
        return;
      untracked(() => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { scope: value, ...dropped(this.own, this.params()) },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });
  }

  /** The person chose a scope: remembered, written to the address (a new history entry, the page goes back to its first page). */
  set(scope: Scope): void {
    const next = this.service.clamp(scope);
    if (next === null) return;
    this.service.remember(this.pageKey, next);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { scope: next, page: null, ...dropped(this.own, this.params()) },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * The `scope` parameter an address built by the page carries: the scope in force on a plain link or a link that names one, nothing on a
   * link that carries filters (the address stays as it is) and when the switch does not apply.
   */
  param(): string | null {
    return this.raw() !== null || this.plain() ? this.value() : null;
  }
}
