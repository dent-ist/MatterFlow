import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import { Dismissable } from './dismissable';

/** One entry of an `mf-action-menu`. A disabled entry stays focusable (`aria-disabled`) and says why. */
export interface MenuAction {
  id: string;
  label: string;
  /** PrimeIcons class, for example `pi-plus`. */
  icon?: string;
  disabled?: boolean;
  /** Why the entry cannot be used; shown under the label and read out with it. */
  reason?: string;
  run: () => void;
}

let nextId = 0;

/**
 * The "..." overflow menu of a record header (C3, #255): an ARIA menu button. Enter, Space or Arrow Down opens (Arrow Up opens on the last
 * entry); arrows, Home and End move between the entries; Enter or Space picks; Esc closes and returns focus to the button (the shared
 * popover rule, `dismissable.ts`); Tab closes. A disabled entry keeps focus and `aria-disabled` and gives its reason instead of acting.
 * Nothing is rendered without entries.
 */
@Component({
  selector: 'mf-action-menu',
  imports: [Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './action-menu.scss',
  template: `
    @if (items().length > 0) {
      <button
        #trigger
        type="button"
        class="mf-btn am__trigger"
        data-overflow
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? uid + '-menu' : null"
        [attr.aria-label]="label()"
        [attr.title]="label()"
        (click)="toggle()"
        (keydown)="onTriggerKey($event)"
      >
        <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
      </button>
      @if (open()) {
        <div
          class="am__menu"
          role="menu"
          tabindex="-1"
          [id]="uid + '-menu'"
          [attr.aria-label]="label()"
          [mfDismissable]="trigger"
          (dismissed)="open.set(false)"
          (keydown)="onMenuKey($event)"
        >
          @for (item of items(); track item.id) {
            <button
              #entry
              type="button"
              role="menuitem"
              class="am__item"
              tabindex="-1"
              [attr.data-action]="item.id"
              [attr.aria-disabled]="item.disabled ? 'true' : null"
              [attr.aria-describedby]="item.disabled && item.reason ? uid + '-r-' + item.id : null"
              (click)="pick(item)"
            >
              <!-- Every entry has the icon slot, so the labels line up whether or not an entry has an icon. -->
              <i class="pi" [class]="item.icon ?? ''" aria-hidden="true"></i>
              <span class="am__text">
                <span>{{ item.label }}</span>
                @if (item.disabled && item.reason) {
                  <span class="am__reason" [id]="uid + '-r-' + item.id" data-reason>{{
                    item.reason
                  }}</span>
                }
              </span>
            </button>
          }
        </div>
      }
    }
  `,
})
export class ActionMenu {
  /** The accessible name of the button and of the menu, for example "More actions". */
  readonly label = input('More actions');
  readonly items = input<readonly MenuAction[]>([]);

  protected readonly uid = `am-${nextId++}`;
  protected readonly open = signal(false);
  private readonly entries = viewChildren<ElementRef<HTMLButtonElement>>('entry');
  private readonly trigger = viewChildren<ElementRef<HTMLButtonElement>>('trigger');

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.show(0);
  }

  private show(focusIndex: number): void {
    this.open.set(true);
    setTimeout(() => this.focusEntry(focusIndex));
  }

  private close(returnFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) this.trigger()[0]?.nativeElement.focus();
  }

  private focusEntry(index: number): void {
    const list = this.entries();
    if (list.length === 0) return;
    list[(index + list.length) % list.length].nativeElement.focus();
  }

  protected onTriggerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.show(event.key === 'ArrowDown' ? 0 : -1);
    }
  }

  protected onMenuKey(event: KeyboardEvent): void {
    const list = this.entries().map((e) => e.nativeElement);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusEntry(at + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusEntry(at - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusEntry(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusEntry(-1);
        break;
      case 'Tab':
        this.close(false);
        break;
    }
  }

  protected pick(item: MenuAction): void {
    if (item.disabled) return;
    this.close(true);
    item.run();
  }
}
