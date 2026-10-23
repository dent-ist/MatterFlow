import { effect, inject, signal, untracked } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { retryWhenBackOnline } from '../../core/http/connectivity';
import { QuietRequests } from '../../core/http/interceptors';

export type PanelState = 'loading' | 'ready' | 'error';

/**
 * One panel's own request (README 6.9): it loads when `trigger` changes, shows a skeleton the first time and the previous numbers
 * (dimmed, `busy`) afterwards, and reports its failure inline with Retry; one slow or failing panel never holds the others. Failures
 * are quiet (no toast: the panel says it). The connection coming back retries a failed panel once. Call in an injection context.
 */
export function panelLoader<T>(trigger: () => unknown, fetch: () => Observable<T>) {
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

  effect(() => {
    trigger();
    untracked(() => void load());
  });
  retryWhenBackOnline(
    () => state() === 'error',
    () => void load(),
  );
  return { state, data, busy, load };
}
