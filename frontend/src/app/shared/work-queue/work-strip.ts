import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

/** Where a link-mode item goes: a router path and its query parameters (repeated keys are arrays). */
export interface WorkStripLink {
  path: string;
  queryParams?: Params;
}

export interface WorkStripItem {
  key: string;
  label: string;
  /** Null while unknown: shown as `--` with the width reserved. */
  count: number | null;
  /** Tooltip of the item. */
  hint?: string;
  /** Overdue style: red text and an icon while the count is above zero (never colour alone: the label is always there). */
  alert?: boolean;
  /** Link mode: the item is an `<a>` to this address (no `aria-pressed`). Ignored while the strip is `interactive`. */
  link?: WorkStripLink;
}

/**
 * The one-line summary strip of My Work ("Needs attention") and Pod Work (X2): a label and a count per item. With `interactive`, an item is a
 * toggle button (`pick` carries its key; `active` is the pressed one); an item with a `link` is an anchor (link mode, the record Overview
 * strip, #260); otherwise it is plain text. A strip without items renders nothing. Zero counts are muted but stay in place.
 * A single line from 640 px, wrapping below, a 2x2 group of 44 px targets on a phone. More items (A5's "New") are just more entries.
 */
@Component({
  selector: 'mf-work-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length > 0) {
      <ul class="strip" [attr.aria-label]="label()" [attr.title]="hint() ?? null" data-strip>
        @for (item of items(); track item.key) {
          <li>
            @if (!interactive() && item.link) {
              <a
                class="item"
                [class.zero]="item.count === 0"
                [class.alert]="item.alert && !!item.count"
                [routerLink]="item.link.path"
                [queryParams]="item.link.queryParams"
                [attr.title]="item.hint ?? null"
                [attr.data-strip-item]="item.key"
              >
                <ng-container *ngTemplateOutlet="body; context: { $implicit: item }" />
              </a>
            } @else if (interactive()) {
              <button
                type="button"
                class="item"
                [class.zero]="item.count === 0"
                [class.alert]="item.alert && !!item.count"
                [class.on]="item.key === active()"
                [attr.aria-pressed]="item.key === active()"
                [attr.title]="item.hint ?? null"
                [attr.data-strip-item]="item.key"
                (click)="pick.emit(item.key)"
              >
                <ng-container *ngTemplateOutlet="body; context: { $implicit: item }" />
              </button>
            } @else {
              <span
                class="item"
                [class.zero]="item.count === 0"
                [class.alert]="item.alert && !!item.count"
                [attr.title]="item.hint ?? null"
                [attr.data-strip-item]="item.key"
              >
                <ng-container *ngTemplateOutlet="body; context: { $implicit: item }" />
              </span>
            }
          </li>
        }
      </ul>
    }
    <ng-template #body let-item>
      @if (item.alert && item.count) {
        <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
      }
      {{ item.label }}
      <strong class="n">{{ item.count ?? '--' }}</strong>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      margin: 0 0 var(--mf-s2);
    }
    .strip {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--mf-text-muted);
    }
    .item {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 28px;
      padding: 0 var(--mf-s2);
      border: 0;
      border-radius: var(--mf-radius, 4px);
      background: none;
      color: inherit;
      font: inherit;
    }
    button.item,
    a.item {
      cursor: pointer;
    }
    a.item {
      text-decoration: none;
    }
    a.item:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    button.item:hover,
    a.item:hover {
      background: var(--mf-surface-2, var(--mf-border));
    }
    button.item.on {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
      color: var(--mf-text);
    }
    .n {
      min-width: 2ch;
      color: var(--mf-text);
      font-variant-numeric: tabular-nums;
    }
    .zero,
    .zero .n {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .alert,
    .alert .n {
      color: var(--mf-danger);
    }
    @media (width < 480px) {
      .strip {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--mf-s1);
      }
      .item {
        width: 100%;
        min-height: 44px;
        justify-content: space-between;
        border: 1px solid var(--mf-border);
      }
    }
  `,
  imports: [NgTemplateOutlet, RouterLink],
})
export class WorkStrip {
  readonly items = input.required<readonly WorkStripItem[]>();
  readonly label = input<string>('Summary');
  readonly hint = input<string | null>(null);
  readonly interactive = input(false);
  readonly active = input<string | null>(null);
  readonly pick = output<string>();
}
