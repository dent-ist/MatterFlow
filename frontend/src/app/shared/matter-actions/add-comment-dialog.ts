import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TaskCommentsClient, TaskQueueClient } from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { textToHtml } from '../../features/tasks/panels/rich-text';

/** The longest comment (the server limit, plain text). */
const MAX_TEXT = 10_000;
const OPEN = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

interface OpenTask {
  taskId: number;
  taskNumber: string;
  title: string;
}

/**
 * "Add comment" from a matter's quick actions (epic #758, PX-25). A matter has no comments of its own (a matter-level note would be a new entity),
 * so the comment goes to one of the matter's open tasks: the person searches the open tasks by title or number, picks one, writes, and the text is
 * posted through the existing task comment API. The comment is plain text, saved as paragraphs. Nothing is read back: no comment text is ever
 * shown here.
 */
@Component({
  selector: 'mf-add-comment-dialog',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .ac__field {
      display: grid;
      gap: var(--mf-s1);
      margin-bottom: var(--mf-s3);
    }
    .ac__field label,
    .ac__legend {
      font-weight: 600;
    }
    .ac__list {
      margin: 0;
      padding: 0;
      list-style: none;
      max-height: 12rem;
      overflow-y: auto;
    }
    .ac__list label {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      min-height: 32px;
      padding: var(--mf-s1) 0;
      font-weight: 400;
    }
    .ac__muted {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    textarea {
      width: 100%;
      min-height: 7rem;
    }
    @media (max-width: 639.98px) {
      .ac__list label {
        min-height: 44px;
        align-items: center;
      }
    }
  `,
  template: `
    <mf-confirm-dialog
      title="Add comment"
      confirmLabel="Add comment"
      [busy]="posting()"
      [error]="error()"
      [(visible)]="visible"
      (confirmed)="post()"
    >
      <p class="ac__muted" data-note>
        The comment is saved on a task of {{ matterLabel() }}. Internal only. Visible to people who
        can view tasks.
      </p>
      <div class="ac__field">
        <label for="ac-search">Find an open task</label>
        <input
          id="ac-search"
          type="search"
          class="mf-control"
          autocomplete="off"
          data-task-search
          [value]="query()"
          (input)="search($any($event.target).value)"
        />
      </div>
      <fieldset class="ac__field" style="border: 0; padding: 0; margin-inline: 0">
        <legend class="ac__legend">Task</legend>
        @if (loading()) {
          <p class="ac__muted" role="status">Searching...</p>
        } @else if (tasks().length === 0) {
          <p class="ac__muted" data-no-tasks>
            {{ query() ? 'No open task matches.' : 'This matter has no open tasks.' }}
          </p>
        } @else {
          <ul class="ac__list" data-task-list>
            @for (t of tasks(); track t.taskId) {
              <li>
                <label>
                  <input
                    type="radio"
                    name="ac-task"
                    [value]="t.taskId"
                    [checked]="chosen() === t.taskId"
                    (change)="chosen.set(t.taskId)"
                  />
                  <span>{{ t.taskNumber }} {{ t.title }}</span>
                </label>
              </li>
            }
          </ul>
        }
      </fieldset>
      <div class="ac__field">
        <label for="ac-text">Comment</label>
        <textarea
          id="ac-text"
          class="mf-control"
          data-comment-text
          [maxLength]="max"
          [value]="text()"
          (input)="text.set($any($event.target).value)"
        ></textarea>
        <span class="ac__muted">{{ text().length }} of {{ max }}</span>
      </div>
      @if (!ready() && touched()) {
        <p class="ac__muted" role="status" data-need>
          {{ chosen() === null ? 'Choose a task.' : 'Write the comment.' }}
        </p>
      }
    </mf-confirm-dialog>
  `,
})
export class AddCommentDialog {
  readonly matterId = input.required<number>();
  readonly matterLabel = input('this matter');
  readonly visible = model(false);
  /** The comment was posted (task id): the page may say where. */
  readonly posted = output<number>();

  private readonly queue = inject(TaskQueueClient);
  private readonly comments = inject(TaskCommentsClient);
  private readonly notify = inject(NotificationService);

  protected readonly max = MAX_TEXT;
  protected readonly query = signal('');
  protected readonly tasks = signal<OpenTask[]>([]);
  protected readonly loading = signal(false);
  protected readonly chosen = signal<number | null>(null);
  protected readonly text = signal('');
  protected readonly posting = signal(false);
  protected readonly error = signal('');
  protected readonly touched = signal(false);
  protected readonly ready = computed(
    () => this.chosen() !== null && this.text().trim().length > 0,
  );

  private timer: ReturnType<typeof setTimeout> | undefined;
  private turn = 0;

  constructor() {
    // Opening starts from nothing: the matter's first open tasks, no choice, no text.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.query.set('');
        this.chosen.set(null);
        this.text.set('');
        this.error.set('');
        this.touched.set(false);
        void this.load('');
      });
    });
  }

  protected search(value: string): void {
    this.query.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(value.trim()), 250);
  }

  private async load(q: string): Promise<void> {
    const turn = ++this.turn;
    this.loading.set(true);
    try {
      const page = await firstValueFrom(
        this.queue.getTaskQueue(
          undefined,
          q || undefined,
          OPEN,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          this.matterId(),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'updated',
          'desc',
          1,
          8,
        ),
      );
      if (turn !== this.turn) return;
      this.tasks.set(
        page.items.map((r) => ({ taskId: r.taskId, taskNumber: r.taskNumber, title: r.title })),
      );
      if (this.chosen() !== null && !this.tasks().some((t) => t.taskId === this.chosen())) {
        this.chosen.set(null);
      }
    } catch {
      if (turn === this.turn) this.tasks.set([]);
    } finally {
      if (turn === this.turn) this.loading.set(false);
    }
  }

  protected async post(): Promise<void> {
    this.touched.set(true);
    const taskId = this.chosen();
    if (taskId === null || !this.ready() || this.posting()) {
      // The dialog stays open (a confirm closes it): the person is told what is missing.
      this.visible.set(true);
      return;
    }
    this.posting.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.comments.addTaskComment(taskId, { bodyHtml: textToHtml(this.text()) }),
      );
      this.notify.success('Comment posted.');
      this.visible.set(false);
      this.posted.emit(taskId);
    } catch (e) {
      // The typed text stays; the message is read in the dialog.
      this.error.set(
        e instanceof ApiError && e.message ? e.message : "Couldn't post the comment. Try again.",
      );
      this.visible.set(true);
    } finally {
      this.posting.set(false);
    }
  }
}
