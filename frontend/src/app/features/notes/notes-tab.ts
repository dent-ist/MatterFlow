import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  AssetsClient,
  MattersClient,
  NoteHistoryEntry,
  NoteListItem,
  NoteResponse,
  NoteTagRef,
  NoteTagsClient,
  NoteTemplateResponse,
  NoteTemplatesClient,
  NotesClient,
  ProjectsClient,
  UsersLookupClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { MfDatePipe } from '../../shared/pipes/mf-date.pipe';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { DropdownItem, Dropdown } from '../../shared/ui/dropdown';
import { SearchBox } from '../../shared/ui/search-box';
import { SlidePanel } from '../../shared/ui/slide-panel';
import { TextField } from '../../shared/ui/text-field';
import { EmbedContent, NoteEditor, RefKind, SuggestItem } from './note-editor';
import {
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  clampSplit,
  dayHeading,
  lockUi,
  noteHistoryText,
  openPlaceholders,
  placeholderValues,
  resolvePlaceholders,
  titleOfHtml,
} from './note-ui';

type PanelKind = 'none' | 'tags' | 'history' | 'templates' | 'save-template' | 'template-read';

const SPLIT_KEY = 'mf.notes.split';
const MAX_TAGS = 5;

/**
 * The Notes tab of a Matter (epic #1001, MD-13 to MD-15; mockup notes-mockup-r3, owner decision AQ.9): the notes of the matter on the left (pinned first, then
 * last updated; tag, Locked and text filters), the open note on the right, and a draggable, keyboard-operable splitter between them. A note opens in
 * READ mode with an Edit button; Edit shows the toolbar and replaces it by Cancel and Save; New starts in edit mode. The title is the first line of the text.
 * Tags (firm-wide, chosen from the list an administrator keeps), history and templates open in the shared side panel; a locked note is read only for
 * everybody and shows why. The server sanitises the text and applies the sensitive-matter rule and the lock; this component follows the permissions
 * `MatterNote.Edit` and `MatterNote.Delete` only to hide or disable buttons.
 */
@Component({
  selector: 'mf-notes-tab',
  imports: [
    Button,
    ConfirmDialog,
    MfDatePipe,
    Dropdown,
    NoteEditor,
    SearchBox,
    SlidePanel,
    TextField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    .nt {
      display: flex;
      min-height: 0;
      height: 100%;
      gap: 0;
    }
    .nt__list {
      display: flex;
      flex-direction: column;
      flex: none;
      min-width: 0;
      min-height: 0;
      gap: var(--mf-s2);
    }
    .nt__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .nt__items {
      flex: 1 1 auto;
      min-height: 0;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .nt__item {
      display: block;
      width: 100%;
      padding: var(--mf-s2) var(--mf-s3);
      border: 0;
      border-bottom: 1px solid var(--mf-border);
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .nt__item:hover {
      background: var(--mf-surface-2, var(--mf-sem-neutral-bg));
    }
    .nt__item[aria-current='true'] {
      background: var(--mf-sem-info-bg, var(--mf-sem-neutral-bg));
    }
    .nt__title {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      font-weight: 600;
    }
    .nt__snip {
      display: block;
      overflow: hidden;
      color: var(--mf-text-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nt__meta {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .nt__split {
      flex: none;
      width: 8px;
      margin: 0 var(--mf-s1);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-border);
      cursor: col-resize;
      touch-action: none;
    }
    .nt__split:hover,
    .nt__split:focus-visible {
      background: var(--mf-primary);
    }
    .nt__pane {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      gap: var(--mf-s2);
    }
    .nt__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .nt__spacer {
      flex: 1 1 auto;
    }
    .nt__byline {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .nt__tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      align-items: center;
    }
    .nt__chip {
      display: inline-flex;
      align-items: center;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-sem-neutral-bg);
      color: var(--mf-sem-neutral-fg);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .nt__banner {
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-risk-solid);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-risk-bg);
      color: var(--mf-sem-risk-fg);
    }
    .nt__banner--info {
      border-color: var(--mf-border-strong);
      background: var(--mf-surface-2, var(--mf-sem-neutral-bg));
      color: var(--mf-text);
    }
    .nt__editor {
      flex: 1 1 auto;
      min-height: 0;
    }
    .nt__dirty {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--mf-sem-risk-solid);
    }
    .nt__empty {
      padding: var(--mf-s4);
      color: var(--mf-text-muted);
    }
    .nt__panel-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .nt__panel-list li {
      padding: var(--mf-s2) 0;
      border-bottom: 1px solid var(--mf-border);
      overflow-wrap: anywhere;
    }
    .nt__day {
      margin: var(--mf-s3) 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .nt__check {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s1) 0;
    }
    .nt__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    @media (max-width: 760px) {
      .nt {
        flex-direction: column;
      }
      .nt__list {
        width: 100% !important;
        max-height: 40%;
      }
      .nt__split {
        display: none;
      }
    }
  `,
  template: `
    <section class="nt" aria-label="Notes" data-notes-tab>
      <div class="nt__list" [style.width.px]="split()" data-notes-list>
        <div class="nt__bar">
          <mf-search-box
            inputId="nt-search"
            label="Search notes"
            [hideLabel]="true"
            [leadingIcon]="true"
            placeholder="Search notes"
            [value]="query()"
            (searchChange)="onSearch($event)"
          />
          <mf-dropdown
            buttonId="nt-tag"
            label="Tag"
            prefix="Tag: "
            size="sm"
            [items]="tagFilterItems()"
            [value]="tagFilter()"
            (valueChange)="onTag($event)"
          />
          <mf-dropdown
            buttonId="nt-locked"
            label="Locked"
            prefix="Show: "
            size="sm"
            [items]="lockedItems"
            [value]="lockedFilter()"
            (valueChange)="onLocked($event)"
          />
          @if (canEdit()) {
            <p-button
              label="New note"
              icon="pi pi-plus"
              size="small"
              data-new-note
              (onClick)="newNote()"
            />
            <p-button
              label="Templates"
              icon="pi pi-clone"
              severity="secondary"
              size="small"
              data-templates
              (onClick)="openTemplates()"
            />
          }
        </div>
        @if (listError()) {
          <p class="pg-reason" role="alert">
            {{ listError() }} <button type="button" (click)="loadList()">Try again</button>
          </p>
        } @else if (loaded() && items().length === 0) {
          <p class="nt__empty" data-notes-empty>
            {{ query() || tagFilter() || lockedFilter() ? 'No notes match.' : 'No notes yet.' }}
          </p>
        }
        <ul class="nt__items" aria-label="Notes of this matter">
          @for (n of items(); track n.noteId) {
            <li>
              <button
                type="button"
                class="nt__item"
                data-note-item
                [attr.aria-current]="isOpen(n.noteId)"
                (click)="open(n.noteId)"
              >
                <span class="nt__title">
                  @if (n.isPinned) {
                    <i class="pi pi-bookmark-fill" aria-hidden="true"></i
                    ><span class="mf-sr-only">Pinned. </span>
                  }
                  @if (n.isLocked) {
                    <i class="pi pi-lock" aria-hidden="true"></i
                    ><span class="mf-sr-only">Locked. </span>
                  }
                  {{ n.title }}
                </span>
                @if (n.snippet) {
                  <span class="nt__snip">{{ n.snippet }}</span>
                }
                @if (n.tags.length > 0) {
                  <span class="nt__tags">
                    @for (t of n.tags; track t.noteTagId) {
                      <span class="nt__chip">{{ t.name }}</span>
                    }
                  </span>
                }
                <span class="nt__meta"
                  >{{ n.updatedByName ?? 'Someone' }} on
                  {{ n.updatedAtUtc | mfDate: 'datetime' }}</span
                >
              </button>
            </li>
          }
        </ul>
      </div>

      <div
        class="nt__split"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the notes list"
        tabindex="0"
        [attr.aria-valuenow]="split()"
        [attr.aria-valuemin]="splitMin"
        [attr.aria-valuemax]="splitMax"
        data-notes-splitter
        (pointerdown)="dragStart($event)"
        (keydown)="splitKey($event)"
      ></div>

      <div class="nt__pane" data-note-pane>
        @if (draft(); as d) {
          <div class="nt__head">
            <h2 class="pg-sr">Note</h2>
            @if (editing()) {
              <p-button
                label="Cancel"
                severity="secondary"
                size="small"
                data-note-cancel
                (onClick)="cancel()"
              />
              @if (dirty()) {
                <span class="nt__dirty" role="img" aria-label="Unsaved changes"></span>
              }
              <span class="nt__spacer"></span>
              <p-button
                label="Tags"
                icon="pi pi-tag"
                severity="secondary"
                size="small"
                data-note-tags
                (onClick)="panel.set('tags')"
              />
              <p-button
                label="Save"
                icon="pi pi-check"
                size="small"
                [disabled]="busy()"
                data-note-save
                (onClick)="save()"
              />
            } @else if (note(); as n) {
              <span class="nt__byline" data-note-byline>
                Last updated by {{ n.updatedByName ?? 'someone' }} ·
                {{ n.updatedAtUtc | mfDate: 'datetime' }}
              </span>
              <span class="nt__spacer"></span>
              <p-button
                label="Edit"
                icon="pi pi-pencil"
                size="small"
                data-note-edit
                [disabled]="!lock().canEdit"
                [title]="lock().editReason"
                (onClick)="edit()"
              />
              @if (canEdit()) {
                <p-button
                  [label]="n.isPinned ? 'Unpin' : 'Pin'"
                  icon="pi pi-bookmark"
                  severity="secondary"
                  size="small"
                  data-note-pin
                  (onClick)="togglePin()"
                />
                @if (n.isLocked) {
                  <p-button
                    label="Unlock"
                    icon="pi pi-lock-open"
                    severity="secondary"
                    size="small"
                    data-note-unlock
                    [disabled]="!lock().canUnlock"
                    [title]="lock().unlockReason"
                    (onClick)="unlock()"
                  />
                } @else {
                  <p-button
                    label="Lock"
                    icon="pi pi-lock"
                    severity="secondary"
                    size="small"
                    data-note-lock
                    (onClick)="lockNote()"
                  />
                }
              }
              <p-button
                label="History"
                icon="pi pi-history"
                severity="secondary"
                size="small"
                data-note-history
                (onClick)="openHistory()"
              />
              @if (canEdit()) {
                <p-button
                  label="Save as template"
                  icon="pi pi-clone"
                  severity="secondary"
                  size="small"
                  data-note-save-template
                  (onClick)="openSaveTemplate()"
                />
              }
              @if (canDelete()) {
                <p-button
                  label="Delete"
                  icon="pi pi-trash"
                  severity="danger"
                  [outlined]="true"
                  size="small"
                  data-note-delete
                  [disabled]="n.isLocked"
                  [title]="n.isLocked ? lock().editReason : ''"
                  (onClick)="confirmDelete.set(true)"
                />
              }
            }
          </div>
          @if (!editing() && note(); as n) {
            @if (n.isLocked) {
              <p class="nt__banner nt__banner--info" role="status" data-note-locked>
                <i class="pi pi-lock" aria-hidden="true"></i> Locked by
                {{ n.lockedByName ?? 'someone' }}
                @if (n.lockedAtUtc) {
                  · {{ n.lockedAtUtc | mfDate: 'datetime' }}
                }
                . It is read only for everybody until it is unlocked.
              </p>
            }
          }
          @if (lockedWhileEditing()) {
            <div class="nt__banner" role="alert" data-note-locked-warning>
              This note was locked by {{ lockedWhileEditing() }}; your changes cannot be saved.
              <span class="nt__actions">
                <p-button
                  label="Copy my text"
                  size="small"
                  severity="secondary"
                  (onClick)="copyMine()"
                />
                <p-button
                  label="Close"
                  size="small"
                  severity="secondary"
                  data-note-locked-close
                  (onClick)="closeLockedWarning()"
                />
              </span>
            </div>
          }
          @if (saveError()) {
            <p class="nt__banner" role="alert" data-note-error>{{ saveError() }}</p>
          }
          <div class="nt__tags" aria-label="Tags" data-note-tag-chips>
            @for (t of draftTags(); track t.noteTagId) {
              <span class="nt__chip">{{ t.name }}</span>
            } @empty {
              @if (editing()) {
                <span class="nt__byline">No tags. Use Tags to add some.</span>
              }
            }
          </div>
          <div class="nt__editor">
            @defer (on immediate) {
              <mf-note-editor
                #editor
                [html]="d.html"
                [contentKey]="d.key"
                [editable]="editing()"
                [source]="source"
                [embedSource]="embedSource"
                (changed)="onChanged($event)"
                (ready)="onEditorReady()"
              />
            } @placeholder {
              <p class="nt__empty" role="status">Loading the editor...</p>
            }
          </div>
        } @else {
          <p class="nt__empty" data-note-none>
            {{
              loaded() && items().length === 0
                ? 'Create the first note of this matter.'
                : 'Choose a note to read it.'
            }}
          </p>
        }
      </div>
    </section>

    <!-- Tags: the firm-wide list; people only pick -->
    <mf-slide-panel
      title="Tags"
      subtitle="Up to five per note. Tags are kept by an administrator."
      primaryLabel="Done"
      secondaryLabel="Close"
      [visible]="panel() === 'tags'"
      (visibleChange)="!$event && panel.set('none')"
      (submitted)="panel.set('none')"
    >
      @for (t of allTags(); track t.noteTagId) {
        <label class="nt__check">
          <input
            type="checkbox"
            [checked]="hasTag(t.noteTagId)"
            [disabled]="!editing() || (!hasTag(t.noteTagId) && selectedTags().length >= maxTags)"
            (change)="toggleTag(t)"
          />
          <span class="nt__chip">{{ t.name }}</span>
        </label>
      } @empty {
        <p class="nt__byline">No tags exist yet. An administrator creates them under Labels.</p>
      }
      @if (!editing()) {
        <p class="nt__byline">Press Edit to change the tags of this note.</p>
      }
    </mf-slide-panel>

    <!-- History -->
    <mf-slide-panel
      title="History"
      subtitle="Who did what and when. No versions."
      secondaryLabel="Close"
      [showFooter]="true"
      primaryLabel="Close"
      [visible]="panel() === 'history'"
      (visibleChange)="!$event && panel.set('none')"
      (submitted)="panel.set('none')"
    >
      <div data-note-history-list>
        @for (g of historyGroups(); track g.day) {
          <h3 class="nt__day">{{ g.day }}</h3>
          <ul class="nt__panel-list">
            @for (h of g.entries; track h.auditEventId) {
              <li>
                <b>{{ h.actorName ?? 'Someone' }}</b> {{ historyText(h) }}
                <span class="nt__meta">{{ h.occurredAtUtc | mfDate: 'datetime' }}</span>
              </li>
            }
          </ul>
        } @empty {
          <p class="nt__byline">No history yet.</p>
        }
      </div>
    </mf-slide-panel>

    <!-- Templates -->
    <mf-slide-panel
      title="Templates"
      subtitle="Using a template copies it into a new note."
      primaryLabel="Close"
      secondaryLabel="Close"
      size="large"
      [visible]="panel() === 'templates'"
      (visibleChange)="!$event && panel.set('none')"
      (submitted)="panel.set('none')"
    >
      <ul class="nt__panel-list" data-template-list>
        @for (t of templates(); track t.noteTemplateId) {
          <li>
            <b>{{ t.name }}</b>
            <span class="nt__chip">{{ t.scope === 'FIRM' ? 'Firm-wide' : 'This matter' }}</span>
            @if (t.description) {
              <span class="nt__meta">{{ t.description }}</span>
            }
            <span class="nt__meta">Used {{ t.usedCount }} times</span>
            <span class="nt__actions">
              <p-button label="Use" size="small" data-template-use (onClick)="useTemplate(t)" />
              <p-button
                label="Duplicate"
                size="small"
                severity="secondary"
                (onClick)="duplicateTemplate(t)"
              />
              @if (t.canEdit) {
                <p-button
                  label="Delete"
                  size="small"
                  severity="danger"
                  [outlined]="true"
                  (onClick)="deleteTemplate(t)"
                />
              }
            </span>
          </li>
        } @empty {
          <li class="nt__byline">No templates yet. Open a note and use Save as template.</li>
        }
      </ul>
    </mf-slide-panel>

    <mf-slide-panel
      title="Save as template"
      primaryLabel="Save template"
      [busy]="busy()"
      [error]="tplError()"
      [visible]="panel() === 'save-template'"
      (visibleChange)="!$event && panel.set('none')"
      (submitted)="saveTemplate()"
    >
      @if (panel() === 'save-template') {
        <div class="nt__panel-form">
          <mf-text-field
            inputId="tpl-name"
            label="Name"
            [required]="true"
            [maxLength]="100"
            [(value)]="tplName"
          />
          <mf-text-field
            inputId="tpl-desc"
            label="Description"
            [maxLength]="160"
            [(value)]="tplDescription"
          />
          @if (isAdmin()) {
            <label class="nt__check"
              ><input
                type="checkbox"
                [checked]="tplFirm()"
                (change)="tplFirm.set($any($event.target).checked)"
              />
              Firm-wide (everyone can use it)</label
            >
          }
          <label class="nt__check"
            ><input
              type="checkbox"
              [checked]="tplTags()"
              (change)="tplTags.set($any($event.target).checked)"
            />
            Include the tags of this note</label
          >
        </div>
      }
    </mf-slide-panel>

    <mf-confirm-dialog
      title="Delete this note?"
      confirmLabel="Delete note"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="confirmDelete"
      (confirmed)="deleteNote()"
    >
      <p>
        {{ note()?.title }} will be deleted for good. The history keeps a line that it was deleted.
      </p>
    </mf-confirm-dialog>
    <mf-confirm-dialog
      title="Discard your changes?"
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      [danger]="true"
      [(visible)]="confirmDiscard"
      (confirmed)="proceedDiscard()"
    >
      <p>The changes to this note have not been saved.</p>
    </mf-confirm-dialog>
  `,
})
export class NotesTab {
  private readonly notesApi = inject(NotesClient);
  private readonly tagsApi = inject(NoteTagsClient);
  private readonly templatesApi = inject(NoteTemplatesClient);
  private readonly assetsApi = inject(AssetsClient);
  private readonly projectsApi = inject(ProjectsClient);
  private readonly mattersApi = inject(MattersClient);
  private readonly usersApi = inject(UsersLookupClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly editorRef = viewChild<NoteEditor>('editor');

  /** The matter whose notes are shown, and its reference and name for the template placeholder `{{matter}}`. */
  readonly matterId = input.required<number>();
  readonly matterLabel = input('');
  /**
   * The seam for the AI policy check of MD-16 (flag off in release 1, so nothing is passed today): called before a note is saved. `proceed: false` stops the save
   * (the person chose Edit in the warning dialog); `ackWarnings` and `reasons` are sent with the save and written to the note history ("saved after an AI warning").
   */
  readonly beforeSave = input<
    | ((html: string) => Promise<{ proceed: boolean; ackWarnings?: string[]; reasons?: string[] }>)
    | null
  >(null);

  protected readonly splitMin = SPLIT_MIN;
  protected readonly splitMax = SPLIT_MAX;
  protected readonly maxTags = MAX_TAGS;
  protected readonly historyText = noteHistoryText;
  protected readonly lockedItems: DropdownItem[] = [
    { value: '', label: 'All notes' },
    { value: 'true', label: 'Locked' },
    { value: 'false', label: 'Not locked' },
  ];

  protected readonly items = signal<NoteListItem[]>([]);
  protected readonly loaded = signal(false);
  protected readonly listError = signal('');
  protected readonly query = signal('');
  protected readonly tagFilter = signal('');
  protected readonly lockedFilter = signal('');
  protected readonly allTags = signal<NoteTagRef[]>([]);
  protected readonly split = signal(this.readSplit());

  protected readonly note = signal<NoteResponse | null>(null);
  /** What the right-hand side shows: the html to start the editor from, and a key that says "this is a different note". */
  protected readonly draft = signal<{ html: string; key: string } | null>(null);
  protected readonly editing = signal(false);
  protected readonly selectedTags = signal<NoteTagRef[]>([]);
  private readonly currentHtml = signal('');
  private readonly startedHtml = signal('');
  private readonly startedTags = signal('');
  protected readonly busy = signal(false);
  protected readonly saveError = signal('');
  protected readonly lockedWhileEditing = signal('');
  protected readonly panel = signal<PanelKind>('none');
  protected readonly history = signal<NoteHistoryEntry[]>([]);
  protected readonly templates = signal<NoteTemplateResponse[]>([]);
  protected readonly confirmDelete = signal(false);
  protected readonly confirmDiscard = signal(false);
  private pendingAfterDiscard: (() => void) | null = null;

  protected tplName = signal('');
  protected tplDescription = signal('');
  protected readonly tplFirm = signal(false);
  protected readonly tplTags = signal(true);
  protected readonly tplError = signal('');

  protected readonly canEdit = computed(() => this.auth.has('MatterNote.Edit'));
  protected readonly canDelete = computed(() => this.auth.has('MatterNote.Delete'));
  protected readonly isAdmin = computed(() => this.auth.isSystemAdmin());
  protected readonly lock = computed(() => {
    const n = this.note();
    return lockUi(
      n ?? { isLocked: false },
      this.auth.profile()?.userId ?? null,
      this.isAdmin(),
      this.canEdit(),
    );
  });
  protected readonly dirty = computed(
    () =>
      this.editing() &&
      (this.currentHtml() !== this.startedHtml() || this.tagKey() !== this.startedTags()),
  );
  protected readonly draftTags = computed<NoteTagRef[]>(() =>
    this.editing() ? this.selectedTags() : (this.note()?.tags ?? []),
  );
  protected readonly tagFilterItems = computed<DropdownItem[]>(() => [
    { value: '', label: 'All tags' },
    ...this.allTags().map((t) => ({ value: String(t.noteTagId), label: t.name })),
  ]);
  protected readonly historyGroups = computed(() => {
    const now = new Date();
    const groups: { day: string; entries: NoteHistoryEntry[] }[] = [];
    for (const e of this.history()) {
      const day = dayHeading(e.occurredAtUtc, now);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.entries.push(e);
      else groups.push({ day, entries: [e] });
    }
    return groups;
  });

  /** The menu of `@`, `#` and the slash commands searches the API for the open note's matter. */
  protected readonly source = async (kind: RefKind, q: string): Promise<SuggestItem[]> => {
    const matterId = this.matterId();
    try {
      switch (kind) {
        case 'user': {
          const users = await firstValueFrom(this.usersApi.lookupUsers(q, 8));
          return users.map((u) => ({
            kind: 'user' as const,
            id: u.userId,
            label: u.displayName,
            sub: u['email'] ?? undefined,
          }));
        }
        case 'asset': {
          const assets = await firstValueFrom(this.assetsApi.lookupAssets(matterId, q, false, 8));
          return assets.map((a) => ({
            kind: 'asset' as const,
            id: a.assetId,
            label: a.displayName,
            sub: a.assetTypeName,
          }));
        }
        case 'project': {
          const projects = await firstValueFrom(
            this.projectsApi.listProjects(
              q || undefined,
              matterId,
              true,
              undefined,
              undefined,
              undefined,
              undefined,
              1,
              8,
            ),
          );
          return projects.items.map((p) => ({
            kind: 'project' as const,
            id: p.projectId,
            label: p.name,
          }));
        }
        case 'matter': {
          const matters = await firstValueFrom(
            this.mattersApi.listMatters(
              q || undefined,
              undefined,
              true,
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
              1,
              8,
            ),
          );
          return matters.items.map((m) => ({
            kind: 'matter' as const,
            id: m.matterId,
            label: m.name,
            sub: m.matterRef,
          }));
        }
        default: {
          const notes = await firstValueFrom(
            this.notesApi.listNotes(matterId, undefined, undefined, q || undefined, 1, 8),
          );
          return notes.items
            .filter((n) => n.noteId !== this.note()?.noteId)
            .map((n) => ({
              kind: kind === 'embed' ? ('embed' as const) : ('note' as const),
              id: n.noteId,
              label: n.title,
            }));
        }
      }
    } catch {
      return [];
    }
  };

  /** The inline `/note` block: the other note's title and text, through the resolver (which answers Restricted or Removed for what the viewer may not see). */
  protected readonly embedSource = async (noteId: number): Promise<EmbedContent | null> => {
    try {
      const result = await firstValueFrom(
        this.notesApi.resolveNoteReferences({
          matterId: this.matterId(),
          references: [{ kind: 'embed', id: noteId }],
        }),
      );
      const item = result.items[0];
      return item?.state === 'Ok' || item?.state === 'Inactive'
        ? { title: item.label ?? '', html: item.bodyHtml ?? '' }
        : null;
    } catch {
      return null;
    }
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopDrag());
    effect(() => {
      this.matterId();
      this.query();
      this.tagFilter();
      this.lockedFilter();
      untracked(() => void this.loadList());
    });
    effect(() => {
      this.matterId();
      untracked(() => void this.loadTags());
    });
  }

  protected tagKey(): string {
    return this.selectedTags()
      .map((t) => t.noteTagId)
      .sort((a, b) => a - b)
      .join(',');
  }

  protected isOpen(id: number): 'true' | null {
    return this.note()?.noteId === id ? 'true' : null;
  }

  protected hasTag(id: number): boolean {
    return this.selectedTags().some((t) => t.noteTagId === id);
  }

  // ---------------------------------------------------------------- list

  protected onSearch(value: string): void {
    this.query.set(value.trim());
  }

  protected onTag(value: string): void {
    this.tagFilter.set(value);
  }

  protected onLocked(value: string): void {
    this.lockedFilter.set(value);
  }

  protected async loadList(): Promise<void> {
    try {
      const tag = this.tagFilter();
      const locked = this.lockedFilter();
      const result = await firstValueFrom(
        this.notesApi.listNotes(
          this.matterId(),
          tag ? [Number(tag)] : undefined,
          locked === '' ? undefined : locked === 'true',
          this.query() || undefined,
          1,
          100,
        ),
      );
      this.items.set(result.items);
      this.listError.set('');
    } catch {
      this.listError.set('The notes could not be loaded.');
    } finally {
      this.loaded.set(true);
    }
  }

  private async loadTags(): Promise<void> {
    try {
      const tags = await firstValueFrom(this.tagsApi.listNoteTags(false));
      this.allTags.set(
        tags.map((t) => ({
          noteTagId: t.noteTagId,
          name: t.name,
          colourKey: t.colourKey,
          isActive: t.isActive,
        })),
      );
    } catch {
      this.allTags.set([]);
    }
  }

  // ---------------------------------------------------------------- open, edit, save

  /** Run `go`, after asking when there are unsaved changes. */
  private guard(go: () => void): void {
    if (this.dirty()) {
      this.pendingAfterDiscard = go;
      this.confirmDiscard.set(true);
    } else {
      go();
    }
  }

  protected open(id: number): void {
    if (this.note()?.noteId === id && !this.editing()) return;
    this.guard(() => void this.openNow(id));
  }

  private async openNow(id: number): Promise<void> {
    try {
      const n = await firstValueFrom(this.notesApi.getNote(id));
      this.showNote(n);
    } catch (e) {
      this.notify.error(
        e instanceof ApiError && e.status === 404
          ? 'That note is no longer available.'
          : 'The note could not be loaded.',
      );
      void this.loadList();
    }
  }

  private showNote(n: NoteResponse): void {
    this.note.set(n);
    this.editing.set(false);
    this.saveError.set('');
    this.lockedWhileEditing.set('');
    this.currentHtml.set(n.bodyHtml);
    this.startedHtml.set(n.bodyHtml);
    this.selectedTags.set([...n.tags]);
    this.startedTags.set(this.tagKey());
    this.draft.set({ html: n.bodyHtml, key: `${n.noteId}:${n.rowVersion}` });
  }

  protected newNote(): void {
    this.guard(() => this.startNew('', []));
  }

  private startNew(html: string, tags: NoteTagRef[]): void {
    this.note.set(null);
    this.saveError.set('');
    this.lockedWhileEditing.set('');
    this.currentHtml.set(html);
    this.startedHtml.set('');
    this.selectedTags.set(tags);
    this.startedTags.set('');
    this.draft.set({ html, key: `new:${Date.now()}` });
    this.editing.set(true);
  }

  protected edit(): void {
    if (!this.lock().canEdit) return;
    this.startedHtml.set(this.currentHtml());
    this.editing.set(true);
    this.saveError.set('');
  }

  protected onEditorReady(): void {
    if (this.editing()) queueMicrotask(() => this.editorRef()?.focus());
  }

  protected onChanged(html: string): void {
    this.currentHtml.set(html);
  }

  protected cancel(): void {
    if (this.dirty()) {
      this.pendingAfterDiscard = () => this.restore();
      this.confirmDiscard.set(true);
    } else {
      this.restore();
    }
  }

  /** Back to the saved note in read mode, or to an empty pane when it was a new note. */
  private restore(): void {
    const n = this.note();
    if (n) {
      this.showNote(n);
    } else {
      this.editing.set(false);
      this.draft.set(null);
    }
  }

  /** The answer "Discard changes" of the confirmation: drop the edits, then do what was waiting (cancel, open another note, new note). */
  protected proceedDiscard(): void {
    this.confirmDiscard.set(false);
    const go = this.pendingAfterDiscard;
    this.pendingAfterDiscard = null;
    this.editing.set(false);
    this.currentHtml.set(this.startedHtml());
    go?.();
  }

  protected async save(): Promise<void> {
    const html = this.editorRef()?.getHtml() ?? this.currentHtml();
    const check = await this.beforeSave()?.(html);
    if (check && !check.proceed) return;
    this.busy.set(true);
    this.saveError.set('');
    try {
      const tagIds = this.selectedTags().map((t) => t.noteTagId);
      const n = this.note();
      const saved = n
        ? await firstValueFrom(
            this.notesApi.updateNote(n.noteId, {
              bodyHtml: html,
              tagIds,
              rowVersion: n.rowVersion,
            } as never),
          )
        : await firstValueFrom(
            this.notesApi.createNote({
              matterId: this.matterId(),
              bodyHtml: html,
              tagIds,
            } as never),
          );
      this.notify.success(n ? 'Note saved' : 'Note created');
      this.showNote(saved);
      await this.loadList();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NOTE_LOCKED') {
        const who = (e.problem?.meta?.['lockedByName'] as string | undefined) ?? 'someone';
        this.lockedWhileEditing.set(who);
      } else if (e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT') {
        this.saveError.set(
          'Someone else changed this note while you were editing. Copy your text, reopen the note and add your changes again.',
        );
      } else if (e instanceof ApiError && e.hasFieldErrors) {
        this.saveError.set(Object.values(e.problem?.errors ?? {})[0]?.[0]?.message ?? e.message);
      } else {
        this.saveError.set(
          e instanceof ApiError ? e.message : 'The note could not be saved. Try again.',
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async copyMine(): Promise<void> {
    const text = titleOfHtml(this.currentHtml()) ? this.currentHtml().replace(/<[^>]+>/g, ' ') : '';
    try {
      await navigator.clipboard.writeText(text.replace(/\s+/g, ' ').trim());
      this.notify.success('Your text was copied');
    } catch {
      this.notify.warn('Copying is not allowed here. Select your text and copy it by hand.');
    }
  }

  protected closeLockedWarning(): void {
    this.lockedWhileEditing.set('');
    const n = this.note();
    if (n) void this.openNow(n.noteId);
  }

  protected toggleTag(tag: NoteTagRef): void {
    if (!this.editing()) return;
    this.selectedTags.update((list) =>
      list.some((t) => t.noteTagId === tag.noteTagId)
        ? list.filter((t) => t.noteTagId !== tag.noteTagId)
        : list.length < MAX_TAGS
          ? [...list, tag]
          : list,
    );
  }

  // ---------------------------------------------------------------- pin, lock, delete

  protected async togglePin(): Promise<void> {
    const n = this.note();
    if (!n) return;
    await this.change(() =>
      firstValueFrom(
        this.notesApi.setNotePinned(n.noteId, { pinned: !n.isPinned, rowVersion: n.rowVersion }),
      ),
    );
  }

  protected async lockNote(): Promise<void> {
    const n = this.note();
    if (n)
      await this.change(() =>
        firstValueFrom(this.notesApi.lockNote(n.noteId, { rowVersion: n.rowVersion })),
      );
  }

  protected async unlock(): Promise<void> {
    const n = this.note();
    if (n)
      await this.change(() =>
        firstValueFrom(this.notesApi.unlockNote(n.noteId, { rowVersion: n.rowVersion })),
      );
  }

  private async change(call: () => Promise<NoteResponse>): Promise<void> {
    try {
      this.showNote(await call());
      await this.loadList();
    } catch (e) {
      this.notify.error(e instanceof ApiError ? e.message : 'That did not work. Try again.');
      const n = this.note();
      if (n) void this.openNow(n.noteId);
    }
  }

  protected async deleteNote(): Promise<void> {
    const n = this.note();
    if (!n) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.notesApi.deleteNote(n.noteId, n.rowVersion));
      this.confirmDelete.set(false);
      this.note.set(null);
      this.draft.set(null);
      this.notify.success('Note deleted');
      await this.loadList();
    } catch (e) {
      this.confirmDelete.set(false);
      this.notify.error(e instanceof ApiError ? e.message : 'The note could not be deleted.');
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- history, templates

  protected async openHistory(): Promise<void> {
    const n = this.note();
    if (!n) return;
    this.panel.set('history');
    try {
      this.history.set((await firstValueFrom(this.notesApi.getNoteHistory(n.noteId))).items);
    } catch {
      this.history.set([]);
      this.notify.error('The history could not be loaded.');
    }
  }

  protected async openTemplates(): Promise<void> {
    this.panel.set('templates');
    await this.loadTemplates();
  }

  private async loadTemplates(): Promise<void> {
    try {
      this.templates.set(
        await firstValueFrom(this.templatesApi.listNoteTemplates(this.matterId())),
      );
    } catch {
      this.templates.set([]);
      this.notify.error('The templates could not be loaded.');
    }
  }

  /** Copies the template into a new note: the placeholders {{date}}, {{time}}, {{matter}} and {{author}} are filled in; others stay for the person. */
  protected useTemplate(t: NoteTemplateResponse): void {
    this.guard(async () => {
      const values = placeholderValues(new Date(), this.matterLabel(), this.auth.displayName());
      const title = t.titleTemplate
        ? `<h1>${resolvePlaceholders(escapeText(t.titleTemplate), values)}</h1>`
        : '';
      const html = title + resolvePlaceholders(t.bodyHtml, values);
      this.panel.set('none');
      this.startNew(
        html,
        t.tags.filter((x) => x.isActive),
      );
      try {
        await firstValueFrom(this.templatesApi.useNoteTemplate(t.noteTemplateId));
      } catch {
        // The count is a convenience; the note is already open.
      }
      const open = openPlaceholders(html);
      if (open.length > 0) this.notify.info(`Fill in: ${open.join(', ')}`);
    });
  }

  protected async duplicateTemplate(t: NoteTemplateResponse): Promise<void> {
    try {
      await firstValueFrom(
        this.templatesApi.duplicateNoteTemplate(t.noteTemplateId, {
          matterId: this.matterId(),
          keepFirmScope: false,
        }),
      );
      await this.loadTemplates();
    } catch (e) {
      this.notify.error(e instanceof ApiError ? e.message : 'The template could not be copied.');
    }
  }

  protected async deleteTemplate(t: NoteTemplateResponse): Promise<void> {
    try {
      await firstValueFrom(this.templatesApi.deleteNoteTemplate(t.noteTemplateId, t.rowVersion));
      await this.loadTemplates();
    } catch (e) {
      this.notify.error(e instanceof ApiError ? e.message : 'The template could not be deleted.');
    }
  }

  protected openSaveTemplate(): void {
    const n = this.note();
    if (!n) return;
    this.tplName.set(n.title);
    this.tplDescription.set('');
    this.tplFirm.set(false);
    this.tplTags.set(true);
    this.tplError.set('');
    this.panel.set('save-template');
  }

  protected async saveTemplate(): Promise<void> {
    const n = this.note();
    if (!n) return;
    if (!this.tplName().trim()) {
      this.tplError.set('Enter a name.');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.templatesApi.createNoteTemplate({
          scope: this.tplFirm() && this.isAdmin() ? 'FIRM' : 'MATTER',
          matterId: this.tplFirm() && this.isAdmin() ? undefined : this.matterId(),
          name: this.tplName().trim(),
          description: this.tplDescription().trim() || undefined,
          bodyHtml: n.bodyHtml,
          tagIds: this.tplTags() ? n.tags.filter((t) => t.isActive).map((t) => t.noteTagId) : [],
        } as never),
      );
      this.panel.set('none');
      this.notify.success('Template saved');
    } catch (e) {
      this.tplError.set(e instanceof ApiError ? e.message : 'The template could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- splitter

  private dragMove: ((e: PointerEvent) => void) | null = null;
  private dragEnd: (() => void) | null = null;

  protected dragStart(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.split();
    this.dragMove = (e) => this.split.set(clampSplit(startWidth + e.clientX - startX));
    this.dragEnd = () => {
      this.stopDrag();
      this.saveSplit();
    };
    window.addEventListener('pointermove', this.dragMove);
    window.addEventListener('pointerup', this.dragEnd);
  }

  private stopDrag(): void {
    if (this.dragMove) window.removeEventListener('pointermove', this.dragMove);
    if (this.dragEnd) window.removeEventListener('pointerup', this.dragEnd);
    this.dragMove = null;
    this.dragEnd = null;
  }

  /** Arrow keys move the splitter by 20 px (100 px with Shift); Home and End go to the limits. Keys of the widget, not app shortcuts (#420). */
  protected splitKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 100 : 20;
    const next =
      e.key === 'ArrowLeft'
        ? this.split() - step
        : e.key === 'ArrowRight'
          ? this.split() + step
          : e.key === 'Home'
            ? SPLIT_MIN
            : e.key === 'End'
              ? SPLIT_MAX
              : null;
    if (next === null) return;
    e.preventDefault();
    this.split.set(clampSplit(next));
    this.saveSplit();
  }

  private readSplit(): number {
    try {
      return clampSplit(Number(localStorage.getItem(SPLIT_KEY) ?? SPLIT_DEFAULT));
    } catch {
      return SPLIT_DEFAULT;
    }
  }

  private saveSplit(): void {
    try {
      localStorage.setItem(SPLIT_KEY, String(this.split()));
    } catch {
      // Remembering the width is a convenience.
    }
  }
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
