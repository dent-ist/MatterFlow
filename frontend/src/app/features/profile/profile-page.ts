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
import { AccountCard } from './account-card';
import { LandingCard } from './landing-card';
import { NotificationPreferences } from './notification-preferences';
import { AuthStore } from '../../core/auth/auth.store';
import { MyAvailability } from '../../core/availability/my-availability';
import { PageTitle } from '../../core/title/page-title';
import { AvailabilityChip } from '../../shared/availability/availability-chip';
import { AvailabilityForm, LoadState } from '../../shared/availability/availability-form';
import { AbsenceList } from '../../shared/availability/absences/absence-list';
import { HolidayCard } from '../../shared/availability/absences/holiday-card';
import { HasUnsavedChanges } from '../../shared/guards/unsaved-changes.guard';
import { PageHeader } from '../../shared/ui/page-header';
import { RecordSkeleton } from '../../shared/ui/record-skeleton';
import { RecordState, recordStateTitle } from '../../shared/ui/record-state';
import { shortAccountName } from '../../shared/ui/person-name';

/**
 * My profile (epics #68 and #520): the person's own page. The header names them (display name, or the Windows account when there is none),
 * says in its context line which role and primary Pod they have, shows their availability chip and has ONE primary action, "Set out of
 * office..." or "I'm back" (the dialog and the store of the header menu). Below it, two columns from 1100 px (Availability and Work hours
 * with the action bar on the left; Account and Notifications on the right) and one column under that, Account first of the two.
 *
 * The page opens for every signed-in person who is not pending (owner decision, epic #1330), because it holds the My Landing Page card between
 * Account and Notifications. The work cards (availability, absences, holidays, notifications and the person's availability chip) need
 * Task.View, as they always did; a person without it sees Account and My Landing Page only.
 *
 * Loading shows the skeleton of the final page; a failed load shows the shared record state (reason, error reference, Retry) under the
 * plain "My profile" header. The form loads its own data and reports its state.
 */
@Component({
  selector: 'mf-profile-page',
  imports: [
    PageHeader,

    AvailabilityChip,
    AvailabilityForm,
    AccountCard,
    LandingCard,
    NotificationPreferences,
    RecordSkeleton,
    RecordState,
    AbsenceList,
    HolidayCard,
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
      <mf-page-header heading="My Profile" data-profile-header>
        <!-- The person's name and availability are the context line under the title (D-21, #1135). -->
        <span mfDescription class="pp__who" [class.pp__who--chip]="works()" data-profile-who>
          <span class="pp__name" data-name>{{ name() }}</span>
          @if (works() && mine.profile()) {
            <mf-availability-chip [availability]="mine.current()" />
          }
          @if (context()) {
            <span data-profile-context>{{ context() }}</span>
          }
        </span>
      </mf-page-header>
    }
    @if (shown() === 'loading') {
      <mf-record-skeleton kind="profile" />
    }
    <div
      class="pp"
      [class.pp--off]="shown() !== 'ready'"
      [class.pp--single]="!works()"
      data-profile-grid
    >
      @if (works()) {
        <div class="pp__col pp__col--main">
          @if (userId(); as id) {
            <mf-absence-list [userId]="id" [displayName]="name()" (changed)="mine.refresh()" />
          }
          <mf-availability-form (loadState)="onLoadState($event)" />
        </div>
      }
      <div class="pp__col pp__col--side">
        @if (works()) {
          @if (userId(); as id) {
            <mf-holiday-card [userId]="id" />
          }
        }
        <mf-account-card />
        <mf-landing-card />
        @if (works()) {
          <mf-notification-preferences />
        }
      </div>
    </div>
    <p class="mf-sr-only" role="status" aria-live="polite" data-page-live>{{ live() }}</p>
  `,
})
export class ProfilePage implements HasUnsavedChanges {
  protected readonly mine = inject(MyAvailability);
  private readonly auth = inject(AuthStore);
  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly form = viewChild(AvailabilityForm);
  protected readonly userId = computed(() => this.auth.profile()?.userId ?? null);

  /** The person works Tasks (Task.View): the availability, absence, holiday and notification cards are theirs. */
  protected readonly works = computed(() => this.auth.has('Task.View'));
  private readonly formState = signal<LoadState>('loading');
  /** What the page shows: the skeleton until the form has loaded, then the page, or the record state when the load failed. Without Task.View there is no form to wait for. */
  protected readonly shown = computed<LoadState>(() => (this.works() ? this.formState() : 'ready'));
  protected readonly retrying = signal(false);
  protected readonly live = signal('');

  /** The display name, or the Windows account when the person has none. */
  protected readonly name = computed(() => {
    const p = this.auth.profile();
    return p?.displayName?.trim() || shortAccountName(p?.windowsAccount) || 'My Profile';
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
    this.formState.set(state);
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
}
