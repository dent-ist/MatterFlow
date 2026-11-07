import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ReportViewLayout, ReportViewResponse } from '../../api/generated/api-client';
import { NotificationService } from '../../core/notify/notification.service';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { Dismissable } from '../../shared/ui/dismissable';
import { FormDialog } from '../../shared/ui/form-dialog';
import { TagChip } from '../../shared/ui/tag-chip';
import { TextField } from '../../shared/ui/text-field';
import { Tip } from '../../shared/ui/tip';
import {
  ReportViewsStore,
  viewErrorText,
  viewNameError,
  suggestedViewName,
} from './report-views-store';

type DialogKind = 'save' | 'rename' | 'delete';

let nextId = 0;

/**
 * The Saved Views menu of the result grid (#722, spec section 6): a button with a chevron whose label is the applied view ("Saved Views" when none, the
 * name and " (modified)" when the grid has changed since), and a menu: the report's own Default first, one row per view (name, a Default chip, a check
 * on the applied one, Rename and Delete on hover or focus), then Save View, Save as New View... and Set as Default or Remove Default for the applied view.
 * Save as New View and Rename are shared form dialogs, Delete is the shared confirm dialog.
 *
 * It owns the calls (`ReportViewsStore`, provided by the grid) and the words of every toast, and nothing about the grid: the grid tells it the layout
 * it has now (`current`) and which view is applied, and applies what is picked (`pick`). `saved` says a view now holds exactly the current layout (the
 * grid makes it the applied one), `removed` that a view is gone.
 *
 * Why not the shared `mf-views-menu`: it is built on `dbo.UserView` (`ViewStateService`, a fixed list of list surfaces, one inline form, no per-report
 * store, no dialogs), and the spec asks for the dialogs, the Default row, check marks and the footer actions; a store adapter would not change that.
 */
@Component({
  selector: 'mf-report-views',
  imports: [ConfirmDialog, Dismissable, FormDialog, TagChip, TextField, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    .rv__label {
      max-width: 14rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* The surface is the shared menu (mf-menu, D-36): 280 px wide, at most 320 px high; the list scrolls and the footer stays. */
    .rv__panel {
      position: absolute;
      z-index: 20;
      top: calc(100% + 4px);
      left: 0;
      display: flex;
      flex-direction: column;
      width: 280px;
      max-height: 320px;
      overflow: hidden;
    }
    .rv__list {
      flex: 0 1 auto;
      min-height: 0;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .rv__row {
      position: relative;
    }
    .rv__apply {
      justify-content: flex-start;
    }
    .rv__name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Rename and Delete sit over the end of the row while it is hovered or holds the focus (they stay in the tab order). */
    .rv__tools {
      position: absolute;
      top: 0;
      right: var(--mf-s1);
      display: flex;
      align-items: center;
      height: 100%;
      background: var(--mf-row-hover);
      opacity: 0;
      pointer-events: none;
    }
    .rv__row:hover .rv__tools,
    .rv__row:focus-within .rv__tools {
      opacity: 1;
      pointer-events: auto;
    }
    .rv__foot {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s2);
      padding: var(--mf-s1) var(--mf-s2) var(--mf-s1);
    }
    .rv__note {
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .rv__check {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-top: var(--mf-s3);
    }
    .rv__confirm {
      margin: 0;
    }
  `,
  template: `
    <button
      #btn
      type="button"
      class="mf-btn"
      data-views-trigger
      aria-haspopup="true"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? panelId : null"
      [attr.aria-label]="appliedName() ? 'Saved Views: ' + label() : null"
      (click)="open.set(!open())"
    >
      <i class="pi pi-bookmark" aria-hidden="true"></i>
      <span class="rv__label" data-views-label>{{ label() }}</span>
      <i class="pi pi-chevron-down" aria-hidden="true"></i>
    </button>
    @if (open()) {
      <div
        class="rv__panel mf-menu"
        role="group"
        aria-label="Saved Views"
        data-views-panel
        [id]="panelId"
        [mfDismissable]="btn"
        (dismissed)="open.set(false)"
      >
        @if (store.state() === 'loading' || store.state() === 'idle') {
          <p class="rv__note" role="status" data-views-loading>Loading saved views...</p>
        } @else if (store.state() === 'error') {
          <p class="rv__note" role="alert" data-views-error>
            Couldn't load saved views.
            <button type="button" class="mf-btn mf-btn--text" data-views-retry (click)="reload()">
              Retry
            </button>
          </p>
        } @else {
          <ul class="rv__list" data-views-list>
            <li class="rv__row">
              <button
                type="button"
                class="mf-menu__item rv__apply"
                data-view-default-row
                [attr.aria-current]="appliedId() === null ? 'true' : null"
                (click)="choose(null)"
              >
                <i class="pi" [class.pi-check]="appliedId() === null" aria-hidden="true"></i>
                <span class="rv__name">Default</span>
              </button>
            </li>
            @for (v of store.views(); track v.viewId) {
              <li class="rv__row" data-view-row [attr.data-view-id]="v.viewId">
                <button
                  type="button"
                  class="mf-menu__item rv__apply"
                  data-view-apply
                  [attr.aria-current]="appliedId() === v.viewId ? 'true' : null"
                  (click)="choose(v)"
                >
                  <i class="pi" [class.pi-check]="appliedId() === v.viewId" aria-hidden="true"></i>
                  <span class="rv__name" [attr.title]="v.name">{{ v.name }}</span>
                  @if (v.isDefault) {
                    <mf-tag-chip data-view-default-chip>Default</mf-tag-chip>
                  }
                </button>
                <span class="rv__tools">
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    data-view-rename
                    [attr.aria-label]="'Rename ' + v.name"
                    [mfTip]="'Rename'"
                    (click)="openRename(v)"
                  >
                    <i class="pi pi-pencil" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    data-view-delete
                    [attr.aria-label]="'Delete ' + v.name"
                    [mfTip]="'Delete'"
                    (click)="openDelete(v)"
                  >
                    <i class="pi pi-trash" aria-hidden="true"></i>
                  </button>
                </span>
              </li>
            }
          </ul>
          <hr class="mf-menu__sep" />
          <div class="rv__foot" role="group" aria-label="Saved view actions">
            @if (appliedId() !== null) {
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-view-save
                [attr.aria-disabled]="modified() ? null : 'true'"
                [mfTip]="modified() ? '' : 'No changes to save.'"
                (click)="modified() && saveApplied()"
              >
                Save View
              </button>
            }
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-view-save-new
              [attr.aria-disabled]="atLimit() ? 'true' : null"
              [mfTip]="atLimit() ? limitText() : ''"
              (click)="!atLimit() && openSave()"
            >
              Save as New View...
            </button>
            @if (appliedView(); as view) {
              @if (view.isDefault) {
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  data-view-clear-default
                  (click)="clearDefault(view)"
                >
                  Remove Default
                </button>
              } @else {
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  data-view-set-default
                  (click)="setDefault(view)"
                >
                  Set as Default
                </button>
              }
            }
          </div>
        }
      </div>
    }
    <span class="mf-sr-only" role="status" aria-live="polite" data-views-status>{{
      status()
    }}</span>

    @if (dialog() === 'save' || dialog() === 'rename') {
      <mf-form-dialog
        size="small"
        [title]="dialog() === 'save' ? 'Save View' : 'Rename View'"
        [primaryLabel]="dialog() === 'save' ? 'Save View' : 'Rename'"
        [busy]="busy()"
        [error]="formError()"
        [visible]="true"
        (visibleChange)="!$event && closeDialog()"
        (submitted)="submitDialog()"
      >
        <form novalidate (submit)="$event.preventDefault(); submitDialog()">
          <mf-text-field
            label="View name"
            inputId="rv-view-name"
            [required]="true"
            [error]="nameError()"
            [value]="name()"
            (valueChange)="name.set($event); nameError.set(null)"
          />
          @if (dialog() === 'save') {
            <label class="rv__check">
              <input
                type="checkbox"
                data-view-make-default
                [checked]="makeDefault()"
                (change)="makeDefault.set($any($event.target).checked)"
              />
              Use as my default view
            </label>
          }
        </form>
      </mf-form-dialog>
    }
    @if (dialog() === 'delete') {
      <mf-confirm-dialog
        title="Delete View"
        confirmLabel="Delete View"
        [danger]="true"
        [busy]="busy()"
        [error]="formError()"
        [visible]="true"
        (visibleChange)="!$event && closeDialog()"
        (confirmed)="confirmDelete()"
      >
        <p class="rv__confirm" data-view-delete-text>
          Delete "{{ target()?.name }}"? This can't be undone.
        </p>
      </mf-confirm-dialog>
    }
  `,
})
export class ReportViewsMenu {
  protected readonly store = inject(ReportViewsStore);
  private readonly notify = inject(NotificationService);

  readonly reportId = input.required<number>();
  readonly reportName = input.required<string>();
  /** The layout of the grid right now (what Save View and Save as New View store). */
  readonly current = input.required<ReportViewLayout>();
  /** The view the grid shows, null for the report's own Default. */
  readonly appliedId = input<number | null>(null);
  /** The grid differs from the applied view. */
  readonly modified = input(false);

  /** A view was picked (null: the Default row): the grid applies it. */
  readonly pick = output<ReportViewResponse | null>();
  /** A view now holds exactly the current layout (just saved or created): the grid shows it as the applied one. */
  readonly saved = output<ReportViewResponse>();
  /** A view was deleted. */
  readonly removed = output<number>();

  protected readonly panelId = `mf-report-views-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly dialog = signal<DialogKind | null>(null);
  protected readonly target = signal<ReportViewResponse | null>(null);
  protected readonly name = signal('');
  protected readonly makeDefault = signal(false);
  protected readonly nameError = signal<string | null>(null);
  protected readonly formError = signal('');
  protected readonly busy = signal(false);
  protected readonly status = signal('');

  protected readonly appliedView = computed(() => this.store.find(this.appliedId()));
  protected readonly appliedName = computed(() => this.appliedView()?.name ?? '');
  protected readonly label = computed(() => {
    const name = this.appliedName();
    return name ? (this.modified() ? `${name} (modified)` : name) : 'Saved Views';
  });
  protected readonly atLimit = computed(() => this.store.views().length >= this.store.limit());
  protected readonly limitText = computed(
    () => `You can save up to ${this.store.limit()} views for this report.`,
  );

  protected reload(): void {
    void this.store.load(this.reportId());
  }

  protected choose(view: ReportViewResponse | null): void {
    this.open.set(false);
    this.pick.emit(view);
    this.status.set(view ? `Showing the view ${view.name}.` : 'Showing the default view.');
  }

  // ---- Save View (the applied view takes the current layout)

  protected async saveApplied(): Promise<void> {
    const view = this.appliedView();
    if (!view) return;
    this.open.set(false);
    try {
      const changed = await this.store.update(this.reportId(), view.viewId, {
        layout: this.current(),
      });
      this.saved.emit(changed);
      this.notify.success('View saved.');
    } catch {
      this.failed("Couldn't save the view.", () => void this.saveApplied());
    }
  }

  // ---- Save as New View and Rename (shared form dialog)

  protected openSave(): void {
    this.open.set(false);
    this.name.set(suggestedViewName(this.reportName(), this.otherNames(null)));
    this.makeDefault.set(false);
    this.begin('save', null);
  }

  protected openRename(view: ReportViewResponse): void {
    this.open.set(false);
    this.name.set(view.name);
    this.begin('rename', view);
  }

  protected openDelete(view: ReportViewResponse): void {
    this.open.set(false);
    this.begin('delete', view);
  }

  private begin(kind: DialogKind, target: ReportViewResponse | null): void {
    this.target.set(target);
    this.nameError.set(null);
    this.formError.set('');
    this.dialog.set(kind);
  }

  protected closeDialog(): void {
    if (this.busy()) return;
    this.dialog.set(null);
    this.target.set(null);
  }

  private otherNames(except: number | null): string[] {
    return this.store
      .views()
      .filter((v) => v.viewId !== except)
      .map((v) => v.name);
  }

  protected async submitDialog(): Promise<void> {
    const kind = this.dialog();
    if (this.busy() || (kind !== 'save' && kind !== 'rename')) return;
    const target = this.target();
    const error = viewNameError(this.name(), this.otherNames(target?.viewId ?? null));
    if (error) {
      this.nameError.set(error);
      return;
    }
    const name = this.name().trim();
    this.busy.set(true);
    this.formError.set('');
    try {
      if (kind === 'save') {
        const made = await this.store.create(
          this.reportId(),
          name,
          this.current(),
          this.makeDefault(),
        );
        this.dialog.set(null);
        this.saved.emit(made);
        this.notify.success('View saved.');
      } else if (target) {
        await this.store.update(this.reportId(), target.viewId, { name });
        this.dialog.set(null);
        this.notify.success('View renamed.');
      }
    } catch (e) {
      const text = viewErrorText(e, this.store.limit());
      if (text && text.startsWith('You already')) this.nameError.set(text);
      else
        this.formError.set(
          text ?? (kind === 'save' ? "Couldn't save the view." : "Couldn't rename the view."),
        );
    } finally {
      this.busy.set(false);
    }
  }

  // ---- Delete (shared confirm dialog)

  protected async confirmDelete(): Promise<void> {
    const view = this.target();
    if (!view || this.busy()) return;
    this.busy.set(true);
    this.formError.set('');
    try {
      await this.store.remove(this.reportId(), view.viewId);
      this.dialog.set(null);
      this.removed.emit(view.viewId);
      this.notify.success('View deleted.');
    } catch {
      this.formError.set("Couldn't delete the view.");
    } finally {
      this.busy.set(false);
    }
  }

  // ---- The default view

  protected async setDefault(view: ReportViewResponse): Promise<void> {
    this.open.set(false);
    try {
      await this.store.setDefault(this.reportId(), view.viewId);
      this.notify.success('Default view set.');
    } catch {
      this.failed("Couldn't update the default view.", () => void this.setDefault(view));
    }
  }

  protected async clearDefault(view: ReportViewResponse): Promise<void> {
    this.open.set(false);
    try {
      await this.store.clearDefault(this.reportId(), view.viewId);
      this.notify.success('Default view removed.');
    } catch {
      this.failed("Couldn't update the default view.", () => void this.clearDefault(view));
    }
  }

  /** An action with no place of its own to say it failed: an error toast with Retry (spec 6.3). */
  private failed(summary: string, retry: () => void): void {
    this.notify.error(summary, undefined, { action: { label: 'Retry', run: retry } });
  }
}
