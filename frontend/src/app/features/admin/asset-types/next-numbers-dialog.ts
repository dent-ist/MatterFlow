import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AssetNumberCounterItem,
  AssetTypesClient,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { StateBlock } from '../../../shared/ui/state-block';
import { renderTail } from './tail-rules';

/** The highest next number the dialog accepts (the counter is shown in a few digits, so this is the practical limit of the spec). */
export const NEXT_NUMBER_MAX = 999_999;

/** The asset type the dialog works on. */
export interface NumberedType {
  assetTypeId: number;
  name: string;
  /** The tail of the pattern (`_{###}`). */
  tail: string;
}

/** The matter a row of the Next Numbers grid belongs to, with its counter. */
export type CounterTarget = Pick<
  AssetNumberCounterItem,
  'matterId' | 'matterRef' | 'matterName' | 'nextNumber'
>;

/** The validation message of a typed next number, or null when it is good (`current` is the number the next asset gets now). */
export function nextNumberError(text: string, current: number): string | null {
  const value = text.trim();
  if (value === '') return 'Enter the next number.';
  if (!/^\d+$/.test(value)) return 'Next Number must be a whole number.';
  const n = Number(value);
  if (n > NEXT_NUMBER_MAX) return `Enter ${NEXT_NUMBER_MAX} or less.`;
  if (n < current)
    return `The next number can’t be lower than ${current}, the number the next asset gets now.`;
  return null;
}

/** The counter at the type's minimum width: `8` with `{###}` is `008`. */
const pad = (n: number, tail: string): string =>
  String(n).padStart(/\{(#+)\}/.exec(tail)?.[1].length ?? 1, '0');

/**
 * The Set Next Number dialog of the Numbering tab (#1297, spec 2.2 and 2.3). The counter can only be raised: the minimum is the number the next asset gets now. Opened from a row
 * (the matter is fixed) or from Set for a Matter (the matter is picked, then its counter is read). Raising it asks one confirm question first; a value equal to the current one
 * closes the dialog without a call. The example is the whole name from the same `renderTail` as the Numbering tab.
 */
@Component({
  selector: 'mf-next-numbers-dialog',
  imports: [FormDialog, ConfirmDialog, EntityPicker, StateBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/form-field.scss',
  styles: `
    .nn {
      display: grid;
      gap: var(--mf-s3);
    }
    .nn__value {
      width: 160px;
      font-family: var(--mf-font-mono);
      text-align: right;
    }
    .nn__example {
      margin: 0;
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-md);
      overflow-wrap: anywhere;
    }
    .nn__muted {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <mf-form-dialog
      title="Set Next Number"
      primaryLabel="Set Next Number"
      size="small"
      [subtitle]="subtitle()"
      [busy]="busy()"
      [error]="errorText()"
      [dirty]="dirty()"
      [canSubmit]="!!matter() && !loading() && canPick()"
      [(visible)]="visible"
      (submitted)="submit()"
    >
      <form
        class="nn"
        novalidate
        (submit)="$event.preventDefault(); submit()"
        data-next-number-form
      >
        @if (!fixed()) {
          @if (canPick()) {
            <mf-entity-picker
              inputId="nn-matter"
              label="Matter"
              placeholder="e.g. 90001-80011 or matter name"
              [required]="true"
              [search]="searchMatters"
              [error]="matterError()"
              [selected]="matter()"
              (selectedChange)="pick($event)"
            />
          } @else {
            <mf-state-block icon="pi-lock">You don't have access to matters.</mf-state-block>
          }
        }
        <div class="mf-field">
          <label class="mf-field__label" for="nn-value">
            Next Number <span class="mf-field__req">(required)</span>
          </label>
          <input
            id="nn-value"
            class="mf-field__input nn__value"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            [placeholder]="loading() ? 'Loading...' : ''"
            [disabled]="loading() || !matter()"
            [attr.aria-invalid]="shownError() ? 'true' : null"
            [attr.aria-describedby]="shownError() ? 'nn-value-error' : null"
            [value]="text()"
            (input)="onInput($any($event.target).value)"
            data-next-number-input
          />
          @if (shownError(); as message) {
            <p class="mf-field__error" role="alert" id="nn-value-error" data-next-number-error>
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              {{ message }}
            </p>
          }
        </div>
        @if (example(); as name) {
          <div class="mf-field">
            <span class="mf-field__label">Example</span>
            <p class="nn__example" role="status" data-next-number-example>{{ name }}</p>
          </div>
        }
        @if (skipped(); as note) {
          <p class="nn__muted" data-next-number-skipped>{{ note }}</p>
        }
      </form>
    </mf-form-dialog>

    <mf-confirm-dialog
      title="Set Next Number"
      confirmLabel="Set Next Number"
      [busy]="busy()"
      [(visible)]="confirmOpen"
      (confirmed)="save()"
    >
      <p data-next-number-confirm>
        The next asset of {{ type().name }} in {{ cm() }} will be numbered {{ confirmName() }}. The
        numbers in between are never used. This can't be undone.
      </p>
    </mf-confirm-dialog>
  `,
})
export class NextNumbersDialog {
  readonly type = input.required<NumberedType>();
  /** A row's matter and counter: the matter is fixed. Null: "Set for a Matter" (the matter is picked). */
  readonly target = input<CounterTarget | null>(null);
  readonly visible = model(false);
  /** The counter was raised; the grid reloads. */
  readonly saved = output<AssetNumberCounterItem>();

  private readonly api = inject(AssetTypesClient);
  private readonly matters = inject(MattersClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);

  protected readonly matter = signal<PickerOption | null>(null);
  protected readonly current = signal(1);
  protected readonly text = signal('1');
  protected readonly touched = signal(false);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly errorText = signal('');
  protected readonly serverError = signal('');
  protected readonly confirmOpen = signal(false);
  protected readonly matterMissing = signal(false);
  /** The example waits 300 ms after the last key (live region, spec 2.2). */
  private readonly typed = signal('1');
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly fixed = computed(() => this.target() !== null);
  protected readonly canPick = computed(() => this.auth.has('Matter.View'));
  protected readonly subtitle = computed(() => {
    const t = this.target();
    return t ? `${t.matterRef} ${t.matterName}` : '';
  });
  protected readonly dirty = computed(() => this.text() !== String(this.current()));
  protected readonly matterError = computed(() =>
    this.matterMissing() && !this.matter() ? 'Select a matter.' : null,
  );
  protected readonly validation = computed(() => nextNumberError(this.text(), this.current()));
  protected readonly shownError = computed(
    () => this.serverError() || (this.touched() ? this.validation() : null),
  );
  protected readonly cm = computed(() => this.matter()?.label.split(' ')[0] ?? '');
  protected readonly example = computed(() => {
    const value = this.typed().trim();
    if (!this.cm() || !/^\d+$/.test(value) || Number(value) > NEXT_NUMBER_MAX || Number(value) < 1)
      return null;
    return renderTail(this.cm(), this.type().tail, Number(value));
  });
  protected readonly confirmName = computed(
    () => renderTail(this.cm(), this.type().tail, Number(this.text())) ?? '',
  );
  protected readonly skipped = computed(() => {
    const value = this.text().trim();
    if (!/^\d+$/.test(value) || this.validation()) return null;
    const n = Number(value);
    const from = this.current();
    if (n <= from) return null;
    const tail = this.type().tail;
    return n - 1 === from
      ? `Number ${pad(from, tail)} will never be used.`
      : `Numbers ${pad(from, tail)} to ${pad(n - 1, tail)} will never be used.`;
  });

  constructor() {
    // Opening the dialog starts it afresh: from a row the matter and its counter are known, otherwise the picker is empty.
    effect(() => {
      if (!this.visible()) return;
      const target = this.target();
      untracked(() => {
        this.reset();
        if (target) {
          this.matter.set({
            id: target.matterId,
            label: `${target.matterRef} ${target.matterName}`,
          });
          this.setCurrent(target.nextNumber);
        }
      });
    });
  }

  protected readonly searchMatters = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.matters.listMatters(
        query,
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
        undefined,
      ),
    );
    return page.items.map((m) => ({
      id: m.matterId,
      label: `${m.matterRef} ${m.name}`,
      inactive: !m.isActive,
    }));
  };

  private reset(): void {
    this.matter.set(null);
    this.touched.set(false);
    this.matterMissing.set(false);
    this.errorText.set('');
    this.serverError.set('');
    this.confirmOpen.set(false);
    this.busy.set(false);
    this.setCurrent(1);
  }

  private setCurrent(next: number): void {
    this.current.set(next);
    this.text.set(String(next));
    this.typed.set(String(next));
  }

  /** The matter was picked (Set for a Matter): its counter is read and prefilled; a matter without a counter shows 1. */
  protected async pick(option: PickerOption | null): Promise<void> {
    this.matter.set(option);
    this.serverError.set('');
    this.errorText.set('');
    if (!option) {
      this.setCurrent(1);
      return;
    }
    this.loading.set(true);
    this.text.set('');
    try {
      const item = await firstValueFrom(
        this.api.getAssetNumberCounter(this.type().assetTypeId, option.id),
      );
      if (this.matter()?.id === option.id) this.setCurrent(item.nextNumber);
    } catch {
      if (this.matter()?.id === option.id) this.setCurrent(1);
      this.errorText.set('Couldn’t read the counter of that matter.');
    } finally {
      this.loading.set(false);
    }
  }

  protected onInput(value: string): void {
    this.text.set(value);
    this.touched.set(true);
    this.serverError.set('');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.typed.set(value), 300);
  }

  /** The primary: validates, closes with no call when nothing changes, else asks the confirm question. */
  protected submit(): void {
    if (this.busy()) return;
    this.matterMissing.set(true);
    this.touched.set(true);
    if (!this.matter() || this.validation()) return;
    this.typed.set(this.text());
    if (Number(this.text()) === this.current()) {
      this.visible.set(false);
      return;
    }
    this.errorText.set('');
    this.confirmOpen.set(true);
  }

  protected async save(): Promise<void> {
    const matter = this.matter();
    if (!matter || this.busy()) return;
    this.busy.set(true);
    this.errorText.set('');
    try {
      const item = await firstValueFrom(
        this.api.setAssetNextNumber(this.type().assetTypeId, matter.id, {
          nextNumber: Number(this.text()),
        }),
      );
      this.notify.success('Next number set', item.nextAssetNumber);
      this.confirmOpen.set(false);
      this.visible.set(false);
      this.saved.emit(item);
    } catch (e) {
      this.confirmOpen.set(false);
      await this.fail(e, matter.id);
    } finally {
      this.busy.set(false);
    }
  }

  /** The counter rose meanwhile: the field keeps its text, the minimum is read again and the message names it. */
  private async fail(e: unknown, matterId: number): Promise<void> {
    const code = e instanceof ApiError ? firstFieldCode(e) : undefined;
    if (code === 'NEXT_NUMBER_TOO_LOW') {
      try {
        const item = await firstValueFrom(
          this.api.getAssetNumberCounter(this.type().assetTypeId, matterId),
        );
        this.current.set(item.nextNumber);
        this.typed.set(this.text());
        this.serverError.set(
          `The next number is now ${item.nextNumber} or more. Enter a higher number.`,
        );
        return;
      } catch {
        // falls through to the general failure
      }
    }
    this.notify.error(
      'Couldn’t set the next number.',
      e instanceof Error && e.message ? e.message : undefined,
    );
  }
}

function firstFieldCode(e: ApiError): string | undefined {
  for (const list of Object.values(e.problem?.errors ?? {})) {
    if (list?.[0]?.code) return list[0].code;
  }
  return e.code;
}
