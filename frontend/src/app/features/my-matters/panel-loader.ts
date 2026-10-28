import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { retryWhenBackOnline } from '../../core/http/connectivity';
import { QuietRequests } from '../../core/http/interceptors';

export type PanelState = 'loading' | 'ready' | 'error';

/** One request of the page, as the {@link LoadGroup} sees it. */
interface LoadMember {
  state: Signal<PanelState>;
  load: () => Promise<void>;
}

/**
 * The requests of one My Matters page, seen together (epic #893, issue #921). One network drop makes every section fail at once, and six identical messages with
 * six Retry buttons say nothing more than one: when TWO OR MORE requests have failed, the page draws ONE banner ("Couldn't load My Matters") with one Retry that
 * asks every failed request again, and each failed section keeps only a muted "Not loaded" line. A single failure keeps its own message and its own Retry.
 * Provided by the page; every {@link panelLoader} in its tree registers itself (a loader outside such a page works alone, as before).
 */
@Injectable()
export class LoadGroup {
  private readonly members = signal<LoadMember[]>([]);

  /** The requests that have failed and not been answered since. */
  readonly failed = computed(() => this.members().filter((m) => m.state() === 'error'));
  /** A request of the page is still on its way for the first time (the page holds its body back briefly for these, issue #921). */
  readonly pending = computed(() => this.members().some((m) => m.state() === 'loading'));
  /** Two or more failed: the page's banner speaks for all of them. */
  readonly many = computed(() => this.failed().length >= 2);

  register(member: LoadMember): () => void {
    this.members.update((all) => [...all, member]);
    return () => this.members.update((all) => all.filter((m) => m !== member));
  }

  /** Retry: every failed request is asked again. */
  retryAll(): void {
    for (const m of this.failed()) void m.load();
  }
}

/**
 * One panel's own request (README 6.9): it loads when `trigger` changes, shows a skeleton the first time and the previous numbers
 * (dimmed, `busy`) afterwards, and reports its failure inline with Retry; one slow or failing panel never holds the others. Failures
 * are quiet (no toast: the panel says it). The connection coming back retries a failed panel once. `options.enabled` holds the first load
 * back until it returns true. Call in an injection context.
 */
export function panelLoader<T>(
  trigger: () => unknown,
  fetch: () => Observable<T>,
  options: { enabled?: () => boolean } = {},
) {
  const quiet = inject(QuietRequests);
  const state = signal<PanelState>('loading');
  const data = signal<T | null>(null);
  const busy = signal(false);
  let turn = 0;

  const load = async (): Promise<void> => {
    const mine = ++turn;
    busy.set(true);
    if (data() === null || state() === 'error') state.set('loading');
    try {
      const result = await quiet.run(() => firstValueFrom(fetch()));
      if (mine !== turn) return;
      data.set(result);
      state.set('ready');
    } catch {
      if (mine !== turn) return;
      state.set('error');
    } finally {
      if (mine === turn) busy.set(false);
    }
  };

  const group = inject(LoadGroup, { optional: true });
  if (group) inject(DestroyRef).onDestroy(group.register({ state, load }));

  effect(() => {
    trigger();
    // A panel that must wait for another (Recent activity waits for "Since your last visit" on a first visit) is held, then loads once released.
    if (options.enabled && !options.enabled()) return;
    untracked(() => void load());
  });
  retryWhenBackOnline(
    () => state() === 'error',
    () => void load(),
  );
  return { state, data, busy, load };
}
