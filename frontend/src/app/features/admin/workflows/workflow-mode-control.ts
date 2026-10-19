import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Dismissable } from '../../../shared/ui/dismissable';
import { FloatPanel } from '../../../shared/ui/float-position';

export const ORDERED_TEXT =
  'Ordered: steps must be resolved in the sequence shown. Numbering is shown to users and the order below is the order they work in.';
export const UNORDERED_TEXT =
  'Unordered: steps can be done in any order. Numbering is hidden from users and the order below is for display only.';

/**
 * The execution mode of a draft as an inline control of the action bar (VP4, #397): a button "Ordered" / "Unordered" that opens a
 * popover with the two choices and the explanation. Choosing the other mode only asks the page (`modeRequest`); the page keeps its
 * confirmation and changes the mode. Esc, a press outside or Tab away closes the popover; focus returns to the button.
 */
@Component({
  selector: 'mf-workflow-mode-control',
  imports: [Dismissable, FloatPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-flex;
    }
    .wmc__btn {
      gap: var(--mf-s1);
    }
    .wmc__label {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .wmc__pop {
      z-index: 1100;
      display: grid;
      gap: var(--mf-s2);
      width: max-content;
      max-width: min(24rem, calc(100vw - 2 * var(--mf-s4)));
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2);
    }
    .wmc__pop p {
      margin: 0;
    }
    .wmc__opt {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-target-min);
      margin: 0;
    }
    .wmc__opt input {
      flex: none;
      margin: 0;
    }
  `,
  template: `
    <button
      #btn
      type="button"
      class="mf-btn wmc__btn"
      data-mode-button
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="'Execution mode: ' + (ordered() ? 'Ordered' : 'Unordered')"
      (click)="open.set(!open())"
    >
      <span class="wmc__label" aria-hidden="true">Mode</span>
      {{ ordered() ? 'Ordered' : 'Unordered' }}
      <i class="pi pi-chevron-down" aria-hidden="true"></i>
    </button>
    @if (open()) {
      <div
        class="wmc__pop"
        role="dialog"
        aria-label="Execution mode"
        data-mode-pop
        [mfDismissable]="btn"
        (dismissed)="open.set(false)"
        [mfFloatPanel]="btn"
        mfFloatAlign="start"
        (floatClose)="open.set(false)"
        (placed)="first.focus()"
      >
        <label class="wmc__opt">
          <input
            #first
            type="radio"
            name="wf-mode"
            data-mode="ordered"
            [checked]="ordered()"
            (change)="choose(true)"
          />
          Ordered - steps must be resolved in sequence
        </label>
        <label class="wmc__opt">
          <input
            type="radio"
            name="wf-mode"
            data-mode="unordered"
            [checked]="!ordered()"
            (change)="choose(false)"
          />
          Unordered - any order
        </label>
        <p class="pg-reason" data-mode-help>{{ ordered() ? orderedText : unorderedText }}</p>
      </div>
    }
  `,
})
export class WorkflowModeControl {
  readonly ordered = input(true);
  readonly modeRequest = output<boolean>();

  protected readonly open = signal(false);
  private readonly button = viewChild<ElementRef<HTMLButtonElement>>('btn');
  protected readonly orderedText = ORDERED_TEXT;
  protected readonly unorderedText = UNORDERED_TEXT;

  protected choose(ordered: boolean): void {
    this.open.set(false);
    this.button()?.nativeElement.focus();
    if (ordered !== this.ordered()) this.modeRequest.emit(ordered);
  }
}
