import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ReportCategoryResponse, ReportDefinitionsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ActiveBadge } from '../../../shared/ui/badge';
import { AdminTabCounts } from '../admin-tabs';

interface Draft {
  /** Category id; 0 for a new category. */
  id: number;
  name: string;
  sortOrder: string;
  isActive: boolean;
  rowVersion: string;
}

/**
 * Admin: the Categories tab of the Reports page (issue #712). Categories group the reports in the lists; they can be added, renamed, reordered
 * and deactivated, never deleted. One row at a time is edited in place (name, order, active) with the row version of the list, so a change
 * made by someone else gives "Reload" instead of overwriting it. A deactivated category stays on the reports that have it but cannot be
 * chosen for a new report. Needs `Report.Manage`.
 */
@Component({
  selector: 'mf-report-categories-tab',
  imports: [ActiveBadge, NgTemplateOutlet, ScrollArea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="mf-sr-only" role="status" aria-live="polite" data-announce>
      {{ announcement() }}
    </div>
    @if (failure(); as f) {
      <p class="rc__error" role="alert" data-failure>{{ f }}</p>
    }
    @if (state() === 'loading') {
      <p class="rc__hint" data-loading>Loading the categories...</p>
    } @else if (state() === 'error') {
      <p class="rc__error" role="alert" data-error>
        The categories could not be loaded.
        <button type="button" class="mf-btn mf-btn--text" (click)="load()">Try again</button>
      </p>
    } @else {
      <div class="mf-table-wrap" mfScrollArea="Report categories">
        <div class="mf-scroll">
          <table class="mf-grid" id="categories-table" data-categories>
            <caption class="mf-sr-only">
              Report categories in display order
            </caption>
            <thead>
              <tr>
                <th class="mf-cell-name" scope="col">Name</th>
                <th class="mf-cell-num" scope="col">Order</th>
                <th class="mf-cell-num" scope="col">Reports</th>
                <th class="mf-cell-badge" scope="col">Status</th>
                <th class="mf-cell-actions" scope="col"><span class="mf-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @if (draft(); as d) {
                @if (d.id === 0) {
                  <tr data-row="new" data-editing>
                    <ng-container *ngTemplateOutlet="editRow; context: { d: d }" />
                  </tr>
                }
              }
              @for (c of categories(); track c.categoryId) {
                @if (draft()?.id === c.categoryId) {
                  <tr [attr.data-row]="c.name" data-editing>
                    <ng-container *ngTemplateOutlet="editRow; context: { d: draft() }" />
                  </tr>
                } @else {
                  <tr [attr.data-row]="c.name" [class.inactive]="!c.isActive">
                    <td class="mf-cell-name">{{ c.name }}</td>
                    <td class="mf-cell-num">{{ c.sortOrder }}</td>
                    <td class="mf-cell-num">{{ c.reportCount }}</td>
                    <td class="mf-cell-badge"><mf-active-badge [active]="c.isActive" /></td>
                    <td class="mf-cell-actions">
                      <button
                        type="button"
                        class="mf-btn mf-btn--text"
                        (click)="edit(c)"
                        [attr.aria-label]="'Edit ' + c.name"
                        data-edit
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                }
              } @empty {
                @if (!draft()) {
                  <tr>
                    <td colspan="5" data-empty>
                      No categories yet. Use New category above to add the first one.
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    <ng-template #editRow let-d="d">
      <td class="mf-cell-name">
        <label class="mf-sr-only" for="cat-name">Name</label>
        <input
          id="cat-name"
          class="mf-control mf-control--fill"
          type="text"
          maxlength="100"
          autocomplete="off"
          [value]="d.name"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="error() ? 'cat-error' : null"
          (input)="patch({ name: $any($event.target).value })"
          (keydown.enter)="save()"
          (keydown.escape)="cancel()"
          data-name
        />
        @if (error(); as e) {
          <p id="cat-error" class="rc__error" role="alert" data-name-error>{{ e }}</p>
        }
      </td>
      <td class="mf-cell-num">
        <label class="mf-sr-only" for="cat-order">Order</label>
        <input
          id="cat-order"
          class="mf-control"
          type="number"
          min="0"
          style="width: 6rem"
          [value]="d.sortOrder"
          (input)="patch({ sortOrder: $any($event.target).value })"
          (keydown.enter)="save()"
          (keydown.escape)="cancel()"
          data-order
        />
      </td>
      <td class="mf-cell-num"></td>
      <td class="mf-cell-badge">
        @if (d.id !== 0) {
          <label class="rc__check"
            ><input
              type="checkbox"
              [checked]="d.isActive"
              (change)="patch({ isActive: $any($event.target).checked })"
              data-active
            />
            Active</label
          >
        }
      </td>
      <td class="mf-cell-actions">
        <button
          type="button"
          class="mf-btn mf-btn--primary"
          (click)="save()"
          [disabled]="busy()"
          data-save
        >
          {{ d.id === 0 ? 'Add' : 'Save' }}
        </button>
        <button type="button" class="mf-btn" (click)="cancel()" data-cancel>Cancel</button>
      </td>
    </ng-template>
  `,
  styles: `
    .rc__error {
      margin: 0;
      color: var(--mf-danger);
    }

    .rc__hint {
      color: var(--mf-text-muted);
    }

    .rc__check {
      display: inline-flex;
      gap: var(--mf-s2);
      align-items: center;
    }
  `,
})
export class ReportCategoriesTab implements HasUnsavedChanges {
  private readonly api = inject(ReportDefinitionsClient);
  private readonly injector = inject(Injector);
  private readonly report = AdminTabCounts.report('categories');

  protected readonly categories = signal<ReportCategoryResponse[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly draft = signal<Draft | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  private saved = '';

  constructor() {
    effect(() => untracked(() => void this.load()));
  }

  hasUnsavedChanges(): boolean {
    const d = this.draft();
    return !!d && JSON.stringify(d) !== this.saved;
  }

  async load(): Promise<void> {
    try {
      const list = await firstValueFrom(this.api.listReportCategories());
      this.categories.set(list);
      this.state.set('ready');
      this.report(list.filter((c) => c.isActive).length);
    } catch {
      this.state.set('error');
    }
  }

  /** New category in the header: opens an empty row at the top. */
  startNew(): void {
    const next = (this.categories().reduce((m, c) => Math.max(m, c.sortOrder), 0) || 0) + 1;
    this.open({ id: 0, name: '', sortOrder: String(next), isActive: true, rowVersion: '' });
  }

  protected edit(c: ReportCategoryResponse): void {
    this.open({
      id: c.categoryId,
      name: c.name,
      sortOrder: String(c.sortOrder),
      isActive: c.isActive,
      rowVersion: c.rowVersion,
    });
  }

  private open(d: Draft): void {
    this.draft.set(d);
    this.saved = JSON.stringify(d);
    this.error.set('');
    this.failure.set('');
    afterNextRender(() => document.getElementById('cat-name')?.focus(), {
      injector: this.injector,
    });
  }

  protected patch(change: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
    this.error.set('');
  }

  protected cancel(): void {
    const id = this.draft()?.id;
    this.draft.set(null);
    this.error.set('');
    afterNextRender(
      () =>
        (
          document.querySelector<HTMLElement>(
            id ? `[data-edit][aria-label^="Edit"]` : '[data-shell-primary] button',
          ) ?? null
        )?.focus(),
      { injector: this.injector },
    );
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.busy()) return;
    const name = d.name.trim();
    if (!name) {
      this.error.set('Enter a name.');
      document.getElementById('cat-name')?.focus();
      return;
    }
    this.busy.set(true);
    this.failure.set('');
    const body = {
      name,
      sortOrder: Math.max(0, Math.trunc(Number(d.sortOrder) || 0)),
      isActive: d.isActive,
    };
    try {
      if (d.id === 0) await firstValueFrom(this.api.createReportCategory(body));
      else await firstValueFrom(this.api.updateReportCategory(d.id, body, d.rowVersion));
      this.draft.set(null);
      this.announcement.set(`Category ${name} saved.`);
      await this.load();
    } catch (e) {
      const errors = serverFormErrors(e);
      if (errors.conflict)
        this.failure.set('Someone else changed this category. The list was reloaded; try again.');
      else if (errors.code === 'DUPLICATE_NAME')
        this.error.set('Another category already has this name.');
      else if (errors.fields['name']) this.error.set(errors.fields['name']);
      else this.failure.set(e instanceof ApiError ? e.message : 'Couldn’t save. Try again.');
      if (errors.conflict) {
        this.draft.set(null);
        await this.load();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
