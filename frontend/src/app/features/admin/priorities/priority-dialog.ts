import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { PriorityView } from '../../../api/generated/api-client';
import { hasReadableText, isHexColor } from '../../../shared/ui/color-contrast';
import { LookupDialog } from '../../../shared/ui/lookup-dialog';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { TextField } from '../../../shared/ui/text-field';
import { ADMIN_FIELD_LIMITS } from '../shared/field-limits';

/** Color choices offered in the picker; `custom` reveals the color input. */
export const PRIORITY_COLOR_TOKENS = [
  { value: 'critical', label: 'Critical red' },
  { value: 'high', label: 'High amber' },
  { value: 'normal', label: 'Normal gray' },
  { value: 'low', label: 'Low gray' },
  { value: 'neutral', label: 'Neutral' },
] as const;

export const CONTRAST_MESSAGE = 'Text must be readable: 4.5:1 minimum';

/** What the dialog hands back: the page saves it (Active and Default are not edited here). */
export interface PriorityDraft {
  label: string;
  color: string;
}

/** The name of a color for the Color column and the picker: the token's label, or the hex value of a custom color. */
export function priorityColorName(color: string): string {
  return PRIORITY_COLOR_TOKENS.find((t) => t.value === color)?.label ?? color;
}

/**
 * New priority / Edit priority (#609): one `mf-lookup-dialog` (#564) with the name (counter, 50), the color (the five tokens plus a custom
 * color), a live badge preview and the 4.5:1 contrast check. A color change is saved with the name, never on its own. The page opens it
 * (`open`), gives the priority being edited (`priority`, null for a new one) and saves on `(save)`; it passes the server's duplicate-name
 * answer as `labelError` and any other failure as `saveError`, and closes the dialog itself after a successful save. Focus: first field in,
 * the opener out (the lookup dialog's rule). No keyboard shortcut.
 */
@Component({
  selector: 'mf-priority-dialog',
  imports: [LookupDialog, TextField, PriorityBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .pd-color {
      display: grid;
      gap: var(--mf-s1);
    }
    .pd-color-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      align-items: center;
    }
    .pd-swatch {
      width: 44px;
      height: 44px;
      padding: 0;
    }
  `,
  template: `
    <mf-lookup-dialog
      [title]="title()"
      [submitLabel]="priority() ? 'Save priority' : 'Add priority'"
      cancelLabel="Cancel"
      [visible]="open()"
      (visibleChange)="open.set($event)"
      [dirty]="dirty()"
      [saving]="busy()"
      [error]="saveError()"
      [summary]="summary()"
      (save)="submit()"
      (cancel)="cancelled.emit()"
    >
      <mf-text-field
        inputId="priority-label"
        label="Name"
        [required]="true"
        [maxLength]="limits.priorityLabel"
        [counter]="true"
        [error]="nameError()"
        [(value)]="label"
      />
      <div class="pd-color">
        <label class="mf-label" for="priority-color">Color</label>
        <div class="pd-color-row">
          <select
            id="priority-color"
            class="mf-control"
            data-color
            [value]="choice()"
            (change)="pick($any($event.target).value)"
          >
            @for (c of tokens; track c.value) {
              <option [value]="c.value" [selected]="choice() === c.value">{{ c.label }}</option>
            }
            <option value="custom" [selected]="choice() === 'custom'">Custom color</option>
          </select>
          @if (choice() === 'custom') {
            <input
              id="priority-custom"
              type="color"
              class="mf-control pd-swatch"
              aria-label="Custom color"
              data-custom-color
              [value]="custom()"
              [attr.aria-invalid]="colorError() ? 'true' : null"
              [attr.aria-describedby]="colorError() ? 'priority-color-error' : null"
              (input)="custom.set($any($event.target).value.toUpperCase())"
            />
          }
        </div>
        @if (colorError()) {
          <p class="mf-form-error" role="alert" id="priority-color-error" data-color-error>
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ colorError() }}
          </p>
        }
      </div>
      <mf-priority-badge
        mfPreview
        [label]="previewLabel()"
        [color]="colorValue()"
        [rank]="rank()"
      />
    </mf-lookup-dialog>
  `,
})
export class PriorityDialog {
  /** Whether the dialog is open. */
  readonly open = model(false);
  /** The priority being edited, or null for a new one. */
  readonly priority = input<PriorityView | null>(null);
  /** Position (1 = most urgent) the preview badge shows its level bars for; a new priority goes last. */
  readonly rank = input<number | null>(null);
  readonly busy = input(false);
  /** The server's duplicate-name answer (under the Name field) and any other save failure (top of the dialog). */
  readonly labelError = input('');
  readonly saveError = input('');

  readonly save = output<PriorityDraft>();
  readonly cancelled = output<void>();

  protected readonly limits = ADMIN_FIELD_LIMITS;
  protected readonly tokens = PRIORITY_COLOR_TOKENS;

  protected readonly label = signal('');
  protected readonly choice = signal<string>('normal');
  protected readonly custom = signal('#336699');
  /** Set after a failed submit, cleared by the next one; the dialog's own messages. */
  private readonly submitted = signal(false);
  /** The name last sent to the server: its duplicate-name answer belongs to that text and goes away when the person types. */
  private readonly sentLabel = signal('');

  protected readonly title = computed(() => (this.priority() ? 'Edit priority' : 'New priority'));
  protected readonly colorValue = computed(() =>
    this.choice() === 'custom' ? this.custom() : this.choice(),
  );
  protected readonly previewLabel = computed(() => this.label().trim() || 'Priority');
  protected readonly contrastOk = computed(
    () => this.choice() !== 'custom' || hasReadableText(this.custom()),
  );

  /** Messages of a failed submit; the contrast message stays while the custom color is unreadable. */
  protected readonly nameError = computed(() => {
    if (this.submitted() && !this.label().trim()) return 'Enter a name.';
    return this.labelError() && this.label().trim() === this.sentLabel() ? this.labelError() : '';
  });
  protected readonly colorError = computed(() =>
    this.submitted() && !this.contrastOk() ? CONTRAST_MESSAGE : '',
  );
  /** The messages of the last failed submit (a snapshot: each failed submit is a new array, so focus goes to the first invalid field again). */
  protected readonly summary = signal<readonly string[]>([]);

  /** The person changed the name or the color since the dialog opened. */
  protected readonly dirty = computed(() => {
    const p = this.priority();
    const label = this.label().trim();
    if (!p) return label !== '' || this.colorValue() !== 'normal';
    return label !== p.label || this.colorValue().toUpperCase() !== p.color.toUpperCase();
  });

  constructor() {
    // Each time the dialog opens, the draft starts from the priority (or the blank form).
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const p = this.priority();
        this.label.set(p?.label ?? '');
        const color = p?.color ?? 'normal';
        if (isHexColor(color)) {
          this.choice.set('custom');
          this.custom.set(color.toUpperCase());
        } else {
          this.choice.set(color);
        }
        this.submitted.set(false);
        this.summary.set([]);
        this.sentLabel.set('');
      });
    });
    // The server's duplicate-name answer joins the summary, and focus goes back to the Name field.
    effect(() => {
      const message = this.labelError();
      if (message) untracked(() => this.summary.set([message]));
    });
  }

  protected pick(value: string): void {
    this.choice.set(value);
    if (value === 'custom' && !isHexColor(this.custom())) this.custom.set('#336699');
  }

  protected submit(): void {
    this.submitted.set(true);
    const label = this.label().trim();
    if (!label || !this.contrastOk()) {
      // The field messages are live now; the summary and the focus move are for this submit only.
      this.summary.set([this.nameError(), this.colorError()].filter((m) => m !== ''));
      return;
    }
    this.summary.set([]);
    this.sentLabel.set(label);
    this.save.emit({ label, color: this.colorValue() });
  }
}
