import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Dialog } from 'primeng/dialog';
import { firstValueFrom } from 'rxjs';
import {
  SwimlaneCard,
  TaskCommentResponse,
  TaskCommentsClient,
  TaskQueueRow,
  TaskResponse,
  TasksClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { DueCell } from '../../../shared/work-queue/due-cell';
import { CopyButton } from '../../../shared/ui/copy-button';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { canEditField } from '../../../shared/work-queue/inline-edit';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { htmlToPlainText, htmlToText } from '../../tasks/panels/rich-text';
import { applyRow, cardToRow } from './swimlane-model';

type LoadState = 'loading' | 'ready' | 'error';

/** How many of the newest comments the peek shows. */
export const PEEK_COMMENTS = 3;

/**
 * The side drawer peek of a Swimlane card: the task summary, its workflow steps, the latest comments and quick actions (the same inline
 * Status, Priority and Assignee menus as the card, "Open full task"). It is an accessible modal dialog like the Activity drawer: focus is
 * trapped inside, Esc or the close button closes it and focus returns to the card that opened it. The task is read when the drawer opens.
 */
@Component({
  selector: 'mf-swimlane-drawer',
  imports: [
    Dialog,
    DialogFocus,
    RouterLink,
    RowEdit,
    StatusBadge,
    PriorityBadge,
    MfDatePipe,
    DueCell,
    CopyButton,
    ErrorReference,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="card() ? 'Task ' + card()!.ref : 'Task'"
      position="right"
      styleClass="mf-drawer mf-swl-drawer"
      [modal]="true"
      [closable]="true"
      [dismissableMask]="true"
      closeAriaLabel="Close task details"
      [mfDialogFocus]="visible()"
      [focusOnShow]="false"
      (onShow)="focusClose()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
      [style]="{
        width: '32rem',
        maxWidth: '100vw',
        height: '100vh',
        maxHeight: '100vh',
        margin: '0',
        borderRadius: '0',
      }"
    >
      @if (visible() && card(); as c) {
        <div class="peek" data-peek [attr.data-peek-task]="c.taskId">
          <h2 class="title">{{ task()?.title ?? c.title }}</h2>
          <p class="where">
            {{ c.clientName }} /
            <a class="mf-ref" [routerLink]="['/matters', c.matterId]" data-peek-matter>{{
              c.matterRef
            }}</a>
            {{ c.matterName }}
            <mf-copy-button [text]="c.ref" label="task number" />
          </p>

          <section aria-labelledby="pk-actions" class="sec">
            <h3 id="pk-actions" class="sr-only">Quick actions</h3>
            <dl class="facts">
              <div class="fact">
                <dt>Status</dt>
                <dd data-peek-status>
                  @if (editable('status')) {
                    <mf-row-edit
                      field="status"
                      [row]="row()"
                      (rowChange)="changed($event)"
                      (taskChange)="task.set($event)"
                    />
                  } @else {
                    <mf-status-badge [code]="c.status" [label]="c.statusLabel" />
                  }
                </dd>
              </div>
              <div class="fact">
                <dt>Priority</dt>
                <dd data-peek-priority>
                  @if (editable('priority')) {
                    <mf-row-edit
                      field="priority"
                      [row]="row()"
                      (rowChange)="changed($event)"
                      (taskChange)="task.set($event)"
                    />
                  } @else {
                    <mf-priority-badge
                      [priorityId]="c.priority.priorityId"
                      [label]="c.priority.label"
                      [color]="c.priority.color"
                    />
                  }
                </dd>
              </div>
              <div class="fact">
                <dt>Assignee</dt>
                <dd data-peek-assignee>
                  @if (editable('assignee')) {
                    <mf-row-edit
                      field="assignee"
                      [row]="row()"
                      (rowChange)="changed($event)"
                      (taskChange)="task.set($event)"
                    />
                  } @else {
                    {{ c.assignee?.displayName ?? 'Unassigned' }}
                  }
                  @if (c.assignee?.availability?.state === 'OUT_OF_OFFICE') {
                    <span class="ooo"
                      ><i class="pi pi-calendar-minus" aria-hidden="true"></i>Out of office</span
                    >
                  }
                </dd>
              </div>
              <div class="fact">
                <dt>Due</dt>
                <dd>
                  <mf-due-cell layout="inline" [due]="c" [status]="c.status" />
                </dd>
              </div>
              <div class="fact">
                <dt>Task type</dt>
                <dd>{{ c.taskTypeName }}</dd>
              </div>
              <div class="fact">
                <dt>Created</dt>
                <dd>{{ c.createdAtUtc | mfDate }}</dd>
              </div>
            </dl>
            <p class="actions">
              <a class="mf-btn mf-btn--primary" data-open-task [routerLink]="['/tasks', c.taskId]">
                Open full task
                <i class="pi pi-arrow-right" aria-hidden="true"></i>
              </a>
            </p>
          </section>

          @switch (state()) {
            @case ('loading') {
              <div class="bones" role="status" aria-busy="true">
                <span class="sr-only">Loading the task...</span>
                <span class="bone" aria-hidden="true"></span>
                <span class="bone" aria-hidden="true"></span>
              </div>
            }
            @case ('error') {
              <div class="alert" role="alert" data-peek-error>
                <span>The task details could not be loaded.</span>
                <mf-error-reference />
                <button type="button" class="mf-btn" data-peek-retry (click)="load()">Retry</button>
              </div>
            }
            @default {
              @if (task(); as t) {
                @if (t.description) {
                  <section class="sec" aria-labelledby="pk-sum">
                    <h3 id="pk-sum">Summary</h3>
                    <p class="text">{{ summary() }}</p>
                  </section>
                }
                <section class="sec" aria-labelledby="pk-steps">
                  <h3 id="pk-steps">
                    Workflow steps
                    <span class="muted"
                      >({{ t.workflow.progress.resolved }} of
                      {{ t.workflow.progress.total }} done)</span
                    >
                  </h3>
                  @if (t.workflow.steps.length === 0) {
                    <p class="muted">This task has no steps.</p>
                  } @else {
                    <ol class="steps" data-peek-steps>
                      @for (s of t.workflow.steps; track s.stepInstanceId) {
                        <li class="step" [attr.data-step-status]="s.status">
                          <i class="pi" [class]="stepIcon(s.status)" aria-hidden="true"></i>
                          <span class="step-title">{{ s.title }}</span>
                          <span class="step-state">{{ stepText(s.status, s.isCurrent) }}</span>
                        </li>
                      }
                    </ol>
                  }
                </section>
                <section class="sec" aria-labelledby="pk-comments">
                  <h3 id="pk-comments">Latest comments</h3>
                  @if (comments().length === 0) {
                    <p class="muted" data-peek-no-comments>No comments yet.</p>
                  } @else {
                    <ul class="comments" data-peek-comments>
                      @for (cm of comments(); track cm.commentId) {
                        <li class="comment">
                          <p class="who">
                            <strong>{{ cm.author.displayName }}</strong>
                            <span class="muted">{{ cm.createdAtUtc | mfDate }}</span>
                          </p>
                          <p class="text">{{ snippet(cm) }}</p>
                        </li>
                      }
                    </ul>
                  }
                </section>
              }
            }
          }
        </div>
      }
    </p-dialog>
  `,
  styles: `
    .peek {
      display: grid;
      gap: var(--mf-s4);
    }
    .title {
      margin: 0;
      font-size: var(--mf-fs-h3);
      overflow-wrap: anywhere;
    }
    .where {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1);
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sec h3 {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s2) var(--mf-s4);
      margin: 0;
    }
    .fact dt {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .fact dd {
      margin: 0;
      min-width: 0;
    }
    .ooo {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      margin-left: var(--mf-s2);
      padding: 0 var(--mf-s2);
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border: 1px solid currentColor;
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
    }
    .actions {
      margin: var(--mf-s3) 0 0;
    }
    .actions a {
      text-decoration: none;
    }
    .steps,
    .comments {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .step {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .step-title {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .step-state {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .step[data-step-status='COMPLETED'] .pi {
      color: var(--mf-success);
    }
    .comment {
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface-alt);
      border-radius: var(--mf-radius);
    }
    .comment p {
      margin: 0;
    }
    .who {
      display: flex;
      justify-content: space-between;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .text {
      margin: 0;
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--mf-text-muted);
      font-weight: 400;
      font-size: var(--mf-fs-sm);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .bones {
      display: grid;
      gap: var(--mf-s2);
    }
    .bone {
      display: block;
      height: 4rem;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .alert {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
      padding: var(--mf-s3);
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
    }
  `,
})
export class SwimlaneDrawer {
  private readonly tasks = inject(TasksClient);
  private readonly commentsApi = inject(TaskCommentsClient);
  private readonly quiet = inject(QuietRequests);
  private readonly auth = inject(AuthStore);
  private seq = 0;
  private destroyed = false;

  /** The card being peeked at (the board's current copy, so an edit shows at once); null while the drawer is closed. */
  readonly card = input<SwimlaneCard | null>(null);
  readonly closed = output<void>();
  /** The card with an edit made in the drawer applied. */
  readonly cardChange = output<SwimlaneCard>();

  protected readonly task = signal<TaskResponse | null>(null);
  protected readonly comments = signal<TaskCommentResponse[]>([]);
  protected readonly state = signal<LoadState>('loading');
  protected readonly visible = computed(() => this.card() !== null);
  protected readonly row = computed<TaskQueueRow>(() => cardToRow(this.card() as SwimlaneCard));
  protected readonly summary = computed(() => {
    const t = this.task();
    // A description saved as text is shown as it is; rich text is reduced to its lines (table cells separated by a bar).
    const text = (
      t?.descriptionFormat === 'HTML' ? htmlToPlainText(t.description) : (t?.description ?? '')
    ).trim();
    return text.length > 400 ? text.slice(0, 400).trimEnd() + '...' : text;
  });

  private openedId: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // Read the task when the drawer opens for a card (not again for every edit of the same card).
    effect(() => {
      const id = this.card()?.taskId ?? null;
      untracked(() => {
        if (id === this.openedId) return;
        this.openedId = id;
        this.task.set(null);
        this.comments.set([]);
        if (id !== null) this.load();
      });
    });
  }

  protected load(): void {
    const c = this.card();
    if (!c) return;
    const id = c.taskId;
    const seq = ++this.seq;
    this.state.set('loading');
    void (async () => {
      try {
        const [task, comments] = await this.quiet.run(() =>
          Promise.all([
            firstValueFrom(this.tasks.getTask(id)),
            firstValueFrom(this.commentsApi.listTaskComments(id, true, 0, PEEK_COMMENTS)).catch(
              () => null,
            ),
          ]),
        );
        if (this.destroyed || seq !== this.seq) return;
        this.task.set(task);
        this.comments.set((comments?.items ?? []).slice(0, PEEK_COMMENTS));
        this.state.set('ready');
      } catch {
        if (this.destroyed || seq !== this.seq) return;
        this.state.set('error');
      }
    })();
  }

  protected editable(field: 'status' | 'priority' | 'assignee'): boolean {
    const c = this.card();
    return !!c && canEditField(field, cardToRow(c), (p) => this.auth.has(p));
  }

  protected changed(row: TaskQueueRow): void {
    const c = this.card();
    if (c) this.cardChange.emit(applyRow(c, row));
  }

  protected onVisible(open: boolean): void {
    if (!open) this.closed.emit();
  }

  protected focusClose(): void {
    document
      .querySelector<HTMLElement>('.mf-swl-drawer button[aria-label="Close task details"]')
      ?.focus();
  }

  protected snippet(c: TaskCommentResponse): string {
    const text = htmlToText(c.bodyHtml).trim();
    return text.length > 240 ? text.slice(0, 240).trimEnd() + '...' : text;
  }

  protected stepIcon(status: string): string {
    switch (status) {
      case 'COMPLETED':
        return 'pi-check-circle';
      case 'SKIPPED':
        return 'pi-forward';
      case 'IN_PROGRESS':
        return 'pi-play-circle';
      default:
        return 'pi-circle';
    }
  }

  protected stepText(status: string, current: boolean): string {
    switch (status) {
      case 'COMPLETED':
        return 'Done';
      case 'SKIPPED':
        return 'Skipped';
      case 'IN_PROGRESS':
        return 'In progress';
      default:
        return current ? 'Next' : 'To do';
    }
  }
}
