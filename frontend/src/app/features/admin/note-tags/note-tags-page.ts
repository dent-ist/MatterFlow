import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { NoteTagResponse, NoteTagsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import {
  TASK_TYPE_COLOURS,
  taskTypeChipColours,
} from '../../../shared/task-type/task-type-colours';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { GridFrame } from '../../../shared/ui/grid-frame';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { TextField } from '../../../shared/ui/text-field';

/**
 * Admin: Notes tags (epic #1001, MD-19; mockup notes-mockup-r3), the fourth tab of the Labels page. The firm-wide tags people pick in a note: name, colour of the
 * ten-colour palette, active or not, and how many notes the person can see that use it. A tag that notes use is deactivated, not deleted (the server says 409 IN_USE).
 * Needs `StatusLabel.Manage`. The page header belongs to `LabelsAdminPage`, which calls `openNew()`.
 */
@Component({
  selector: 'mf-note-tags-page',
  imports: [Button, ConfirmDialog, Dropdown, GridFrame, FormDialog, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .nt-chip {
      display: inline-block;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .nt-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
    }
  `,
  template: `
    @if (error()) {
      <p class="pg-reason" role="alert">
        {{ error() }} <button type="button" (click)="load()">Try again</button>
      </p>
    } @else if (loaded() && tags().length === 0) {
      <p class="pg-reason" data-note-tags-empty>No tags yet. Use New tag.</p>
    } @else {
      <mf-grid-frame scrollLabel="Notes tags">
        <table class="pg-table" data-note-tags-table>
          <caption class="pg-sr">
            Notes tags
          </caption>
          <thead>
            <tr>
              <th scope="col">Tag</th>
              <th scope="col">Colour</th>
              <th scope="col" class="pg-num">Notes</th>
              <th scope="col">Status</th>
              <th scope="col"><span class="pg-sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (t of tags(); track t.noteTagId) {
              <tr data-note-tag-row>
                <td>
                  <span
                    class="nt-chip"
                    [style.background]="colours(t).bg"
                    [style.color]="colours(t).fg"
                    >{{ t.name }}</span
                  >
                </td>
                <td>{{ colourLabel(t.colourKey) }}</td>
                <td class="pg-num">{{ t.visibleNoteCount }}</td>
                <td>{{ t.isActive ? 'Active' : 'Inactive' }}</td>
                <td>
                  <span class="nt-actions">
                    <p-button
                      label="Edit"
                      size="small"
                      severity="secondary"
                      (onClick)="openEdit(t)"
                    />
                    <p-button
                      [label]="t.isActive ? 'Deactivate' : 'Activate'"
                      size="small"
                      severity="secondary"
                      (onClick)="toggle(t)"
                    />
                    <p-button
                      label="Delete"
                      size="small"
                      severity="danger"
                      [outlined]="true"
                      [disabled]="t.isInUse"
                      [title]="
                        t.isInUse ? 'Notes or templates use this tag. Deactivate it instead.' : ''
                      "
                      (onClick)="askDelete(t)"
                    />
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </mf-grid-frame>
    }
    <mf-form-dialog
      [title]="editing() ? 'Edit tag' : 'New tag'"
      [primaryLabel]="editing() ? 'Save tag' : 'Create tag'"
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
        <span class="mf-field__label" id="nt-colour-label">Colour</span>
        <mf-dropdown
          buttonId="nt-colour"
          label="Colour"
          [items]="colourItems"
          [value]="colour()"
          (valueChange)="colour.set($event)"
        />
      }
    </mf-form-dialog>
    <mf-confirm-dialog
      title="Delete this tag?"
      confirmLabel="Delete tag"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="confirmDelete"
      (confirmed)="remove()"
    >
      <p>{{ target()?.name }} will be deleted. No note or template uses it.</p>
    </mf-confirm-dialog>
  `,
})
export class NoteTagsPage {
  private readonly api = inject(NoteTagsClient);
  private readonly notify = inject(NotificationService);

  protected readonly tags = signal<NoteTagResponse[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');
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

  protected colours(t: NoteTagResponse): { bg: string; fg: string } {
    return taskTypeChipColours(t.colourKey);
  }

  protected colourLabel(key?: string | null): string {
    return this.colourItems.find((c) => c.value === (key ?? ''))?.label ?? 'Blue';
  }

  protected async load(): Promise<void> {
    try {
      this.tags.set(await firstValueFrom(this.api.listNoteTags(true)));
      this.error.set('');
    } catch {
      this.error.set('The tags could not be loaded.');
    } finally {
      this.loaded.set(true);
    }
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
      this.formError.set(this.message(e, 'The tag could not be saved.'));
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
      this.notify.error(this.message(e, 'The tag could not be changed.'));
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
      this.notify.error(this.message(e, 'The tag could not be deleted.'));
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  private message(e: unknown, fallback: string): string {
    return e instanceof ApiError ? e.message : fallback;
  }
}
