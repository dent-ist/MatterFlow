import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  signal,
} from '@angular/core';
import { LIST_BODY } from '../lists/list-body';
import { AdminTabCounts } from '../admin-tabs';
import { firstValueFrom } from 'rxjs';
import { NoteTagResponse, NoteTagsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { TASK_TYPE_COLOURS } from '../../../shared/task-type/task-type-colours';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { adminListState } from '../../../shared/ui/admin-list-state';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { LocalPaging } from '../../../shared/ui/local-paging';
import { Pager } from '../../../shared/ui/pager';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { rowActions } from '../../../shared/ui/row-actions';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { TextField } from '../../../shared/ui/text-field';
import { IntPipe } from '../../../shared/ui/number-format';
import { Button } from 'primeng/button';
import { TagChip } from '../../../shared/ui/tag-chip';

/**
 * Admin: Note Tags (epic #1001, MD-19; mockup notes-mockup-r3), the Notes list of Administration > Lists (it was the fourth tab of the Labels page). The firm-wide tags people pick in a note: name, colour of the
 * ten-colour palette, active or not, and how many notes the person can see that use it. A tag that notes use is deactivated, not deleted (the server says 409 IN_USE).
 * Needs `StatusLabel.Manage`. The header belongs to `mf-list-editor`, which calls `openNew()`. The list is the shared record grid (#1205, D-44a): the
 * empty, error and loading bodies are the grid's.
 */
@Component({
  selector: 'mf-note-tags-page',
  providers: [{ provide: LIST_BODY, useExisting: forwardRef(() => NoteTagsPage) }],
  imports: [
    Button,
    IntPipe,
    ActionMenu,
    ActiveBadge,
    ConfirmDialog,
    Pager,
    Dropdown,
    RecordGrid,
    RecordCell,
    FormDialog,
    TextField,
    TagChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <mf-record-grid
      data-note-tags-table
      label="Note Tags"
      noun="tags"
      [grid]="grid"
      [rows]="paging.slice(tags())"
      [rowKey]="tagKey"
      [loadState]="ls.state()"
      [empty]="ls.empty()"
      emptyText="No tags yet."
      [bones]="bones"
      [actions]="true"
      (retry)="load()"
    >
      <p-button mfEmptyAction label="New Tag" icon="pi pi-plus" (onClick)="openNew()" />
      <ng-template mfCell="name" let-t>
        <td data-note-tag-row>
          <mf-tag-chip [colour]="t.colourKey || 'slate'">{{ t.name }}</mf-tag-chip>
        </td>
      </ng-template>
      <ng-template mfCell="colour" let-t>
        <td>{{ colourLabel(t.colourKey) }}</td>
      </ng-template>
      <ng-template mfCell="notes" let-t>
        <td class="pg-num">{{ t.visibleNoteCount | mfInt }}</td>
      </ng-template>
      <ng-template mfCell="status" let-t>
        <td><mf-active-badge [active]="t.isActive" /></td>
      </ng-template>
      <ng-template mfCell="actions" let-t>
        <td class="mf-col-actions">
          @let menu = menuFor(t);
          <mf-action-menu [floating]="true" [label]="menu.label" [items]="menu.items" />
        </td>
      </ng-template>
      @if (ls.view() === 'rows') {
        <div mfGridFoot>
          <mf-pager
            [page]="paging.page()"
            [pageSize]="paging.size()"
            [pageSizes]="paging.sizes"
            [total]="tags().length"
            (pageChange)="paging.goTo($event)"
            (pageSizeChange)="paging.setSize($event)"
          />
        </div>
      }
    </mf-record-grid>
    <mf-form-dialog
      [title]="editing() ? 'Edit Tag' : 'New Tag'"
      [primaryLabel]="editing() ? 'Save Tag' : 'Create Tag'"
      [busy]="busy()"
      [error]="formError()"
      [dirty]="false"
      [(visible)]="panel"
      (submitted)="save()"
    >
      @if (panel()) {
        <mf-text-field
          inputId="nt-name"
          label="Name"
          [required]="true"
          [maxLength]="60"
          [(value)]="name"
        />
        <div class="nt-colour">
          <label class="mf-label" id="nt-colour-label" for="nt-colour">Color</label>
          <mf-dropdown
            field
            buttonId="nt-colour"
            label="Color"
            [items]="colourItems"
            [value]="colour()"
            (valueChange)="colour.set($event)"
          />
        </div>
      }
    </mf-form-dialog>
    <mf-confirm-dialog
      title="Delete Tag"
      confirmLabel="Delete Tag"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="confirmDelete"
      (confirmed)="remove()"
    >
      <p>{{ target()?.name }} is deleted; no note or template uses it. This cannot be undone.</p>
    </mf-confirm-dialog>
  `,
  styles: `
    .nt-colour {
      display: grid;
      gap: var(--mf-s1);
      justify-items: start;
      margin-top: var(--mf-s3);
    }
  `,
})
export class NoteTagsPage {
  private readonly api = inject(NoteTagsClient);
  private readonly notify = inject(NotificationService);
  private readonly report = AdminTabCounts.report('note-tags');

  protected readonly paging = new LocalPaging();
  protected readonly tags = signal<NoteTagResponse[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly ls = adminListState({ state: this.state, rows: this.tags });
  protected readonly tagKey = (t: NoteTagResponse): number => t.noteTagId;
  /** The columns: Name is the spring; the others have fixed widths so the headings never move between loading, empty, error and rows. */
  protected readonly gridDefs = signal<readonly RecordGridColumn[]>([
    { key: 'name', label: 'Name', locked: true, minWidth: '200px' },
    { key: 'colour', label: 'Color', width: 'var(--mf-col-status-w)', minWidth: '120px' },
    {
      key: 'notes',
      label: 'Notes',
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    {
      key: 'status',
      label: 'Status',
      width: 'var(--mf-col-status-w)',
      minWidth: 'var(--mf-col-status-w)',
    },
  ]);
  protected readonly grid = new RecordGridState('admin-note-tags', this.gridDefs);
  protected readonly bones: Record<string, string> = {
    name: '8rem',
    colour: '4rem',
    notes: '2rem',
    status: '4.5rem',
  };
  protected readonly panel = signal(false);
  protected readonly editing = signal<NoteTagResponse | null>(null);
  protected readonly target = signal<NoteTagResponse | null>(null);
  protected readonly confirmDelete = signal(false);
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected name = signal('');
  protected readonly colour = signal('');
  protected readonly colourItems: DropdownItem[] = [
    ...TASK_TYPE_COLOURS.map((c) => ({ value: c.key, label: c.label })),
  ];
  /** The number of tags, for the tab name. */
  readonly count = computed(() => this.tags().length);

  constructor() {
    void this.load();
  }

  /** The row menu (D-44, #1153): Edit, Deactivate / Activate, Delete last and set apart (disabled with its reason while notes use the tag). */
  protected menuFor(t: NoteTagResponse) {
    return rowActions(
      t.name,
      [
        { id: 'edit', label: 'Edit', icon: 'pi-pencil', run: () => this.openEdit(t) },
        {
          id: 'toggle',
          label: t.isActive ? 'Deactivate' : 'Activate',
          kind: 'state',
          run: () => void this.toggle(t),
        },
        {
          id: 'delete',
          label: 'Delete',
          icon: 'pi-trash',
          danger: true,
          reason: t.isInUse ? 'Notes or templates use this tag. Deactivate it instead.' : undefined,
          run: () => this.askDelete(t),
        },
      ],
      { can: () => true },
    );
  }

  protected colourLabel(key?: string | null): string {
    return this.colourItems.find((c) => c.value === (key ?? ''))?.label ?? 'Blue';
  }

  protected async load(): Promise<void> {
    if (this.tags().length === 0) this.state.set('loading');
    try {
      this.tags.set(await firstValueFrom(this.api.listNoteTags(true)));
      this.reportCount();
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  /** The catalogue and the editor header count the ACTIVE tags (the list is asked with `includeInactive=true`, so inactive ones are in it). */
  private reportCount(): void {
    this.report(this.tags().filter((t) => t.isActive).length);
  }

  /** Leaving with the New or Edit panel open and the text changed is unsaved work (the dialog itself asks nothing, as before). */
  hasUnsavedChanges(): boolean {
    if (!this.panel()) return false;
    const t = this.editing();
    return t ? this.name().trim() !== t.name : this.name().trim() !== '';
  }

  openNew(): void {
    this.editing.set(null);
    this.name.set('');
    // Every tag has a colour: the first palette colour no other tag uses (the palette order), or the first one when all are taken.
    const used = new Set(this.tags().map((t) => t.colourKey));
    this.colour.set((TASK_TYPE_COLOURS.find((c) => !used.has(c.key)) ?? TASK_TYPE_COLOURS[0]).key);
    this.formError.set('');
    this.panel.set(true);
  }

  protected openEdit(t: NoteTagResponse): void {
    this.editing.set(t);
    this.name.set(t.name);
    this.colour.set(t.colourKey ?? TASK_TYPE_COLOURS[0].key);
    this.formError.set('');
    this.panel.set(true);
  }

  protected async save(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.formError.set('Enter a name.');
      return;
    }
    this.busy.set(true);
    try {
      const t = this.editing();
      if (t) {
        await firstValueFrom(
          this.api.updateNoteTag(t.noteTagId, {
            name,
            colourKey: this.colour() || undefined,
            isActive: t.isActive,
            rowVersion: t.rowVersion,
          }),
        );
      } else {
        await firstValueFrom(
          this.api.createNoteTag({ name, colourKey: this.colour() || undefined }),
        );
      }
      this.panel.set(false);
      this.notify.success(t ? 'Tag saved' : 'Tag created');
      await this.load();
    } catch (e) {
      this.formError.set(this.message(e, "Couldn't save the tag."));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(t: NoteTagResponse): Promise<void> {
    try {
      await firstValueFrom(
        this.api.updateNoteTag(t.noteTagId, {
          name: t.name,
          colourKey: t.colourKey ?? undefined,
          isActive: !t.isActive,
          rowVersion: t.rowVersion,
        }),
      );
      await this.load();
    } catch (e) {
      this.notify.error("Couldn't change the tag.", this.reason(e));
      await this.load();
    }
  }

  protected askDelete(t: NoteTagResponse): void {
    this.target.set(t);
    this.confirmDelete.set(true);
  }

  protected async remove(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deleteNoteTag(t.noteTagId, t.rowVersion));
      this.confirmDelete.set(false);
      this.notify.success('Tag deleted');
      await this.load();
    } catch (e) {
      this.confirmDelete.set(false);
      this.notify.error("Couldn't delete the tag.", this.reason(e));
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  private message(e: unknown, fallback: string): string {
    return e instanceof ApiError ? e.message : fallback;
  }

  /** The reason line of an error toast: the server's sentence, or nothing. */
  private reason(e: unknown): string | undefined {
    return e instanceof ApiError ? e.message : undefined;
  }
}
