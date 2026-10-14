import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../http/api-error';
import { Clock } from '../time/clock';
import { MeApi } from './me-api';
import { MeProfile } from './me.models';
import { Permission } from './permissions';

export type AuthLoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Minimum gap between focus-triggered permission refreshes (architecture section 12). */
export const FOCUS_REFRESH_THROTTLE_MS = 60_000;

/**
 * Signal store for the signed-in user, built on GET /me. Used for usability gating only; the
 * backend authorizes every call.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(MeApi);
  private readonly clock = inject(Clock);

  private readonly _profile = signal<MeProfile | null>(null);
  private readonly _state = signal<AuthLoadState>('idle');
  private inflight: Promise<void> | null = null;
  private lastLoadedAt = 0;
  private focusListening = false;

  readonly profile = this._profile.asReadonly();
  readonly state = this._state.asReadonly();
  readonly displayName = computed(() => this._profile()?.displayName ?? '');
  readonly isAuthenticated = computed(() => this._profile() !== null);
  readonly isSystemAdmin = computed(() => this._profile()?.isSystemAdmin ?? false);
  readonly isDisabled = computed(() => this._profile()?.status === 'DISABLED');
  /** Zero effective permissions (server status ACCESS_PENDING, or an active user with none). */
  readonly isPending = computed(() => {
    const p = this._profile();
    if (!p || p.status === 'DISABLED') return false;
    return p.status === 'ACCESS_PENDING' || (!p.isSystemAdmin && p.permissions.length === 0);
  });
  /** Pending or disabled: the only reachable screen is Access Pending. */
  readonly isRestricted = computed(() => this.isPending() || this.isDisabled());
  readonly permissions = computed<ReadonlySet<Permission>>(() => {
    const p = this._profile();
    return new Set(p && !this.isRestricted() ? p.permissions : []);
  });

  /** Reactive check; reads signals so templates and `computed`s update on refresh. */
  has(code: Permission | string): boolean {
    if (this.isRestricted()) return false;
    return this.isSystemAdmin() || this.permissions().has(code as Permission);
  }

  /** True when the user holds at least one of the codes (empty list = no requirement). */
  hasAny(codes: readonly (Permission | string)[]): boolean {
    return codes.length === 0 || codes.some((c) => this.has(c));
  }

  /** Loads /me once; concurrent callers share the request. Never rejects. */
  ensureLoaded(): Promise<void> {
    if (this._state() === 'ready') return Promise.resolve();
    return this.load();
  }

  /** Forces a reload of the profile and permissions. Never rejects. */
  refresh(): Promise<void> {
    return this.load();
  }

  /** Reload when the window regains focus, at most once per 60 s. Returns a disposer. */
  startFocusRefresh(target: Window = window): () => void {
    if (this.focusListening) return () => undefined;
    this.focusListening = true;
    const onFocus = () => {
      if (this.clock.now().getTime() - this.lastLoadedAt >= FOCUS_REFRESH_THROTTLE_MS) {
        void this.refresh();
      }
    };
    target.addEventListener('focus', onFocus);
    return () => {
      target.removeEventListener('focus', onFocus);
      this.focusListening = false;
    };
  }

  private load(): Promise<void> {
    if (this.inflight) return this.inflight;
    this._state.set('loading');
    this.inflight = firstValueFrom(this.api.getMe())
      .then((profile) => {
        this._profile.set(profile);
        this._state.set('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'ACCOUNT_DISABLED') {
          this._profile.set(this.restrictedProfile('DISABLED'));
          this._state.set('ready');
        } else if (err instanceof ApiError && err.code === 'ACCESS_PENDING') {
          this._profile.set(this.restrictedProfile('ACCESS_PENDING'));
          this._state.set('ready');
        } else {
          this._state.set(this._profile() ? 'ready' : 'error');
        }
      })
      .finally(() => {
        this.lastLoadedAt = this.clock.now().getTime();
        this.inflight = null;
      });
    return this.inflight;
  }

  private restrictedProfile(status: 'DISABLED' | 'ACCESS_PENDING'): MeProfile {
    const prev = this._profile();
    return {
      userId: prev?.userId ?? 0,
      displayName: prev?.displayName ?? '',
      windowsAccount: prev?.windowsAccount,
      email: prev?.email,
      registeredAtUtc: prev?.registeredAtUtc,
      status,
      roles: [],
      permissions: [],
      isSystemAdmin: false,
    };
  }
}
