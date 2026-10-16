import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The level glyph of a priority (4 small bars for the most urgent down to 1, the same shape as the priority badge). Decorative. */
@Component({
  selector: 'mf-users-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (on of bars(); track $index) {
      <span class="gb" [class.on]="on"></span>
    }
  `,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host {
      display: inline-flex;
      align-items: flex-end;
      gap: 1px;
      height: 10px;
    }
    .gb {
      box-sizing: border-box;
      width: 3px;
      border: 1px solid currentColor;
    }
    .gb:nth-child(1) {
      height: 4px;
    }
    .gb:nth-child(2) {
      height: 6px;
    }
    .gb:nth-child(3) {
      height: 8px;
    }
    .gb:nth-child(4) {
      height: 10px;
    }
    .gb.on {
      background: currentColor;
    }
  `,
})
export class UsersGlyph {
  /** How many of the four bars are filled (1 to 4). */
  readonly level = input(1);
  protected readonly bars = computed(() => [0, 1, 2, 3].map((i) => i < this.level()));
}
