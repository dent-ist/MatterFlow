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
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NoteListItem, NotesClient } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { NoteTagChip } from '../../notes/note-tag-chip';
import { LoadState } from '../../../shared/ui/data-table';
import { numericInstant, readableInstant } from '../../../shared/ui/numeric-date';
import { shortAccountName } from '../../../shared/ui/person-name';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { SECTION_ROWS, type SectionStats } from '../../../shared/ui/section-card';

/**
 * The Notes section of the one-page Matter (#1396): the most recently updated notes as a compact list (Title, Tags, Author, Last Updated), 10 at most. A title opens the Notes full view
 * on that note (`?tab=notes&note=<id>`); the editor, search, tag filters, templates and history stay there (D-03b). "Add Note" in the section header opens the full view with a new
 * note ready. Needs `MatterNote.View`; nothing is asked before `active` is true.
 */
@Component({
  selector: 'mf-matter-notes-section',
  imports: [RecordGrid, RecordCell, RouterLink, NoteTagChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    td.mn-title {
      width: 100%;
      max-width: 0;
    }
    .mn-tags {
      display: flex;
      gap: var(--mf-s1);
      overflow: hidden;
    }
  `,
  template: `
    <mf-record-grid
      label="Notes list"
      caption="Most recently updated notes of this matter"
      noun="notes"
      emptyText="No notes yet."
      [grid]="grid"
      [compact]="true"
      [skeletonRows]="10"
      [rows]="rows()"
      [rowKey]="noteKey"
      [loadState]="state()"
      [empty]="rows().length === 0"
      (retry)="load()"
    >
      <ng-template mfCell="title" let-n>
        <td class="mn-title">
          <a
            class="mf-link pg-clip"
            data-note-open
            [routerLink]="['/matters', matterId()]"
            [queryParams]="{ tab: 'notes', note: n.noteId }"
            [title]="n.title"
            >{{ n.title }}</a
          >
        </td>
      </ng-template>
      <ng-template mfCell="tags" let-n>
        <td>
          <span class="mn-tags">
            @for (g of n.tags; track g.noteTagId) {
              <mf-note-tag [name]="g.name" [colourKey]="g.colourKey" />
            }
          </span>
        </td>
      </ng-template>
      <ng-template mfCell="author" let-n>
        <td>
          <span class="pg-clip-fit" [attr.title]="author(n)">{{ author(n) }}</span>
        </td>
      </ng-template>
      <ng-template mfCell="updated" let-n>
        <td>
          <time [attr.datetime]="n.updatedAtUtc" [attr.title]="long(n)">{{ stamp(n) }}</time>
        </td>
      </ng-template>
    </mf-record-grid>
  `,
})
export class MatterNotesSection {
  readonly matterId = input.required<number>();
  /** False until the section is near the window: nothing is requested before. */
  readonly active = input(false);
  /** Counts up when a note changed elsewhere: the list is read again. */
  readonly reloadTick = input(0);
  readonly stats = output<SectionStats>();

  private readonly api = inject(NotesClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly gridDefs = signal<RecordGridColumn[]>([
    { key: 'title', label: 'Title', locked: true, minWidth: '200px' },
    { key: 'tags', label: 'Tags', width: '208px', minWidth: '208px' },
    { key: 'author', label: 'Author', width: '176px', minWidth: '176px' },
    { key: 'updated', label: 'Last Updated', width: '152px', minWidth: '152px' },
  ]);
  protected readonly grid = new RecordGridState('matter-notes-section', this.gridDefs);
  protected readonly noteKey = (n: NoteListItem): number => n.noteId;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<NoteListItem[]>([]);
  private readonly total = signal(0);
  private requestId = 0;

  constructor() {
    effect(() => {
      this.matterId();
      this.reloadTick();
      if (!this.active()) return;
      untracked(() => void this.load());
    });
    effect(() => {
      const state = this.state();
      const shown = this.rows().length;
      const total = this.total();
      untracked(() =>
        this.stats.emit({
          state: state === 'ready' ? 'ready' : state === 'error' ? 'error' : 'loading',
          shown,
          total,
        }),
      );
    });
  }

  protected async load(): Promise<void> {
    const id = ++this.requestId;
    this.state.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.listNotes(this.matterId(), undefined, undefined, undefined, 1, SECTION_ROWS),
      );
      if (id !== this.requestId) return;
      this.rows.set(page.items);
      this.total.set(page.total);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }

  protected author(n: NoteListItem): string {
    const name = n.updatedByName ?? n.createdByName ?? '';
    return shortAccountName(name) || name;
  }

  protected stamp(n: NoteListItem): string {
    return numericInstant(n.updatedAtUtc, this.clock.now(), this.zone);
  }

  protected long(n: NoteListItem): string {
    return readableInstant(n.updatedAtUtc, this.zone);
  }
}
