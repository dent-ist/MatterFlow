import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AvailabilityLike, availabilityDisplay } from '../../core/availability/availability';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { Badge } from '../ui/badge';

/**
 * A person's availability as a badge: `Available`, `Off hours` or `Out of office until Oct 20`. Colour, icon and text always say the
 * same thing. Off hours is a soft state (neutral), never "unavailable". The out-of-office note is the tooltip.
 */
@Component({
  selector: 'mf-availability-chip',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      [attr.title]="availability()?.note || null"
      data-availability-chip
      [attr.data-state]="d().state"
    >
      <mf-badge [tone]="d().tone" [icon]="d().icon">{{ d().label }}</mf-badge>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class AvailabilityChip {
  readonly availability = input<AvailabilityLike | null | undefined>(null);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly d = computed(() => availabilityDisplay(this.availability(), this.zone));
}
