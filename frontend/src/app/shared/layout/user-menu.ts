import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChildren,
  ViewContainerRef,
} from '@angular/core';
import type { SetOutOfOfficeDialog } from '../availability/set-out-of-office-dialog';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { outOfOfficeText } from '../../core/availability/availability';
import { MyAvailability } from '../../core/availability/my-availability';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { USER_TIME_ZONE } from '../../core/time/clock';

interface Item {
  id: 'profile' | 'out' | 'back' | 'shortcuts';
  label: string;
  icon: string;
}

let nextId = 0;

/**
 * The user area of the header, as an accessible menu button (ARIA menu button pattern): the name opens My profile, "Set out of
 * office..." / "I'm back" and Keyboard shortcuts. While the person is out of office a label says so next to the name. Enter, Space
 * or Arrow Down opens; arrows, Home and End move; Esc closes and returns focus to the button; Tab closes.
 */
@Component({
  selector: 'mf-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    <button
      #trigger
      type="button"
      class="um-trigger"
      data-testid="user-menu"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? uid + '-menu' : null"
      [attr.aria-label]="triggerLabel()"
      (click)="toggle($event)"
      (keydown)="onTriggerKey($event)"
    >
      <i class="pi pi-user um-icon" aria-hidden="true"></i>
      <span class="um-text">
        <span class="um-name">{{ auth.displayName() }}</span>
        @if (outLabel(); as label) {
          <span class="um-ooo" data-ooo-label>
            <i class="pi pi-calendar-minus" aria-hidden="true"></i> {{ label }}
          </span>
        } @else if (account(); as acc) {
          <span class="um-account">{{ acc }}</span>
        }
      </span>
      <i class="pi pi-chevron-down um-chevron" aria-hidden="true"></i>
    </button>
    @if (open()) {
      <div
        class="um-menu"
        role="menu"
        tabindex="-1"
        [id]="uid + '-menu'"
        aria-label="Your account"
        (keydown)="onMenuKey($event)"
      >
        @for (item of items(); track item.id) {
          <button
            #entry
            type="button"
            role="menuitem"
            class="um-item"
            tabindex="-1"
            [attr.data-menu-item]="item.id"
            (click)="choose(item)"
          >
            <i class="pi" [class]="item.icon" aria-hidden="true"></i>
            <span>{{ item.label }}</span>
          </button>
        }
      </div>
    }
  `,
  styleUrl: './user-menu.scss',
})
export class UserMenu {
  protected readonly auth = inject(AuthStore);
  private readonly mine = inject(MyAvailability);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The shortcut list is opened by the shell (it lazy-loads the list). */
  readonly shortcuts = output<void>();

  protected readonly uid = `um-${nextId++}`;
  protected readonly open = signal(false);
  private readonly container = inject(ViewContainerRef);
  private oooDialog: ComponentRef<SetOutOfOfficeDialog> | null = null;
  private readonly entries = viewChildren<ElementRef<HTMLButtonElement>>('entry');

  /** Availability belongs to people who work Tasks (the API policy is Task.View). */
  private readonly hasProfile = computed(() => this.auth.has('Task.View'));
  protected readonly outLabel = computed(() =>
    this.hasProfile() ? outOfOfficeText(this.mine.current(), this.zone) : null,
  );
  protected readonly account = computed(() => {
    const account = this.auth.profile()?.windowsAccount;
    return account && account !== this.auth.displayName() ? account : null;
  });
  protected readonly triggerLabel = computed(
    () =>
      `${this.auth.displayName()}${this.outLabel() ? ', ' + this.outLabel() : ''}, account menu`,
  );

  protected readonly items = computed<Item[]>(() => {
    const list: Item[] = [];
    if (this.hasProfile()) {
      list.push({ id: 'profile', label: 'My profile', icon: 'pi-user-edit' });
      list.push(
        this.mine.isOut()
          ? { id: 'back', label: "I'm back", icon: 'pi-check-circle' }
          : { id: 'out', label: 'Set out of office...', icon: 'pi-calendar-minus' },
      );
    }
    list.push({ id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'pi-question-circle' });
    return list;
  });

  constructor() {
    // Once the permissions are known, read the person's own availability for the header label.
    effect(() => {
      if (this.hasProfile()) untracked(() => void this.mine.ensureLoaded());
    });
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
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
    if (returnFocus) this.trigger()?.focus();
  }

  private trigger(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.um-trigger');
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

  protected onEscape(): void {
    this.close(true);
  }

  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  /**
   * The quick dialog loads the first time it is asked for: it carries the date input of the form engine, which the header (loaded on
   * every page) must not pull in.
   */
  private async openOutOfOfficeDialog(): Promise<void> {
    if (!this.oooDialog) {
      const { SetOutOfOfficeDialog } = await import('../availability/set-out-of-office-dialog');
      this.oooDialog = this.container.createComponent(SetOutOfOfficeDialog);
    }
    this.oooDialog.setInput('visible', true);
  }

  protected async choose(item: Item): Promise<void> {
    switch (item.id) {
      case 'profile':
        this.close(false);
        await this.router.navigate(['/profile']);
        return;
      case 'out':
        this.close(true); // focus goes back to the button, which the dialog returns to when it closes
        await this.openOutOfOfficeDialog();
        return;
      case 'shortcuts':
        this.close(false);
        this.shortcuts.emit();
        return;
      case 'back':
        this.close(true);
        try {
          await this.mine.setAvailable();
          this.notify.success('Welcome back', 'You show as available again.');
        } catch (err) {
          this.notify.error(
            'We could not update your status',
            err instanceof ApiError ? err.message : 'Try again from My profile.',
          );
        }
        return;
    }
  }
}
