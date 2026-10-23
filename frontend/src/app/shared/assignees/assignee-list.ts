import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UsersLookupClient } from '../../api/generated/api-client';
import { outOfOfficeText } from '../../core/availability/availability';
import { USER_TIME_ZONE } from '../../core/time/clock';

/** The short Suggested list holds at most this many people (owner decision: 5 to 8). */
export const SUGGESTION_COUNT = 6;
/** A search over all eligible users shows this many (the list scrolls). */
export const SEARCH_COUNT = 25;
/** A Pod's members, all of them (a Pod is small; the server caps a lookup at 50). */
export const POD_COUNT = 50;

/** One person a Task can be assigned to, as every assignee picker shows them. The order of a list is the server's (the one ranking): nothing here sorts. */
export interface AssigneeCandidate {
  id: number;
  name: string;
  /** Open tasks (New, In Progress, On Hold). */
  openTaskCount: number;
  /** "3 open": the muted text after the name. */
  hint: string;
  /** Why the person ranks here, for a tooltip. Empty in a plain name search. */
  reason: string;
  /** "Out of office until Oct 20" while the person is out of office (still selectable), otherwise undefined. */
  flag?: string;
}

/** What the picker is showing: the Pod's members, the Suggested list, or search results over everyone. */
export type AssigneeMode = 'pod' | 'suggested' | 'search';

/** The Task being assigned, as far as the suggestions care: its Pod and its Task Type (both optional). */
export interface AssigneeContext {
  podId?: number | null;
  taskTypeId?: number | null;
}

export const openHint = (count: number): string => `${count} open`;

/**
 * The state of one assignee picker: what it lists when it opens and what typing does. The same class drives the inline grid picker, the Edit task
 * dialog and Create task, so the rules (Pod members first with a "Search all users" way out, Suggested for a Task without a Pod, a search over all
 * eligible users) exist once. It does not rank: the order and the Suggested set come from `GET /users/lookup` (the server's single ranking).
 */
export class AssigneeList {
  readonly items = signal<AssigneeCandidate[]>([]);
  readonly loading = signal(false);
  readonly mode = signal<AssigneeMode>('suggested');
  /** The Pod's members are the scope until the person chooses "Search all users". */
  private readonly scope = signal<'pod' | 'all'>('all');
  private seq = 0;
  private started = false;

  /** True while the list is the Pod's members: offer "Search all users". */
  readonly canSearchAll = computed(() => this.mode() === 'pod');
  /** Heading above the people: "Suggested" for the short list; none otherwise. */
  readonly heading = computed(() => (this.mode() === 'suggested' ? 'Suggested' : null));

  constructor(
    private readonly api: UsersLookupClient,
    private readonly zone: string,
    private readonly context: () => AssigneeContext,
  ) {}

  /** Opens fresh: the Pod's members when the Task has a Pod that has any, otherwise the Suggested list. */
  async open(): Promise<void> {
    this.start();
    this.items.set([]);
    await this.load('');
  }

  /** The person typed: search the Pod's members while in Pod scope, otherwise everyone. Empty text goes back to the opening list. */
  async search(text: string): Promise<void> {
    if (!this.started) this.start();
    await this.load(text.trim());
  }

  /** The scope a fresh list starts in: the Task's Pod when it has one. */
  private start(): void {
    this.started = true;
    this.scope.set(this.context().podId == null ? 'all' : 'pod');
  }

  /** "Search all users": leaves the Pod scope (the server still only warns USER_NOT_IN_POD on save). */
  async searchAll(): Promise<void> {
    this.scope.set('all');
    await this.load('');
  }

  private async load(text: string): Promise<void> {
    const seq = ++this.seq;
    const { podId, taskTypeId } = this.context();
    const inPod = this.scope() === 'pod' && podId != null;
    this.loading.set(true);
    try {
      let found: AssigneeCandidate[];
      let mode: AssigneeMode;
      if (inPod) {
        found = await this.fetch(text, POD_COUNT, podId, taskTypeId, false);
        mode = 'pod';
        if (found.length === 0 && text === '') {
          // A Pod without members to offer: the Suggested list is more useful than an empty menu.
          this.scope.set('all');
          found = await this.fetch('', SUGGESTION_COUNT, null, taskTypeId, true);
          mode = 'suggested';
        }
      } else if (text === '') {
        found = await this.fetch('', SUGGESTION_COUNT, null, taskTypeId, true);
        mode = 'suggested';
      } else {
        found = await this.fetch(text, SEARCH_COUNT, null, taskTypeId, false);
        mode = 'search';
      }
      if (seq !== this.seq) return;
      this.mode.set(mode);
      this.items.set(found);
    } catch {
      if (seq === this.seq) this.items.set([]);
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  private async fetch(
    text: string,
    limit: number,
    podId: number | null | undefined,
    taskTypeId: number | null | undefined,
    suggest: boolean,
  ): Promise<AssigneeCandidate[]> {
    const found = await firstValueFrom(
      this.api.lookupUsers(
        text || undefined,
        limit,
        podId ?? undefined,
        taskTypeId ?? undefined,
        suggest || undefined,
      ),
    );
    return found.map((u) => ({
      id: u.userId,
      name: u.displayName,
      openTaskCount: u.openTaskCount,
      hint: openHint(u.openTaskCount),
      reason: u.reason,
      flag: outOfOfficeText(u.availability, this.zone) ?? undefined,
    }));
  }
}

/** Creates the state of an assignee picker (the one shared implementation behind the three pickers). */
@Injectable({ providedIn: 'root' })
export class AssigneeLists {
  private readonly api = inject(UsersLookupClient);
  private readonly zone = inject(USER_TIME_ZONE);

  /** `context` is read at each load, so a picker whose Pod changes keeps working. */
  create(context: () => AssigneeContext): AssigneeList {
    return new AssigneeList(this.api, this.zone, context);
  }
}
