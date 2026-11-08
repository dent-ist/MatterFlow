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
import {
  CurrentStatesClient,
  MatterTypesClient,
  TeamTitlesClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { pageIcon } from '../../../shared/ui/tab-icons';
import { MfTab } from '../../../shared/ui/tabs';
import { AdminTabCounts, adminTabItems, resolveAdminTab } from '../admin-tabs';
import { MatterListTab, MATTER_LIST_TEXTS } from './matter-list-tab';
import { MATTER_LIST_TABS, MATTER_LIST_TEXT, MatterListKind } from './matter-lists-tabs';

/**
 * Administration > Matter Lists (epic #1298, UI spec 7): one menu item and one page with three tabs on the admin list shell, Matter Types, Current States and Team Titles, with
 * the number of ACTIVE items in each tab name. One permission, `MatterList.Manage`, opens all three. `/admin/matter-types`, `/admin/current-states` and `/admin/team-titles`
 * are one route with a `:tab` segment (like Labels), so the page stays alive when the tab changes. The header's primary action is "New Matter Type" / "New State" / "New Title".
 */
@Component({
  selector: 'mf-matter-lists-admin-page',
  imports: [AdminListShell, Button, MatterListTab],
  providers: [AdminTabCounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Matter Lists"
      [icon]="icon"
      [description]="description"
      [tabs]="tabs()"
      [tab]="current()"
      tabsLabel="Matter types, current states and team titles"
      idPrefix="matter-lists"
      tableId="matter-lists-table"
      (tabChange)="select($event)"
    >
      @if (canManage()) {
        <p-button
          mfPrimary
          [label]="newLabel()"
          icon="pi pi-plus"
          data-new
          (onClick)="list()?.openNew()"
        />
      }
      <mf-matter-list-tab [kind]="current()" />
    </mf-admin-list-shell>
  `,
})
export class MatterListsAdminPage implements HasUnsavedChanges {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly counts = inject(AdminTabCounts);
  private readonly typesApi = inject(MatterTypesClient);
  private readonly statesApi = inject(CurrentStatesClient);
  private readonly titlesApi = inject(TeamTitlesClient);
  protected readonly list = viewChild(MatterListTab);

  /** The `:tab` path segment. */
  readonly tab = input<string>();

  private readonly can = (permission: string) => this.auth.has(permission);
  protected readonly description = MATTER_LIST_TEXT;
  protected readonly icon = pageIcon('matter-lists');
  protected readonly canManage = computed(() => this.auth.has('MatterList.Manage'));
  protected readonly tabs = computed<MfTab[]>(() =>
    adminTabItems(MATTER_LIST_TABS, this.can, this.counts.snapshot()),
  );
  protected readonly current = computed<MatterListKind>(
    () =>
      (resolveAdminTab(MATTER_LIST_TABS, this.tab(), this.can)?.id as MatterListKind) ??
      'matter-types',
  );
  protected readonly newLabel = computed(() => MATTER_LIST_TEXTS[this.current()].newButton);

  constructor() {
    const active = <T extends { isActive: boolean }>(list: T[]) =>
      list.filter((i) => i.isActive).length;
    void this.counts.start(
      MATTER_LIST_TABS,
      {
        'matter-types': () => firstValueFrom(this.typesApi.listMatterTypes()).then(active),
        'current-states': () => firstValueFrom(this.statesApi.listCurrentStates()).then(active),
        'team-titles': () => firstValueFrom(this.titlesApi.listTeamTitles()).then(active),
      },
      this.can,
    );
  }

  hasUnsavedChanges(): boolean {
    return this.list()?.hasUnsavedChanges() ?? false;
  }

  protected select(key: string): void {
    void this.router.navigate(['/admin', key]);
  }
}
