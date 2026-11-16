import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import {
  PATHS_HELP,
  PATHS_MAX,
  PATH_MAX_LENGTH,
  PathRow,
  newPathRow,
  pathRowProblems,
} from '../../../shared/forms/matter-paths';
import { Tip } from '../../../shared/ui/tip';

/**
 * The DMS Paths or DFS Paths of the Matter form (epic #1389, issue #1391): one single-line input per path, a Remove icon button on each line and the text button "Add Path"
 * under them (at most 10; at the limit the button is disabled and the help line says so). The form starts with one empty line, so the field is always there to type in. A line is
 * checked when the person leaves it and on Save (`submitted`), never per keystroke; a message from the server (`lineErrors`, by line) shows until the next Save. An empty line is
 * ignored on Save. Removing the only line empties it. The lines are `PathRow`s, kept by the form, so it can tell what changed.
 */
@Component({
  selector: 'mf-matter-path-list',
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .mpl__rows {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
    }
    .mpl__row {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
    }
    .mpl__field {
      flex: 1 1 0;
      min-width: 0;
    }
    .mpl__foot {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--mf-s1);
      margin-top: var(--mf-s1);
    }
  `,
  template: `
    <div class="mf-field" role="group" [attr.aria-labelledby]="idBase() + '-label'">
      <span class="mf-field__label" [id]="idBase() + '-label'">{{ label() }}</span>
      <div class="mpl__rows" data-path-rows>
        @for (row of rows(); track row.key; let i = $index) {
          <div class="mpl__row" data-path-line>
            <div class="mpl__field">
              <input
                class="mf-field__input"
                type="text"
                autocomplete="off"
                [id]="idBase() + '-' + i"
                [name]="idBase() + '-' + i"
                [attr.aria-label]="label() + ' ' + (i + 1)"
                [attr.maxlength]="pathLimit"
                [attr.aria-invalid]="messageOf(i) ? 'true' : null"
                [attr.aria-describedby]="messageOf(i) ? idBase() + '-' + i + '-error' : null"
                [value]="row.text"
                (input)="setText(row.key, $any($event.target).value)"
                (blur)="touch(row.key)"
              />
              @if (messageOf(i); as message) {
                <p
                  class="mf-field__error"
                  role="alert"
                  data-path-error
                  [id]="idBase() + '-' + i + '-error'"
                >
                  <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ message }}
                </p>
              }
            </div>
            @if (canRemove(row)) {
              <button
                type="button"
                class="mf-btn mf-btn--icon"
                data-remove-path
                [attr.aria-label]="'Remove ' + label() + ' ' + (i + 1)"
                [mfTip]="'Remove ' + singular() + ' ' + (i + 1)"
                (click)="remove(row.key)"
              >
                <i class="pi pi-trash" aria-hidden="true"></i>
              </button>
            }
          </div>
        }
      </div>
      <div class="mpl__foot">
        <button
          type="button"
          class="mf-btn mf-btn--text"
          data-add-path
          [disabled]="atLimit()"
          (click)="add()"
        >
          <i class="pi pi-plus" aria-hidden="true"></i> Add Path
        </button>
        @if (listError(); as problem) {
          <p class="mf-field__error" role="alert" data-path-list-error>
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ problem }}
          </p>
        }
        <p class="mf-field__help" [id]="idBase() + '-help'" data-path-help>{{ help }}</p>
      </div>
    </div>
  `,
})
export class MatterPathList {
  /** The visible label of the group ("DMS Paths"). */
  readonly label = input.required<string>();
  /** The label of one path ("DMS Path"), for the Remove tooltip. */
  readonly singular = input.required<string>();
  /** Start of the ids of the inputs: `<idBase>-0`, `<idBase>-1`, ... */
  readonly idBase = input.required<string>();
  /** The lines; the list changes them and the form reads them. */
  readonly rows = model.required<PathRow[]>();
  /** Messages from the server by line index, shown until the next Save. */
  readonly lineErrors = input<Readonly<Record<number, string>>>({});
  /** A message about the whole list (too many paths). */
  readonly listError = input<string | null>(null);
  /** True once Save was pressed: every line is checked then, not only the ones that were left. */
  readonly submitted = input(false);

  protected readonly pathLimit = PATH_MAX_LENGTH;
  protected readonly help = PATHS_HELP;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly touched = signal<ReadonlySet<number>>(new Set());

  protected readonly atLimit = computed(() => this.rows().length >= PATHS_MAX);
  private readonly problems = computed(() => pathRowProblems(this.rows()));

  protected messageOf(index: number): string | null {
    const row = this.rows()[index];
    if (!row) return null;
    const server = this.lineErrors()[index];
    if (server) return server;
    return this.submitted() || this.touched().has(row.key) ? this.problems()[index] : null;
  }

  /** The Remove button is on every line except the only line while it is empty (it would do nothing). */
  protected canRemove(row: PathRow): boolean {
    return this.rows().length > 1 || row.text.trim() !== '';
  }

  protected setText(key: number, text: string): void {
    this.rows.update((rows) => rows.map((r) => (r.key === key ? { ...r, text } : r)));
  }

  protected touch(key: number): void {
    this.touched.update((set) => new Set(set).add(key));
  }

  protected add(): void {
    if (this.atLimit()) return;
    const row = newPathRow();
    this.rows.update((rows) => [...rows, row]);
    const id = `${this.idBase()}-${this.rows().length - 1}`;
    afterNextRender(() => this.host.querySelector<HTMLInputElement>(`[id="${id}"]`)?.focus(), {
      injector: this.injector,
    });
  }

  protected remove(key: number): void {
    const rest = this.rows().filter((r) => r.key !== key);
    this.rows.set(rest.length > 0 ? rest : [newPathRow()]);
  }
}
