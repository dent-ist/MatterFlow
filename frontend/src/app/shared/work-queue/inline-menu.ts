import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

export interface MenuOption {
  id: string;
  label: string;
  /** Muted text after the label (for a status action: the status it leads to). */
  hint?: string;
  selected?: boolean;
  disabled?: boolean;
  /** Why a disabled option cannot be used; read out with the option. */
  reason?: string;
}

let nextId = 0;

/**
 * A value in a table cell that opens a small menu (inline edit). The projected content is the current value; a chevron
 * marks it as changeable. A button with `aria-haspopup`; Enter, Space or Arrow Down opens, arrows move, Enter or Space picks,
 * Esc closes and returns focus. The list is fixed-positioned from the trigger so the table's scroll container does not clip it.
 * Clicks and keys inside never reach the row.
 */
@Component({
  selector: 'mf-inline-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      #trigger
      type="button"
      class="im-trigger"
      [class.im-outlined]="outlined()"
      data-inline-trigger
      aria-haspopup="true"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? uid + '-pop' : null"
      [attr.aria-label]="label()"
      [attr.aria-busy]="busy() ? 'true' : null"
      [attr.aria-disabled]="busy() ? 'true' : null"
      (click)="toggle($event)"
      (keydown)="onTriggerKey($event)"
    >
      <span class="im-value"><ng-content /></span>
      <i
        class="pi"
        [class]="busy() ? 'pi-spin pi-spinner' : 'pi-chevron-down'"
        aria-hidden="true"
      ></i>
    </button>
    @if (open()) {
      <div
        #pop
        class="im-pop"
        role="group"
        [id]="uid + '-pop'"
        [attr.aria-label]="menuLabel()"
        [style.top.px]="pos().top"
        [style.left.px]="pos().left"
        [style.max-height.px]="pos().maxHeight"
        (click)="$event.stopPropagation()"
        (keydown)="onPopKey($event)"
      >
        @if (searchable()) {
          <input
            #search
            type="text"
            class="im-search"
            autocomplete="off"
            [attr.aria-label]="searchLabel()"
            [value]="query()"
            (input)="onSearch($event)"
          />
        }
        <!-- The notes sit outside role="menu": a menu may only contain items (axe aria-required-children). -->
        @if (loading()) {
          <p class="im-note" role="status">Loading...</p>
        } @else if (options().length === 0) {
          <p class="im-note" role="status">{{ emptyText() }}</p>
        }
        @if (options().length > 0) {
          <div role="menu" class="im-list" [attr.aria-label]="menuLabel()">
            @for (o of options(); track o.id) {
              <button
                type="button"
                role="menuitemradio"
                class="im-item"
                [attr.data-option]="o.id"
                [attr.aria-checked]="o.selected ? 'true' : 'false'"
                [attr.aria-disabled]="o.disabled ? 'true' : null"
                [attr.aria-describedby]="o.reason ? uid + '-r-' + o.id : null"
                (click)="pick(o)"
              >
                <i
                  class="pi"
                  [class.pi-check]="o.selected"
                  aria-hidden="true"
                  style="width: 1rem"
                ></i>
                <span>{{ o.label }}</span>
                @if (o.hint) {
                  <span class="im-hint">{{ o.hint }}</span>
                }
              </button>
              @if (o.reason) {
                <span class="im-reason" [id]="uid + '-r-' + o.id">{{ o.reason }}</span>
              }
            }
          </div>
        }
        @if (footnote(); as note) {
          <p class="im-foot" data-menu-note>{{ note }}</p>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: inline-block;
      max-width: 100%;
    }
    .im-value {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .im-trigger {
      max-width: 100%;
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 1.75rem;
      padding: 0 var(--mf-s1);
      border: 1px solid transparent;
      border-radius: var(--mf-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    /* Where the value is the main action of a list (the Dashboard's unassigned queue) it looks like a control at rest. */
    .im-trigger.im-outlined {
      border-color: var(--mf-border-strong);
      background: var(--mf-surface);
    }
    .im-trigger:hover:not([aria-disabled='true']),
    .im-trigger:focus-visible,
    .im-trigger[aria-expanded='true'] {
      border-color: var(--mf-border-strong);
      background: var(--mf-surface-alt);
    }
    .im-trigger[aria-disabled='true'] {
      cursor: progress;
      opacity: 0.7;
    }
    .im-trigger .pi {
      color: var(--mf-text-muted);
      font-size: 0.875rem;
    }
    .im-pop {
      position: fixed;
      z-index: 1100;
      min-width: 14rem;
      max-width: 22rem;
      max-height: 16rem;
      overflow-y: auto;
      padding: var(--mf-s1);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-1);
    }
    .im-search {
      box-sizing: border-box;
      width: 100%;
      min-height: 2rem;
      margin-bottom: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .im-item {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      min-height: var(--mf-target-min, 2rem);
      padding: 0 var(--mf-s2);
      border: 0;
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .im-item:hover:not([aria-disabled='true']),
    .im-item:focus-visible {
      background: var(--mf-surface-alt);
    }
    .im-item[aria-disabled='true'] {
      color: var(--mf-text-muted);
      cursor: not-allowed;
    }
    .im-item[aria-checked='true'] {
      font-weight: 600;
    }
    .im-hint,
    .im-note,
    .im-reason {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .im-foot {
      margin: var(--mf-s1) 0 0;
      padding: var(--mf-s1) var(--mf-s2) 0;
      border-top: 1px solid var(--mf-border);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .im-note {
      margin: 0;
      padding: var(--mf-s2);
    }
    .im-reason {
      display: block;
      padding: 0 var(--mf-s2) var(--mf-s2) 1.75rem;
    }
  `,
})
export class InlineMenu implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Accessible name of the trigger: what it changes and the current value. */
  readonly label = input.required<string>();
  readonly menuLabel = input('Options');
  readonly options = input.required<readonly MenuOption[]>();
  readonly searchable = input(false);
  readonly searchLabel = input('Search');
  readonly emptyText = input('No matches.');
  readonly loading = input(false);
  readonly busy = input(false);
  /** Draws the trigger with a border at rest (it is the main action of a list, not a value in a table cell). */
  readonly outlined = input(false);
  /** A line under the options, for example why the list is limited. */
  readonly footnote = input<string | null>(null);

  readonly opened = output<void>();
  readonly searched = output<string>();
  readonly picked = output<MenuOption>();

  protected readonly uid = `im-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly pos = signal<{ top: number; left: number; maxHeight: number | null }>({
    top: 0,
    left: 0,
    maxHeight: null,
  });
  private readonly popRef = viewChild<ElementRef<HTMLElement>>('pop');
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  constructor() {
    // The list grows when the people arrive or the search narrows it: keep it on the side that fits.
    effect(() => {
      this.options();
      this.loading();
      this.footnote();
      if (untracked(() => this.open())) setTimeout(() => this.place());
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onScroll, true);
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    // Busy uses aria-disabled, not disabled: a disabled button would drop the focus that a pick returned to it.
    if (this.busy()) return;
    if (this.open()) this.close(true);
    else this.show();
  }

  show(): void {
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    // Below the trigger first; once the list is drawn and measured, `place` flips it above (right against the trigger) only if it does not fit.
    this.pos.set({
      top: rect.bottom + 4,
      left: Math.max(4, Math.min(rect.left, window.innerWidth - 240)),
      maxHeight: null,
    });
    this.query.set('');
    this.open.set(true);
    document.addEventListener('scroll', this.onScroll, true);
    this.opened.emit();
    setTimeout(() => {
      this.place();
      this.focusFirst();
    });
  }

  /** Puts the list next to the trigger on the side with room for its real height; if neither side fits it scrolls inside the free space. */
  private place(): void {
    const pop = this.popRef()?.nativeElement;
    if (!pop) return;
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const margin = 8;
    const height = pop.getBoundingClientRect().height;
    const roomBelow = window.innerHeight - rect.bottom - 4 - margin;
    const roomAbove = rect.top - 4 - margin;
    const left = this.pos().left;
    const cap = 256;
    if (height <= roomBelow) {
      this.pos.set({ top: rect.bottom + 4, left, maxHeight: null });
    } else if (height <= roomAbove) {
      this.pos.set({ top: rect.top - 4 - height, left, maxHeight: null });
    } else if (roomAbove > roomBelow) {
      const max = Math.min(cap, Math.max(96, roomAbove));
      this.pos.set({ top: rect.top - 4 - Math.min(height, max), left, maxHeight: max });
    } else {
      this.pos.set({
        top: rect.bottom + 4,
        left,
        maxHeight: Math.min(cap, Math.max(96, roomBelow)),
      });
    }
  }

  focusTrigger(): void {
    this.trigger().nativeElement.focus();
  }

  close(returnFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    document.removeEventListener('scroll', this.onScroll, true);
    if (returnFocus) this.trigger().nativeElement.focus();
  }

  protected pick(o: MenuOption): void {
    if (o.disabled) return;
    this.close(true);
    this.picked.emit(o);
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.searched.emit(value);
  }

  protected onTriggerKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'ArrowDown' && !this.open() && !this.busy()) {
      event.preventDefault();
      this.show();
    }
  }

  protected onPopKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
    } else if (event.key === 'Tab') {
      this.close(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = this.focusables();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  @HostListener('window:resize')
  protected onViewportChange(): void {
    this.close(false);
  }

  /** Scrolling anywhere but the list itself (the table scrolls sideways) would leave the fixed list behind. */
  private readonly onScroll = (event: Event): void => {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close(false);
  };

  private focusables(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        '.im-search, .im-item:not([aria-disabled="true"])',
      ),
    );
  }

  private focusFirst(): void {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLElement>('.im-search') ??
      root.querySelector<HTMLElement>('.im-item[aria-checked="true"]') ??
      root.querySelector<HTMLElement>('.im-item:not([aria-disabled="true"])');
    target?.focus();
  }
}
