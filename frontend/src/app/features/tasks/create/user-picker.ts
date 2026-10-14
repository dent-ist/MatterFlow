import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UsersLookupClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';

interface Choice {
  id: number;
  label: string;
}

/**
 * User typeahead for USER_REF fields of a Task Type's request form (the `MF_USER_PICKER` implementation). Uses the lightweight
 * users lookup (id and display name of active users; needs Task.Assign). Satisfies the form engine's `ReferencePicker` contract:
 * `value` (user id, two-way), `disabled`, `readOnly`, `invalid`, `inputId`, `label`. Keyboard: arrows move, Enter selects, Escape closes.
 */
@Component({
  selector: 'mf-user-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (readOnly()) {
      <span data-readonly>{{
        chosen()?.label ?? (value() ? 'User ' + value() : 'Not provided')
      }}</span>
    } @else if (chosen(); as c) {
      <div class="up__chosen" data-chosen>
        <span>{{ c.label }}</span>
        @if (!disabled()) {
          <button type="button" class="up__change" (click)="clear()">Change</button>
        }
      </div>
    } @else if (value()) {
      <span class="up__muted" data-chosen-id>User {{ value() }}</span>
      @if (!disabled()) {
        <button type="button" class="up__change" (click)="clear()">Change</button>
      }
    } @else {
      <div class="up__box">
        <input
          class="up__input"
          type="text"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          [id]="inputId()"
          [attr.aria-label]="label()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="inputId() + '-list'"
          [attr.aria-activedescendant]="active() >= 0 ? inputId() + '-opt-' + active() : null"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [disabled]="disabled() || !canLookup()"
          [placeholder]="canLookup() ? 'Search users' : 'User lookup is not allowed'"
          [value]="text()"
          (input)="onInput($event)"
          (focus)="onFocus()"
          (keydown)="onKey($event)"
          (blur)="close()"
        />
        @if (open()) {
          <ul class="up__list" role="listbox" [id]="inputId() + '-list'">
            @if (loading()) {
              <li class="up__note" role="presentation">Searching...</li>
            } @else if (options().length === 0) {
              <li class="up__note" role="presentation">No users match.</li>
            }
            @for (o of options(); track o.id; let i = $index) {
              <li
                role="option"
                class="up__option"
                [id]="inputId() + '-opt-' + i"
                [attr.aria-selected]="i === active()"
                [class.up__option--active]="i === active()"
                (mousedown)="$event.preventDefault(); choose(o)"
              >
                {{ o.label }}
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .up__box {
      position: relative;
      display: grid;
    }
    .up__input {
      min-height: var(--mf-row-h);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .up__input[aria-invalid='true'] {
      border-color: var(--mf-danger);
    }
    .up__list {
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
    .up__option,
    .up__note {
      padding: var(--mf-s2) var(--mf-s3);
    }
    .up__option {
      cursor: pointer;
    }
    .up__option--active,
    .up__option:hover {
      background: var(--mf-selected-bg);
    }
    .up__note,
    .up__muted {
      color: var(--mf-text-muted);
    }
    .up__chosen {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      min-height: var(--mf-row-h);
    }
    .up__change {
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class UserPicker implements OnDestroy {
  readonly value = model<number | null>(null);
  readonly disabled = input(false);
  readonly readOnly = input(false);
  readonly invalid = input(false);
  readonly inputId = input('user-picker');
  readonly label = input('User');
  readonly debounceMs = input(250);

  private readonly api = inject(UsersLookupClient);
  private readonly auth = inject(AuthStore);

  protected readonly canLookup = computed(() => this.auth.has('Task.Assign'));
  protected readonly text = signal('');
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly options = signal<Choice[]>([]);
  protected readonly active = signal(-1);
  private readonly picked = signal<Choice | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;

  protected readonly chosen = computed(() => {
    const pick = this.picked();
    return pick && pick.id === this.value() ? pick : null;
  });

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  protected onFocus(): void {
    if (this.canLookup()) void this.search();
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.search(), this.debounceMs());
  }

  private async search(): Promise<void> {
    const turn = ++this.sequence;
    this.open.set(true);
    this.loading.set(true);
    try {
      const found = await firstValueFrom(this.api.lookupUsers(this.text().trim() || undefined, 20));
      if (turn !== this.sequence) return;
      this.options.set(found.map((u) => ({ id: u.userId, label: u.displayName })));
      this.active.set(found.length > 0 ? 0 : -1);
    } catch {
      if (turn === this.sequence) this.options.set([]);
    } finally {
      if (turn === this.sequence) this.loading.set(false);
    }
  }

  protected onKey(event: KeyboardEvent): void {
    const list = this.options();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.open.set(true);
      this.active.set(Math.min(list.length - 1, this.active() + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.set(Math.max(0, this.active() - 1));
    } else if (event.key === 'Enter' && this.open() && list[this.active()]) {
      event.preventDefault();
      this.choose(list[this.active()]);
    } else if (event.key === 'Escape') {
      this.close();
    }
  }

  protected choose(choice: Choice): void {
    this.picked.set(choice);
    this.value.set(choice.id);
    this.text.set('');
    this.close();
  }

  protected clear(): void {
    this.picked.set(null);
    this.value.set(null);
  }

  protected close(): void {
    this.open.set(false);
  }
}
