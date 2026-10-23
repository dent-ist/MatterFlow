import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { NgTemplateOutlet } from '@angular/common';
import { Dismissable } from '../ui/dismissable';

export interface MenuOption {
  id: string;
  label: string;
  /** Muted text after the label (for a person: how many tasks they have open). */
  hint?: string;
  /** Tooltip of the item (for a status action: the status it leads to; statuses are tenant-renamable, so it is not repeated as visible text). */
  tip?: string;
  /** Dangerous choice (Cancel task): the danger colour. */
  danger?: boolean;
  /** Draws a divider above the item (the dangerous choice sits last, apart from the others). */
  separated?: boolean;
  /** A warning shown under the label with an icon (for example "Out of office until Oct 20"); the option stays selectable. */
  flag?: string;
  selected?: boolean;
  /** Heading of the run of options this one belongs to (for example "Suggested"); consecutive options with the same group sit under one heading. */
  group?: string;
  disabled?: boolean;
  /** Why a disabled option cannot be used; read out with the option. */
  reason?: string;
  /** A check for this option is running: a small spinner shows and the option stays usable (Complete while step inputs are checked). */
  pending?: boolean;
}

let nextId = 0;

/**
 * A value in a table cell that opens a small menu (inline edit). The projected content is the current value; a chevron
 * marks it as changeable. A button with `aria-haspopup`; Enter, Space or Arrow Down opens, arrows move, Enter or Space picks,
 * Esc (the shared popover rule) closes and returns focus. The list is fixed-positioned from the trigger so the table's scroll container does not clip it.
 * Clicks and keys inside never reach the row.
 */
@Component({
  selector: 'mf-inline-menu',
  imports: [Dismissable, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      #trigger
      type="button"
      class="im-trigger"
      [class.im-outlined]="outlined()"
      [class.im-icon]="!!icon()"
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
      @if (icon(); as glyph) {
        <i class="pi" [class]="busy() ? 'pi-spin pi-spinner' : glyph" aria-hidden="true"></i>
      } @else {
        <span class="im-value"><ng-content /></span>
        <i
          class="pi"
          [class]="busy() ? 'pi-spin pi-spinner' : 'pi-chevron-down'"
          aria-hidden="true"
        ></i>
      }
    </button>
    @if (open()) {
      <div
        #pop
        class="im-pop"
        role="group"
        [mfDismissable]="trigger"
        (dismissed)="close(false)"
        [id]="uid + '-pop'"
        [attr.aria-label]="menuLabel()"
        [style.top.px]="pos().top"
        [style.left.px]="pos().left"
        [style.max-height.px]="pos().maxHeight"
        (click)="$event.stopPropagation()"
        (keydown)="onPopKey($event)"
      >
        @if (lead(); as action) {
          <!-- A first choice above the search box (Assign to me): not one of the people, so it stays when the search narrows the list. -->
          <button
            type="button"
            class="im-item im-lead"
            data-lead
            [attr.aria-label]="action.ariaLabel"
            (click)="pickLead()"
          >
            <i class="pi pi-user" aria-hidden="true"></i>
            <span class="im-text">{{ action.label }}</span>
          </button>
        }
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
            @for (section of sections(); track $index) {
              @if (section.label) {
                <div role="group" class="im-section" [attr.aria-label]="section.label">
                  <div class="im-group" aria-hidden="true" data-menu-group>{{ section.label }}</div>
                  @for (o of section.options; track o.id) {
                    <ng-container
                      [ngTemplateOutlet]="itemTpl"
                      [ngTemplateOutletContext]="{ $implicit: o }"
                    />
                  }
                </div>
              } @else {
                @for (o of section.options; track o.id) {
                  <ng-container
                    [ngTemplateOutlet]="itemTpl"
                    [ngTemplateOutletContext]="{ $implicit: o }"
                  />
                }
              }
            }
          </div>
        }
        <ng-template #itemTpl let-o>
          <button
            type="button"
            role="menuitemradio"
            class="im-item"
            [class.im-danger]="o.danger"
            [class.im-sep]="o.separated"
            [attr.title]="o.tip ?? null"
            [attr.data-option]="o.id"
            [attr.aria-checked]="o.selected ? 'true' : 'false'"
            [attr.aria-disabled]="o.disabled ? 'true' : null"
            [attr.aria-describedby]="o.reason ? uid + '-r-' + o.id : null"
            (click)="pick(o)"
          >
            <i class="pi" [class.pi-check]="o.selected" aria-hidden="true" style="width: 1rem"></i>
            <span class="im-text">
              <span>{{ o.label }}</span>
              @if (o.flag) {
                <span class="im-flag" data-option-flag>
                  <i class="pi pi-calendar-minus" aria-hidden="true"></i> {{ o.flag }}
                </span>
              }
            </span>
            @if (o.pending) {
              <i class="pi pi-spin pi-spinner im-spin" aria-hidden="true" data-option-pending></i>
            }
            @if (o.hint) {
              <span class="im-hint">{{ o.hint }}</span>
            }
          </button>
          @if (o.reason) {
            <span class="im-reason" [id]="uid + '-r-' + o.id">{{ o.reason }}</span>
          }
        </ng-template>
        @if (checking()) {
          <p class="im-sr" role="status" data-menu-checking>Checking step inputs</p>
        }
        @if (footnote() || footAction()) {
          <p class="im-foot" data-menu-note>
            {{ footnote() }}
            @if (footAction(); as action) {
              <button type="button" class="im-foot-link" data-foot-action (click)="pickFoot()">
                {{ action }}
              </button>
            }
          </p>
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
    /* No border or fill on hover: the value (a badge with a chevron) already looks like a control. Keyboard focus and the open menu keep theirs. */
    .im-trigger:focus-visible,
    .im-trigger[aria-expanded='true'] {
      border-color: var(--mf-border-strong);
      background: var(--mf-surface-alt);
    }
    /* Icon-only trigger (a row action such as Reassign): a 24 px minimum target. */
    .im-trigger.im-icon {
      justify-content: center;
      min-width: 1.75rem;
      padding: 0;
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
    .im-lead {
      margin-bottom: var(--mf-s1);
      border-bottom: 1px solid var(--mf-border);
      border-radius: var(--mf-radius) var(--mf-radius) 0 0;
      font-weight: 600;
    }
    .im-lead .pi {
      width: 1rem;
      color: var(--mf-text-muted);
    }
    .im-sep {
      margin-top: var(--mf-s1);
      border-top: 1px solid var(--mf-border);
    }
    .im-danger {
      color: var(--mf-danger);
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
    .im-text {
      display: grid;
      min-width: 0;
    }
    .im-flag {
      color: var(--mf-warning);
      font-size: var(--mf-fs-xs);
      font-weight: 400;
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
    .im-group {
      padding: var(--mf-s1) var(--mf-s2) 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .im-foot-link {
      min-height: var(--mf-target-min, 1.5rem);
      padding: 0 var(--mf-s1);
      border: 0;
      background: transparent;
      color: var(--mf-link, var(--mf-primary));
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    .im-spin {
      font-size: 0.875rem;
    }
    .im-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
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
  /** A PrimeIcons class (for example `pi-user-edit`): the trigger is then this icon alone, with `label` as its accessible name. */
  readonly icon = input<string | null>(null);
  /** A line under the options, for example why the list is limited. */
  readonly footnote = input<string | null>(null);

  /** A link after the footnote (for example "Search all users"); picking it emits `footPicked`. The menu stays open. */
  readonly footAction = input<string | null>(null);

  /** A first choice above the search box and the options (for example "Assign to me"): its visible text and its accessible name. */
  readonly lead = input<{ label: string; ariaLabel: string } | null>(null);

  /** Says that something in the list is still being checked; read out politely once. */
  readonly checking = input(false);

  readonly opened = output<void>();
  readonly searched = output<string>();
  readonly picked = output<MenuOption>();
  readonly leadPicked = output<void>();
  readonly footPicked = output<void>();

  /** The options in runs of the same `group` heading; options without a group form a run with no heading. */
  protected readonly sections = computed(() => {
    const runs: { label: string | null; options: MenuOption[] }[] = [];
    for (const o of this.options()) {
      const label = o.group ?? null;
      const last = runs[runs.length - 1];
      if (last && last.label === label) last.options.push(o);
      else runs.push({ label, options: [o] });
    }
    return runs;
  });

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
      this.footAction();
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

  /** Puts the focus in the search box (after a link in the list changed what the list shows). */
  focusSearch(): void {
    this.host.nativeElement.querySelector<HTMLElement>('.im-search')?.focus();
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

  protected pickFoot(): void {
    this.footPicked.emit();
  }

  protected pickLead(): void {
    this.close(true);
    this.leadPicked.emit();
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.searched.emit(value);
  }

  protected onTriggerKey(event: KeyboardEvent): void {
    // Keys on the trigger never reach the row, except Escape on a closed menu: it must still close the drawer or dialog around it.
    if (event.key !== 'Escape' || this.open()) event.stopPropagation();
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
        '.im-lead, .im-search, .im-item:not([aria-disabled="true"]), .im-foot-link',
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
