import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { PrioritiesClient, StatusLabelsClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { HasUnsavedChanges } from '../../shared/guards/unsaved-changes.guard';
import { AdminListShell } from '../../shared/ui/admin-list-shell';
import { MfTab } from '../../shared/ui/tabs';
import { AdminTabCounts, adminTabItems, resolveAdminTab } from './admin-tabs';
import { LABEL_TABS, LabelsTab } from './labels-tabs';
import { PrioritiesPage } from './priorities/priorities-page';
import { StatusLabelsPage } from './status-labels/status-labels-page';

/** One line per tab, 90 characters at most (the header shows it on one line). */
export const LABEL_TAB_TEXT: Record<LabelsTab, string> = {
  priorities: 'Order priorities from most to least urgent. Exactly one is the default.',
  'status-labels': "Rename how the five statuses read. You can't add or remove statuses.",
};

/**
 * Administration: Labels (#593). One menu item, one page, two tabs on the admin list shell: Priorities (`Priority.Manage`) and Status
 * labels (`StatusLabel.Manage`), with the counts of active priorities and of status labels in the tab names. `/admin/priorities` and
 * `/admin/status-labels` open the matching tab (one route with a `:tab` segment, like Users and Task Types); a tab the person may not use
 * is not offered, a link to it lands on the first one they may use (`labelsTabGuard`, AD-D), and a person with a single tab gets no tab
 * strip. The New priority action is the page's one primary action; both tabs open their dialog through `?edit=`.
 */
@Component({
  selector: 'mf-labels-admin-page',
  imports: [AdminListShell, Button, PrioritiesPage, StatusLabelsPage],
  providers: [AdminTabCounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Labels"
      icon="pi pi-flag"
      [description]="description()"
      [tabs]="tabs()"
      [tab]="current()"
      tabsLabel="Priorities and status labels"
      idPrefix="labels"
      tableId="labels-table"
      (tabChange)="select($event)"
    >
      @if (current() === 'priorities' && canManagePriorities()) {
        <p-button
          mfPrimary
          label="New priority"
          icon="pi pi-plus"
          data-new
          (onClick)="newPriority()"
        />
      }
      @switch (current()) {
        @case ('priorities') {
          <mf-priorities-page [edit]="edit()" />
        }
        @case ('status-labels') {
          <mf-status-labels-page [edit]="edit()" />
        }
      }
    </mf-admin-list-shell>
  `,
})
export class LabelsAdminPage implements HasUnsavedChanges {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly counts = inject(AdminTabCounts);
  private readonly priorityApi = inject(PrioritiesClient);
  private readonly statusApi = inject(StatusLabelsClient);
  private readonly statusPage = viewChild(StatusLabelsPage);

  /** The `:tab` path segment (`priorities` or `status-labels`). */
  readonly tab = input<string>();
  /** `?edit=<id>`, `?edit=new` or `?edit=<status code>`: the dialog the open tab shows. */
  readonly edit = input<string | undefined>(undefined);

  private readonly can = (permission: string) => this.auth.has(permission);
  protected readonly canManagePriorities = computed(() => this.auth.has('Priority.Manage'));

  /** Only the tabs the person may use: `Priorities (8)`, `Status labels (5)` (`--` while the count is on its way). */
  protected readonly tabs = computed<MfTab[]>(() =>
    adminTabItems(LABEL_TABS, this.can, this.counts.snapshot()),
  );

  protected readonly current = computed<LabelsTab>(
    () => (resolveAdminTab(LABEL_TABS, this.tab(), this.can)?.id as LabelsTab) ?? 'priorities',
  );

  protected readonly description = computed(() => LABEL_TAB_TEXT[this.current()]);

  constructor() {
    void this.counts.start(
      LABEL_TABS,
      {
        priorities: () =>
          firstValueFrom(this.priorityApi.listPriorities()).then(
            (list) => list.filter((p) => p.isActive).length,
          ),
        'status-labels': () =>
          firstValueFrom(this.statusApi.listStatusLabels()).then((list) => list.length),
      },
      this.can,
    );
  }

  /** The tab's own list owns the dialogs; the page has no other unsaved work. */
  hasUnsavedChanges(): boolean {
    return this.statusPage()?.hasUnsavedChanges() ?? false;
  }

  protected newPriority(): void {
    void this.router.navigate(['/admin/priorities'], { queryParams: { edit: 'new' } });
  }

  protected select(key: string): void {
    void this.router.navigate(['/admin', key]);
  }
}
