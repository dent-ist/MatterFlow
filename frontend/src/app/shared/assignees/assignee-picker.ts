import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { PickerOption } from '../ui/entity-picker';
import { AssigneeCandidate, AssigneeLists } from './assignee-list';

/** The extra last choice of a Pod's list: it is not a person, so it has no id of a user. */
const SEARCH_ALL = -1;

/**
 * Assignee field of Edit task and Create task (`mf-assignee-picker`): the same rules as the inline picker of the work grids, from the same
 * shared list (`AssigneeList`). Opening it lists the Task's Pod members by load, or, for a Task without a Pod, the Suggested people; typing
 * searches everyone. A Pod's list ends with "Search all users". Keyboard: Arrow keys move, Enter selects, Escape closes (the entity picker's contract).
 */
@Component({
  selector: 'mf-assignee-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mf-field">
      <label class="mf-field__label" [attr.for]="inputId()">{{ label() }}</label>
      @if (selected(); as s) {
        <div class="mf-picker__chosen" data-chosen>
          <span>{{ s.label }}</span>
          @if (s.flag) {
            <span class="mf-picker__flag mf-picker__flag--chosen" data-chosen-flag>
              <i class="pi pi-calendar-minus" aria-hidden="true"></i> {{ s.flag }}
            </span>
          }
          <button
            type="button"
            class="mf-picker__change"
            [id]="inputId() + '-change'"
            (click)="clear()"
          >
            Change
          </button>
        </div>
      } @else {
        <div class="mf-picker__box">
          <input
            class="mf-field__input"
            type="text"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            [id]="inputId()"
            [placeholder]="placeholder()"
            [attr.aria-expanded]="open()"
            [attr.aria-controls]="inputId() + '-list'"
            [attr.aria-activedescendant]="activeId()"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            [value]="text()"
            (focus)="onFocus()"
            (input)="onInput($event)"
            (keydown)="onKey($event)"
            (blur)="close()"
          />
          @if (open()) {
            <ul
              class="mf-picker__list"
              role="listbox"
              [id]="inputId() + '-list'"
              data-assignee-list
            >
              @if (list.loading()) {
                <li class="mf-picker__note" role="presentation">Searching...</li>
              } @else if (rows().length === 0) {
                <li class="mf-picker__note" role="presentation">No people found.</li>
              }
              @if (!list.loading() && list.heading(); as heading) {
                <li class="mf-picker__heading" role="presentation" data-assignee-heading>
                  {{ heading }}
                </li>
              }
              @for (o of rows(); track o.id; let i = $index) {
                <li
                  role="option"
                  class="mf-picker__option"
                  [id]="inputId() + '-opt-' + i"
                  [attr.aria-selected]="i === active()"
                  [class.mf-picker__option--active]="i === active()"
                  [attr.title]="o.reason || null"
                  [attr.data-option]="o.id"
                  (mousedown)="$event.preventDefault(); choose(o)"
                >
                  @if (o.id === searchAll) {
                    <span class="mf-picker__all" data-search-all>{{ o.name }}</span>
                  } @else {
                    <span class="mf-picker__name">{{ o.name }}</span>
                    <span class="mf-picker__hint" data-option-hint>{{ o.hint }}</span>
                    @if (o.flag) {
                      <span class="mf-picker__flag" data-option-flag>
                        <i class="pi pi-calendar-minus" aria-hidden="true"></i> {{ o.flag }}
                      </span>
                    }
                  }
                </li>
              }
            </ul>
          }
        </div>
      }
      @if (help()) {
        <p class="mf-field__help" [id]="inputId() + '-help'">{{ help() }}</p>
      }
      @if (error(); as e) {
        <p class="mf-field__error" role="alert" [id]="inputId() + '-error'">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
        </p>
      }
    </div>
  `,
  styleUrl: '../ui/form-field.scss',
  styles: `
    .mf-picker__box {
      position: relative;
      display: grid;
    }
    .mf-picker__list {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 10;
      margin: 2px 0 0;
      padding: 0;
      list-style: none;
      max-height: 16rem;
      overflow: auto;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-2);
    }
    .mf-picker__option,
    .mf-picker__note,
    .mf-picker__heading {
      padding: var(--mf-s2) var(--mf-s3);
    }
    .mf-picker__heading {
      padding-bottom: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .mf-picker__option {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0 var(--mf-s2);
      cursor: pointer;
    }
    .mf-picker__option--active,
    .mf-picker__option:hover {
      background: var(--mf-selected-bg);
    }
    .mf-picker__hint,
    .mf-picker__note {
      color: var(--mf-text-muted);
    }
    .mf-picker__all {
      color: var(--mf-link);
      text-decoration: underline;
    }
    .mf-picker__flag--chosen {
      display: inline;
    }
    .mf-picker__flag {
      flex-basis: 100%;
      color: var(--mf-warning);
      font-size: var(--mf-fs-xs);
    }
    .mf-picker__chosen {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      min-height: var(--mf-row-h);
    }
    .mf-picker__change {
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class AssigneePicker implements OnDestroy {
  readonly label = input('Assignee');
  readonly inputId = input.required<string>();
  readonly placeholder = input('Search users');
  readonly help = input('');
  readonly error = input<string | null>(null);
  readonly debounceMs = input(250);
  /** The Pod of the Task: its members are listed first. Null or absent: the Suggested people. */
  readonly podId = input<number | null | undefined>(null);
  /** The Task Type, passed on to the suggestions (the ranking may use it). */
  readonly taskTypeId = input<number | null | undefined>(null);

  readonly selected = model<PickerOption | null>(null);

  protected readonly searchAll = SEARCH_ALL;
  protected readonly list = inject(AssigneeLists).create(() => ({
    podId: this.podId(),
    taskTypeId: this.taskTypeId(),
  }));
  protected readonly text = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(-1);

  /** The people of the list plus, in a Pod's list, the "Search all users" row as its last choice. */
  protected readonly rows = computed<AssigneeCandidate[]>(() => {
    const people = this.list.items();
    return this.list.canSearchAll()
      ? [
          ...people,
          {
            id: SEARCH_ALL,
            name: 'Search all users',
            openTaskCount: 0,
            hint: '',
            reason: '',
          },
        ]
      : people;
  });
  protected readonly activeId = computed(() =>
    this.open() && this.active() >= 0 ? `${this.inputId()}-opt-${this.active()}` : null,
  );
  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    const parts = [this.error() ? `${id}-error` : null, this.help() ? `${id}-help` : null].filter(
      Boolean,
    );
    return parts.length ? parts.join(' ') : null;
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  protected onFocus(): void {
    if (this.open()) return;
    this.open.set(true);
    this.active.set(-1);
    this.text.set('');
    void this.list.open();
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.text.set(value);
    this.open.set(true);
    this.active.set(-1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.list.search(value), this.debounceMs());
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.rows().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.open()) this.onFocus();
      else if (count > 0) this.active.set((this.active() + 1) % count);
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      this.active.set((this.active() - 1 + count) % count);
    } else if (event.key === 'Enter' && this.open() && this.active() >= 0) {
      event.preventDefault();
      const row = this.rows()[this.active()];
      if (row) this.choose(row);
    } else if (event.key === 'Escape' && this.open()) {
      // Closes the list only; a dialog around the picker keeps its own Escape for when the list is closed.
      event.stopPropagation();
      this.close();
    }
  }

  protected choose(row: AssigneeCandidate): void {
    if (row.id === SEARCH_ALL) {
      this.text.set('');
      this.active.set(-1);
      void this.list.searchAll();
      return;
    }
    const hadFocus = this.host.nativeElement.contains(document.activeElement);
    this.selected.set({ id: row.id, label: row.name, flag: row.flag });
    this.text.set('');
    this.close();
    // The input is replaced by the chosen text and its Change button: keep keyboard focus in the picker.
    if (hadFocus) this.focusLater(`${this.inputId()}-change`);
  }

  protected clear(): void {
    this.selected.set(null);
    this.focusLater(this.inputId());
  }

  protected close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  private focusLater(id: string): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[id="${id}"]`)?.focus());
  }
}
