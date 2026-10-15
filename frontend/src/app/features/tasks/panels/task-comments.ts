import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  TaskCommentResponse,
  TaskCommentRevisionResponse,
  TaskCommentsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { COMMENT_MAX_TEXT, decorateLinks, htmlToText, isBlankHtml } from './rich-text';
import { RichTextEditor } from './rich-text-editor';

export const COMMENTS_INTERNAL_NOTE = 'Internal only. Visible to people who can view tasks.';
export const COMMENTS_PRIVILEGE_NOTE =
  'Privilege reminder: comments are saved with the task. Do not record anything that should not be stored here.';
export const COMMENT_DELETE_BODY =
  'Delete this comment? It will be hidden from view but kept in the audit record.';
/** The server returns at most this many comments per request (`take`); longer threads are fetched page by page (SEC2-10). */
export const COMMENTS_PAGE_SIZE = 200;

const RENDER_CACHE_LIMIT = 1000;

/**
 * The Comments section of a Task (UX S10): the thread, a basic rich-text composer, and edit / delete of one's own comments.
 * Comments are allowed in every Task status; `readOnly` only hides the composer and the row actions (for example when the viewer lacks
 * Task.Comment). Cancel and On Hold reasons show their purpose label and cannot be deleted. Bodies arrive sanitized from the server and
 * are rendered through Angular's own HTML sanitizer.
 *
 * Inputs: `taskId` (required), `readOnly`. Outputs: `countChange` (comments shown, after every load and change) and `changed`
 * (a comment was posted, edited or deleted, so the host can refresh its header or the activity).
 */
@Component({
  selector: 'mf-task-comments',
  imports: [MfDatePipe, RichTextEditor, ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tc" aria-label="Comments">
      <header class="tc__head">
        <h2 class="tc__title" tabindex="-1" data-section-heading>Comments ({{ total() }})</h2>
        <div class="tc__order" role="group" aria-label="Order">
          <button
            type="button"
            data-order="oldest"
            [attr.aria-pressed]="!newestFirst()"
            (click)="setOrder(false)"
          >
            Oldest first
          </button>
          <button
            type="button"
            data-order="newest"
            [attr.aria-pressed]="newestFirst()"
            (click)="setOrder(true)"
          >
            Newest first
          </button>
        </div>
      </header>

      @switch (state()) {
        @case ('loading') {
          <p class="tc__muted" role="status" aria-busy="true">Loading comments...</p>
        }
        @case ('error') {
          <p class="tc__alert" role="alert" data-load-error>
            Something went wrong. Try again.
            <button type="button" class="tc__link" (click)="reload()">Retry</button>
          </p>
        }
        @default {
          @if (items().length === 0) {
            <p class="tc__muted" data-empty>No comments yet.</p>
          } @else {
            <ol class="tc__list">
              @for (c of items(); track c.commentId) {
                <li class="tc__item" [attr.data-comment-id]="c.commentId">
                  <div class="tc__meta">
                    <strong class="tc__author">{{ c.author.displayName }}</strong>
                    <time [attr.datetime]="c.createdAtUtc" [title]="c.createdAtUtc + ' (UTC)'">{{
                      c.createdAtUtc | mfDate
                    }}</time>
                    @if (c.purposeLabel) {
                      <span class="tc__tag" data-purpose>{{ c.purposeLabel }}</span>
                    }
                  </div>

                  @if (editingId() === c.commentId) {
                    <div class="tc__edit" data-edit-form>
                      <mf-rich-text-editor
                        label="Edit comment"
                        [(value)]="editDraft"
                        [disabled]="saving()"
                        (submitted)="saveEdit(c)"
                      />
                      @if (editError()) {
                        <p class="tc__alert" role="alert" data-edit-error>{{ editError() }}</p>
                      }
                      <div class="tc__actions">
                        <button
                          type="button"
                          class="mf-btn mf-btn--primary"
                          data-save-edit
                          [disabled]="saving() || isBlank(editDraft())"
                          (click)="saveEdit(c)"
                        >
                          Save changes
                        </button>
                        <button
                          type="button"
                          class="mf-btn"
                          data-cancel-edit
                          (click)="cancelEdit()"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  } @else {
                    <div class="tc__body" data-body [innerHTML]="render(c.bodyHtml)"></div>
                    @if (c.isEdited) {
                      <p class="tc__edited">
                        <span data-edited
                          >Edited
                          <time [attr.datetime]="c.editedAtUtc">{{
                            c.editedAtUtc | mfDate
                          }}</time></span
                        >
                        <button
                          type="button"
                          class="tc__link"
                          data-history-toggle
                          [attr.aria-expanded]="historyId() === c.commentId"
                          (click)="toggleHistory(c)"
                        >
                          View edit history
                        </button>
                      </p>
                      @if (historyId() === c.commentId) {
                        <div class="tc__history" data-history>
                          @if (history() === null) {
                            <p class="tc__muted" role="status">Loading edit history...</p>
                          } @else {
                            @for (r of history(); track r.revisionId) {
                              <div class="tc__rev">
                                <time [attr.datetime]="r.revisedAtUtc">{{
                                  r.revisedAtUtc | mfDate
                                }}</time>
                                <div class="tc__body" [innerHTML]="render(r.bodyHtml)"></div>
                              </div>
                            }
                          }
                        </div>
                      }
                    }
                    @if (!readOnly() && (c.canEdit || c.canDelete)) {
                      <div class="tc__actions">
                        @if (c.canEdit) {
                          <button type="button" class="mf-btn" data-edit (click)="startEdit(c)">
                            Edit
                          </button>
                        }
                        @if (c.canDelete) {
                          <button
                            type="button"
                            class="mf-btn mf-btn--danger"
                            data-delete
                            (click)="askDelete(c)"
                          >
                            Delete
                          </button>
                        }
                      </div>
                    }
                  }
                </li>
              }
            </ol>
            @if (items().length < total()) {
              <div class="tc__more" data-more>
                <p class="tc__muted" data-more-note>
                  Showing {{ items().length }} of {{ total() }} comments.
                </p>
                @if (moreError()) {
                  <p class="tc__alert" role="alert" data-more-error>{{ moreError() }}</p>
                }
                <button
                  type="button"
                  class="mf-btn"
                  data-load-more
                  [disabled]="loadingMore()"
                  (click)="loadMore()"
                >
                  {{ loadingMore() ? 'Loading...' : 'Load more comments' }}
                </button>
              </div>
            }
          }
        }
      }

      @if (canPost()) {
        <form class="tc__composer" data-composer (submit)="post($event)">
          <mf-rich-text-editor
            label="Add a comment"
            placeholder="Add a comment... (Ctrl+Enter to post)"
            [(value)]="draft"
            [disabled]="posting()"
            (submitted)="post()"
          />
          <p class="tc__note" data-internal-note>{{ internalNote }}</p>
          <p class="tc__note tc__note--privilege" data-privilege-note>
            <i class="pi pi-lock" aria-hidden="true"></i> {{ privilegeNote }}
          </p>
          @if (postError()) {
            <p class="tc__alert" role="alert" data-post-error>{{ postError() }}</p>
          }
          <button
            type="submit"
            class="mf-btn mf-btn--primary"
            data-post
            [disabled]="posting() || isBlank(draft())"
          >
            Post comment
          </button>
        </form>
      } @else {
        <p class="tc__note" data-internal-note>{{ internalNote }}</p>
      }

      <mf-confirm-dialog
        title="Delete comment"
        confirmLabel="Delete comment"
        cancelLabel="Keep comment"
        [danger]="true"
        [busy]="saving()"
        [(visible)]="deleteOpen"
        (confirmed)="confirmDelete()"
      >
        <p data-delete-body>{{ deleteBody }}</p>
      </mf-confirm-dialog>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .tc {
      display: grid;
      gap: var(--mf-s3);
    }
    .tc__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
    }
    .tc__title {
      margin: 0;
      font-size: var(--mf-fs-h3);
      scroll-margin-top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s4));
    }
    .tc__title:focus {
      outline: none;
    }
    .tc__title:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .tc__order {
      display: inline-flex;
      gap: var(--mf-s1);
    }
    .tc__order button {
      min-height: var(--mf-target-min, 2rem);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .tc__order button[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      font-weight: 600;
    }
    .tc__order button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .tc__list {
      display: grid;
      gap: var(--mf-s3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tc__item {
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .tc__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .tc__author {
      color: var(--mf-text);
    }
    .tc__tag {
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-st-hold-bg);
      color: var(--mf-text);
      font-size: var(--mf-fs-xs);
    }
    .tc__body {
      overflow-wrap: anywhere;
    }
    .tc__body :where(p, ul, ol) {
      margin: 0 0 var(--mf-s2);
    }
    .tc__body :where(ul, ol) {
      padding-left: var(--mf-s5, 1.5rem);
    }
    .tc__body a {
      color: var(--mf-link);
    }
    .tc__body :where(.tc__host) {
      margin-left: var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .tc__body :where(.tc__warn) {
      margin-left: var(--mf-s1);
      color: var(--mf-danger-text, var(--mf-danger));
      cursor: help;
    }
    .tc__more {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
    }
    .tc__edited {
      margin: var(--mf-s1) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .tc__history {
      margin-top: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border-left: 3px solid var(--mf-border-strong);
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
    }
    .tc__rev + .tc__rev {
      margin-top: var(--mf-s2);
    }
    .tc__rev time {
      font-size: var(--mf-fs-sm);
    }
    .tc__actions {
      display: flex;
      gap: var(--mf-s2);
      margin-top: var(--mf-s2);
    }
    .tc__composer {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
    }
    .tc__composer mf-rich-text-editor {
      justify-self: stretch;
    }
    .tc__note,
    .tc__muted {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .tc__note--privilege {
      color: var(--mf-text);
    }
    .tc__alert {
      margin: 0;
      color: var(--mf-danger-text, var(--mf-danger));
    }
    .tc__link {
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class TaskComments {
  /** The Task whose comments are shown. */
  readonly taskId = input.required<number>();
  /** Hides the composer and the edit / delete actions. */
  readonly readOnly = input(false);
  /** Change the value (for example the Task's rowVersion) to reload the thread quietly: a status change adds its reason as a comment. */
  readonly refresh = input<string | number | null>(null);

  /** Number of comments shown, after every load and change. */
  readonly countChange = output<number>();
  /** A comment was posted, edited or deleted. */
  readonly changed = output<void>();

  protected readonly internalNote = COMMENTS_INTERNAL_NOTE;
  protected readonly privilegeNote = COMMENTS_PRIVILEGE_NOTE;
  protected readonly deleteBody = COMMENT_DELETE_BODY;
  protected readonly maxText = COMMENT_MAX_TEXT;

  private readonly api = inject(TaskCommentsClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly rendered = new Map<string, string>();

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly items = signal<TaskCommentResponse[]>([]);
  /** All comments of the Task (the thread can be longer than the part shown). */
  protected readonly total = signal(0);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal('');
  protected readonly newestFirst = signal(false);

  protected readonly draft = signal('');
  protected readonly posting = signal(false);
  protected readonly postError = signal('');

  protected readonly editingId = signal<number | null>(null);
  protected readonly editDraft = signal('');
  protected readonly editError = signal('');
  protected readonly saving = signal(false);

  protected readonly historyId = signal<number | null>(null);
  protected readonly history = signal<TaskCommentRevisionResponse[] | null>(null);

  protected readonly deleteOpen = signal(false);
  private deleting: TaskCommentResponse | null = null;

  constructor() {
    effect(() => {
      this.taskId();
      untracked(() => {
        this.state.set('loading');
        void this.load();
      });
    });
    effect(() => {
      this.refresh();
      untracked(() => {
        // The first run is the initial load above; later ones reload without the loading state, keeping what is shown.
        if (this.refreshed && this.state() !== 'loading' && this.editingId() === null) {
          void this.load(this.items().length);
        }
        this.refreshed = true;
      });
    });
  }

  private refreshed = false;

  protected canPost(): boolean {
    return !this.readOnly() && this.auth.has('Task.Comment');
  }

  protected isBlank(html: string): boolean {
    return isBlankHtml(html);
  }

  protected reload(): void {
    this.state.set('loading');
    void this.load();
  }

  protected setOrder(newestFirst: boolean): void {
    if (this.newestFirst() === newestFirst) return;
    this.newestFirst.set(newestFirst);
    void this.load();
  }

  /** Appends the next page of a thread longer than the first one (the server caps a request at 200 comments). */
  protected async loadMore(): Promise<void> {
    if (this.loadingMore()) return;
    const taskId = this.taskId();
    const newestFirst = this.newestFirst();
    this.loadingMore.set(true);
    this.moreError.set('');
    try {
      const list = await firstValueFrom(
        this.api.listTaskComments(taskId, newestFirst, this.items().length, COMMENTS_PAGE_SIZE),
      );
      // The thread or its order changed while the page was on its way: that answer no longer fits.
      if (taskId !== this.taskId() || newestFirst !== this.newestFirst()) return;
      this.items.update((current) => [...current, ...list.items]);
      this.total.set(list.total);
      this.countChange.emit(list.total);
    } catch {
      this.moreError.set("Couldn't load more comments. Try again.");
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected async post(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.posting() || isBlankHtml(this.draft())) return;
    if (htmlToText(this.draft()).trim().length > COMMENT_MAX_TEXT) {
      this.postError.set(`A comment can have at most ${COMMENT_MAX_TEXT} characters.`);
      return;
    }
    this.posting.set(true);
    this.postError.set('');
    try {
      await firstValueFrom(this.api.addTaskComment(this.taskId(), { bodyHtml: this.draft() }));
      this.draft.set('');
      this.notify.success('Comment posted.');
      await this.load(this.items().length);
      this.changed.emit();
    } catch (error) {
      // The typed text stays in the composer.
      this.postError.set(messageOf(error));
    } finally {
      this.posting.set(false);
    }
  }

  protected startEdit(comment: TaskCommentResponse): void {
    this.editingId.set(comment.commentId);
    this.editDraft.set(comment.bodyHtml);
    this.editError.set('');
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editError.set('');
  }

  protected async saveEdit(comment: TaskCommentResponse): Promise<void> {
    if (this.saving() || isBlankHtml(this.editDraft())) return;
    this.saving.set(true);
    this.editError.set('');
    try {
      await firstValueFrom(
        this.api.editTaskComment(this.taskId(), comment.commentId, {
          bodyHtml: this.editDraft(),
          rowVersion: comment.rowVersion,
        }),
      );
      this.editingId.set(null);
      this.historyId.set(null);
      this.notify.success('Saved.');
      await this.load(this.items().length);
      this.changed.emit();
    } catch (error) {
      this.editError.set(
        error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT'
          ? 'Someone else changed this comment. Cancel and reopen it to see the latest.'
          : messageOf(error),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected askDelete(comment: TaskCommentResponse): void {
    this.deleting = comment;
    this.deleteOpen.set(true);
  }

  protected async confirmDelete(): Promise<void> {
    const comment = this.deleting;
    if (!comment || this.saving()) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.deleteTaskComment(this.taskId(), comment.commentId));
      this.deleteOpen.set(false);
      this.deleting = null;
      await this.load(this.items().length);
      this.changed.emit();
    } catch (error) {
      this.deleteOpen.set(false);
      this.notify.error("Couldn't delete the comment.", messageOf(error));
      await this.load(this.items().length);
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleHistory(comment: TaskCommentResponse): Promise<void> {
    if (this.historyId() === comment.commentId) {
      this.historyId.set(null);
      return;
    }
    this.historyId.set(comment.commentId);
    this.history.set(null);
    try {
      const list = await firstValueFrom(
        this.api.listTaskCommentRevisions(this.taskId(), comment.commentId),
      );
      if (this.historyId() === comment.commentId) this.history.set(list.items);
    } catch {
      this.history.set([]);
    }
  }

  /**
   * Links in a comment open in a new tab (the server already added rel="noopener noreferrer") and show the host they really go to; a link that
   * looks deceptive gets a warning mark (SEC2-12). The input is the server-sanitized body; Angular's own sanitizer still runs on the result when
   * it is bound to innerHTML.
   */
  protected render(html: string): string {
    // The template calls this on every change detection pass for every comment on screen; parsing the body each time would cost a DOM parse per
    // comment per pass on a long thread, so the result is remembered per body text.
    let decorated = this.rendered.get(html);
    if (decorated === undefined) {
      if (this.rendered.size >= RENDER_CACHE_LIMIT) this.rendered.clear();
      decorated = decorateLinks(html);
      this.rendered.set(html, decorated);
    }
    return decorated;
  }

  /**
   * Loads the first page and, with `keep` (after a post, edit or delete: the number on screen before), as many further pages as it takes to
   * show at least that many comments again. The first request carries no paging arguments: the server's default page is the first 200.
   */
  private async load(keep = 0): Promise<void> {
    const taskId = this.taskId();
    const newestFirst = this.newestFirst();
    try {
      const first = await firstValueFrom(this.api.listTaskComments(taskId, newestFirst));
      let items = first.items;
      while (items.length < keep && items.length < first.total) {
        const next = await firstValueFrom(
          this.api.listTaskComments(taskId, newestFirst, items.length, COMMENTS_PAGE_SIZE),
        );
        if (next.items.length === 0) break;
        items = [...items, ...next.items];
      }
      if (taskId !== this.taskId() || newestFirst !== this.newestFirst()) return;
      this.items.set(items);
      this.total.set(first.total);
      this.moreError.set('');
      this.state.set('ready');
      this.countChange.emit(first.total);
    } catch {
      if (taskId === this.taskId()) this.state.set('error');
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof ApiError && error.message
    ? error.message
    : 'Something went wrong. Try again.';
}
