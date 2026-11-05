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
  ElementRef,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AssetsClient,
  MatterAiAllowed,
  MattersClient,
  NoteHistoryEntry,
  NoteListItem,
  NoteReferenceResolution,
  NoteResponse,
  NoteTagResponse,
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
import { taskTypeChipColours } from '../../shared/task-type/task-type-colours';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { Dropdown, DropdownItem } from '../../shared/ui/dropdown';
import { AiButton, AiComingSoon } from '../../shared/ui/ai/ai-assist';
import { NumericDatePipe } from '../../shared/ui/numeric-date';
import { SearchBox } from '../../shared/ui/search-box';
import { FormDialog } from '../../shared/ui/form-dialog';
import { SlidePanel } from '../../shared/ui/slide-panel';
import { StateBlock } from '../../shared/ui/state-block';
import { TextField } from '../../shared/ui/text-field';
import { EmbedContent, NoteEditor, RefInfo, SuggestItem, SuggestKind } from './note-editor';
import { NoteTagChip } from './note-tag-chip';
import {
  NoteSort,
  SPLIT_DEFAULT,
  SPLIT_MIN,
  SPLIT_STEP,
  avatarKey,
  clampSplit,
  dayHeading,
  groupByTag,
  initialsOf,
  lockUi,
  noteHistoryText,
  openPlaceholders,
  placeholderValues,
  resolvePlaceholders,
  sortNotes,
  splitLimit,
  titleOfHtml,
  withoutTitleBlock,
} from './note-ui';
import { formatAgo } from '../../shared/ui/number-format';
import { IntPipe } from '../../shared/ui/number-format';

type PanelKind = 'none' | 'tags' | 'history' | 'refs' | 'save-template';
type NoteView = 'tag' | 'latest' | 'templates';
type TagRow = NoteTagResponse & { noteTagId: number };

const SPLIT_KEY = 'mf.notes.split';
const MAX_TAGS = 5;
const HIST_OPEN_KEY = 'mf.notes.hist';
const HIST_WIDTH_KEY = 'mf.notes.histw';
const VIEW_KEY = 'mf.notes.view';
const REF_KINDS = ['asset', 'project', 'matter', 'note'] as const;
const REF_TITLES: Record<string, string> = {
  asset: 'Assets',
  project: 'Projects',
  matter: 'Matters',
  note: 'Notes',
};
const REF_ICONS: Record<string, string> = {
  asset: 'pi-database',
  project: 'pi-folder',
  matter: 'pi-briefcase',
  note: 'pi-file',
};

interface RefChip {
  kind: string;
  id: number;
  label: string;
  state: string;
  stateText: string;
}

/**
 * The Notes tab of a Matter (epic #1001; MD-13 to MD-15 and MD-27 / #1031; the design is notes-mockup-r3, parity checklist docs/ux/matter-detail/notes-parity.md,
 * owner decisions AQ.9 and AQ.10): one card with a header row (count, search, tag filter, view switch By tag / Latest / Templates, sort, New note), the notes
 * of the matter on the left (grouped by tag, pinned first, with a resizable splitter) and the open note on the right. A note opens in READ mode with an Edit button;
 * Edit shows the toolbar and replaces the buttons by Cancel (left) and Save (right); New starts in edit mode. The title is the first line of the text. Tags (firm-wide,
 * chosen from the list an administrator keeps), history (a column, a rail or a side panel) and the template forms open in the shared side panel; a locked note is read
 * only for everybody and says why. The server sanitises the text and applies the sensitive-matter rule and the lock; this component follows the permissions
 * `MatterNote.Edit` and `MatterNote.Delete` only to hide or disable buttons.
 */
@Component({
  selector: 'mf-notes-tab',
  imports: [
    IntPipe,
    AiButton,
    AiComingSoon,
    ConfirmDialog,
    Dropdown,
    FormDialog,
    NgTemplateOutlet,
    NoteEditor,
    NoteTagChip,
    NumericDatePipe,
    RouterLink,
    SearchBox,
    SlidePanel,
    StateBlock,
    TextField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill', '(keydown)': 'onKey($event)' },
  styleUrls: [
    './notes-tab.scss',
    './notes-tab-views.scss',
    './notes-tab-panel.scss',
    './notes-tab-tpl.scss',
    './notes-tab-misc.scss',
  ],
  template: `
    <section
      class="nt"
      #card
      aria-label="Notes"
      data-notes-tab
      [class.nt--stacked]="stacked()"
      [class.nt--wide]="wide()"
      [class.nt--tight]="cardWidth() > 0 && cardWidth() <= 1120"
      [class.nt--tighter]="cardWidth() > 0 && cardWidth() <= 1000"
    >
      <div class="nt__body">
        <!-- the list -->
        @if (showList()) {
          <div
            class="nt__list"
            [class.nt__list--full]="stacked() || !showPanel()"
            [style.width.px]="stacked() || !showPanel() ? null : listWidth()"
            data-notes-list
          >
            <div class="nt__lc" data-notes-controls>
              <div class="nt__lc1">
                <mf-search-box
                  class="nt__search"
                  inputId="nt-search"
                  [label]="
                    view() === 'templates' ? 'Search templates' : 'Search notes by title and text'
                  "
                  [hideLabel]="true"
                  [hintOnFocus]="true"
                  [leadingIcon]="true"
                  [compact]="true"
                  [placeholder]="
                    view() === 'templates' ? 'Search templates' : 'Search title and text'
                  "
                  [value]="query()"
                  (searchChange)="onSearch($event)"
                />
                @if (canEdit()) {
                  <button
                    type="button"
                    class="mf-btn mf-btn--primary"
                    data-new-note
                    (click)="newNote()"
                  >
                    <i class="pi pi-plus" aria-hidden="true"></i><span>New Note</span>
                  </button>
                }
              </div>
              <div class="nt__lc2">
                <div class="nt__seg" role="group" aria-label="Notes view" data-notes-views>
                  @for (v of views; track v.id) {
                    <button
                      type="button"
                      [attr.data-view]="v.id"
                      [attr.aria-pressed]="view() === v.id"
                      [attr.aria-label]="v.label"
                      [title]="v.label"
                      (click)="setView(v.id)"
                    >
                      <i class="pi" [class]="v.icon" aria-hidden="true"></i
                      ><span class="nt__lbl">{{ v.short }}</span>
                    </button>
                  }
                </div>
                @if (view() !== 'templates') {
                  <span class="nt__vo">
                    <button
                      type="button"
                      class="mf-btn"
                      data-view-options
                      aria-haspopup="menu"
                      [attr.aria-expanded]="viewOptionsOpen()"
                      (click)="toggleViewOptions()"
                    >
                      <i class="pi pi-sliders-h" aria-hidden="true"></i>View Options
                    </button>
                    @if (viewOptionsOpen()) {
                      <ul
                        class="nt__menu nt__menu--left"
                        role="menu"
                        aria-label="View options"
                        tabindex="-1"
                        data-view-options-menu
                        (keydown)="menuNav($event)"
                      >
                        <li role="presentation" class="nt__mh">Sort</li>
                        @for (o of sortItems; track o.value) {
                          <li role="none">
                            <button
                              type="button"
                              class="mf-btn mf-btn--text nt__mi"
                              role="menuitemradio"
                              [attr.aria-checked]="sortValue() === o.value"
                              (click)="sortValue.set(o.value)"
                            >
                              <i
                                class="pi"
                                [class]="sortValue() === o.value ? 'pi-check' : 'nt__blank'"
                                aria-hidden="true"
                              ></i
                              >{{ o.label }}
                            </button>
                          </li>
                        }
                        <li role="separator" class="nt__sep"></li>
                        <li role="presentation" class="nt__mh">Tags</li>
                        @for (o of tagFilterItems(); track o.value) {
                          <li role="none">
                            <button
                              type="button"
                              class="mf-btn mf-btn--text nt__mi"
                              role="menuitemcheckbox"
                              [attr.aria-checked]="filterValues().includes(o.value)"
                              [attr.data-filter]="o.value"
                              (click)="toggleFilter(o.value)"
                            >
                              <i
                                class="pi"
                                [class]="
                                  filterValues().includes(o.value) ? 'pi-check' : 'nt__blank'
                                "
                                aria-hidden="true"
                              ></i
                              ><span class="nt__grow">{{ o.label }}</span
                              ><span class="nt__n">{{ o.count | mfInt }}</span>
                            </button>
                          </li>
                        }
                        @if (view() === 'tag') {
                          <li role="separator" class="nt__sep"></li>
                          <li role="none">
                            <button
                              type="button"
                              class="mf-btn mf-btn--text nt__mi"
                              role="menuitem"
                              data-toggle-all
                              (click)="toggleAll(); closeMenus()"
                            >
                              <i
                                class="pi"
                                [class]="anyOpen() ? 'pi-angle-double-up' : 'pi-angle-double-down'"
                                aria-hidden="true"
                              ></i
                              >{{ anyOpen() ? 'Collapse all groups' : 'Expand all groups' }}
                            </button>
                          </li>
                        }
                      </ul>
                    }
                  </span>
                }
              </div>
              @if (activeFilters().length || !canEdit()) {
                <div class="nt__lc3">
                  @if (!canEdit()) {
                    <span
                      class="nt__pill nt__pill--info"
                      title="You can read notes on this matter. Adding and editing needs the Matter Note Edit permission."
                      data-notes-readonly
                      ><i class="pi pi-eye" aria-hidden="true"></i>Read only</span
                    >
                  }
                  @for (f of activeFilters(); track f.value) {
                    @if (f.tag; as t) {
                      <mf-note-tag
                        [name]="t.name"
                        [colourKey]="t.colourKey"
                        [removable]="true"
                        data-filter-chip
                        (removed)="toggleFilter(f.value)"
                      />
                    } @else {
                      <span class="nt__pill" data-filter-chip
                        >{{ f.label }}
                        <button
                          type="button"
                          class="nt__x"
                          [attr.aria-label]="'Remove filter ' + f.label"
                          (click)="toggleFilter(f.value)"
                        >
                          <i class="pi pi-times" aria-hidden="true"></i>
                        </button>
                      </span>
                    }
                  }
                </div>
              }
            </div>
            <div class="nt__scroll" tabindex="-1">
              @if (listError()) {
                <p class="nt__error" role="alert" data-notes-error>
                  <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>{{ listError() }}
                  <button type="button" class="mf-btn" (click)="loadList()">Retry</button>
                </p>
              } @else if (!loaded()) {
                <div class="nt__skel" aria-busy="true" role="status" data-notes-loading>
                  <span class="mf-sr-only">Loading notes</span>
                  @for (w of skeleton; track $index) {
                    <div [style.width]="w"></div>
                  }
                </div>
              } @else if (view() === 'templates') {
                <div class="nt__thead">
                  <span
                    >A template is a ready-made note: title, tags and body. Placeholders such as
                    <span class="nt__tok">{{ '{{date}}' }}</span>
                    <span class="nt__tok">{{ '{{matter}}' }}</span>
                    <span class="nt__tok">{{ '{{author}}' }}</span> are filled when it is
                    used.</span
                  >
                </div>
                @if (shownTemplates().length) {
                  <ul class="nt__nl" data-template-list>
                    @for (grp of templateGroups(); track grp.scope) {
                      <li class="nt__grp" data-template-group>
                        {{ grp.label }}
                      </li>
                      @for (t of grp.items; track t.noteTemplateId) {
                        <li class="nt__tpl">
                          <button
                            type="button"
                            class="nt__row"
                            data-template-item
                            [attr.aria-current]="
                              selTemplate()?.noteTemplateId === t.noteTemplateId ? 'true' : null
                            "
                            (click)="openTemplate(t)"
                          >
                            <span class="nt__tile" aria-hidden="true"
                              ><i class="pi pi-clone"></i
                            ></span>
                            <span>
                              <span class="nt__tt"
                                ><span class="nt__ti">{{ t.name }}</span></span
                              >
                              <span class="nt__pv"
                                >{{ t.description }}
                                <span class="nt__plain">{{ preview(t.bodyHtml) }}</span></span
                              >
                              <span class="nt__tags">
                                <span
                                  class="nt__pill"
                                  [class.nt__pill--info]="t.scope === 'SYSTEM'"
                                  data-template-level
                                >
                                  <i class="pi" [class]="levelIcon(t.scope)" aria-hidden="true"></i>
                                  {{ levelLabel(t.scope) }}
                                </span>
                                @for (g of t.tags; track g.noteTagId) {
                                  <mf-note-tag [name]="g.name" [colourKey]="g.colourKey" />
                                }
                                <span class="nt__plain">Used {{ t.usedCount | mfInt }} times</span>
                              </span>
                            </span>
                          </button>
                        </li>
                      }
                    }
                  </ul>
                } @else {
                  <mf-state-block icon="pi-search">
                    {{ query() ? 'No results for "' + query() + '".' : 'No templates yet.' }}
                    @if (!query()) {
                      <span mfStateReason
                        >Create one from a note: open it and use More actions, Save as
                        template.</span
                      >
                    }
                  </mf-state-block>
                }
              } @else if (totalCount() === 0 && !query() && !filterValues().length) {
                <mf-state-block icon="pi-file" data-notes-empty>
                  {{ canEdit() ? 'No notes yet.' : 'No notes.' }}
                  @if (canEdit()) {
                    <button
                      mfStateAction
                      type="button"
                      class="mf-btn mf-btn--primary"
                      (click)="newNote()"
                    >
                      <i class="pi pi-plus" aria-hidden="true"></i>New Note
                    </button>
                  }
                </mf-state-block>
              } @else if (items().length === 0) {
                <mf-state-block icon="pi-search" data-notes-nomatch>
                  @if (query() && !filterValues().length) {
                    No results for "{{ query() }}".
                  } @else {
                    No notes match these filters.
                  }
                  <button mfStateAction type="button" class="mf-btn" (click)="clearFilters()">
                    Clear Filters
                  </button>
                </mf-state-block>
              } @else if (view() === 'tag') {
                @for (g of groups(); track g.id) {
                  <section
                    class="nt__grp"
                    [class.is-closed]="collapsed()[g.id]"
                    [attr.data-group]="g.id"
                  >
                    <h3>
                      <button
                        type="button"
                        [attr.aria-expanded]="!collapsed()[g.id]"
                        [attr.aria-controls]="'nt-g-' + g.id"
                        (click)="toggleGroup(g.id)"
                      >
                        <i class="pi pi-chevron-down nt__chev" aria-hidden="true"></i>
                        @if (g.tag; as t) {
                          <mf-note-tag [name]="t.name" [colourKey]="t.colourKey" />
                          @if (!t.isActive) {
                            <span class="nt__inactive">inactive</span>
                          }
                        } @else {
                          <span class="nt__pill"
                            ><i class="pi pi-minus" aria-hidden="true"></i>Untagged</span
                          >
                        }
                        <span class="nt__grow"></span>
                        <span class="nt__cnt" [attr.aria-label]="g.notes.length + ' notes'">{{
                          g.notes.length
                        }}</span>
                      </button>
                    </h3>
                    <ul class="nt__nl" [id]="'nt-g-' + g.id">
                      @for (n of g.notes; track n.noteId) {
                        <ng-container
                          [ngTemplateOutlet]="row"
                          [ngTemplateOutletContext]="{ $implicit: n, gid: g.id }"
                        />
                      }
                    </ul>
                  </section>
                }
              } @else if (view() === 'latest') {
                <ul class="nt__nl">
                  @for (n of sorted(); track n.noteId) {
                    <ng-container
                      [ngTemplateOutlet]="row"
                      [ngTemplateOutletContext]="{ $implicit: n, gid: '' }"
                    />
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (showList() && showPanel() && !stacked()) {
          <div
            class="nt__split"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the note list"
            tabindex="0"
            [class.is-drag]="dragging()"
            [attr.aria-valuenow]="listWidth()"
            [attr.aria-valuemin]="splitMin"
            [attr.aria-valuemax]="splitMaxNow()"
            [attr.aria-valuetext]="'Note list ' + listWidth() + ' pixels wide'"
            data-notes-splitter
            (pointerdown)="dragStart($event)"
            (dblclick)="splitReset()"
            (keydown)="splitKey($event)"
          >
            <span class="nt__grip"></span>
          </div>
        }

        <!-- the note (or template) panel -->
        @if (showPanel()) {
          <div class="nt__panel" #pane data-note-pane role="region" aria-label="Note">
            @if (selTemplate(); as t) {
              @if (tplEditMode()) {
                <header class="nt__ph" data-note-head>
                  <span class="nt__crumb"
                    >Templates / <b>{{ tplName() || 'New template' }}</b></span
                  >
                  <span class="nt__pill nt__pill--info" data-template-badge>Template</span>
                  <span class="nt__pill" data-editing-label>Editing</span>
                  <span class="nt__state" [class.is-dirty]="tplDirty()" data-note-state>
                    <i aria-hidden="true"></i
                    ><span>{{ tplDirty() ? 'Unsaved changes' : 'No changes' }}</span>
                  </span>
                  <span class="nt__hr">
                    <span class="nt__vdiv" aria-hidden="true"></span>
                    <span class="nt__cs">
                      <button
                        type="button"
                        class="mf-btn"
                        data-template-cancel
                        (click)="cancelTemplate()"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        class="mf-btn mf-btn--primary"
                        data-template-save
                        [disabled]="busy() || !tplDirty()"
                        (click)="saveTemplateEdit()"
                      >
                        Save
                      </button>
                    </span>
                  </span>
                </header>
                <div class="nt__pbody">
                  <div class="nt__pedit" data-template-form>
                    @if (tplError()) {
                      <p class="nt__banner nt__banner--warn" role="alert">
                        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i
                        >{{ tplError() }}
                      </p>
                    }
                    <div class="nt__tfields">
                      <mf-text-field
                        inputId="te-name"
                        label="Name"
                        [required]="true"
                        [maxLength]="100"
                        [(value)]="tplName"
                      />
                      <mf-text-field
                        inputId="te-desc"
                        label="Description"
                        [maxLength]="160"
                        [(value)]="tplDescription"
                      />
                      <div
                        class="nt__tagpick"
                        data-template-tagpick
                        (focusout)="onTplTagsFocusOut($event)"
                      >
                        <span class="nt__fl" id="te-tags-l">Tags (up to five)</span>
                        <button
                          type="button"
                          class="nt__erow nt__tagbtn"
                          aria-haspopup="listbox"
                          aria-labelledby="te-tags-l"
                          [attr.aria-expanded]="tplTagsOpen()"
                          data-template-tags-button
                          (click)="tplTagsOpen.set(!tplTagsOpen())"
                          (keydown.escape)="tplTagsOpen.set(false)"
                        >
                          @for (g of tplTagChips(); track g.noteTagId) {
                            <mf-note-tag [name]="g.name" [colourKey]="g.colourKey" />
                          } @empty {
                            <span class="nt__plain">None chosen</span>
                          }
                          <i class="pi pi-chevron-down nt__caret" aria-hidden="true"></i>
                        </button>
                        @if (tplTagsOpen()) {
                          <div
                            class="nt__tagmenu"
                            role="group"
                            aria-label="Tags the template offers"
                          >
                            @for (g of allTags(); track g.noteTagId) {
                              <label class="nt__check">
                                <input
                                  type="checkbox"
                                  [checked]="tplTagIds().includes(g.noteTagId)"
                                  [disabled]="
                                    !tplTagIds().includes(g.noteTagId) && tplTagIds().length >= 5
                                  "
                                  (change)="toggleTplTag(g.noteTagId)"
                                  (keydown.escape)="tplTagsOpen.set(false)"
                                />
                                <mf-note-tag [name]="g.name" [colourKey]="g.colourKey" />
                              </label>
                            }
                          </div>
                        }
                      </div>
                      <div class="nt__fl nt__lvl">
                        <label for="te-level" id="te-level-l">Level</label>
                        <mf-dropdown
                          data-template-level-select
                          buttonId="te-level"
                          label="Level"
                          [items]="levelItems()"
                          [value]="tplLevel()"
                          [neutralValue]="null"
                          (valueChange)="onLevel($event)"
                        />
                      </div>
                    </div>
                    <div class="nt__edhint">
                      <button
                        type="button"
                        class="mf-btn mf-btn--icon"
                        aria-label="About placeholders"
                        title="Type placeholders such as {{ '{{date}}' }}, {{ '{{matter}}' }}, {{ '{{author}}' }}; they are filled when the template is used. Other placeholders stay for the person to fill in. The first line of the text becomes the title of the new note."
                        aria-describedby="te-ph-help"
                        data-template-help
                      >
                        <i class="pi pi-info-circle" aria-hidden="true"></i>
                      </button>
                      <span class="mf-sr-only" id="te-ph-help"
                        >Type placeholders such as {{ '{{date}}' }}, {{ '{{matter}}' }},
                        {{ '{{author}}' }}; they are filled when the template is used. Other
                        placeholders, for example {{ '{{custodian}}' }}, stay for the person to fill
                        in. The first line of the text becomes the title of the new note.</span
                      >
                    </div>
                    @defer (on immediate) {
                      <mf-note-editor
                        [html]="tplHtml()"
                        [contentKey]="tplKey()"
                        [editable]="true"
                        [source]="source"
                        [embedSource]="embedSource"
                        [highlightTokens]="true"
                        (changed)="tplHtml.set($event)"
                        (notice)="notify.info($event)"
                      />
                    } @placeholder {
                      <p class="nt__byline" role="status">Loading editor</p>
                    }
                  </div>
                </div>
              } @else {
                <header class="nt__ph" data-note-head>
                  <span class="nt__crumb"
                    >Templates / <b>{{ t.name }}</b></span
                  >
                  <span class="nt__pill nt__pill--info" data-template-badge>Template</span>
                  <button
                    type="button"
                    class="mf-btn"
                    data-template-edit
                    [attr.aria-disabled]="tplReason(t) ? 'true' : null"
                    [title]="tplReason(t) || 'Edit this template'"
                    (click)="onTemplateAction($event, tplReason(t), 'edit', t)"
                  >
                    <i class="pi pi-pencil" aria-hidden="true"></i>Edit
                  </button>
                  <ng-container
                    [ngTemplateOutlet]="noteActions"
                    [ngTemplateOutletContext]="{ $implicit: 'template' }"
                  />
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    aria-label="Close template"
                    title="Close"
                    (click)="closePanel()"
                  >
                    <i class="pi pi-times" aria-hidden="true"></i>
                  </button>
                </header>
                <div class="nt__pbody">
                  <div class="nt__pmain">
                    <div class="nt__pscroll">
                      <h2 class="nt__ptitle" tabindex="-1" #ptitle>{{ t.name }}</h2>
                      <p class="nt__upd">
                        Used {{ t.usedCount | mfInt }} times &middot; last changed by
                        <b>{{ t.updatedByName ?? 'someone' }}</b> &middot;
                        {{ t.updatedAtUtc | mfNum }}
                      </p>
                      <div class="nt__tags">
                        <span
                          class="nt__pill"
                          [class.nt__pill--info]="t.scope === 'SYSTEM'"
                          data-template-level
                        >
                          <i class="pi" [class]="levelIcon(t.scope)" aria-hidden="true"></i>
                          {{ levelLabel(t.scope) }}
                        </span>
                        @if (t.targetName) {
                          <span class="nt__plain">{{ t.targetName }}</span>
                        }
                        @for (g of t.tags; track g.noteTagId) {
                          <mf-note-tag [name]="g.name" [colourKey]="g.colourKey" />
                        }
                      </div>
                      @if (t.description) {
                        <p class="nt__byline">{{ t.description }}</p>
                      }
                      <p class="nt__banner nt__banner--slim">
                        <i class="pi pi-info-circle" aria-hidden="true"></i>
                        <span
                          >Highlighted placeholders are replaced when the template is used (with
                          /template). The first line of the text becomes the title of the new
                          note.</span
                        >
                      </p>
                      @defer (on immediate) {
                        <mf-note-editor
                          [html]="t.bodyHtml"
                          [contentKey]="'tpl:' + t.noteTemplateId + ':' + t.rowVersion"
                          [editable]="false"
                          [embedSource]="embedSource"
                          [highlightTokens]="true"
                        />
                      }
                    </div>
                  </div>
                </div>
              }
            } @else if (draft(); as d) {
              <!-- the header: read mode and edit mode -->
              @if (editing()) {
                <header class="nt__ph" data-note-head>
                  <span class="nt__crumb"
                    >Notes / <b>{{ note()?.title || 'New note' }}</b></span
                  >
                  <span class="nt__pill" data-editing-label>Editing</span>
                  <span class="nt__state" [class.is-dirty]="dirty()" id="nt-state" data-note-state>
                    <i aria-hidden="true"></i
                    ><span>{{ dirty() ? 'Unsaved changes' : 'No changes' }}</span>
                  </span>
                  <span class="nt__hr">
                    <mf-ai-button
                      [allowed]="aiAllowed()"
                      [showNote]="false"
                      (pressed)="aiPanel.set(true)"
                    />
                    <ng-container
                      [ngTemplateOutlet]="noteActions"
                      [ngTemplateOutletContext]="{ $implicit: 'edit' }"
                    />
                    @if (!stacked()) {
                      <button
                        type="button"
                        class="mf-btn mf-btn--icon"
                        data-note-wide
                        [attr.aria-pressed]="wide()"
                        [attr.aria-label]="
                          wide() ? 'Show the list again' : 'Expand to the full width'
                        "
                        [title]="wide() ? 'Show list' : 'Full width'"
                        (click)="wide.set(!wide())"
                      >
                        <i
                          class="pi"
                          [class]="wide() ? 'pi-window-minimize' : 'pi-window-maximize'"
                          aria-hidden="true"
                        ></i>
                      </button>
                    }
                    <span class="nt__vdiv" aria-hidden="true"></span>
                    <span class="nt__cs">
                      <button type="button" class="mf-btn" data-note-cancel (click)="cancel()">
                        Cancel
                      </button>
                      <button
                        type="button"
                        class="mf-btn mf-btn--primary"
                        data-note-save
                        [disabled]="busy() || !canSave()"
                        [attr.aria-disabled]="saveBlocked() ? 'true' : null"
                        [title]="
                          saveBlocked()
                            ? 'Locked by ' + lockedWhileEditing() + '; your changes cannot be saved'
                            : ''
                        "
                        (click)="onSaveClick()"
                      >
                        Save
                      </button>
                    </span>
                  </span>
                </header>
              } @else if (note(); as n) {
                <header class="nt__ph" data-note-head>
                  <span class="nt__crumb"
                    >Notes / <b>{{ n.title }}</b></span
                  >
                  <mf-ai-button
                    [allowed]="aiAllowed()"
                    [showNote]="false"
                    (pressed)="aiPanel.set(true)"
                  />
                  @if (canEdit()) {
                    <button
                      type="button"
                      class="mf-btn"
                      data-note-edit
                      [attr.aria-disabled]="!lock().canEdit ? 'true' : null"
                      [title]="
                        n.isLocked ? 'Locked by ' + (n.lockedByName ?? 'someone') : 'Edit this note'
                      "
                      [attr.aria-label]="
                        n.isLocked
                          ? 'Edit, not available: locked by ' + (n.lockedByName ?? 'someone')
                          : 'Edit'
                      "
                      (click)="onEditClick($event)"
                    >
                      <i class="pi pi-pencil" aria-hidden="true"></i>Edit
                    </button>
                  }
                  <ng-container
                    [ngTemplateOutlet]="noteActions"
                    [ngTemplateOutletContext]="{ $implicit: 'note' }"
                  />
                  @if (!stacked()) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--icon"
                      data-note-wide
                      [attr.aria-pressed]="wide()"
                      [attr.aria-label]="
                        wide() ? 'Show the list again' : 'Expand to the full width'
                      "
                      [title]="wide() ? 'Show list' : 'Full width'"
                      (click)="wide.set(!wide())"
                    >
                      <i
                        class="pi"
                        [class]="wide() ? 'pi-window-minimize' : 'pi-window-maximize'"
                        aria-hidden="true"
                      ></i>
                    </button>
                  }
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    data-note-close
                    aria-label="Close note"
                    title="Close note"
                    (click)="closePanel()"
                  >
                    <i class="pi pi-times" aria-hidden="true"></i>
                  </button>
                </header>
              }

              <div class="nt__pbody" #pbody>
                @if (editing()) {
                  <div class="nt__pedit" data-note-edit-area>
                    @if (lockedWhileEditing()) {
                      <div
                        class="nt__banner nt__banner--warn"
                        role="alert"
                        data-note-locked-warning
                      >
                        <i class="pi pi-lock" aria-hidden="true"></i>
                        <div>
                          <b
                            >This note was locked by {{ lockedWhileEditing() }}; your changes cannot
                            be saved.</b
                          >
                          Nobody can edit a locked note until {{ lockedWhileEditing() }} or an
                          administrator unlocks it. Copy your text first if you want to keep it.
                          <div class="nt__bb">
                            <button type="button" class="mf-btn" (click)="copyMine()">
                              <i class="pi pi-copy" aria-hidden="true"></i>Copy My Text
                            </button>
                            <button
                              type="button"
                              class="mf-btn"
                              data-note-locked-close
                              (click)="closeLockedWarning()"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      </div>
                    }
                    @if (conflict(); as c) {
                      <div
                        class="nt__banner"
                        [class.nt__banner--warn]="!keepMine()"
                        role="alert"
                        data-note-conflict
                      >
                        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                        <div>
                          @if (keepMine()) {
                            <b>You are keeping your version.</b> Saving replaces what
                            {{ c.who }} saved at {{ c.at | mfNum }}. Their change stays in the
                            history.
                          } @else {
                            <b
                              >{{ c.who }} saved this note at {{ c.at | mfNum }} while you were
                              editing.</b
                            >
                            You can load their version (your unsaved changes are lost) or keep yours
                            (their version is replaced when you save).
                          }
                          <div class="nt__bb">
                            <button
                              type="button"
                              class="mf-btn"
                              data-note-reload
                              (click)="reloadTheirs()"
                            >
                              <i class="pi pi-refresh" aria-hidden="true"></i>Reload Their Version
                            </button>
                            @if (!keepMine()) {
                              <button
                                type="button"
                                class="mf-btn"
                                data-note-keep
                                (click)="keepMine.set(true)"
                              >
                                Keep Mine
                              </button>
                            }
                          </div>
                        </div>
                      </div>
                    }
                    @if (saveError()) {
                      <p class="nt__banner nt__banner--warn" role="alert" data-note-error>
                        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i
                        >{{ saveError() }}
                      </p>
                    }
                    @if (tplBanner().length) {
                      <div class="nt__banner nt__banner--slim" role="status" data-template-tags>
                        <i class="pi pi-info-circle" aria-hidden="true"></i>
                        <span>Template tags:</span>
                        @for (t of tplBanner(); track t.noteTagId) {
                          <mf-note-tag [name]="t.name" [colourKey]="t.colourKey" />
                        }
                        <span class="nt__grow"></span>
                        <button type="button" class="mf-btn" (click)="applyTplTags()">
                          Apply Tags
                        </button>
                        <button type="button" class="mf-btn" (click)="tplBanner.set([])">
                          No Thanks
                        </button>
                      </div>
                    }
                    <div
                      class="nt__erow nt__slim"
                      role="group"
                      aria-label="Tags, optional, up to 5"
                      data-note-tag-chips
                    >
                      <span class="nt__tl"><i class="pi pi-tag" aria-hidden="true"></i>Tags</span>
                      @for (t of selectedTags(); track t.noteTagId) {
                        <mf-note-tag
                          [name]="t.name"
                          [colourKey]="t.colourKey"
                          [inactive]="!t.isActive"
                          [removable]="true"
                          (removed)="removeTag(t.noteTagId)"
                        />
                      }
                      <button
                        type="button"
                        class="nt__add"
                        data-note-tags
                        #addTag
                        (click)="panel.set('tags')"
                      >
                        <i class="pi pi-plus" aria-hidden="true"></i
                        >{{ selectedTags().length ? 'Add' : 'Add tag' }}
                      </button>
                    </div>
                    @defer (on immediate) {
                      <mf-note-editor
                        #editor
                        [html]="d.html"
                        [contentKey]="d.key"
                        [editable]="true"
                        [source]="source"
                        [embedSource]="embedSource"
                        (changed)="onChanged($event)"
                        (notice)="notify.info($event)"
                        (templateChosen)="onTemplateChosen($event)"
                        (ready)="onEditorReady()"
                      />
                    } @placeholder {
                      <p class="nt__byline" role="status">Loading editor</p>
                    }
                  </div>
                } @else if (note(); as n) {
                  <div class="nt__pmain">
                    <div class="nt__pscroll">
                      <h2 class="nt__ptitle" tabindex="-1" #ptitle data-note-title>
                        @if (n.isPinned) {
                          <i class="pi pi-thumbtack" aria-hidden="true"></i
                          ><span class="mf-sr-only">Pinned. </span>
                        }
                        @if (n.isLocked) {
                          <i class="pi pi-lock" aria-hidden="true" data-note-lock-icon></i
                          ><span class="mf-sr-only">Locked. </span>
                        }
                        {{ n.title }}
                      </h2>
                      <p class="nt__upd" data-note-byline>
                        Last Updated by <b>{{ n.updatedByName ?? 'someone' }}</b> &middot;
                        {{ n.updatedAtUtc | mfNum }}
                      </p>
                      <div class="nt__tags" data-note-tag-chips>
                        <span class="mf-sr-only">Tags: </span>
                        @for (t of n.tags; track t.noteTagId) {
                          <mf-note-tag
                            [name]="t.name"
                            [colourKey]="t.colourKey"
                            [inactive]="!t.isActive"
                          />
                        } @empty {
                          <span class="nt__byline">No tags</span>
                        }
                        @if (n.isLocked) {
                          <span class="nt__pill nt__pill--lock" data-note-lock-badge>
                            <i class="pi pi-lock" aria-hidden="true"></i>Locked by
                            {{ n.lockedByName ?? 'someone' }}
                            @if (n.lockedAtUtc) {
                              &middot; {{ n.lockedAtUtc | mfNum }}
                            }
                          </span>
                        }
                      </div>
                      @if (!canEdit()) {
                        <p class="nt__banner">
                          <i class="pi pi-eye" aria-hidden="true"></i>
                          <span
                            >You can read this note. Editing needs the Matter Note Edit
                            permission.</span
                          >
                        </p>
                      }
                      @if (n.isLocked && canEdit()) {
                        <p class="nt__banner" role="status" data-note-locked>
                          <i class="pi pi-lock" aria-hidden="true"></i>
                          <span
                            >This note is locked: it is read only for everybody (pinning still
                            works).
                            {{
                              lock().canUnlock
                                ? 'You can unlock it.'
                                : 'Only ' +
                                  (n.lockedByName ?? 'the person who locked it') +
                                  ' or an administrator can unlock it.'
                            }}</span
                          >
                        </p>
                      }
                      @defer (on immediate) {
                        <mf-note-editor
                          [html]="d.html"
                          [contentKey]="d.key"
                          [editable]="false"
                          [embedSource]="embedSource"
                          [refInfo]="refInfo()"
                          (refOpen)="openRef($event)"
                        />
                      } @placeholder {
                        <p class="nt__byline" role="status">Loading note</p>
                      }
                    </div>
                  </div>
                }

                <!-- the right rail: History and References (one open at a time); a column next to it when the note area is 820 px wide -->
                @if (note() && histWide()) {
                  @if (sideOpen() !== 'none') {
                    <div
                      class="nt__split nt__split--hist"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize the side panel"
                      tabindex="0"
                      [class.is-drag]="dragging()"
                      [attr.aria-valuenow]="histWidth()"
                      [attr.aria-valuemin]="splitMin"
                      [attr.aria-valuemax]="histMax"
                      [attr.aria-valuetext]="'Side panel ' + histWidth() + ' pixels wide'"
                      data-history-splitter
                      (pointerdown)="dragStartHist($event)"
                      (dblclick)="histReset()"
                      (keydown)="histKey($event)"
                    >
                      <span class="nt__grip"></span>
                    </div>
                    <aside
                      class="nt__phist"
                      [style.--hw]="histWidth() + 'px'"
                      [attr.aria-label]="sideOpen() === 'refs' ? 'Referenced Items' : 'History'"
                      data-history-rail-open
                      [attr.data-side]="sideOpen()"
                    >
                      <div class="nt__hh">
                        <h3 id="nt-hh3">
                          {{ sideOpen() === 'refs' ? 'Referenced Items' : 'History' }}
                          <span class="nt__cnt">{{
                            sideOpen() === 'refs' ? refChips().length : history().length
                          }}</span>
                        </h3>
                        <button
                          type="button"
                          class="mf-btn mf-btn--icon"
                          aria-label="Close the side panel"
                          title="Close"
                          (click)="closeSide()"
                        >
                          <i class="pi pi-angle-double-right" aria-hidden="true"></i>
                        </button>
                      </div>
                      @if (sideOpen() === 'refs') {
                        <div
                          class="nt__hlist nt__refs"
                          tabindex="0"
                          role="region"
                          aria-labelledby="nt-hh3"
                          data-note-refs
                        >
                          <ng-container [ngTemplateOutlet]="refsBody" />
                        </div>
                      } @else {
                        <div
                          class="nt__hlist"
                          tabindex="0"
                          role="region"
                          aria-labelledby="nt-hh3"
                          data-note-history-list
                        >
                          <ng-container [ngTemplateOutlet]="historyBody" />
                        </div>
                        <p class="nt__hnote">
                          History shows who and when only. There are no versions, no comparison and
                          no restore.
                        </p>
                      }
                    </aside>
                  }
                  <div
                    class="nt__rail"
                    role="toolbar"
                    aria-orientation="vertical"
                    aria-label="Note side panels"
                    tabindex="-1"
                    data-side-rail
                  >
                    <button
                      type="button"
                      class="mf-btn mf-btn--icon"
                      data-history-rail
                      aria-label="History"
                      title="History"
                      [attr.aria-expanded]="sideOpen() === 'history'"
                      [attr.aria-pressed]="sideOpen() === 'history'"
                      (click)="toggleSide('history')"
                    >
                      <i class="pi pi-history" aria-hidden="true"></i>
                      <span class="nt__badge">{{ history().length }}</span>
                    </button>
                    @if (refChips().length) {
                      <button
                        type="button"
                        class="mf-btn mf-btn--icon"
                        data-refs-rail
                        aria-label="Referenced Items"
                        title="Referenced Items"
                        [attr.aria-expanded]="sideOpen() === 'refs'"
                        [attr.aria-pressed]="sideOpen() === 'refs'"
                        (click)="toggleSide('refs')"
                      >
                        <i class="pi pi-link" aria-hidden="true"></i>
                        <span class="nt__badge">{{ refChips().length }}</span>
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </section>

    <!-- one note row, used by the By tag and Latest views -->
    <ng-template #row let-n let-gid="gid">
      <li>
        <button
          type="button"
          class="nt__row"
          data-note-item
          [class.is-twin]="twinId() === n.noteId && n.tags.length > 1 && gid !== ''"
          [attr.aria-current]="isOpen(n.noteId)"
          (mouseenter)="twinId.set(n.noteId)"
          (mouseleave)="twinId.set(null)"
          (focus)="twinId.set(n.noteId)"
          (blur)="twinId.set(null)"
          (click)="open(n.noteId, $event.detail === 0)"
        >
          <span
            class="nt__av"
            aria-hidden="true"
            [style.background]="av(author(n)).bg"
            [style.color]="av(author(n)).fg"
            >{{ initials(author(n)) }}</span
          >
          <span>
            <span class="nt__tt">
              @if (n.isPinned) {
                <i class="pi pi-thumbtack" aria-hidden="true"></i
                ><span class="mf-sr-only">Pinned. </span>
              }
              @if (n.isLocked) {
                <i class="pi pi-lock" aria-hidden="true"></i
                ><span class="mf-sr-only">Locked. </span>
              }
              <span class="nt__ti">
                @for (s of marks(n.title); track $index) {
                  @if (s.hit) {
                    <mark>{{ s.t }}</mark>
                  } @else {
                    {{ s.t }}
                  }
                }
              </span>
            </span>
            <span class="nt__pv">
              @for (s of marks(n.snippet); track $index) {
                @if (s.hit) {
                  <mark>{{ s.t }}</mark>
                } @else {
                  {{ s.t }}
                }
              }
            </span>
            <span class="nt__tags">
              <span class="mf-sr-only">Tags: </span>
              @if (n.tags.length === 0) {
                <span class="nt__plain">No tags</span>
              } @else if (gid !== '' && gid !== '_none') {
                @for (t of n.tags; track t.noteTagId) {
                  @if ('' + t.noteTagId === gid) {
                    <mf-note-tag [name]="t.name" [colourKey]="t.colourKey" [here]="true" />
                  }
                }
                @if (otherTags(n, gid).length) {
                  <span class="nt__also">also in</span>
                  @for (t of otherTags(n, gid); track t.noteTagId) {
                    <mf-note-tag [name]="t.name" [colourKey]="t.colourKey" />
                  }
                }
              } @else {
                @for (t of n.tags; track t.noteTagId) {
                  <mf-note-tag [name]="t.name" [colourKey]="t.colourKey" />
                }
              }
            </span>
            <span class="nt__meta">
              <span class="mf-sr-only">Author. </span>
              <span
                >Updated by <b>{{ n.updatedByName ?? 'someone' }}</b> &middot;
                {{ n.updatedAtUtc | mfNum }}</span
              >
            </span>
          </span>
        </button>
      </li>
    </ng-template>

    <!-- the Actions menu of a note (MD-36): Organise, Share and reuse, View (narrow only), Danger -->
    <ng-template #noteActions let-kind>
      @if (kind === 'template' || note()) {
        <span class="nt__am">
          <button
            type="button"
            class="mf-btn mf-btn--icon"
            data-note-actions
            aria-haspopup="menu"
            aria-label="Actions"
            title="Actions"
            [attr.aria-expanded]="actionsOpen()"
            (click)="toggleActions()"
          >
            <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
          </button>
          @if (actionsOpen()) {
            <ul
              class="nt__menu nt__menu--right"
              role="menu"
              aria-label="Actions"
              tabindex="-1"
              data-actions-menu
              (keydown)="menuNav($event)"
            >
              @if (kind !== 'template' && note(); as n) {
                <li role="presentation" class="nt__mh">Organise</li>
                <li role="none">
                  <button
                    type="button"
                    class="mf-btn mf-btn--text nt__mi"
                    role="menuitem"
                    data-note-pin
                    [attr.aria-disabled]="organiseReason() ? 'true' : null"
                    [title]="organiseReason()"
                    (click)="onMenu(organiseReason(), 'pin')"
                  >
                    <i class="pi pi-thumbtack" aria-hidden="true"></i
                    >{{ n.isPinned ? 'Unpin note' : 'Pin note' }}
                  </button>
                </li>
                <li role="none">
                  @if (n.isLocked) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text nt__mi"
                      role="menuitem"
                      data-note-unlock
                      [attr.aria-disabled]="organiseReason() || !lock().canUnlock ? 'true' : null"
                      [title]="organiseReason() || (lock().canUnlock ? '' : unlockReason(n))"
                      (click)="
                        onMenu(
                          organiseReason() || (lock().canUnlock ? '' : unlockReason(n)),
                          'unlock'
                        )
                      "
                    >
                      <i class="pi pi-lock-open" aria-hidden="true"></i>Unlock Note
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text nt__mi"
                      role="menuitem"
                      data-note-lock
                      [attr.aria-disabled]="organiseReason() ? 'true' : null"
                      [title]="organiseReason()"
                      (click)="onMenu(organiseReason(), 'lock')"
                    >
                      <i class="pi pi-lock" aria-hidden="true"></i>Lock Note
                    </button>
                  }
                </li>
                <li role="separator" class="nt__sep"></li>
                <li role="presentation" class="nt__mh">Share and reuse</li>
                <li role="none">
                  <button
                    type="button"
                    class="mf-btn mf-btn--text nt__mi"
                    role="menuitem"
                    data-note-copy-link
                    (click)="onMenu('', 'copy')"
                  >
                    <i class="pi pi-link" aria-hidden="true"></i>Copy Link
                  </button>
                </li>
                <li role="none">
                  <button
                    type="button"
                    class="mf-btn mf-btn--text nt__mi"
                    role="menuitem"
                    data-note-save-template
                    [attr.aria-disabled]="saveTplReason() ? 'true' : null"
                    [title]="saveTplReason()"
                    (click)="onMenu(saveTplReason(), 'saveTpl')"
                  >
                    <i class="pi pi-clone" aria-hidden="true"></i>Save as template...
                  </button>
                </li>
                @if (!histWide()) {
                  <li role="separator" class="nt__sep"></li>
                  <li role="presentation" class="nt__mh">View</li>
                  <li role="none">
                    <button
                      type="button"
                      class="mf-btn mf-btn--text nt__mi"
                      role="menuitem"
                      data-note-history
                      (click)="onMenu('', 'history')"
                    >
                      <i class="pi pi-history" aria-hidden="true"></i>History
                    </button>
                  </li>
                  @if (refChips().length) {
                    <li role="none">
                      <button
                        type="button"
                        class="mf-btn mf-btn--text nt__mi"
                        role="menuitem"
                        data-note-refs-button
                        (click)="onMenu('', 'refs')"
                      >
                        <i class="pi pi-link" aria-hidden="true"></i>Referenced Items
                      </button>
                    </li>
                  }
                }
                <li role="separator" class="nt__sep"></li>
                <li role="presentation" class="nt__mh">Danger</li>
                <li role="none">
                  <button
                    type="button"
                    class="mf-btn mf-btn--text mf-btn--danger nt__mi"
                    role="menuitem"
                    data-note-delete
                    [attr.aria-disabled]="deleteReason(n) ? 'true' : null"
                    [title]="deleteReason(n)"
                    (click)="onMenu(deleteReason(n), 'delete')"
                  >
                    <i class="pi pi-trash" aria-hidden="true"></i>Delete Note
                  </button>
                </li>
              } @else if (kind === 'template' && selTemplate(); as t) {
                <li role="presentation" class="nt__mh">Danger</li>
                <li role="none">
                  <button
                    type="button"
                    class="mf-btn mf-btn--text mf-btn--danger nt__mi"
                    role="menuitem"
                    data-template-delete
                    [attr.aria-disabled]="tplReason(t) ? 'true' : null"
                    [title]="tplReason(t)"
                    (click)="closeMenus(); onTemplateAction($event, tplReason(t), 'del', t)"
                  >
                    <i class="pi pi-trash" aria-hidden="true"></i>Delete Template
                  </button>
                </li>
              }
            </ul>
          }
        </span>
      }
    </ng-template>

    <ng-template #refsBody>
      @for (k of refKinds; track k) {
        @if (refsOf(k).length) {
          <div class="nt__refgrp">
            <h4>
              {{ refTitles[k] }}
              <span class="nt__cnt">{{ refsOf(k).length }}</span>
            </h4>
            <div class="nt__refchips">
              @for (r of refsOf(k); track r.id) {
                @if (r.state === 'Removed' || r.state === 'Restricted') {
                  <span class="nt__refchip is-gone">
                    <i class="pi pi-info-circle" aria-hidden="true"></i>{{ r.state }} {{ k }}</span
                  >
                } @else {
                  <button
                    type="button"
                    class="nt__refchip"
                    [attr.aria-label]="r.label + ', opens in a new window'"
                    (click)="openRef({ kind: k, id: r.id })"
                  >
                    <i class="pi" [class]="refIcons[k]" aria-hidden="true"></i>{{ r.label }}
                    @if (r.stateText) {
                      <span class="nt__st">{{ r.stateText }}</span>
                    }
                  </button>
                }
              }
            </div>
          </div>
        }
      }
    </ng-template>

    <ng-template #historyBody>
      @for (g of historyGroups(); track g.day) {
        <section>
          <h4>{{ g.day }}</h4>
          <ol>
            @for (h of g.entries; track h.auditEventId) {
              <li>
                <span
                  class="nt__av nt__av--sm"
                  aria-hidden="true"
                  [style.background]="av(h.actorName).bg"
                  [style.color]="av(h.actorName).fg"
                  >{{ initials(h.actorName) }}</span
                >
                <span
                  ><b>{{ h.actorName ?? 'Someone' }}</b> {{ historyText(h) }}
                  <span class="nt__when"
                    >{{ h.occurredAtUtc | mfNum }} &middot; {{ relative(h.occurredAtUtc) }}</span
                  ></span
                >
              </li>
            }
          </ol>
        </section>
      } @empty {
        <p class="nt__byline">No history yet.</p>
      }
    </ng-template>

    <!-- Tags: the firm-wide list; people only pick (owner decision: a side panel) -->
    <mf-slide-panel
      title="Tags"
      subtitle="Up to five per note. Tags are kept by an administrator."
      primaryLabel="Done"
      secondaryLabel="Close"
      [visible]="panel() === 'tags'"
      (visibleChange)="!$event && panel.set('none')"
      (submitted)="panel.set('none')"
    >
      <div data-tags-panel>
        <mf-text-field
          inputId="nt-tag-search"
          label="Search Tags"
          [maxLength]="40"
          [(value)]="tagQuery"
        />
        <div role="group" aria-label="Tags" class="nt__taglist">
          @for (t of pickableTags(); track t.noteTagId) {
            <button
              type="button"
              class="nt__tagopt"
              role="checkbox"
              [attr.aria-checked]="hasTag(t.noteTagId)"
              [disabled]="!editing() || (!hasTag(t.noteTagId) && selectedTags().length >= maxTags)"
              (click)="toggleTag(t)"
            >
              <mf-note-tag [name]="t.name" [colourKey]="t.colourKey" [inactive]="!t.isActive" />
              <span class="nt__grow"></span>
              <span class="nt__n">{{ t.visibleNoteCount | mfInt }}</span>
              <i class="pi nt__tick" [class.pi-check]="hasTag(t.noteTagId)" aria-hidden="true"></i>
            </button>
          } @empty {
            <p class="nt__byline">
              {{
                tagQuery()
                  ? 'No tag with that name'
                  : 'No tags exist yet. An administrator creates them under Labels, Note Tags.'
              }}
            </p>
          }
        </div>
        <p class="nt__byline" aria-live="polite" data-tag-count>
          {{ selectedTags().length }} of {{ maxTags }} selected{{
            selectedTags().length >= maxTags ? '. Maximum of 5 tags reached' : ''
          }}
        </p>
        @if (!editing()) {
          <p class="nt__byline">Press Edit to change the tags of this note.</p>
        }
        <p class="nt__byline">
          Missing a tag?
          @if (isAdmin()) {
            <a routerLink="/admin/note-tags" target="_blank" data-tags-admin-link
              >Create one under Labels, Note Tags</a
            >.
          } @else {
            Ask an administrator (Labels, Note Tags). Users can only pick.
          }
        </p>
      </div>
    </mf-slide-panel>

    <!-- History as a side panel when the note area is narrow -->
    <mf-slide-panel
      title="History"
      subtitle="Who did what and when. No versions."
      [visible]="panel() === 'history'"
      (visibleChange)="!$event && panel.set('none')"
      [showFooter]="false"
      (submitted)="panel.set('none')"
    >
      <div class="nt__hlist" data-note-history-list>
        <ng-container [ngTemplateOutlet]="historyBody" />
      </div>
      <p class="nt__hnote">
        History shows who and when only. There are no versions, no comparison and no restore.
      </p>
    </mf-slide-panel>

    <!-- References as a side panel when the note area is narrow -->
    <mf-slide-panel
      title="Referenced Items"
      [visible]="panel() === 'refs'"
      (visibleChange)="!$event && panel.set('none')"
      [showFooter]="false"
      (submitted)="panel.set('none')"
    >
      <div class="nt__hlist nt__refs" data-note-refs>
        <ng-container [ngTemplateOutlet]="refsBody" />
      </div>
    </mf-slide-panel>

    <mf-form-dialog
      title="Save as Template"
      primaryLabel="Save Template"
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
            label="Template Name"
            [required]="true"
            [maxLength]="100"
            [(value)]="tplName"
          />
          <mf-text-field
            inputId="tpl-desc"
            label="Description"
            help="What is it for?"
            [maxLength]="160"
            [(value)]="tplDescription"
          />
          <fieldset class="nt__fieldset">
            <legend class="nt__byline">Level (who can use it)</legend>
            <label class="nt__check"
              ><input
                type="radio"
                name="sat-scope"
                [checked]="tplLevel() === 'MATTER'"
                (change)="tplLevel.set('MATTER')"
              />
              <span><b>Matter Level</b> This matter only</span></label
            >
            <label class="nt__check"
              ><input
                type="radio"
                name="sat-scope"
                [disabled]="!clientId() || !canClientLevel()"
                [checked]="tplLevel() === 'CLIENT'"
                (change)="tplLevel.set('CLIENT')"
              />
              <span
                ><b>Client Level</b>
                {{
                  canClientLevel()
                    ? 'Every matter of ' + clientName()
                    : 'Needs the permission to edit clients'
                }}</span
              ></label
            >
            <label class="nt__check"
              ><input
                type="radio"
                name="sat-scope"
                [disabled]="!isAdmin()"
                [checked]="tplLevel() === 'SYSTEM'"
                (change)="tplLevel.set('SYSTEM')"
              />
              <span
                ><b>System Level</b> {{ isAdmin() ? 'Every matter' : 'Administrator only' }}</span
              ></label
            >
          </fieldset>
          <label class="nt__check"
            ><input
              type="checkbox"
              [checked]="tplTags()"
              (change)="tplTags.set($any($event.target).checked)"
            />
            <span
              ><b>Include the tags</b>
              {{ note()?.tags?.length ? tagNames(note()!) : 'This note has none' }}</span
            ></label
          >
          <p class="nt__byline">
            References to people, assets, projects, matters and notes are kept. Add placeholders
            such as {{ '{{date}}' }} in the template editor afterwards.
          </p>
        </div>
      }
    </mf-form-dialog>

    <mf-ai-coming-soon [(visible)]="aiPanel" />
    <mf-confirm-dialog
      title="Delete Note"
      confirmLabel="Delete Note"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="confirmDelete"
      (confirmed)="deleteNote()"
    >
      <p>
        <b>{{ note()?.title }}</b> is removed for everyone who can see this matter{{
          deleteTagText()
        }}; this cannot be undone from this screen and the deletion is written to the audit log.
      </p>
    </mf-confirm-dialog>
    <mf-confirm-dialog
      title="Delete Template"
      confirmLabel="Delete Template"
      [danger]="true"
      [(visible)]="confirmDeleteTpl"
      (confirmed)="deleteTemplate()"
    >
      <p>
        <b>{{ tplToDelete()?.name }}</b> is removed from the template list{{
          tplToDelete()?.scope === 'SYSTEM'
            ? ' for every matter'
            : tplToDelete()?.scope === 'CLIENT'
              ? ' for every matter of the client'
              : ''
        }}. Notes already made from it are not changed.
      </p>
    </mf-confirm-dialog>
    <mf-confirm-dialog
      title="Discard Unsaved Changes"
      confirmLabel="Discard Changes"
      cancelLabel="Keep Editing"
      [danger]="true"
      [(visible)]="confirmDiscard"
      (confirmed)="proceedDiscard()"
    >
      <p>
        You have unsaved changes to <b>{{ draftTitle() || 'a new note' }}</b
        >. If you leave now they are lost.
      </p>
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly notify = inject(NotificationService);
  private readonly editorRef = viewChild<NoteEditor>('editor');
  private readonly cardRef = viewChild<ElementRef<HTMLElement>>('card');
  private readonly titleRef = viewChild<ElementRef<HTMLElement>>('ptitle');
  private readonly addTagRef = viewChild<ElementRef<HTMLElement>>('addTag');

  /** The matter whose notes are shown, and its reference and name for the template placeholder `{{matter}}`. */
  readonly matterId = input.required<number>();
  readonly matterLabel = input('');
  /** The matter's client, for Client Level templates. */
  readonly clientId = input<number | undefined>(undefined);
  readonly clientName = input('');
  /** The matter is sensitive: the header says so. */
  readonly sensitive = input(false);
  /** A note was created or deleted: the page refreshes the tab number. */
  readonly changed = output<void>();
  /** The matter's AI allowed setting: it decides whether the AI button is on or says "AI can't be used on this matter" (MD-16). */
  readonly aiAllowed = input<MatterAiAllowed | null | undefined>(MatterAiAllowed.No);
  /**
   * The seam for the AI policy check of MD-16 (flag off in release 1, so nothing is passed today): called before a note is saved. `proceed: false` stops the save
   * (the person chose Edit in the warning dialog); `ackWarnings` and `reasons` are sent with the save and written to the note history ("saved after an AI warning").
   */
  readonly beforeSave = input<
    | ((html: string) => Promise<{ proceed: boolean; ackWarnings?: string[]; reasons?: string[] }>)
    | null
  >(null);

  protected readonly splitMin = SPLIT_MIN;
  protected readonly histMax = 480;
  protected readonly maxTags = MAX_TAGS;
  protected readonly refKinds = REF_KINDS;
  protected readonly refTitles = REF_TITLES;
  protected readonly refIcons = REF_ICONS;
  protected readonly historyText = noteHistoryText;
  protected readonly skeleton = ['46%', '92%', '70%', '46%', '92%', '70%', '46%'];
  protected readonly views: { id: NoteView; label: string; short: string; icon: string }[] = [
    { id: 'tag', label: 'By Tag', short: 'By Tag', icon: 'pi-align-left' },
    { id: 'latest', label: 'Latest First', short: 'Latest', icon: 'pi-list' },
    { id: 'templates', label: 'Templates', short: 'Templates', icon: 'pi-clone' },
  ];
  protected readonly sortItems: DropdownItem[] = [
    { value: 'updated', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'title', label: 'A to Z' },
    { value: 'created', label: 'Created' },
  ];

  // ---- the list
  protected readonly allNotes = signal<NoteListItem[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly loaded = signal(false);
  protected readonly listError = signal('');
  protected readonly query = signal('');
  protected readonly view = signal<NoteView>(this.readView());
  protected readonly sortValue = signal<string>('updated');
  protected readonly filterValues = signal<readonly string[]>([]);
  protected readonly collapsed = signal<Record<string, boolean>>({});
  protected readonly twinId = signal<number | null>(null);
  protected readonly allTags = signal<TagRow[]>([]);
  protected readonly tagQuery = signal('');
  protected readonly viewOptionsOpen = signal(false);
  protected readonly actionsOpen = signal(false);
  /** The active tag, Untagged and Locked filters, for the removable chips under the view switch. */
  protected readonly activeFilters = computed(() =>
    this.filterValues().map((v) => {
      const tag = this.allTags().find((t) => String(t.noteTagId) === v) ?? null;
      return { value: v, tag, label: tag?.name ?? (v === '_none' ? 'Untagged' : 'Locked') };
    }),
  );

  private readonly tagValues = computed(() => this.filterValues().filter((v) => v !== '_locked'));
  private readonly onlyLocked = computed(() => this.filterValues().includes('_locked'));
  /** The notes after the tag and Locked filters (the text search was done by the server). */
  protected readonly items = computed(() => {
    const tags = this.tagValues();
    const locked = this.onlyLocked();
    return this.allNotes().filter(
      (n) =>
        (tags.length === 0 ||
          tags.some((t) =>
            t === '_none' ? n.tags.length === 0 : n.tags.some((x) => String(x.noteTagId) === t),
          )) &&
        (!locked || n.isLocked),
    );
  });
  protected readonly sorted = computed(() => sortNotes(this.items(), this.sortValue() as NoteSort));
  protected readonly groups = computed(() =>
    groupByTag(this.sorted(), this.allTags(), this.tagValues()),
  );
  protected readonly anyOpen = computed(() => this.groups().some((g) => !this.collapsed()[g.id]));
  protected readonly tagFilterItems = computed<DropdownItem[]>(() => {
    const all = this.allNotes();
    const withTags = this.allTags()
      .filter((t) => all.some((n) => n.tags.some((x) => x.noteTagId === t.noteTagId)))
      .map((t) => ({
        value: String(t.noteTagId),
        label: t.name,
        count: all.filter((n) => n.tags.some((x) => x.noteTagId === t.noteTagId)).length,
      }));
    return [
      ...withTags,
      { value: '_none', label: 'Untagged', count: all.filter((n) => n.tags.length === 0).length },
      { value: '_locked', label: 'Locked', count: all.filter((n) => n.isLocked).length },
    ];
  });

  // ---- layout: one card, the list, a splitter and the panel
  protected readonly cardWidth = signal(0);
  protected readonly split = signal(this.readSplit());
  protected readonly dragging = signal(false);
  protected readonly wide = signal(false);
  protected readonly stacked = computed(() => this.cardWidth() > 0 && this.cardWidth() < 760);
  protected readonly splitMaxNow = computed(() =>
    splitLimit(this.cardWidth() || SPLIT_DEFAULT + 420),
  );
  protected readonly listWidth = computed(() => clampSplit(this.split(), this.splitMaxNow()));
  protected readonly showPanel = computed(
    () => this.draft() !== null || this.selTemplate() !== null,
  );
  protected readonly showList = computed(
    () => !(this.stacked() && this.showPanel()) && !(this.wide() && this.showPanel()),
  );

  // ---- the open note
  protected readonly note = signal<NoteResponse | null>(null);
  /** What the right-hand side shows: the html to start the editor from, and a key that says "this is a different note or mode". */
  protected readonly draft = signal<{ html: string; key: string } | null>(null);
  protected readonly editing = signal(false);
  protected readonly selectedTags = signal<
    { noteTagId: number; name: string; colourKey?: string | null; isActive: boolean }[]
  >([]);
  private readonly currentHtml = signal('');
  private readonly startedHtml = signal('');
  private readonly startedTags = signal('');
  protected readonly busy = signal(false);
  protected readonly saveError = signal('');
  protected readonly lockedWhileEditing = signal('');
  protected readonly conflict = signal<{ who: string; at: string } | null>(null);
  protected readonly keepMine = signal(false);
  protected readonly tplBanner = signal<NoteTemplateResponse['tags']>([]);
  protected readonly panel = signal<PanelKind>('none');
  protected readonly aiPanel = signal(false);
  protected readonly refInfo = signal<Record<string, RefInfo>>({});
  protected readonly refChips = signal<RefChip[]>([]);
  private readonly paneRef = viewChild<ElementRef<HTMLElement>>('pane');
  /** The note area is wide enough (820 px) for the history column; narrower, History opens in the side panel. */
  protected readonly paneWidth = signal(0);
  protected readonly histWide = computed(() => this.paneWidth() >= 820);
  /** The right-hand panel of the note area: History or References, one at a time (remembered). */
  protected readonly sideOpen = signal<'history' | 'refs' | 'none'>(this.readSide());
  protected readonly histWidth = signal(this.readHistWidth());

  // ---- templates
  protected readonly templates = signal<NoteTemplateResponse[]>([]);
  protected readonly selTemplate = signal<NoteTemplateResponse | null>(null);
  protected readonly shownTemplates = computed(() => {
    const q = this.query().toLowerCase();
    return this.templates().filter(
      (t) => !q || `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q),
    );
  });
  protected readonly tplEditing = signal<NoteTemplateResponse | null>(null);
  protected readonly tplTagIds = signal<number[]>([]);
  protected readonly tplHtml = signal('');
  protected readonly tplKey = signal('');
  protected readonly tplToDelete = signal<NoteTemplateResponse | null>(null);
  protected readonly confirmDeleteTpl = signal(false);
  /** The open template is being edited in the note panel (a new one has no `tplEditing`). */
  protected readonly tplEditMode = signal(false);
  private readonly tplStart = signal('');
  private tplSnapshot(): string {
    return JSON.stringify([
      this.tplName(),
      this.tplDescription(),
      this.tplHtml(),
      this.tplTagIds(),
      this.tplLevel(),
    ]);
  }
  protected readonly tplDirty = computed(
    () => this.tplEditMode() && this.tplSnapshot() !== this.tplStart(),
  );
  protected tplName = signal('');
  protected tplDescription = signal('');
  protected readonly tplLevel = signal<'MATTER' | 'CLIENT' | 'SYSTEM'>('MATTER');
  protected readonly tplTagsOpen = signal(false);
  protected readonly tplTags = signal(true);
  protected readonly tplError = signal('');

  protected readonly history = signal<NoteHistoryEntry[]>([]);
  protected readonly confirmDelete = signal(false);
  protected readonly confirmDiscard = signal(false);
  private pendingAfterDiscard: (() => void) | null = null;

  protected readonly canEdit = computed(() => this.auth.has('MatterNote.Edit'));
  protected readonly canDelete = computed(() => this.auth.has('MatterNote.Delete'));
  protected readonly isAdmin = computed(() => this.auth.isSystemAdmin());
  protected readonly canClientLevel = computed(
    () => this.auth.isSystemAdmin() || this.auth.has('Client.Edit'),
  );
  protected readonly levelItems = computed<DropdownItem[]>(() => {
    const items: DropdownItem[] = [
      { value: 'MATTER', label: `Matter Level (${this.matterLabel()})` },
    ];
    if (this.clientId() && (this.canClientLevel() || this.tplLevel() === 'CLIENT')) {
      items.push({
        value: 'CLIENT',
        label: `Client Level (${this.clientName()})`,
        disabled: !this.canClientLevel(),
      });
    }
    if (this.isAdmin() || this.tplLevel() === 'SYSTEM') {
      items.push({
        value: 'SYSTEM',
        label: 'System Level (every matter)',
        disabled: !this.isAdmin(),
      });
    }
    return items;
  });

  protected onLevel(value: string): void {
    if (value === 'MATTER' || value === 'CLIENT' || value === 'SYSTEM') this.tplLevel.set(value);
  }

  protected readonly tplTagChips = computed(() =>
    this.allTags().filter((g) => this.tplTagIds().includes(g.noteTagId)),
  );
  /** Templates grouped by level, nearest first: Matter, Client, System. */
  protected readonly templateGroups = computed(() =>
    (['MATTER', 'CLIENT', 'SYSTEM'] as const)
      .map((scope) => ({
        scope,
        label: this.levelLabel(scope),
        items: this.shownTemplates().filter((t) => t.scope === scope),
      }))
      .filter((g) => g.items.length > 0),
  );

  protected levelLabel(scope: string): string {
    return scope === 'SYSTEM'
      ? 'System Level'
      : scope === 'CLIENT'
        ? 'Client Level'
        : 'Matter Level';
  }

  protected levelIcon(scope: string): string {
    return scope === 'SYSTEM' ? 'pi-globe' : scope === 'CLIENT' ? 'pi-users' : 'pi-briefcase';
  }

  protected onTplTagsFocusOut(e: FocusEvent): void {
    const host = e.currentTarget as HTMLElement;
    if (!host.contains(e.relatedTarget as Node | null)) this.tplTagsOpen.set(false);
  }
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
      this.tplDirty() ||
      (this.editing() &&
        (this.currentHtml() !== this.startedHtml() || this.tagKey() !== this.startedTags())),
  );
  /** Save is on once there is something to save: any change of an open note, or some content in a new note. */
  protected readonly canSave = computed(() =>
    this.note() ? this.dirty() : titleOfHtml(this.currentHtml()) !== '' || this.dirty(),
  );
  protected readonly saveBlocked = computed(() => this.lockedWhileEditing() !== '');
  protected readonly draftTitle = computed(() => titleOfHtml(this.currentHtml()));
  /** The tags a person can pick: the active ones, plus an inactive one the note already has (it stays visible and can be removed). */
  protected readonly pickableTags = computed(() => {
    const q = this.tagQuery().trim().toLowerCase();
    const own = new Set(this.selectedTags().map((t) => t.noteTagId));
    return this.allTags().filter(
      (t) => (t.isActive || own.has(t.noteTagId)) && (!q || t.name.toLowerCase().includes(q)),
    );
  });
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
  protected readonly deleteTagText = computed(() => {
    const names = (this.note()?.tags ?? []).map((t) => t.name);
    if (names.length === 0) return '';
    return names.length > 1
      ? `, and from all ${names.length} tag groups it appears in (${names.join(', ')})`
      : `, and from its tag group (${names[0]})`;
  });

  /** The menu of `@`, `#` and the slash commands searches the API for the open note's matter. */
  protected readonly source = async (kind: SuggestKind, q: string): Promise<SuggestItem[]> => {
    const matterId = this.matterId();
    try {
      switch (kind) {
        case 'template': {
          if (this.templates().length === 0) await this.loadTemplates();
          const needle = q.toLowerCase();
          return this.templates()
            .filter(
              (t) => !needle || `${t.name} ${t.description ?? ''}`.toLowerCase().includes(needle),
            )
            .slice(0, 12)
            .map((t) => ({
              kind: 'template' as const,
              id: t.noteTemplateId,
              label: t.name,
              sub: [t.description, t.tags.map((g) => g.name).join(', ')]
                .filter(Boolean)
                .join(' \u00b7 '),
            }));
        }
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
            sub: [a.assetTypeName, a.externalReference, a.isActive ? '' : 'inactive']
              .filter(Boolean)
              .join(' · '),
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
              sub: `Updated ${n.updatedByName ?? 'someone'}`,
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
    inject(DestroyRef).onDestroy(() => {
      this.stopDrag();
      this.stopWatch?.();
      this.paneObserver?.disconnect();
    });
    afterNextRender(() => {
      const watchers: ResizeObserver[] = [];
      if (typeof ResizeObserver === 'undefined') return;
      const card = this.cardRef()?.nativeElement;
      if (card) {
        const w = new ResizeObserver(() => this.cardWidth.set(card.clientWidth));
        w.observe(card);
        this.cardWidth.set(card.clientWidth);
        watchers.push(w);
      }
      this.stopWatch = () => watchers.forEach((w) => w.disconnect());
    });
    // The note area is measured whenever its element appears (a note is opened).
    effect(() => {
      const el = this.paneRef()?.nativeElement;
      untracked(() => {
        this.paneObserver?.disconnect();
        this.paneObserver = null;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const w = new ResizeObserver(() => this.paneWidth.set(el.clientWidth));
        w.observe(el);
        this.paneWidth.set(el.clientWidth);
        this.paneObserver = w;
      });
    });
    effect(() => {
      this.matterId();
      this.query();
      this.sortValue();
      untracked(() => void this.loadList());
    });
    effect(() => {
      this.matterId();
      untracked(() => {
        void this.loadTags();
        if (this.view() === 'templates') void this.loadTemplates();
      });
    });
    // Unsaved changes: the browser asks before the page is left or reloaded.
    const unload = (e: BeforeUnloadEvent) => {
      if (this.dirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', unload));
    // The closing click of the "New note" menu.
    const close = (e: Event) => {
      const t = e.target as HTMLElement;
      if (this.viewOptionsOpen() && !t.closest('.nt__vo')) this.viewOptionsOpen.set(false);
      if (this.actionsOpen() && !t.closest('.nt__am')) this.actionsOpen.set(false);
    };
    document.addEventListener('click', close);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('click', close));
  }

  private paneObserver: ResizeObserver | null = null;
  private deepLinked = false;

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

  protected otherTags(n: NoteListItem, gid: string) {
    return n.tags.filter((t) => String(t.noteTagId) !== gid);
  }

  protected av(name: string | null | undefined): { bg: string; fg: string } {
    return taskTypeChipColours(avatarKey(name));
  }

  /** The author of a note for its avatar; a server that has not sent the author yet falls back to the person who last updated it. */
  protected author(n: NoteListItem): string | undefined {
    return n.createdByName ?? n.updatedByName;
  }

  protected initials(name: string | null | undefined): string {
    return initialsOf(name);
  }

  protected tagNames(n: NoteResponse): string {
    return n.tags.map((t) => t.name).join(', ');
  }

  protected preview(html: string): string {
    return titleOfHtml(html)
      ? html
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 150)
      : '';
  }

  /** "10 m ago", "3 h ago", "yesterday", "4 d ago" for the history. */
  protected relative(iso: string): string {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return formatAgo(m);
    const h = Math.round(m / 60);
    if (h < 24) return formatAgo(h * 60);
    const d = Math.round(h / 24);
    return d <= 1 ? 'yesterday' : formatAgo(d * 1440);
  }

  /** The text split into plain and highlighted parts (the search words show with a mark). */
  protected marks(text: string | null | undefined): { t: string; hit: boolean }[] {
    const s = text ?? '';
    const q = this.query().trim().toLowerCase();
    if (!q) return [{ t: s, hit: false }];
    const out: { t: string; hit: boolean }[] = [];
    const low = s.toLowerCase();
    let at = 0;
    for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, at)) {
      if (i > at) out.push({ t: s.slice(at, i), hit: false });
      out.push({ t: s.slice(i, i + q.length), hit: true });
      at = i + q.length;
    }
    if (at < s.length) out.push({ t: s.slice(at), hit: false });
    return out;
  }

  protected unlockReason(n: NoteResponse): string {
    return `Only ${n.lockedByName ?? 'the person who locked it'} or an administrator can unlock this note`;
  }

  protected refsOf(kind: string): RefChip[] {
    return this.refChips().filter((r) => r.kind === kind);
  }

  protected tplReason(t: NoteTemplateResponse): string {
    if (t.canEdit && this.canEdit()) return '';
    if (t.scope === 'SYSTEM') return 'System Level templates are changed by an administrator';
    if (t.scope === 'CLIENT')
      return 'Client Level templates are changed by people who may edit clients';
    return 'Changing a matter template needs the Matter Note Edit permission';
  }

  // ---------------------------------------------------------------- list

  protected onSearch(value: string): void {
    this.query.set(value.trim());
  }

  protected setView(v: NoteView): void {
    if (this.view() === v) return;
    this.guard(() => {
      this.view.set(v);
      this.writeText(VIEW_KEY, v);
      this.selTemplate.set(null);
      this.twinId.set(null);
      if (v === 'templates') void this.loadTemplates();
    });
  }

  protected toggleGroup(id: string): void {
    this.collapsed.update((c) => ({ ...c, [id]: !c[id] }));
  }

  protected toggleAll(): void {
    const open = this.anyOpen();
    this.collapsed.set(Object.fromEntries(this.groups().map((g) => [g.id, open])));
  }

  protected clearFilters(): void {
    this.filterValues.set([]);
    this.query.set('');
  }

  protected toggleViewOptions(): void {
    this.actionsOpen.set(false);
    this.viewOptionsOpen.update((o) => !o);
    if (this.viewOptionsOpen()) this.focusFirstItem('[data-view-options-menu]');
  }

  protected toggleActions(): void {
    this.viewOptionsOpen.set(false);
    this.actionsOpen.update((o) => !o);
    if (this.actionsOpen()) this.focusFirstItem('[data-actions-menu]');
  }

  protected closeMenus(): void {
    this.viewOptionsOpen.set(false);
    this.actionsOpen.set(false);
  }

  private focusFirstItem(menu: string): void {
    setTimeout(
      () =>
        document.querySelector<HTMLElement>(`${menu} button:not([aria-disabled="true"])`)?.focus(),
      0,
    );
  }

  /** Up, Down, Home and End move inside an open menu (keys of the widget, not shortcuts, #420); Escape closes it and returns to its button. */
  protected menuNav(ev: KeyboardEvent): void {
    const menu = ev.currentTarget as HTMLElement;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('button'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to =
      ev.key === 'ArrowDown'
        ? (i + 1) % items.length
        : ev.key === 'ArrowUp'
          ? (i - 1 + items.length) % items.length
          : ev.key === 'Home'
            ? 0
            : ev.key === 'End'
              ? items.length - 1
              : -1;
    if (to >= 0) {
      ev.preventDefault();
      items[to].focus();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      const opener = menu.parentElement?.querySelector<HTMLElement>(':scope > button');
      this.closeMenus();
      opener?.focus();
    }
  }

  protected toggleFilter(value: string): void {
    this.filterValues.update((v) =>
      v.includes(value) ? v.filter((x) => x !== value) : [...v, value],
    );
  }

  /** Runs a menu item, or says why it cannot (a disabled item stays visible with its reason). */
  protected onMenu(
    reason: string,
    what: 'pin' | 'lock' | 'unlock' | 'copy' | 'saveTpl' | 'history' | 'refs' | 'delete',
  ): void {
    this.closeMenus();
    if (reason) {
      this.notify.info(reason);
      return;
    }
    if (what === 'pin') void this.togglePin();
    else if (what === 'lock') void this.lockNote();
    else if (what === 'unlock') void this.unlock();
    else if (what === 'copy') void this.copyLink();
    else if (what === 'saveTpl') this.openSaveTemplate();
    else if (what === 'history') this.historyButton();
    else if (what === 'refs') this.refsButton();
    else this.confirmDelete.set(true);
  }

  protected organiseReason(): string {
    if (!this.canEdit()) return 'Needs the Matter Note Edit permission';
    if (this.editing()) return 'Save or cancel your changes first';
    return '';
  }

  protected saveTplReason(): string {
    return this.organiseReason();
  }

  protected deleteReason(n: NoteResponse): string {
    if (!this.canDelete()) return 'Delete needs the Matter Note Delete permission';
    if (n.isLocked) return `Locked by ${n.lockedByName ?? 'someone'}: unlock it before deleting`;
    return '';
  }

  /** The address of this note: the Notes tab of the matter with the note open. */
  protected async copyLink(): Promise<void> {
    const n = this.note();
    if (!n) return;
    const url = new URL(
      this.router.serializeUrl(
        this.router.createUrlTree(['/matters', n.matterId], {
          queryParams: { tab: 'notes', note: n.noteId },
        }),
      ),
      window.location.origin,
    ).toString();
    try {
      await navigator.clipboard.writeText(url);
      this.notify.success('Link copied');
    } catch {
      this.notify.warn(
        "Couldn't copy the link.",
        'Copying is not allowed here. Copy the address from the browser.',
      );
    }
  }

  protected async loadList(): Promise<void> {
    try {
      const sort = this.sortValue() === 'created' ? 'createdAt' : undefined;
      const all: NoteListItem[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const r = await firstValueFrom(
          this.notesApi.listNotes(
            this.matterId(),
            undefined,
            undefined,
            this.query() || undefined,
            page,
            100,
            sort,
          ),
        );
        all.push(...r.items);
        if (all.length >= r.total || r.items.length === 0) break;
      }
      this.allNotes.set(all);
      if (!this.query()) this.totalCount.set(all.length);
      this.listError.set('');
      this.changed.emit();
      const wanted = Number(this.route.snapshot.queryParamMap.get('note'));
      if (wanted > 0 && !this.deepLinked) {
        this.deepLinked = true;
        void this.openNow(wanted, true);
      }
    } catch {
      this.listError.set("Couldn't load the notes.");
    } finally {
      this.loaded.set(true);
    }
  }

  private async loadTags(): Promise<void> {
    try {
      this.allTags.set(await firstValueFrom(this.tagsApi.listNoteTags(false)));
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

  protected open(id: number, byKeyboard = false): void {
    if (this.note()?.noteId === id && !this.editing()) return;
    this.guard(() => void this.openNow(id, byKeyboard));
  }

  private async openNow(id: number, focusTitle = false): Promise<void> {
    try {
      const n = await firstValueFrom(this.notesApi.getNote(id));
      this.selTemplate.set(null);
      this.showNote(n);
      if (focusTitle || this.stacked()) this.focusTitle();
    } catch (e) {
      this.notify.error(
        "Couldn't load the note.",
        e instanceof ApiError && e.status === 404 ? 'It is no longer available.' : undefined,
      );
      void this.loadList();
    }
  }

  private focusTitle(): void {
    setTimeout(() => this.titleRef()?.nativeElement.focus(), 60);
  }

  private showNote(n: NoteResponse): void {
    const split = withoutTitleBlock(n.bodyHtml, n.title);
    this.note.set(n);
    this.editing.set(false);
    this.wide.set(false);
    this.saveError.set('');
    this.lockedWhileEditing.set('');
    this.conflict.set(null);
    this.keepMine.set(false);
    this.tplBanner.set([]);
    this.currentHtml.set(n.bodyHtml);
    this.startedHtml.set(n.bodyHtml);
    this.selectedTags.set([...n.tags]);
    this.startedTags.set(this.tagKey());
    this.draft.set({ html: split.rest, key: `${n.noteId}:${n.rowVersion}:read` });
    void this.loadHistory(n.noteId);
    void this.resolveRefs(n);
  }

  /** What the reader may do with each reference of the note: the chips and the "Referenced Items" list follow the answer (Removed, Restricted, state tags). */
  private async resolveRefs(n: NoteResponse): Promise<void> {
    const refs = (n.references ?? []).filter((r) => r.kind !== 'user');
    if (refs.length === 0) {
      this.refInfo.set({});
      this.refChips.set([]);
      return;
    }
    try {
      const r = await firstValueFrom(
        this.notesApi.resolveNoteReferences({ matterId: n.matterId, references: refs }),
      );
      const info: Record<string, RefInfo> = {};
      const chips: RefChip[] = [];
      const seen = new Set<string>();
      for (const x of r.items as NoteReferenceResolution[]) {
        const kind = x.kind === 'embed' ? 'note' : x.kind;
        const key = `${kind}:${x.id}`;
        const stateText = x.state === 'Inactive' ? (x.detail ?? 'inactive').toLowerCase() : '';
        info[`${x.kind}:${x.id}`] = { state: x.state, stateText };
        if (seen.has(key) || !(REF_KINDS as readonly string[]).includes(kind)) continue;
        seen.add(key);
        chips.push({ kind, id: x.id, label: x.label ?? '', state: x.state, stateText });
      }
      if (this.note()?.noteId === n.noteId) {
        this.refInfo.set(info);
        this.refChips.set(chips);
      }
    } catch {
      this.refInfo.set({});
      this.refChips.set([]);
    }
  }

  /** A chip or "Open note": an asset, project or matter opens in a new window; another note of the matter opens here. */
  protected openRef(e: { kind: string; id: number }): void {
    if (e.kind === 'note' || e.kind === 'embed') {
      this.open(e.id, true);
      return;
    }
    const base = e.kind === 'asset' ? '/assets' : e.kind === 'project' ? '/projects' : '/matters';
    window.open(
      this.router.serializeUrl(this.router.createUrlTree([base, e.id])),
      '_blank',
      'noopener',
    );
  }

  protected newNote(): void {
    this.guard(() => {
      this.selTemplate.set(null);
      this.startNew('', []);
    });
  }

  private startNew(html: string, tags: NoteTemplateResponse['tags']): void {
    this.note.set(null);
    this.saveError.set('');
    this.lockedWhileEditing.set('');
    this.conflict.set(null);
    this.keepMine.set(false);
    this.currentHtml.set(html);
    this.startedHtml.set('');
    this.selectedTags.set(tags.map((t) => ({ ...t })));
    this.startedTags.set('');
    this.history.set([]);
    this.refChips.set([]);
    this.draft.set({ html, key: `new:${Date.now()}` });
    this.editing.set(true);
    this.wide.set(!this.stacked());
  }

  protected onEditClick(ev: Event): void {
    if (!this.lock().canEdit) {
      ev.preventDefault();
      const n = this.note();
      this.notify.info(`Note locked by ${n?.lockedByName ?? 'someone'}`);
      return;
    }
    this.edit();
  }

  protected edit(): void {
    const n = this.note();
    if (!n || !this.lock().canEdit) return;
    this.startedHtml.set(n.bodyHtml);
    this.currentHtml.set(n.bodyHtml);
    this.draft.set({ html: n.bodyHtml, key: `${n.noteId}:${n.rowVersion}:edit` });
    this.editing.set(true);
    this.saveError.set('');
    this.wide.set(!this.stacked());
  }

  /** `/template`: the body goes in at the cursor; in an empty note the title line and the suggested tags come too (as From template does). */
  protected onTemplateChosen(id: number): void {
    const t = this.templates().find((x) => x.noteTemplateId === id);
    const ed = this.editorRef();
    if (!t || !ed) return;
    const values = placeholderValues(new Date(), this.matterLabel(), this.auth.displayName());
    const body = resolvePlaceholders(t.bodyHtml, values);
    if (ed.isEmpty()) {
      ed.applyTemplate(body, true);
      this.tplBanner.set(t.tags.filter((x) => x.isActive));
    } else {
      ed.applyTemplate(body, false);
    }
    void firstValueFrom(this.templatesApi.useNoteTemplate(t.noteTemplateId)).catch(() => undefined);
    const open = openPlaceholders(body);
    this.notify.info(
      'Template inserted',
      open.length > 0 ? `"${t.name}". Fill in: ${open.join(', ')}.` : t.name,
    );
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
    this.wide.set(false);
    if (n) {
      this.showNote(n);
      this.focusTitle();
    } else {
      this.editing.set(false);
      this.draft.set(null);
    }
  }

  protected closePanel(): void {
    this.guard(() => {
      this.note.set(null);
      this.draft.set(null);
      this.selTemplate.set(null);
      this.tplEditMode.set(false);
      this.editing.set(false);
      this.wide.set(false);
    });
  }

  /** The answer "Discard changes" of the confirmation: drop the edits, then do what was waiting (cancel, open another note, new note). */
  protected proceedDiscard(): void {
    this.confirmDiscard.set(false);
    const go = this.pendingAfterDiscard;
    this.pendingAfterDiscard = null;
    this.editing.set(false);
    this.tplEditMode.set(false);
    this.currentHtml.set(this.startedHtml());
    go?.();
  }

  protected onSaveClick(): void {
    if (this.saveBlocked()) {
      this.notify.info(
        `Note locked by ${this.lockedWhileEditing()}`,
        'Your changes cannot be saved.',
      );
      return;
    }
    void this.save();
  }

  protected async save(): Promise<void> {
    const html = this.editorRef()?.getHtml() ?? this.currentHtml();
    if (html.length > 100_000) {
      this.notify.warn('Note too large', 'The limit is 100 KB of formatted text.');
      return;
    }
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
              ackWarnings: check?.ackWarnings,
              ackWarningReasons: check?.reasons,
              rowVersion: this.keepMine()
                ? ((await this.latestRowVersion(n.noteId)) ?? n.rowVersion)
                : n.rowVersion,
            }),
          )
        : await firstValueFrom(
            this.notesApi.createNote({
              matterId: this.matterId(),
              bodyHtml: html,
              tagIds,
            }),
          );
      this.notify.success('Note saved');
      this.showNote(saved);
      this.focusTitle();
      await this.loadList();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NOTE_LOCKED') {
        const who = (e.problem?.meta?.['lockedByName'] as string | undefined) ?? 'someone';
        this.lockedWhileEditing.set(who);
      } else if (e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT') {
        await this.showConflict();
      } else if (e instanceof ApiError && e.hasFieldErrors) {
        this.saveError.set(Object.values(e.problem?.errors ?? {})[0]?.[0]?.message ?? e.message);
      } else {
        this.saveError.set(
          e instanceof ApiError ? e.message : "Couldn't save the note. Try again.",
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async latestRowVersion(id: number): Promise<string | null> {
    try {
      return (await firstValueFrom(this.notesApi.getNote(id))).rowVersion;
    } catch {
      return null;
    }
  }

  /** Someone saved the note while it was open here: say who and when, and offer "Reload their version" and "Keep mine". */
  private async showConflict(): Promise<void> {
    const n = this.note();
    if (!n) return;
    try {
      const latest = await firstValueFrom(this.notesApi.getNote(n.noteId));
      if (latest.isLocked) {
        // The change that made the saved copy newer was somebody locking the note: say that, not "someone saved".
        this.lockedWhileEditing.set(latest.lockedByName ?? 'someone');
        return;
      }
      this.conflict.set({
        who: latest.updatedByName ?? 'Someone',
        at: latest.updatedAtUtc,
      });
    } catch {
      this.saveError.set('Someone else changed this note while you were editing.');
    }
  }

  protected async reloadTheirs(): Promise<void> {
    const n = this.note();
    if (!n) return;
    this.editing.set(false);
    this.currentHtml.set(this.startedHtml());
    await this.openNow(n.noteId, true);
    this.notify.info('Their version loaded');
  }

  protected async copyMine(): Promise<void> {
    const text = this.currentHtml()
      .replace(/<\/(p|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    try {
      await navigator.clipboard.writeText(text.replace(/[ \t]+/g, ' ').trim());
      this.notify.success('Text copied');
    } catch {
      this.notify.warn(
        "Couldn't copy the text.",
        'Copying is not allowed here. Select your text and copy it by hand.',
      );
    }
  }

  protected closeLockedWarning(): void {
    this.lockedWhileEditing.set('');
    const n = this.note();
    this.editing.set(false);
    this.currentHtml.set(this.startedHtml());
    if (n) void this.openNow(n.noteId, true);
  }

  // ---------------------------------------------------------------- tags

  protected toggleTag(tag: TagRow): void {
    if (!this.editing()) return;
    this.selectedTags.update((list) =>
      list.some((t) => t.noteTagId === tag.noteTagId)
        ? list.filter((t) => t.noteTagId !== tag.noteTagId)
        : list.length < MAX_TAGS
          ? [...list, tag]
          : list,
    );
  }

  protected removeTag(id: number): void {
    this.selectedTags.update((l) => l.filter((t) => t.noteTagId !== id));
    setTimeout(() => this.addTagRef()?.nativeElement.focus(), 30);
  }

  protected applyTplTags(): void {
    for (const t of this.tplBanner()) {
      if (this.selectedTags().length < MAX_TAGS && !this.hasTag(t.noteTagId))
        this.selectedTags.update((l) => [...l, { ...t }]);
    }
    this.tplBanner.set([]);
  }

  // ---------------------------------------------------------------- pin, lock, delete

  protected onUnlockClick(ev: Event): void {
    const n = this.note();
    if (!n) return;
    if (!this.lock().canUnlock) {
      ev.preventDefault();
      this.notify.info(this.unlockReason(n));
      return;
    }
    void this.unlock();
  }

  protected async togglePin(): Promise<void> {
    const n = this.note();
    if (!n) return;
    await this.change(
      () =>
        firstValueFrom(
          this.notesApi.setNotePinned(n.noteId, { pinned: !n.isPinned, rowVersion: n.rowVersion }),
        ),
      n.isPinned ? ['Note unpinned'] : ['Note pinned', 'It stays at the top of its group.'],
    );
  }

  protected async lockNote(): Promise<void> {
    const n = this.note();
    if (n)
      await this.change(
        () => firstValueFrom(this.notesApi.lockNote(n.noteId, { rowVersion: n.rowVersion })),
        ['Note locked', 'It is read only for everybody.'],
      );
  }

  protected async unlock(): Promise<void> {
    const n = this.note();
    if (n)
      await this.change(
        () => firstValueFrom(this.notesApi.unlockNote(n.noteId, { rowVersion: n.rowVersion })),
        ['Note unlocked'],
      );
  }

  private async change(
    call: () => Promise<NoteResponse>,
    done: readonly [title: string, detail?: string],
  ): Promise<void> {
    try {
      this.showNote(await call());
      this.notify.info(done[0], done[1]);
      await this.loadList();
    } catch (e) {
      this.notify.error(
        "Couldn't complete that.",
        e instanceof ApiError ? e.message : 'Try again.',
      );
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
      this.editing.set(false);
      this.wide.set(false);
      this.notify.success('Note deleted');
      await this.loadList();
      setTimeout(
        () => (document.querySelector('[data-new-note]') as HTMLElement | null)?.focus(),
        60,
      );
    } catch (e) {
      this.confirmDelete.set(false);
      this.notify.error("Couldn't delete the note.", e instanceof ApiError ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- history

  private async loadHistory(id: number): Promise<void> {
    try {
      this.history.set((await firstValueFrom(this.notesApi.getNoteHistory(id))).items);
    } catch {
      this.history.set([]);
    }
  }

  protected historyButton(): void {
    if (this.histWide()) this.toggleSide('history');
    else void this.openHistory();
  }

  protected refsButton(): void {
    if (this.histWide()) this.toggleSide('refs');
    else this.panel.set('refs');
  }

  /** Clicking the icon of the open panel closes it; the other icon swaps the content. */
  protected toggleSide(kind: 'history' | 'refs'): void {
    this.setSide(this.sideOpen() === kind ? 'none' : kind);
  }

  protected closeSide(): void {
    this.setSide('none');
    setTimeout(
      () => (document.querySelector('[data-history-rail]') as HTMLElement | null)?.focus(),
      30,
    );
  }

  private setSide(v: 'history' | 'refs' | 'none'): void {
    this.sideOpen.set(v);
    this.writeText(HIST_OPEN_KEY, v);
  }

  private readSide(): 'history' | 'refs' | 'none' {
    try {
      const v = localStorage.getItem(HIST_OPEN_KEY);
      return v === 'refs' || v === 'none' ? v : 'history';
    } catch {
      return 'history';
    }
  }

  protected dragStartHist(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.histWidth();
    this.dragging.set(true);
    this.dragMove = (e) => this.histWidth.set(this.clampHist(startWidth - (e.clientX - startX)));
    this.dragEnd = () => {
      this.stopDrag();
      this.writeNumber(HIST_WIDTH_KEY, this.histWidth());
    };
    window.addEventListener('pointermove', this.dragMove);
    window.addEventListener('pointerup', this.dragEnd);
  }

  /** The history splitter has the same keys as the list splitter; the column is on the right, so ArrowLeft makes it wider. */
  protected histKey(e: KeyboardEvent): void {
    const next =
      e.key === 'ArrowLeft'
        ? this.histWidth() + SPLIT_STEP
        : e.key === 'ArrowRight'
          ? this.histWidth() - SPLIT_STEP
          : e.key === 'Home'
            ? SPLIT_MIN
            : e.key === 'End'
              ? this.histMax
              : null;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.histReset();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    this.histWidth.set(this.clampHist(next));
    this.writeNumber(HIST_WIDTH_KEY, this.histWidth());
  }

  protected histReset(): void {
    this.histWidth.set(300);
    this.writeNumber(HIST_WIDTH_KEY, 300);
    this.notify.info('Width reset');
  }

  private clampHist(w: number): number {
    return Math.min(this.histMax, Math.max(SPLIT_MIN, Math.round(w)));
  }

  protected async openHistory(): Promise<void> {
    const n = this.note();
    if (!n) return;
    this.panel.set('history');
    await this.loadHistory(n.noteId);
  }

  // ---------------------------------------------------------------- templates

  private async loadTemplates(): Promise<void> {
    try {
      this.templates.set(
        await firstValueFrom(this.templatesApi.listNoteTemplates(this.matterId())),
      );
    } catch {
      this.templates.set([]);
      this.notify.error("Couldn't load the templates.");
    }
  }

  /** Opens a template in the panel (the Templates view). */
  protected openTemplate(t: NoteTemplateResponse): void {
    this.guard(() => {
      this.note.set(null);
      this.draft.set(null);
      this.editing.set(false);
      this.tplEditMode.set(false);
      this.selTemplate.set(t);
    });
  }

  /** A template button: a disabled one says why instead of doing something. */
  protected onTemplateAction(
    ev: Event,
    reason: string,
    what: 'edit' | 'del',
    t: NoteTemplateResponse,
  ): void {
    ev.stopPropagation();
    if (reason) {
      this.notify.info(reason);
      return;
    }
    if (what === 'edit') this.editTemplate(t);
    else {
      this.tplToDelete.set(t);
      this.confirmDeleteTpl.set(true);
    }
  }

  /** Edit mode of the open template, in the note panel (name, description, title, text, tags). */
  protected editTemplate(t: NoteTemplateResponse | null): void {
    this.tplEditing.set(t);
    this.tplName.set(t?.name ?? '');
    this.tplDescription.set(t?.description ?? '');
    this.tplTagIds.set(t ? t.tags.map((x) => x.noteTagId) : []);
    this.tplHtml.set(t?.bodyHtml ?? '');
    this.tplKey.set(`${t?.noteTemplateId ?? 'new'}:${Date.now()}`);
    this.tplLevel.set((t?.scope as 'MATTER' | 'CLIENT' | 'SYSTEM' | undefined) ?? 'MATTER');
    this.tplTagsOpen.set(false);
    this.tplError.set('');
    this.tplStart.set(this.tplSnapshot());
    this.tplEditMode.set(true);
  }

  protected cancelTemplate(): void {
    const back = () => {
      this.tplEditMode.set(false);
    };
    if (this.tplDirty()) {
      this.pendingAfterDiscard = back;
      this.confirmDiscard.set(true);
    } else {
      back();
    }
  }

  protected toggleTplTag(id: number): void {
    this.tplTagIds.update((l) =>
      l.includes(id) ? l.filter((x) => x !== id) : l.length < MAX_TAGS ? [...l, id] : l,
    );
  }

  protected async saveTemplateEdit(): Promise<void> {
    if (!this.tplName().trim()) {
      this.tplError.set('Enter a name.');
      return;
    }
    this.busy.set(true);
    try {
      const t = this.tplEditing();
      const common = {
        name: this.tplName().trim(),
        description: this.tplDescription().trim() || undefined,
        // "Title when used" is no longer edited; a stored value is passed through unchanged (MD-41; the column is for later cleanup)
        titleTemplate: t?.titleTemplate ?? undefined,
        bodyHtml: this.tplHtml(),
        tagIds: this.tplTagIds(),
      };
      if (!t) return;
      const level = this.tplLevel();
      const moved =
        level !== t.scope
          ? {
              scope: level,
              matterId: level === 'MATTER' ? this.matterId() : undefined,
              clientId: level === 'CLIENT' ? this.clientId() : undefined,
            }
          : {};
      const saved = await firstValueFrom(
        this.templatesApi.updateNoteTemplate(t.noteTemplateId, {
          ...common,
          ...moved,
          rowVersion: t.rowVersion,
        }),
      );
      this.notify.success('Template saved');
      this.tplEditMode.set(false);
      await this.loadTemplates();
      this.selTemplate.set(
        this.templates().find((x) => x.noteTemplateId === saved.noteTemplateId) ?? saved,
      );
    } catch (e) {
      this.tplError.set(e instanceof ApiError ? e.message : "Couldn't save the template.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteTemplate(): Promise<void> {
    const t = this.tplToDelete();
    if (!t) return;
    try {
      await firstValueFrom(this.templatesApi.deleteNoteTemplate(t.noteTemplateId, t.rowVersion));
      this.confirmDeleteTpl.set(false);
      if (this.selTemplate()?.noteTemplateId === t.noteTemplateId) this.selTemplate.set(null);
      this.notify.success('Template deleted');
      await this.loadTemplates();
    } catch (e) {
      this.confirmDeleteTpl.set(false);
      this.notify.error(
        "Couldn't delete the template.",
        e instanceof ApiError ? e.message : undefined,
      );
    }
  }

  protected openSaveTemplate(): void {
    const n = this.note();
    if (!n) return;
    this.tplName.set(n.title);
    this.tplDescription.set('');
    this.tplLevel.set('MATTER');
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
      const level = this.tplLevel();
      await firstValueFrom(
        this.templatesApi.createNoteTemplate({
          scope: level,
          matterId: level === 'MATTER' ? this.matterId() : undefined,
          clientId: level === 'CLIENT' ? this.clientId() : undefined,
          name: this.tplName().trim(),
          description: this.tplDescription().trim() || undefined,
          bodyHtml: n.bodyHtml,
          tagIds: this.tplTags() ? n.tags.filter((t) => t.isActive).map((t) => t.noteTagId) : [],
        }),
      );
      this.panel.set('none');
      this.notify.success(
        'Template saved',
        `Find "${this.tplName().trim()}" under Templates or with New note, From template.`,
      );
    } catch (e) {
      this.tplError.set(e instanceof ApiError ? e.message : "Couldn't save the template.");
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- keys and splitter

  /** Escape closes an open note on a narrow screen (a dialog or a menu takes it first); a menu of the editor stops it itself. */
  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && (this.viewOptionsOpen() || this.actionsOpen())) {
      e.preventDefault();
      this.closeMenus();
      return;
    }
    if (e.key === 'Escape' && (e.target as HTMLElement).closest('.nt__phist')) {
      e.preventDefault();
      this.closeSide();
      return;
    }
    if (
      e.key === 'Escape' &&
      this.stacked() &&
      this.showPanel() &&
      !e.defaultPrevented &&
      !(e.target as HTMLElement).closest('.ne__menu, .ne__dlg')
    ) {
      this.closePanel();
    }
  }

  private stopWatch: (() => void) | null = null;
  private dragMove: ((e: PointerEvent) => void) | null = null;
  private dragEnd: (() => void) | null = null;

  protected dragStart(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.listWidth();
    this.dragging.set(true);
    this.dragMove = (e) =>
      this.split.set(clampSplit(startWidth + e.clientX - startX, this.splitMaxNow()));
    this.dragEnd = () => {
      this.stopDrag();
      this.saveSplit();
    };
    window.addEventListener('pointermove', this.dragMove);
    window.addEventListener('pointerup', this.dragEnd);
  }

  private stopDrag(): void {
    this.dragging.set(false);
    if (this.dragMove) window.removeEventListener('pointermove', this.dragMove);
    if (this.dragEnd) window.removeEventListener('pointerup', this.dragEnd);
    this.dragMove = null;
    this.dragEnd = null;
  }

  /** Left and Right move the splitter by 16 px; Home and End go to the limits, Enter (or a double click) resets it. Keys of the widget, not app shortcuts (#420). */
  protected splitKey(e: KeyboardEvent): void {
    const cur = this.listWidth();
    const next =
      e.key === 'ArrowLeft'
        ? cur - SPLIT_STEP
        : e.key === 'ArrowRight'
          ? cur + SPLIT_STEP
          : e.key === 'Home'
            ? SPLIT_MIN
            : e.key === 'End'
              ? this.splitMaxNow()
              : null;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.splitReset();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    this.split.set(clampSplit(next, this.splitMaxNow()));
    this.saveSplit();
  }

  protected splitReset(): void {
    this.split.set(SPLIT_DEFAULT);
    this.saveSplit();
    this.notify.info('Width reset');
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

  private readHistWidth(): number {
    return Math.min(this.histMax, Math.max(SPLIT_MIN, this.readNumber(HIST_WIDTH_KEY, 300)));
  }

  private readView(): NoteView {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === 'latest' || v === 'tag' ? v : 'tag';
    } catch {
      return 'tag';
    }
  }

  private readNumber(key: string, fallback: number): number {
    try {
      const v = Number(localStorage.getItem(key));
      return localStorage.getItem(key) === null || !Number.isFinite(v) ? fallback : v;
    } catch {
      return fallback;
    }
  }

  private writeNumber(key: string, value: number): void {
    this.writeText(key, String(value));
  }

  private writeText(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Remembering is a convenience.
    }
  }
}
