import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The Calendar button of the My Matters Overview (epic #893 issue #929): an icon button in the heading of the task area that switches the area between the grids
 * (Needs my attention, Next 7 days) and the calendar, and back. It names what pressing it does ("Show calendar" while the grids are shown, "Show list" while the calendar
 * is), so the label changes with the state instead of a pressed flag. A 32 px button, 44 px on a phone; never a shortcut (#420).
 */
@Component({
  selector: 'mf-mm-calendar-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-flex;
    }
    .ct {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--mf-options-h, 32px);
      min-width: var(--mf-options-h, 32px);
      height: var(--mf-options-h, 32px);
      padding: 0;
    }
    @media (max-width: 639.98px) {
      .ct {
        width: 44px;
        min-width: 44px;
        height: 44px;
      }
    }
  `,
  template: `
    <button
      type="button"
      class="mf-btn ct"
      data-calendar-toggle
      [attr.aria-label]="label()"
      [attr.title]="label()"
      (click)="flip.emit()"
    >
      <i
        class="pi"
        [class.pi-calendar]="!calendar()"
        [class.pi-list]="calendar()"
        aria-hidden="true"
      ></i>
    </button>
  `,
})
export class CalendarToggle {
  /** The calendar is the one shown now (the button then takes the person back to the list). */
  readonly calendar = input(false);
  readonly flip = output<void>();
  protected label(): string {
    return this.calendar() ? 'Show list' : 'Show calendar';
  }
}
