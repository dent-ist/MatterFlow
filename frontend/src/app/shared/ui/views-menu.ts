import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { UserViewDto } from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { ViewStateService } from '../../core/views/view-state.service';
import { ViewState, ViewSurface, isViewState } from '../../core/views/view-state';

/** The text of a failed call that the person can act on ("You already have a view named 'X' here."), else a plain sentence. */
function reasonOf(error: unknown): string {
  if (error instanceof ApiError) {
    const first = Object.values(error.problem?.errors ?? {})[0]?.[0]?.message;
    return first ?? error.problem?.detail ?? error.message;
  }
  return 'That did not work. Try again in a moment.';
}

/**
 * Saved views (PM v2, PV-29 #880): a person keeps named views of a list (its filters and sort), applies one with a click, renames or deletes it
 * and sets one as the default the list opens on. They are personal (never shared), stored on the server (`dbo.UserView`, the store that also
 * remembers each section's state) and cached for the first paint of the default. The page tells the menu how to read its state (`capture`) and how
 * to show one (`apply`); a view is just that state. At most 30 views per list, names unique per person. Lazy features only.
 */
@Component({
  selector: 'mf-views-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'close()' },
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    .vm__summary {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 32px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      cursor: pointer;
      list-style: none;
    }
    .vm__summary::-webkit-details-marker {
      display: none;
    }
    .vm__panel {
      position: absolute;
      z-index: 30;
      top: calc(100% + 2px);
      right: 0;
      width: min(26rem, 90vw);
      box-sizing: border-box;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2, 0 4px 14px rgb(0 0 0 / 0.18));
    }
    .vm__hint {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .vm__list {
      max-height: 14rem;
      margin: 0 0 var(--mf-s3);
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .vm__row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      align-items: center;
      padding: var(--mf-s1) 0;
      border-bottom: 1px solid var(--mf-border);
    }
    .vm__apply {
      flex: 1 1 8rem;
      min-height: 32px;
      padding: 0 var(--mf-s2);
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .vm__tag {
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
    }
    .vm__icon {
      min-width: 32px;
      min-height: 32px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    .vm__form {
      display: grid;
      gap: var(--mf-s2);
    }
    .vm__form label {
      font-weight: 600;
    }
    .vm__inline {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      align-items: center;
      width: 100%;
    }
    .vm__inline input[type='text'] {
      flex: 1 1 10rem;
      min-height: 32px;
    }
    .vm__error {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    @media (max-width: 639.98px) {
      .vm__summary,
      .vm__apply,
      .vm__icon,
      .vm__inline .mf-btn,
      .vm__inline input[type='text'] {
        min-height: 44px;
      }
      .vm__icon {
        min-width: 44px;
      }
    }
  `,
  template: `
    <details #details (toggle)="opened($event)" data-views>
      <summary class="vm__summary" data-views-trigger>
        <i class="pi pi-bookmark" aria-hidden="true"></i>
        <span>Views</span>
        @if (views().length > 0) {
          <span class="mf-sr-only">, {{ views().length }} saved</span>
        }
      </summary>
      <div class="vm__panel" role="group" aria-label="Saved views">
        <p class="vm__hint">
          A view keeps this list's filters and sort under a name. Only you can see your views.
        </p>
        @if (state() === 'loading') {
          <p class="vm__hint" role="status">Loading your views.</p>
        } @else if (state() === 'error') {
          <p class="vm__error" role="alert" data-views-error>
            Couldn't load your views.
            <button type="button" class="mf-btn mf-btn--text" (click)="load()">Retry</button>
          </p>
        } @else if (views().length === 0) {
          <p class="vm__hint" data-views-empty>No saved views yet.</p>
        } @else {
          <ul class="vm__list" data-views-list>
            @for (v of views(); track v.id) {
              <li class="vm__row" data-view-row [attr.data-view-name]="v.name">
                @if (renaming()?.id === v.id) {
                  <span class="vm__inline">
                    <label class="mf-sr-only" [for]="'vm-rename-' + v.id"
                      >New name for {{ v.name }}</label
                    >
                    <input
                      type="text"
                      maxlength="80"
                      [id]="'vm-rename-' + v.id"
                      [value]="draft()"
                      (input)="draft.set($any($event.target).value)"
                      (keydown.enter)="commitRename(v)"
                      data-view-rename-input
                    />
                    <button
                      type="button"
                      class="mf-btn mf-btn--primary"
                      data-view-rename-save
                      (click)="commitRename(v)"
                    >
                      Rename
                    </button>
                    <button type="button" class="mf-btn" (click)="renaming.set(null)">
                      Cancel
                    </button>
                  </span>
                } @else if (deleting()?.id === v.id) {
                  <span class="vm__inline" role="alert">
                    Delete "{{ v.name }}"?
                    <button
                      type="button"
                      class="mf-btn mf-btn--primary"
                      data-view-delete-confirm
                      (click)="commitDelete(v)"
                    >
                      Delete
                    </button>
                    <button type="button" class="mf-btn" (click)="deleting.set(null)">Keep</button>
                  </span>
                } @else {
                  <button type="button" class="vm__apply" data-view-apply (click)="applyView(v)">
                    {{ v.name }}
                  </button>
                  @if (v.isDefault && defaults()) {
                    <span class="vm__tag" data-view-default>Default</span>
                  }
                  @if (defaults()) {
                    <button
                      type="button"
                      class="vm__icon"
                      data-view-default-toggle
                      [attr.aria-label]="
                        v.isDefault
                          ? 'Stop opening this list on ' + v.name
                          : 'Open this list on ' + v.name
                      "
                      [attr.title]="v.isDefault ? 'Stop opening on this view' : 'Open on this view'"
                      (click)="toggleDefault(v)"
                    >
                      <i
                        [class]="v.isDefault ? 'pi pi-star-fill' : 'pi pi-star'"
                        aria-hidden="true"
                      ></i>
                    </button>
                  }
                  <button
                    type="button"
                    class="vm__icon"
                    data-view-rename
                    [attr.aria-label]="'Rename ' + v.name"
                    title="Rename"
                    (click)="startRename(v)"
                  >
                    <i class="pi pi-pencil" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="vm__icon"
                    data-view-delete
                    [attr.aria-label]="'Delete ' + v.name"
                    title="Delete"
                    (click)="deleting.set(v)"
                  >
                    <i class="pi pi-trash" aria-hidden="true"></i>
                  </button>
                }
              </li>
            }
          </ul>
        }
        <div class="vm__form">
          <label for="vm-new-name">Save the current view as</label>
          <span class="vm__inline">
            <input
              id="vm-new-name"
              type="text"
              maxlength="80"
              placeholder="Name"
              [value]="newName()"
              (input)="newName.set($any($event.target).value)"
              (keydown.enter)="create()"
              data-view-name-input
            />
            <button
              type="button"
              class="mf-btn mf-btn--primary"
              data-view-save
              [disabled]="busy()"
              (click)="create()"
            >
              Save
            </button>
          </span>
          @if (error(); as e) {
            <p class="vm__error" role="alert" data-view-form-error>{{ e }}</p>
          }
        </div>
        <span class="mf-sr-only" role="status" aria-live="polite" data-views-status>{{
          message()
        }}</span>
      </div>
    </details>
  `,
})
export class ViewsMenu {
  private readonly store = inject(ViewStateService);
  private readonly details = viewChild<ElementRef<HTMLDetailsElement>>('details');

  readonly surface = input.required<ViewSurface>();
  /** Reads the state of the list as it is on screen (filters, sort). */
  readonly capture = input.required<() => ViewState>();
  /** Shows a saved state on the list. */
  readonly apply = input.required<(state: ViewState) => void>();
  /** False where the list cannot open on a saved view (a section of a page): then there is no "open on this view" star. */
  readonly defaults = input(true);

  protected readonly views = signal<UserViewDto[]>([]);
  protected readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly newName = signal('');
  protected readonly draft = signal('');
  protected readonly renaming = signal<UserViewDto | null>(null);
  protected readonly deleting = signal<UserViewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  /** The panel is read when it first opens (and again after a failed read), so a list nobody opens the menu on costs no request. */
  protected opened(event: Event): void {
    if (!(event.target as HTMLDetailsElement).open) return;
    this.error.set(null);
    if (this.state() === 'idle' || this.state() === 'error') void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.views.set(await this.store.listNamed(this.surface()));
      this.state.set('ready');
      this.syncDefault();
    } catch {
      this.state.set('error');
    }
  }

  /** The browser keeps the default's state, so the list can open on it before anything is loaded. */
  private syncDefault(): void {
    const def = this.views().find((v) => v.isDefault);
    this.store.cacheDefault(
      this.surface(),
      def && isViewState(def.state) ? (def.state as ViewState) : null,
    );
  }

  protected applyView(v: UserViewDto): void {
    if (isViewState(v.state)) this.apply()(v.state as ViewState);
    this.message.set(`Showing the view ${v.name}.`);
    this.close();
  }

  protected async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name) {
      this.error.set('Enter a name for the view.');
      return;
    }
    await this.run(async () => {
      const made = await this.store.create(this.surface(), name, this.capture()());
      this.views.set(
        [...this.views(), made].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
      );
      this.newName.set('');
      this.message.set(`Saved the view ${name}.`);
    });
  }

  protected startRename(v: UserViewDto): void {
    this.deleting.set(null);
    this.draft.set(v.name ?? '');
    this.renaming.set(v);
  }

  protected async commitRename(v: UserViewDto): Promise<void> {
    const name = this.draft().trim();
    if (!name) {
      this.error.set('Enter a name for the view.');
      return;
    }
    await this.run(async () => {
      const changed = await this.store.update(v, { name });
      this.replace(changed);
      this.renaming.set(null);
      this.message.set(`Renamed to ${name}.`);
    });
  }

  protected async toggleDefault(v: UserViewDto): Promise<void> {
    await this.run(async () => {
      const changed = await this.store.update(v, { isDefault: !v.isDefault });
      // The server clears the surface's other default; read the list again so every row is right.
      this.replace(changed);
      this.views.set(await this.store.listNamed(this.surface()));
      this.syncDefault();
      this.message.set(
        changed.isDefault
          ? `The list now opens on ${changed.name}.`
          : `The list no longer opens on ${changed.name}.`,
      );
    });
  }

  protected async commitDelete(v: UserViewDto): Promise<void> {
    await this.run(async () => {
      await this.store.remove(v);
      this.views.set(this.views().filter((x) => x.id !== v.id));
      this.deleting.set(null);
      this.syncDefault();
      this.message.set(`Deleted the view ${v.name}.`);
    });
  }

  private replace(changed: UserViewDto): void {
    this.views.set(
      this.views()
        .map((x) => (x.id === changed.id ? changed : x))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    );
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(reasonOf(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    const details = this.details()?.nativeElement;
    if (!details?.open) return;
    details.open = false;
    details.querySelector<HTMLElement>('summary')?.focus();
  }
}
