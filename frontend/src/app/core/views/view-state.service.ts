import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
// Types only: the generated client is one big module that must not be pulled into eager shell code. The client class is imported the first time
// it is needed (see `client()`), and this service is only ever injected by lazy features.
import type { UserViewDto, UserViewsClient } from '../../api/generated/api-client';
import { AuthStore } from '../auth/auth.store';
import { ViewState, ViewSurface, fitsViewState, isViewState } from './view-state';

const WRITE_DELAY_MS = 600;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Remembered screen state and named views of the signed-in person (PM v2, #856). The server (`dbo.UserView`) is the truth so the state follows the
 * person between workstations; `localStorage` (per person, try/catch around every access) is a write-through cache for the first paint. The page
 * works with storage blocked and with the endpoint failing: reads give null (defaults), writes are dropped silently. The address always wins over a
 * remembered state (`mergeViewState`). Lazy features only: never inject this from eager shell code.
 */
@Injectable({ providedIn: 'root' })
export class ViewStateService {
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthStore);
  private api: UserViewsClient | undefined;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, ViewState>();

  private async client(): Promise<UserViewsClient> {
    if (!this.api) {
      const { UserViewsClient: client } = await import('../../api/generated/api-client');
      this.api = this.injector.get(client);
    }
    return this.api;
  }

  private key(surface: ViewSurface): string {
    return `mf.view.${surface}.${this.auth.profile()?.userId ?? 0}`;
  }

  /** The cached state for the first paint, or null (nothing cached, storage blocked, unreadable). */
  cached(surface: ViewSurface): ViewState | null {
    try {
      const raw = storage()?.getItem(this.key(surface));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isViewState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private cache(surface: ViewSurface, state: ViewState): void {
    try {
      storage()?.setItem(this.key(surface), JSON.stringify(state));
    } catch {
      // Not caching is fine.
    }
  }

  /** The server's remembered state of the surface (refreshing the cache), else the cache, else null. Never rejects. */
  async load(surface: ViewSurface): Promise<ViewState | null> {
    try {
      const list = await firstValueFrom((await this.client()).listMyViews(surface));
      const row = list.items.find((v) => v.name == null);
      if (row && isViewState(row.state)) {
        this.cache(surface, row.state);
        return row.state;
      }
      return row ? null : this.cached(surface);
    } catch {
      return this.cached(surface);
    }
  }

  /** Remembers the state: cached at once, sent to the server after a short pause (the last call wins). Never throws. */
  save(surface: ViewSurface, state: ViewState): void {
    if (!fitsViewState(state)) return;
    this.cache(surface, state);
    this.pending.set(surface, state);
    const timer = this.timers.get(surface);
    if (timer) clearTimeout(timer);
    this.timers.set(
      surface,
      setTimeout(() => void this.flush(surface), WRITE_DELAY_MS),
    );
  }

  /** Sends a pending state now (for example before leaving the page). Never rejects. */
  async flush(surface: ViewSurface): Promise<void> {
    const timer = this.timers.get(surface);
    if (timer) clearTimeout(timer);
    this.timers.delete(surface);
    const state = this.pending.get(surface);
    if (!state) return;
    this.pending.delete(surface);
    try {
      await firstValueFrom((await this.client()).saveMyRememberedView(surface, { state }));
    } catch {
      // The cache still has it; the next change tries again.
    }
  }

  // ---- named views (the screen for them arrives with PV-29); these throw the API error so the caller can say why

  async listNamed(surface: ViewSurface): Promise<UserViewDto[]> {
    const list = await firstValueFrom((await this.client()).listMyViews(surface));
    return list.items.filter((v) => v.name != null);
  }

  async create(
    surface: ViewSurface,
    name: string,
    state: ViewState,
    isDefault = false,
  ): Promise<UserViewDto> {
    return firstValueFrom((await this.client()).createMyView({ surface, name, state, isDefault }));
  }

  async update(
    view: UserViewDto,
    change: { name?: string; state?: ViewState; isDefault?: boolean },
  ): Promise<UserViewDto> {
    return firstValueFrom(
      (await this.client()).updateMyView(view.id, {
        name: change.name,
        state: change.state,
        isDefault: change.isDefault,
        rowVersion: view.rowVersion,
      }),
    );
  }

  async remove(view: UserViewDto): Promise<void> {
    await firstValueFrom((await this.client()).deleteMyView(view.id));
  }
}
