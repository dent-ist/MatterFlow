import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
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
  /** A word or phrase in place of the number (a record's Form, Default workflow or Status); long text is cut with an ellipsis, the tooltip has it whole. */
  value?: string;
  /** Tooltip of the item. */
  hint?: string;
  /** Overdue style: red text and an icon while the count is above zero (never colour alone: the label is always there). */
  alert?: boolean;
  /** Link mode: the item is an `<a>` to this address (no `aria-pressed`). Ignored while the strip is `interactive`. */
  link?: WorkStripLink;
  /** In an `interactive` strip: a plain count that is not a toggle (a number that has no filter behind it). */
  inert?: boolean;
  /** Tinted (the warning colours) while the count is above zero: "somebody is waiting" (Users: Pending access). The label and the number stay, so it is never colour alone. */
  tinted?: boolean;
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
      <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
      <ul
        class="strip"
        [class.seg]="segments()"
        [attr.role]="roving() ? 'toolbar' : null"
        [attr.aria-orientation]="roving() ? 'horizontal' : null"
        [attr.aria-label]="label()"
        [attr.title]="hint() ?? null"
        data-strip
        (keydown)="onKeydown($event)"
        (focusin)="onFocusIn($event)"
      >
        @for (item of items(); track item.key) {
          <li [attr.role]="roving() ? 'none' : null">
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
            } @else if (interactive() && !item.inert) {
              <button
                type="button"
                class="item"
                [class.zero]="item.count === 0"
                [class.alert]="item.alert && !!item.count"
                [class.on]="item.key === active()"
                [class.tinted]="item.tinted && !!item.count"
                [attr.aria-pressed]="item.key === active()"
                [attr.tabindex]="roving() ? (item.key === stop() ? 0 : -1) : null"
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
      <strong class="n" [class.v]="item.value !== undefined">{{
        item.value ?? item.count ?? '--'
      }}</strong>
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
    .n.v {
      max-width: 22ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    /* Somebody is waiting (Pending access): the warning colours while the count is above zero; the pressed segment keeps its fill. */
    button.item.tinted:not(.on) {
      border-color: var(--mf-warning);
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
    }
    button.item.tinted:not(.on) .n {
      color: inherit;
    }
    /* Segments (#581): one connected group of choices, the pressed one filled; the same tokens as the chips. */
    .seg {
      gap: 0;
    }
    .seg .item {
      min-height: 32px;
      padding-inline: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: 0;
    }
    .seg li:not(:first-child) .item {
      margin-left: -1px;
    }
    .seg li:first-child .item {
      border-radius: var(--mf-radius, 4px) 0 0 var(--mf-radius, 4px);
    }
    .seg li:last-child .item {
      border-radius: 0 var(--mf-radius, 4px) var(--mf-radius, 4px) 0;
    }
    .seg button.item.on {
      outline: none;
      border-color: var(--mf-primary);
      background: color-mix(in srgb, var(--mf-primary) 12%, var(--mf-surface));
      box-shadow: inset 0 -2px 0 var(--mf-primary);
      font-weight: 600;
      position: relative;
    }
    .seg button.item:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
      position: relative;
    }
    @media (width < 480px) {
      .strip.seg {
        display: flex;
        gap: 0;
      }
      .seg li {
        flex: 1 1 0;
        min-width: 0;
      }
      .seg .item {
        min-height: 44px;
        justify-content: center;
        flex-wrap: wrap;
      }
      .strip li {
        min-width: 0;
      }
      /* A word or phrase (a record's Form, Default workflow) gets the whole box: label above, text below, so it is not cut to "No...". */
      .item:has(.n.v) {
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 0;
      }
      .item:has(.n.v) .n.v {
        max-width: 100%;
      }
      .n.v {
        flex: 0 1 auto;
        min-width: 0;
        max-width: none;
      }
      .strip {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--mf-s1);
      }
      .item {
        width: 100%;
        min-width: 0;
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
  /** Draws the items as one connected group of choices (single-select: the `active` one is filled) instead of loose chips (#581). Use with `interactive`. */
  readonly segments = input(false);
  readonly active = input<string | null>(null);
  /**
   * One Tab stop for the whole group, arrow keys move between the choices (a roving tabindex, as a toolbar): Left/Right, Home and End.
   * The pressed choice is the stop (the first one when none is pressed). Enter and Space press, as for any button. Use with `interactive`.
   */
  readonly roving = input(false);
  readonly pick = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The key of the choice that is the Tab stop while the focus is elsewhere or has moved with the arrow keys. */
  private readonly moved = signal<string | null>(null);

  protected stop(): string | null {
    const keys = this.items()
      .filter((i) => !i.inert)
      .map((i) => i.key);
    const wanted = this.moved();
    if (wanted && keys.includes(wanted)) return wanted;
    const pressed = this.active();
    return pressed && keys.includes(pressed) ? pressed : (keys[0] ?? null);
  }

  protected onFocusIn(event: FocusEvent): void {
    if (!this.roving()) return;
    const key = (event.target as HTMLElement | null)?.getAttribute?.('data-strip-item');
    if (key) this.moved.set(key);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.roving() || event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('button[data-strip-item]'),
    );
    const at = buttons.indexOf(event.target as HTMLElement);
    if (at < 0 || buttons.length === 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (at + 1) % buttons.length;
        break;
      case 'ArrowLeft':
        next = (at - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    buttons[next].focus();
  }
}
