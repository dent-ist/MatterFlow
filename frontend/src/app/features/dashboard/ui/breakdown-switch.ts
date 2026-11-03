import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Segmented } from '../../../shared/ui/segmented';
import { BreakdownMode } from './breakdown-view';

/** The views of a breakdown card in the order of the control (DB-11): bars first, the table last. */
const VIEWS: readonly { mode: BreakdownMode; label: string; icon: string }[] = [
  { mode: 'bars', label: 'Bars', icon: 'pi-chart-bar' },
  { mode: 'pie', label: 'Pie', icon: 'pi-chart-pie' },
  { mode: 'table', label: 'Table', icon: 'pi-table' },
];

/**
 * The view switch in the header of a Breakdowns card: the shared segmented control (`mfSegmented`: one Tab stop, arrow keys inside the group, the pressed
 * button ticked and bold). It replaces the old "View as table" link; the table keeps the accessible data table. The group is named for the card.
 */
@Component({
  selector: 'mf-bd-switch',
  imports: [Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div mfSegmented role="group" [attr.aria-label]="'View of ' + heading()" data-view-switch>
      @for (v of views; track v.mode) {
        <button
          type="button"
          class="mf-btn"
          [attr.data-view]="v.mode"
          [attr.aria-pressed]="mode() === v.mode"
          (click)="pick.emit(v.mode)"
        >
          <i class="pi" [class]="v.icon" aria-hidden="true"></i>
          <span class="lbl">{{ v.label }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .mf-btn {
      gap: var(--mf-s1);
      padding-inline: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .pi {
      font-size: 0.8125rem;
    }
    /* A narrow card: the icons carry the buttons, the words stay for assistive tools. */
    @container (max-width: 17rem) {
      .lbl {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    }
  `,
})
export class BreakdownSwitch {
  readonly mode = input.required<BreakdownMode>();
  readonly heading = input.required<string>();
  readonly pick = output<BreakdownMode>();
  protected readonly views = VIEWS;
}
