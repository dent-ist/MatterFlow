import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  OnHoldReasonsClient,
  TaskTypesClient,
  UsersClient,
  WorkflowsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { FilterOption } from '../filters/filter-def';

/** People are read in pages of 100, at most this many pages (500 people); the filter still works for anyone in the address. */
const PEOPLE_PAGES = 5;

/**
 * The choices behind the work lists' Assignee, Creator, Task type and Workflow column filters. They are read once per session, after the
 * list itself has loaded (never in front of it), and only with the permission the endpoint needs, so nobody gets a 403 in the console:
 * task types need Task.View (a work list needs it anyway), the people need User.View and the workflows Workflow.Manage. Without a
 * permission the list offers the people, types and workflows that are on screen, and a value in the address still filters.
 */
@Injectable({ providedIn: 'root' })
export class QueueChoices {
  private readonly auth = inject(AuthStore);
  private readonly typesApi = inject(TaskTypesClient);
  private readonly usersApi = inject(UsersClient);
  private readonly workflowsApi = inject(WorkflowsClient);
  private readonly reasonsApi = inject(OnHoldReasonsClient);

  readonly types = signal<readonly FilterOption[]>([]);
  readonly workflows = signal<readonly FilterOption[]>([]);
  readonly people = signal<readonly FilterOption[]>([]);
  /** The on-hold reasons of the column filter (PM v2, #877); the first choice is "No reason given" (`0`). */
  readonly onHoldReasons = signal<readonly FilterOption[]>([]);

  private started = false;

  /** Starts reading the choices (once); safe to call from every work list. */
  ensure(): void {
    if (this.started) return;
    this.started = true;
    void this.loadTypes();
    void this.loadPeople();
    void this.loadWorkflows();
    void this.loadOnHoldReasons();
  }

  private async loadOnHoldReasons(): Promise<void> {
    if (!this.auth.has('Task.View')) return;
    try {
      const reasons = await firstValueFrom(this.reasonsApi.listOnHoldReasons());
      this.onHoldReasons.set(
        reasons.map((r) => ({
          value: String(r.id),
          label: r.name,
          ...(r.isActive ? {} : { hint: '(inactive)' }),
        })),
      );
    } catch {
      // The list works without the choices.
    }
  }

  private async loadTypes(): Promise<void> {
    if (!this.auth.has('Task.View')) return;
    try {
      const types = await firstValueFrom(this.typesApi.listTaskTypes());
      this.types.set(
        types
          .map((t) => ({
            value: String(t.id),
            label: t.name,
            ...(t.isActive ? {} : { hint: '(inactive)' }),
          }))
          .sort(byLabel),
      );
    } catch {
      // The list works without the choices.
    }
  }

  private async loadWorkflows(): Promise<void> {
    if (!this.auth.has('Workflow.Manage')) return;
    try {
      const out: FilterOption[] = [];
      for (let page = 1; page <= 3; page++) {
        const result = await firstValueFrom(
          this.workflowsApi.listWorkflows(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            page,
            100,
          ),
        );
        for (const w of result.items) {
          out.push({
            value: String(w.workflowDefinitionId),
            label: w.name,
            ...(w.isActive ? {} : { hint: '(inactive)' }),
          });
        }
        if (out.length >= result.total) break;
      }
      this.workflows.set(out.sort(byLabel));
    } catch {
      // The list works without the choices.
    }
  }

  private async loadPeople(): Promise<void> {
    if (!this.auth.has('User.View')) return;
    try {
      const out: FilterOption[] = [];
      for (let page = 1; page <= PEOPLE_PAGES; page++) {
        const result = await firstValueFrom(
          this.usersApi.listUsers(
            'all',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            page,
            100,
          ),
        );
        for (const u of result.items) {
          if (u.isPending) continue;
          out.push({
            value: String(u.userId),
            label: u.displayName,
            ...(u.isActive ? {} : { hint: '(inactive)' }),
          });
        }
        if (page * 100 >= result.total) break;
      }
      this.people.set(out.sort(byLabel));
    } catch {
      // The list works without the choices.
    }
  }
}

function byLabel(a: FilterOption, b: FilterOption): number {
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

/** Adds the options of `extra` that `base` does not have (people seen on screen), keeping `base` order. */
export function mergeOptions(
  base: readonly FilterOption[],
  extra: readonly FilterOption[],
): readonly FilterOption[] {
  if (extra.length === 0) return base;
  const known = new Set(base.map((o) => o.value));
  const added = extra.filter((o) => !known.has(o.value));
  return added.length === 0 ? base : [...base, ...added].sort(byLabel);
}
