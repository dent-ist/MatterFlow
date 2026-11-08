import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Tip } from '../../shared/ui/tip';
import { starLabel, starTip } from './report-favourites';

/**
 * The favourite star of a report (#723, #1326): the Reports list shows it in the star column and the run page beside the heading. An outline star
 * (muted) when the report is not a favourite, a filled amber star when it is; an icon button with the action and the report as its name and the
 * tooltip "Add to Favourites" / "Remove from Favourites". The page owns the call; this only reports the press (`toggled`). `compact` is the 32 px
 * button of a table cell (D-02), otherwise it is the 36 px icon button. No shortcut: it is an ordinary tab stop that Enter and Space press.
 */
@Component({
  selector: 'mf-report-star',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Tip],
  styles: `
    :host {
      display: inline-flex;
    }
    .rs__btn {
      color: var(--mf-text-muted);
    }
    .rs__btn[data-on] {
      color: var(--mf-sem-risk-solid);
    }
  `,
  template: `
    <button
      type="button"
      class="mf-btn mf-btn--text mf-btn--icon rs__btn"
      [class.mf-btn--cell]="compact()"
      [attr.aria-label]="label()"
      [mfTip]="tip()"
      [attr.data-on]="on() ? '' : null"
      data-favourite
      (click)="toggled.emit()"
    >
      <i class="pi" [class.pi-star-fill]="on()" [class.pi-star]="!on()" aria-hidden="true"></i>
    </button>
  `,
})
export class ReportStarButton {
  /** The report's name, for the accessible name ("Add Overdue tasks to favourites"). */
  readonly name = input.required<string>();
  readonly on = input(false);
  /** The 32 px button of a table cell. */
  readonly compact = input(false);
  readonly toggled = output<void>();

  protected label(): string {
    return starLabel(this.name(), this.on());
  }
  protected tip(): string {
    return starTip(this.on());
  }
}
