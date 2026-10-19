import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  Injector,
  linkedSignal,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
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
import { PanelScroll } from '../../../shared/ui/panel-scroll';
import { SearchBox } from '../../../shared/ui/search-box';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { COMMENT_MAX_TEXT, decorateLinks, htmlToText, isBlankHtml } from './rich-text';
import { RichTextEditor } from './rich-text-editor';
import { countNew, latestOf, readSeen, saveSeen } from './section-state';

export const COMMENTS_INTERNAL_NOTE = 'Internal only. Visible to people who can view tasks.';
export const COMMENTS_PRIVILEGE_NOTE =
  'Privilege reminder: comments are saved with the task. Do not record anything that should not be stored here.';
export const COMMENT_DELETE_BODY =
  'Delete this comment? It will be hidden from view but kept in the audit record.';
/** The server returns at most this many comments per request (`take`); longer threads are fetched page by page (SEC2-10). */
export const COMMENTS_PAGE_SIZE = 200;

const RENDER_CACHE_LIMIT = 1000;
/** A thread longer than this puts the composer above the comments. */
export const COMPOSER_FIRST_ABOVE = 5;
/** How long a linked comment stays highlighted. */
const HIGHLIGHT_MS = 4000;

/** How many of the most recent comments the thread shows ("Show latest"); `all` shows every loaded comment. */
export type CommentLimit = 3 | 5 | 10 | 'all';
export const COMMENT_LIMITS: readonly CommentLimit[] = [3, 5, 10, 'all'];
export const COMMENT_LIMIT_DEFAULT: CommentLimit = 3;
export const commentLimitKey = (userId: number | null | undefined): string =>
  `mf.task-comments.limit.${userId ?? 'anon'}`;

function readLimit(key: string): CommentLimit {
  try {
    const raw = localStorage.getItem(key);
    return COMMENT_LIMITS.find((l) => String(l) === raw) ?? COMMENT_LIMIT_DEFAULT;
  } catch {
    return COMMENT_LIMIT_DEFAULT;
  }
}

function saveLimit(key: string, limit: CommentLimit): void {
  try {
    localStorage.setItem(key, String(limit));
  } catch {
    // Not remembered (private window or blocked storage).
  }
}

const timeOf = (c: TaskCommentResponse): number => Date.parse(c.createdAtUtc) || 0;

/**
 * The Comments section of a Task (UX S10): the thread, a basic rich-text composer, and edit / delete of one's own comments.
 * Comments are allowed in every Task status; `readOnly` only hides the composer and the row actions (for example when the viewer lacks
 * Task.Comment). Cancel and On Hold reasons show their purpose label and cannot be deleted. Bodies arrive sanitized from the server and
 * are rendered through Angular's own HTML sanitizer.
 *
 * The thread shows the most recent 3 comments by default ("Show latest" 3 / 5 / 10 / All, remembered per user); the sort order only orders the
 * comments inside that window, and a search looks through every loaded comment whatever the limit. The server list is always requested newest
 * first, so the latest comments are in the first page however long the thread is.
 *
 * It is the body of the Task page's Comments tab (#347): the tab carries the name and the count, so there is no bar. A "N new" cue shows comments by
 * others since this person last saw the thread (the thread counts as seen while the tab is `active`, and again when it is left). The list loads with
 * the page whichever tab is showing, so the count is right at once. The composer is one line until it gets focus (or `composerRequest` changes).
 *
 * Inputs: `taskId` (required), `readOnly`, `refresh`, `active`, `composerRequest`, `focusRequest`. Outputs: `countChange` (comments shown, after every load and change) and `changed`
 * (a comment was posted, edited or deleted, so the host can refresh its header or the activity).
 */
@Component({
  selector: 'mf-task-comments',
  imports: [MfDatePipe, NgTemplateOutlet, RichTextEditor, ConfirmDialog, SearchBox, PanelScroll],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tc" aria-label="Comments">
      <h2 class="mf-sr-only" tabindex="-1" data-section-heading>Comments</h2>
      <span class="mf-sr-only" role="status" aria-live="polite" data-live>{{ announce() }}</span>
      @if (newBadge()) {
        <p class="tc__new" data-new-badge>{{ newBadge() }}</p>
      }
      <div class="tc__panel" [id]="panelId">
        <div class="tc__tools">
          <mf-search-box
            class="tc__search"
            inputId="tc-search"
            label="Search comments"
            placeholder="Search comments"
            [hideLabel]="true"
            [hintOnFocus]="true"
            hint="Searches the author and the text of all the comments loaded here, whatever the Show latest setting."
            [value]="query()"
            (searchChange)="query.set($event)"
          />
          <div class="tc__opts">
            <select
              class="mf-control tc__sort"
              data-order-select
              aria-label="Sort comments"
              (change)="setOrder($any($event.target).value === 'newest')"
            >
              <option value="oldest" [selected]="!newestFirst()">Oldest first</option>
              <option value="newest" [selected]="newestFirst()">Newest first</option>
            </select>
          </div>
        </div>

        @if (composerFirst()) {
          <ng-container [ngTemplateOutlet]="composerTpl" />
        }

        @if (missingNote()) {
          <p class="tc__muted" role="status" data-comment-missing>{{ missingNote() }}</p>
        }

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
            } @else if (visibleItems().length === 0) {
              <p class="tc__muted" data-no-match role="status">
                No comments match "{{ query() }}".
                <button type="button" class="tc__link" (click)="query.set('')">Clear search</button>
              </p>
            } @else {
              @if (query()) {
                <p class="tc__muted" data-match-count role="status">
                  {{ visibleItems().length }} of {{ items().length }} comments match.
                </p>
              }
              @if (!query() && limited()) {
                <p class="tc__muted" data-limit-note role="status">
                  Showing latest {{ visibleItems().length }} of {{ total() }}.
                  <button type="button" class="tc__link" data-show-all (click)="setLimit('all')">
                    Show all
                  </button>
                </p>
              } @else if (!query() && shownAll() && total() > latestCount) {
                <p class="tc__muted" data-limit-note role="status">
                  Showing all {{ total() }}.
                  <button
                    type="button"
                    class="tc__link"
                    data-show-latest
                    (click)="setLimit(latestCount)"
                  >
                    Show latest {{ latestCount }}
                  </button>
                </p>
              }
              <div mfPanelScroll="Comment thread" class="tc__scroll" data-comments-scroll>
                <ol class="tc__list">
                  @for (c of visibleItems(); track c.commentId) {
                    <li
                      class="tc__item"
                      tabindex="-1"
                      [class.tc__item--hit]="highlightId() === c.commentId"
                      [attr.data-comment-id]="c.commentId"
                    >
                      <div class="tc__meta">
                        <strong class="tc__author">{{ c.author.displayName }}</strong>
                        <time
                          [attr.datetime]="c.createdAtUtc"
                          [title]="c.createdAtUtc + ' (UTC)'"
                          >{{ c.createdAtUtc | mfDate }}</time
                        >
                        @if (c.purposeLabel) {
                          <span class="tc__tag" data-purpose>{{ c.purposeLabel }}</span>
                        }
                        @if (
                          editingId() !== c.commentId && !readOnly() && (c.canEdit || c.canDelete)
                        ) {
                          <span class="tc__actions tc__actions--row">
                            @if (c.canEdit) {
                              <button
                                type="button"
                                class="mf-btn mf-btn--text mf-btn--icon"
                                data-edit
                                aria-label="Edit comment"
                                title="Edit comment"
                                (click)="startEdit(c)"
                              >
                                <i class="pi pi-pencil" aria-hidden="true"></i>
                              </button>
                            }
                            @if (c.canDelete) {
                              <button
                                type="button"
                                class="mf-btn mf-btn--text mf-btn--icon mf-btn--danger"
                                data-delete
                                aria-label="Delete comment"
                                title="Delete comment"
                                (click)="askDelete(c)"
                              >
                                <i class="pi pi-trash" aria-hidden="true"></i>
                              </button>
                            }
                          </span>
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
                            <p class="tc__alert" role="alert" data-edit-error>
                              {{ editError() }}
                            </p>
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
                        <div
                          class="tc__body mf-rich"
                          data-body
                          [innerHTML]="render(c.bodyHtml)"
                        ></div>
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
                                    <div
                                      class="tc__body mf-rich"
                                      [innerHTML]="render(r.bodyHtml)"
                                    ></div>
                                  </div>
                                }
                              }
                            </div>
                          }
                        }
                      }
                    </li>
                  }
                </ol>
              </div>
              @if (items().length < total() && (shownAll() || query())) {
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

        @if (!composerFirst()) {
          <ng-container [ngTemplateOutlet]="composerTpl" />
        }
      </div>

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

    <ng-template #composerTpl>
      @if (canPost()) {
        <form
          class="tc__composer"
          data-composer
          (submit)="post($event)"
          (focusout)="composerFocusOut($event)"
        >
          @if (composerOpen()) {
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
          } @else {
            <input
              type="text"
              class="mf-control tc__quick"
              data-composer-quick
              placeholder="Write a comment..."
              aria-label="Add a comment"
              autocomplete="off"
              (focus)="expandComposer()"
              (click)="expandComposer()"
            />
          }
        </form>
      } @else {
        <p class="tc__note" data-internal-note>{{ internalNote }}</p>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .tc {
      display: grid;
      gap: var(--mf-s3);
    }
    .tc__new {
      justify-self: start;
      margin: 0;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-selected-bg);
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .tc__panel {
      display: grid;
      gap: var(--mf-s3);
    }
    .tc__tools {
      display: grid;
      gap: var(--mf-s2);
    }
    .tc__search {
      width: 100%;
      min-width: 0;
    }
    .tc__opts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .tc__sort {
      width: auto;
      min-width: 8.5rem;
    }
    /* The thread scrolls by itself when it is taller than the panel allows (--mf-panel-max); the composer stays below it. */
    .tc__scroll {
      margin: 0 calc(var(--mf-s1) * -1);
      padding: var(--mf-s1);
    }
    .tc__list {
      display: grid;
      gap: var(--mf-s3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tc__item:focus-visible {
      outline: 2px solid var(--mf-focus, currentColor);
      outline-offset: 2px;
    }
    .tc__item--hit {
      border-color: var(--mf-border-strong);
      background: var(--mf-selected-bg);
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
      min-width: 0;
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
      justify-content: flex-end;
      gap: var(--mf-s2);
      margin-top: var(--mf-s2);
    }
    /* Edit and Delete sit at the right end of the author line instead of under the text. */
    .tc__actions--row {
      margin: calc(var(--mf-s1) * -1) 0 calc(var(--mf-s1) * -1) auto;
    }
    .tc__composer {
      display: grid;
      gap: var(--mf-s2);
      justify-items: stretch;
    }
    .tc__composer [data-post] {
      justify-self: end;
    }
    .tc__quick {
      width: 100%;
      border-radius: 999px;
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

  /**
   * A request to show one comment (the host sets it when someone chooses a comment in the Activity, after it has shown the tab): the thread shows the
   * comment (loading older pages when needed), scrolls to it, highlights it for a few seconds and puts focus on it. `seq` makes a repeated
   * request for the same comment count.
   */
  readonly focusRequest = input<{ commentId: number; seq: number } | null>(null);

  /** Whether the Comments tab is the one showing: the thread counts as seen while it is, and a request to focus needs it to be. */
  readonly active = input(true);
  /** A change (the host counts up) puts the cursor in the composer: shortcut C. The host shows the tab first. */
  readonly composerRequest = input(0);

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
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly rendered = new Map<string, string>();

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly items = signal<TaskCommentResponse[]>([]);
  /** All comments of the Task (the thread can be longer than the part shown). */
  protected readonly total = signal(0);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal('');
  protected readonly newestFirst = signal(false);
  /** The size of the short view of a long thread (the default of `limit`). */
  protected readonly latestCount = 3;
  private readonly limitKey = computed(() => commentLimitKey(this.auth.profile()?.userId));
  /** How many of the latest comments are shown; remembered per user. */
  protected readonly limit = linkedSignal<string, CommentLimit>({
    source: this.limitKey,
    computation: (key) => readLimit(key),
  });
  /** The search text; filters the comments already loaded (a thread is loaded in full, in pages of 200). */
  protected readonly query = signal('');
  /** The loaded comments, newest first (by date, then id). */
  private readonly newestFirstItems = computed(() =>
    [...this.items()].sort((a, b) => timeOf(b) - timeOf(a) || b.commentId - a.commentId),
  );
  /** A link to a comment shows the whole thread for now (not remembered), so the comment is on screen. */
  private readonly revealAll = signal(false);
  private readonly effectiveLimit = computed<CommentLimit>(() =>
    this.revealAll() ? 'all' : this.limit(),
  );
  /** True when the whole loaded thread is shown (Show all, or a link to a comment). */
  protected readonly shownAll = computed(() => this.effectiveLimit() === 'all');
  /** True when the "latest N" limit hides some comments (and no search is active). */
  protected readonly limited = computed(() => {
    const l = this.effectiveLimit();
    return l !== 'all' && this.total() > l;
  });
  /**
   * What the thread shows: the most recent N comments by date (all of them with Show latest = All), in the chosen sort order. A search
   * ignores the limit and looks through every loaded comment.
   */
  protected readonly visibleItems = computed(() => {
    const q = this.query().trim().toLowerCase();
    const newest = this.newestFirstItems();
    const l = this.effectiveLimit();
    const picked = q
      ? newest.filter((c) =>
          (c.author.displayName + ' ' + htmlToText(c.bodyHtml)).toLowerCase().includes(q),
        )
      : l === 'all'
        ? newest
        : newest.slice(0, l);
    return this.newestFirst() ? picked : [...picked].reverse();
  });

  /** Above 5 comments the composer comes first, so a reply does not mean scrolling past the whole thread. */
  protected readonly composerFirst = computed(() => this.total() > COMPOSER_FIRST_ABOVE);
  /** The comment just linked to, for a few seconds. */
  protected readonly highlightId = signal<number | null>(null);
  protected readonly missingNote = signal('');
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly panelId = 'tc-panel';
  private wasActive = true;
  private readonly userId = computed(() => this.auth.profile()?.userId);
  /** When this person last saw this Task's comments (the baseline of "new"; null on a first visit). */
  private readonly seenAt = linkedSignal<[number | null | undefined, number], number | null>({
    source: () => [this.userId(), this.taskId()],
    computation: ([user, task]) => readSeen(user, task),
  });
  protected readonly newCount = computed(() =>
    countNew(this.items(), this.seenAt(), this.userId()),
  );
  protected readonly newBadge = computed(() =>
    this.newCount() > 0 ? `${this.newCount()} new` : '',
  );
  /** Said once through a polite live region when the page opens with new comments. */
  protected readonly announce = signal('');
  /** The first load of this Task decides whether the section opens by itself (new comments). */
  private visited = false;

  /** The composer is one line ("Write a comment...") until it gets focus; then it is the full editor. */
  protected readonly composerOpen = signal(false);
  private readonly editor = viewChild(RichTextEditor);
  private focusing = false;

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
    this.destroyRef.onDestroy(() => clearTimeout(this.highlightTimer));
    effect(() => {
      this.taskId();
      untracked(() => {
        this.visited = false;
        this.announce.set('');
        this.composerOpen.set(false);
        this.state.set('loading');
        void this.load();
      });
    });
    // Seen: while the tab is showing, the newest comment counts as read for the next visit; leaving the tab clears the "N new" cue.
    effect(() => {
      if (this.active() && this.state() === 'ready') {
        this.items();
        untracked(() => this.markSeen());
      }
    });
    effect(() => {
      const active = this.active();
      untracked(() => {
        if (this.wasActive && !active && this.state() === 'ready') this.seenAt.set(this.markSeen());
        this.wasActive = active;
      });
    });
    effect(() => {
      const request = this.composerRequest();
      untracked(() => {
        if (request > 0) this.focusComposer();
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
  private handledSeq = 0;

  /** Runs a focus request once the thread has loaded. */
  private readonly focusEffect = effect(() => {
    const request = this.focusRequest();
    const ready = this.state() === 'ready';
    if (!request || !ready || request.seq === this.handledSeq) return;
    this.handledSeq = request.seq;
    untracked(() => void this.showComment(request.commentId));
  });

  private async showComment(commentId: number): Promise<void> {
    this.missingNote.set('');
    this.query.set('');
    // Older comments than the first page: fetch pages until the comment is among them or the thread is exhausted.
    while (
      !this.items().some((c) => c.commentId === commentId) &&
      this.items().length < this.total()
    ) {
      const before = this.items().length;
      await this.loadMore();
      if (this.items().length === before) break;
    }
    if (!this.items().some((c) => c.commentId === commentId)) {
      this.missingNote.set('That comment is no longer in the thread.');
      return;
    }
    this.revealAll.set(true);
    this.highlightId.set(commentId);
    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => this.highlightId.set(null), HIGHLIGHT_MS);
    // After the host has closed the drawer (which gives focus back to its button) and the list has rendered.
    afterNextRender(
      () =>
        setTimeout(() => {
          const row = this.host.nativeElement.querySelector<HTMLElement>(
            `[data-comment-id="${commentId}"]`,
          );
          if (!row) return;
          row.scrollIntoView?.({ block: 'center' });
          row.focus({ preventScroll: true });
        }, 120),
      { injector: this.injector },
    );
  }

  protected expandComposer(): void {
    if (this.composerOpen()) return;
    this.focusComposer();
  }

  /** Opens the composer from its one-line form and puts the cursor in it. */
  private focusComposer(): void {
    if (!this.canPost()) return;
    this.composerOpen.set(true);
    this.focusing = true;
    this.placeCursor(0);
  }

  /** Focuses the editor once it is on screen: waits a moment (a few tries) when this is the request that is showing the tab. */
  private placeCursor(attempt: number): void {
    afterNextRender(
      () => {
        const editor = this.editor();
        // The host puts this body in a pane it hides while another tab shows.
        const hidden = this.host.nativeElement.closest('[hidden]') !== null;
        if (hidden && attempt < 5) {
          setTimeout(() => this.placeCursor(attempt + 1), 40);
          return;
        }
        editor?.focus();
        this.focusing = false;
      },
      { injector: this.injector },
    );
  }

  /** Back to the one-line input when focus leaves an empty composer. */
  protected composerFocusOut(event: FocusEvent): void {
    const form = event.currentTarget as HTMLElement;
    if (this.focusing || this.posting() || form.contains(event.relatedTarget as Node | null))
      return;
    if (isBlankHtml(this.draft())) this.composerOpen.set(false);
  }

  /** Stores "seen now" (never before the newest comment) and returns it. */
  private markSeen(): number {
    const latest = latestOf(this.items());
    const at = Math.max(Date.now(), latest ? timeOf(latest) : 0);
    saveSeen(this.userId(), this.taskId(), at);
    return at;
  }

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

  /** The order inside the window only; the list is loaded newest first whatever it is, so nothing is requested again. */
  protected setOrder(newestFirst: boolean): void {
    this.newestFirst.set(newestFirst);
  }

  protected setLimit(value: string | CommentLimit): void {
    const next = COMMENT_LIMITS.find((l) => String(l) === String(value));
    if (next === undefined) return;
    this.revealAll.set(false);
    this.limit.set(next);
    saveLimit(this.limitKey(), next);
  }

  /** Appends the next page of a thread longer than the first one (the server caps a request at 200 comments). */
  protected async loadMore(): Promise<void> {
    if (this.loadingMore()) return;
    const taskId = this.taskId();
    this.loadingMore.set(true);
    this.moreError.set('');
    try {
      const list = await firstValueFrom(
        this.api.listTaskComments(taskId, true, this.items().length, COMMENTS_PAGE_SIZE),
      );
      // The thread changed while the page was on its way: that answer no longer fits.
      if (taskId !== this.taskId()) return;
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
      this.composerOpen.set(false);
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

  /** After the first load of a Task: new comments by others are announced; a first visit only starts the clock. */
  private firstVisit(): void {
    if (this.visited) return;
    this.visited = true;
    const n = this.newCount();
    if (n > 0) {
      this.announce.set(`${n} new comment${n === 1 ? '' : 's'}`);
    } else if (this.seenAt() === null) {
      this.markSeen();
    }
  }

  /**
   * Loads the first page and, with `keep` (after a post, edit or delete: the number on screen before), as many further pages as it takes to
   * show at least that many comments again. The first request carries no paging arguments: the server's default page is the first 200.
   */
  private async load(keep = 0): Promise<void> {
    const taskId = this.taskId();
    try {
      const first = await firstValueFrom(this.api.listTaskComments(taskId, true));
      let items = first.items;
      while (items.length < keep && items.length < first.total) {
        const next = await firstValueFrom(
          this.api.listTaskComments(taskId, true, items.length, COMMENTS_PAGE_SIZE),
        );
        if (next.items.length === 0) break;
        items = [...items, ...next.items];
      }
      if (taskId !== this.taskId()) return;
      this.items.set(items);
      this.total.set(first.total);
      this.moreError.set('');
      this.state.set('ready');
      this.countChange.emit(first.total);
      this.firstVisit();
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
