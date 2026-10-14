import {
  ComponentRef,
  Directive,
  InjectionToken,
  OnDestroy,
  Type,
  ViewContainerRef,
  effect,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Contract for pluggable ASSET_REF / USER_REF pickers. A picker is a standalone component that
 * declares these inputs and a `valueChange` output (a `model()` satisfies both):
 *
 * - `value`: the selected id (positive integer) or null
 * - `disabled`: true while the form is read-only
 * - `readOnly`: true when the form is read-only; the picker should display the selection's name
 * - `invalid`: true when the field shows a validation error
 * - `inputId`: id for the focusable element, so the field label can point at it
 * - `label`: accessible name of the field
 *
 * Inputs a picker does not declare are skipped.
 */
export interface ReferencePicker {
  value?: Subscribable;
  valueChange?: Subscribable;
}

interface Subscribable {
  subscribe(next: (value: number | null) => void): { unsubscribe(): void };
}

/** Provide a picker component type for ASSET_REF fields. */
export const MF_ASSET_PICKER = new InjectionToken<Type<ReferencePicker>>('MF_ASSET_PICKER');
/** Provide a picker component type for USER_REF fields. */
export const MF_USER_PICKER = new InjectionToken<Type<ReferencePicker>>('MF_USER_PICKER');

/** Hosts a picker component and wires its inputs and `valueChange` output. */
@Directive({ selector: '[mfPickerHost]' })
export class ReferencePickerHost implements OnDestroy {
  readonly picker = input.required<Type<ReferencePicker>>({ alias: 'mfPickerHost' });
  readonly value = input<number | null>(null);
  readonly pickerDisabled = input(false);
  readonly pickerInvalid = input(false);
  readonly pickerInputId = input('');
  readonly pickerLabel = input('');
  readonly valueChange = output<number | null>();

  private readonly vcr = inject(ViewContainerRef);
  private ref: ComponentRef<ReferencePicker> | null = null;
  private sub: { unsubscribe(): void } | null = null;

  constructor() {
    effect(() => {
      const type = this.picker();
      if (this.ref?.componentType !== type) {
        this.destroyRef();
        this.ref = this.vcr.createComponent(type);
        this.sub =
          (this.ref.instance.valueChange ?? this.ref.instance.value)?.subscribe((v) =>
            this.valueChange.emit(v),
          ) ?? null;
      }
      const set = (name: string, v: unknown): void => {
        try {
          this.ref?.setInput(name, v);
        } catch {
          // The picker does not declare this input.
        }
      };
      set('value', this.value());
      set('disabled', this.pickerDisabled());
      set('readOnly', this.pickerDisabled());
      set('invalid', this.pickerInvalid());
      set('inputId', this.pickerInputId());
      set('label', this.pickerLabel());
    });
  }

  ngOnDestroy(): void {
    this.destroyRef();
  }

  private destroyRef(): void {
    this.sub?.unsubscribe();
    this.ref?.destroy();
    this.ref = null;
    this.sub = null;
  }
}
