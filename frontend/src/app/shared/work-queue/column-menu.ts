import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Dismissable } from '../ui/dismissable';
import { ColumnMenuId, ColumnMenuItem } from './column-menu-items';

/**
 * The menu of a column header (#207): Sort, Widen, Narrow, Fit to content, Reset width, Hide column. A `menu` of `menuitem` buttons with
 * a roving tab stop: Up, Down, Home and End move, Enter and Space choose, Esc closes and gives the header its focus back (the shared
 * popover rule, `mfDismissable`), Tab closes and continues from the header. Items that do not apply stay in the list, dimmed and
 * `aria-disabled`, so the person hears why (Fit on the Title: "Fills the space left"). Loaded on first use (`@defer` in the grid).
 */
@Component({
  selector: 'mf-column-menu',
  imports: [Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #menu
      class="cm"
      role="menu"
      tabindex="-1"
      data-column-menu
      [attr.aria-label]="label() + ' column options'"
      [mfDismissable]="trigger()"
      (dismissed)="closed.emit(false)"
      [style.left.px]="pos().left"
      [style.top.px]="pos().top"
      (keydown)="onKey($event)"
    >
      @for (item of items(); track item.id; let i = $index) {
        <button
          type="button"
          role="menuitem"
          class="cm-item"
          [attr.data-item]="item.id"
          [attr.aria-label]="item.name"
          [attr.aria-disabled]="item.disabled ? 'true' : null"
          [tabindex]="i === active() ? 0 : -1"
          (focus)="active.set(i)"
          (click)="choose(item)"
        >
          {{ item.label }}
          @if (item.hint) {
            <span class="cm-hint">{{ item.hint }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    .cm {
      position: fixed;
      z-index: 1100;
      display: flex;
      flex-direction: column;
      min-width: 12rem;
      padding: var(--mf-s1);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-1);
    }
    .cm-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      min-height: var(--mf-target-min);
      padding: var(--mf-s1) var(--mf-s3);
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .cm-item:hover,
    .cm-item:focus-visible {
      background: var(--mf-surface-alt);
    }
    .cm-item[aria-disabled='true'] {
      color: var(--mf-text-muted);
      cursor: default;
    }
    .cm-hint {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class ColumnMenu {
  readonly items = input.required<readonly ColumnMenuItem[]>();
  /** The column's name, for the menu's accessible name. */
  readonly label = input.required<string>();
  /** Where it opens (viewport px); it is moved back inside the window once measured. */
  readonly x = input(0);
  readonly y = input(0);
  /** The header control that opened it: Esc gives it focus back and a press on it is not "outside". */
  readonly trigger = input<HTMLElement | null>(null);
  readonly picked = output<ColumnMenuId>();
  /** `true`: the grid moves focus back to the header (Tab); Esc and outside presses are handled by the dismiss rule. */
  readonly closed = output<boolean>();

  protected readonly active = signal(0);
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');
  private readonly shift = signal<{ left: number; top: number } | null>(null);
  protected readonly pos = () => this.shift() ?? { left: this.x(), top: this.y() };

  constructor() {
    afterNextRender(() => {
      const el = this.menu().nativeElement;
      const box = el.getBoundingClientRect();
      const left = Math.max(4, Math.min(this.x(), window.innerWidth - box.width - 4));
      const top = Math.max(4, Math.min(this.y(), window.innerHeight - box.height - 4));
      this.shift.set({ left, top });
      const first = this.items().findIndex((i) => !i.disabled);
      this.focusItem(first < 0 ? 0 : first);
    });
  }

  protected choose(item: ColumnMenuItem): void {
    if (!item.disabled) this.picked.emit(item.id);
  }

  private focusItem(index: number): void {
    const buttons = this.menu().nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]');
    const n = buttons.length;
    if (n === 0) return;
    const at = ((index % n) + n) % n;
    this.active.set(at);
    buttons[at].focus();
  }

  protected onKey(event: KeyboardEvent): void {
    const at = this.active();
    switch (event.key) {
      case 'ArrowDown':
        this.focusItem(at + 1);
        break;
      case 'ArrowUp':
        this.focusItem(at - 1);
        break;
      case 'Home':
        this.focusItem(0);
        break;
      case 'End':
        this.focusItem(this.items().length - 1);
        break;
      case 'Tab':
        this.closed.emit(true);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
}
