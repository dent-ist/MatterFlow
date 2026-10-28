import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * A headline number that stands out (`mf-stat-tile`, epic #893 issue #933): the value large, its unit once next to it, the plain label under it and, when there
 * is one, a small note ("oldest 41 days"). A zero is muted, so the tiles that carry something are the ones the eye lands on. A tile that can filter the list below
 * it is a toggle button (`pressable`): pressed it is outlined, bold and ticked, never colour alone. The accessible name STARTS with the value ("2 pending
 * disposition, oldest 41 days"), the way the number is read first on screen. Put the tiles in a `ul` with one tile in each `li`.
 */
@Component({
  selector: 'mf-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .st {
      box-sizing: border-box;
      display: grid;
      align-content: center;
      gap: 2px;
      width: 100%;
      height: 100%;
      min-height: 76px;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg, 8px);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      text-align: left;
    }
    button.st {
      cursor: pointer;
    }
    button.st:hover {
      background: var(--mf-surface-alt);
    }
    button.st:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .st--on {
      border-color: var(--mf-primary);
      border-width: 2px;
      padding: calc(var(--mf-s2) - 1px) calc(var(--mf-s3) - 1px);
      background: var(--mf-selected-bg);
    }
    .st__value {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-h2, 22px);
      font-weight: 700;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
    }
    .st__unit {
      font-size: var(--mf-fs-md);
      font-weight: 600;
    }
    .st__label {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .st--on .st__label {
      color: var(--mf-text);
      font-weight: 700;
    }
    .st__note {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    /* A zero says "nothing here": quiet, regular weight. */
    .st--zero .st__value {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .st__tick::before {
      content: '\\2713';
      margin-right: 2px;
    }
    @media (max-width: 639.98px) {
      .st {
        min-height: 64px;
      }
      button.st {
        min-height: 44px;
      }
      .st__value {
        font-size: var(--mf-fs-h3, 18px);
      }
    }
  `,
  template: `
    @if (pressable()) {
      <button
        type="button"
        class="st"
        [class.st--on]="pressed()"
        [class.st--zero]="muted()"
        [attr.aria-pressed]="pressed()"
        [attr.aria-label]="name()"
        (click)="pick.emit()"
      >
        <ng-container *ngTemplateOutlet="body" />
      </button>
    } @else {
      <div class="st" [class.st--zero]="muted()" role="group" [attr.aria-label]="name()">
        <ng-container *ngTemplateOutlet="body" />
      </div>
    }
    <ng-template #body>
      <span class="st__value" aria-hidden="true">
        <span>{{ value() }}</span>
        @if (unit()) {
          <span class="st__unit">{{ unit() }}</span>
        }
      </span>
      <span class="st__label" aria-hidden="true">
        @if (pressed()) {
          <span class="st__tick"></span>
        }
        {{ label() }}
      </span>
      @if (note()) {
        <span class="st__note" aria-hidden="true">{{ note() }}</span>
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
})
export class StatTile {
  /** The number as shown ("1,234", "989.98"). */
  readonly value = input.required<string>();
  /** The plain label ("Pending disposition"). */
  readonly label = input.required<string>();
  /** The unit of the value, shown once beside it ("GB"). */
  readonly unit = input('');
  /** A small line under the label ("oldest 41 days"). */
  readonly note = input('');
  /** The value is zero (or nothing): muted. */
  readonly muted = input(false);
  /** The tile is a toggle that filters something else. */
  readonly pressable = input(false);
  readonly pressed = input(false);
  /** The tile was pressed. */
  readonly pick = output<void>();

  /** "2 pending disposition, oldest 41 days": the value first. */
  protected readonly name = computed(() => {
    const value = `${this.value()}${this.unit() ? ' ' + this.unit() : ''}`;
    const label = this.label().toLowerCase();
    return `${value} ${label}${this.note() ? ', ' + this.note() : ''}`;
  });
}
