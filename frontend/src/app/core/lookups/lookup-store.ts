import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  PrioritiesClient,
  PriorityView,
  StatusLabelView,
  StatusLabelsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../auth/auth.store';
import { SessionReset } from '../session/session-reset';

export type StatusCode = 'NEW' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';

/** Shown until (or if) the server labels load; these are the seeded defaults. */
export const DEFAULT_STATUS_LABELS: Readonly<Record<StatusCode, string>> = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export type LookupLoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Shared Priority and Status label lookups (tickets #33). Badges and Task screens read these signals; the admin screens push
 * their results back with `setPriorities` / `setStatusLabels` so every badge on screen follows an edit immediately. Inactive
 * priorities stay in `priorities` (historical tasks still show them); pickers use `activePriorities`.
 */
@Injectable({ providedIn: 'root' })
export class LookupStore {
  private readonly prioritiesApi = inject(PrioritiesClient);
  private readonly statusApi = inject(StatusLabelsClient);
  private readonly injector = inject(Injector);

  private readonly _priorities = signal<PriorityView[]>([]);
  private readonly _statusLabels = signal<StatusLabelView[]>([]);
  private readonly _state = signal<LookupLoadState>('idle');
  private inflight: Promise<void> | null = null;

  constructor() {
    // The lists are the same for everybody, but what a person may read is not: another person starts from an empty store.
    inject(SessionReset).register(() => {
      this._priorities.set([]);
      this._statusLabels.set([]);
      this._state.set('idle');
      this.inflight = null;
    });
  }

  readonly state = this._state.asReadonly();
  /** All priorities, most urgent first, including inactive. */
  readonly priorities = this._priorities.asReadonly();
  readonly statusLabels = this._statusLabels.asReadonly();
  readonly activePriorities = computed(() => this._priorities().filter((p) => p.isActive));
  readonly defaultPriority = computed(() => this._priorities().find((p) => p.isDefault) ?? null);

  priority(id: number | null | undefined): PriorityView | null {
    return id == null ? null : (this._priorities().find((p) => p.id === id) ?? null);
  }

  /** 1-based position among all priorities (1 = most urgent); null when unknown. */
  priorityRank(id: number | null | undefined): number | null {
    const index = id == null ? -1 : this._priorities().findIndex((p) => p.id === id);
    return index < 0 ? null : index + 1;
  }

  /** The display label for a status code; the seeded default until labels load. */
  statusLabel(code: string | null | undefined): string {
    if (!code) return '';
    const found = this._statusLabels().find((s) => s.code === code);
    return found?.displayLabel ?? DEFAULT_STATUS_LABELS[code as StatusCode] ?? code;
  }

  /**
   * Loads both lookups once; concurrent callers share the request. Never rejects (state becomes `error`), and a failed load is not
   * retried by later callers (use `reload`), so a user without Task.View does not trigger a request per badge.
   */
  ensureLoaded(): Promise<void> {
    if (this._state() !== 'idle') return this.inflight ?? Promise.resolve();
    return (this.inflight = this.load());
  }

  /** Forces a reload from the server. */
  reload(): Promise<void> {
    this.inflight = null;
    return (this.inflight = this.load());
  }

  setPriorities(list: PriorityView[]): void {
    this._priorities.set([...list].sort((a, b) => a.sortOrder - b.sortOrder));
  }

  setStatusLabels(list: StatusLabelView[]): void {
    this._statusLabels.set([...list].sort((a, b) => a.sortOrder - b.sortOrder));
  }

  /**
   * Which lists this person may read (AD-D #519): priorities with `Task.View` or `Priority.Manage`, status labels with `Task.View` or
   * `StatusLabel.Manage`, so the Labels page of a person who manages only one of them asks for that one only (no refused request, no
   * toast). Until the profile is loaded (specs, early calls) both lists are asked for, as before.
   */
  private permitted(): { priorities: boolean; statusLabels: boolean } {
    let auth: AuthStore | null = null;
    try {
      auth = this.injector.get(AuthStore);
    } catch {
      auth = null;
    }
    if (!auth || auth.state() !== 'ready') return { priorities: true, statusLabels: true };
    const view = auth.has('Task.View');
    return {
      priorities: view || auth.has('Priority.Manage'),
      statusLabels: view || auth.has('StatusLabel.Manage'),
    };
  }

  private async load(): Promise<void> {
    this._state.set('loading');
    const may = this.permitted();
    try {
      if (!may.priorities && !may.statusLabels)
        throw new Error('No permission to read the lookups.');
      const [priorities, labels] = await Promise.all([
        may.priorities ? firstValueFrom(this.prioritiesApi.listPriorities()) : null,
        may.statusLabels ? firstValueFrom(this.statusApi.listStatusLabels()) : null,
      ]);
      if (priorities) this.setPriorities(priorities);
      if (labels) this.setStatusLabels(labels);
      this._state.set('ready');
    } catch {
      this._state.set('error');
    } finally {
      this.inflight = null;
    }
  }
}
