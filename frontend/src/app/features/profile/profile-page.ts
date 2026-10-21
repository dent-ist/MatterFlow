import { ChangeDetectionStrategy, Component, HostListener, viewChild } from '@angular/core';
import { AccountCard } from './account-card';
import { AvailabilityForm } from '../../shared/availability/availability-form';
import { HasUnsavedChanges } from '../../shared/guards/unsaved-changes.guard';
import { PageHeader } from '../../shared/ui/page-header';

/**
 * My profile (epic #68): where each person sets their own status (Available / Out of office, with dates and a note), their weekly work
 * hours and their time zone. Colleagues see the result on assignee lists, the Users administration screen and the Dashboard.
 */
@Component({
  selector: 'mf-profile-page',
  imports: [PageHeader, AvailabilityForm, AccountCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .profile-account {
      max-width: 46rem;
      margin-top: var(--mf-s5);
    }
  `,
  template: `
    <mf-page-header
      heading="My profile"
      description="Tell colleagues when you are out of office and set the hours you usually work."
    />
    <mf-availability-form />
    <mf-account-card class="profile-account" />
  `,
})
export class ProfilePage implements HasUnsavedChanges {
  private readonly form = viewChild(AvailabilityForm);

  hasUnsavedChanges(): boolean {
    return this.form()?.hasUnsavedChanges() ?? false;
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }
}
