import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Button } from 'primeng/button';
import { AccountCard } from './account-card';
import { NotificationPreferences } from './notification-preferences';
import { AuthStore } from '../../core/auth/auth.store';
import { MyAvailability } from '../../core/availability/my-availability';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { PageTitle } from '../../core/title/page-title';
import { AvailabilityChip } from '../../shared/availability/availability-chip';
import { AvailabilityForm, LoadState } from '../../shared/availability/availability-form';
import { SetOutOfOfficeDialog } from '../../shared/availability/set-out-of-office-dialog';
import { HasUnsavedChanges } from '../../shared/guards/unsaved-changes.guard';
import { PageHeader, RecordTitle } from '../../shared/ui/page-header';
import { RecordSkeleton } from '../../shared/ui/record-skeleton';
import { RecordState, recordStateTitle } from '../../shared/ui/record-state';

/**
 * My profile (epics #68 and #520): the person's own page. The header names them (display name, or the Windows account when there is none),
 * says in its context line which role and primary Pod they have, shows their availability chip and has ONE primary action, "Set out of
 * office..." or "I'm back" (the dialog and the store of the header menu). Below it, two columns from 1100 px (Availability and Work hours
 * with the action bar on the left; Account and Notifications on the right) and one column under that, Account first of the two.
 *
 * Loading shows the skeleton of the final page; a failed load shows the shared record state (reason, error reference, Retry) under the
 * plain "My profile" header. The form loads its own data and reports its state.
 */
@Component({
  selector: 'mf-profile-page',
  imports: [
    PageHeader,
    RecordTitle,
    AvailabilityChip,
    AvailabilityForm,
    AccountCard,
    NotificationPreferences,
    RecordSkeleton,
    RecordState,
    SetOutOfOfficeDialog,
    Button,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './profile-page.scss',
  template: `
    @if (shown() === 'error') {
      <mf-record-state
        kind="profile"
        state="error"
        [busy]="retrying()"
        [focusHeading]="true"
        (retried)="retry()"
      />
    } @else {
      <mf-page-header [description]="context()" icon="" data-profile-header>
        <mf-record-title mfTitle [name]="name()" [clamp]="true">
          @if (mine.profile()) {
            <mf-availability-chip [availability]="mine.current()" />
          }
        </mf-record-title>
        @if (mine.profile() && canAct()) {
          <p-button
            mfActions
            [label]="primaryLabel()"
            [loading]="backBusy()"
            data-primary-action
            (onClick)="primary()"
          />
        }
      </mf-page-header>
    }
    @if (shown() === 'loading') {
      <mf-record-skeleton kind="profile" />
    }
    <div class="pp" [class.pp--off]="shown() !== 'ready'" data-profile-grid>
      <div class="pp__col pp__col--main">
        <mf-availability-form (loadState)="onLoadState($event)" />
      </div>
      <div class="pp__col pp__col--side">
        <mf-account-card />
        <mf-notification-preferences />
      </div>
    </div>
    <mf-set-out-of-office-dialog />
    <p class="mf-sr-only" role="status" aria-live="polite" data-page-live>{{ live() }}</p>
  `,
})
export class ProfilePage implements HasUnsavedChanges {
  protected readonly mine = inject(MyAvailability);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly form = viewChild(AvailabilityForm);
  private readonly dialog = viewChild(SetOutOfOfficeDialog);

  /** What the page shows: the skeleton until the form has loaded, then the page, or the record state when the load failed. */
  protected readonly shown = signal<LoadState>('loading');
  protected readonly retrying = signal(false);
  protected readonly backBusy = signal(false);
  protected readonly live = signal('');

  /** The page is only reachable with Task.View, and so is availability; kept explicit so the action never shows without the right. */
  protected readonly canAct = computed(() => this.auth.has('Task.View'));

  protected readonly primaryLabel = computed(() =>
    this.mine.isOut() ? "I'm back" : 'Set out of office...',
  );

  /** The display name, or the Windows account when the person has none. */
  protected readonly name = computed(() => {
    const p = this.auth.profile();
    return p?.displayName?.trim() || p?.windowsAccount?.trim() || 'My profile';
  });

  /** "Data Technician · Demo Pod": the roles by name, then the primary Pod. */
  protected readonly context = computed(() => {
    const p = this.auth.profile();
    const roles = [...(p?.roles ?? [])].sort((a, b) => a.localeCompare(b)).join(', ');
    const pod = p?.pods?.find((x) => x.isPrimary)?.name;
    return [roles, pod].filter(Boolean).join(' · ');
  });

  hasUnsavedChanges(): boolean {
    return this.form()?.hasUnsavedChanges() ?? false;
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  protected onLoadState(state: LoadState): void {
    // A Retry from the error state keeps the error on screen (and its Retry button where it is) until the answer arrives.
    if (state === 'loading' && this.shown() === 'error' && this.retrying()) return;
    const wasRetrying = this.retrying();
    this.shown.set(state);
    if (state === 'error') this.pageTitle.set(recordStateTitle('profile', 'error'));
    if (state !== 'loading') this.retrying.set(false);
    if (state === 'ready' && wasRetrying) {
      this.live.set('Loaded');
      afterNextRender(() => this.focusHeading(), { injector: this.injector });
    }
  }

  protected retry(): void {
    if (this.retrying()) return;
    this.retrying.set(true);
    this.live.set('Loading profile');
    void this.form()?.load();
  }

  private focusHeading(): void {
    const heading = this.host.nativeElement.querySelector<HTMLElement>('[data-page-title]');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }

  /** "Set out of office..." opens the dialog of the header menu; "I'm back" is the same quick action as the menu's. */
  protected async primary(): Promise<void> {
    if (!this.mine.isOut()) {
      this.dialog()?.open();
      return;
    }
    this.backBusy.set(true);
    try {
      await this.mine.setAvailable();
      this.notify.success('Welcome back', 'You show as available again.', { key: 'availability' });
    } catch (err) {
      this.notify.error(
        'We could not update your status',
        err instanceof ApiError ? err.message : 'Try again.',
      );
    } finally {
      this.backBusy.set(false);
    }
  }
}
