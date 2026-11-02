import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AssetsClient,
  MatterOverview,
  MatterOverviewClient,
  MatterResponse,
  MyMattersActivityItem,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { AssetTypeChip } from '../../../shared/ui/asset-type-chip';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { activityText, activityTime } from '../../my-matters/facts';
import { panelLoader } from '../../my-matters/panel-loader';
import { aiLabel } from './matter-ai';

/**
 * The Summary tab of the Matter page (MD-03, #1004; owner decision AQ.2, mockup round 3). Nothing here scrolls the page: the asset tiles stay at the top and the
 * details list and the recent activity scroll inside their own boxes (below 768 px the page scrolls and the boxes become plain cards).
 *
 *   Assets by type (a tile per type with a count; each opens the Assets tab filtered to the type)       [needs Asset.View]
 *   Details (one Edit button)                       | Recent activity (and the "Next events" panel, MD-08, in the same column)
 *     CM number (large, first), Client, Matter number, Name, Status, Sensitive, Primary PM, Secondary PM, Created, Last changed,
 *     the custom fields as ordinary rows (no heading), AI allowed
 *
 * It shows only fields the Matter already has plus the one new field AI allowed; nothing is invented.
 */
@Component({
  selector: 'mf-matter-summary',
  imports: [
    RouterLink,
    ActiveBadge,
    SensitiveBadge,
    AssetTypeChip,
    CustomFieldsView,
    MatterRef,
    MfDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      min-height: 0;
    }
    .ms__tiles {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ms__tile {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-ctl-h);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      color: inherit;
      text-decoration: none;
    }
    .ms__tile:hover {
      background: var(--mf-sem-info-bg);
    }
    .ms__count {
      font-size: var(--mf-fs-lg);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .ms__tile-name {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ms__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-auto-rows: minmax(0, 1fr);
      gap: var(--mf-s3);
      flex: 1 1 auto;
      min-height: 0;
    }
    .ms__card {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
    }
    .ms__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      padding: var(--mf-s3) var(--mf-s3) var(--mf-s2);
    }
    .ms__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .ms__scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 0 var(--mf-s3) var(--mf-s3);
    }
    .ms__dl {
      display: grid;
      grid-template-columns: minmax(8rem, 12rem) minmax(0, 1fr);
      gap: var(--mf-s2) var(--mf-s3);
      margin: 0;
    }
    .ms__dl dt {
      color: var(--mf-text-muted);
    }
    .ms__dl dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .ms__cm {
      font-family: var(--mf-font-mono, monospace);
      font-size: var(--mf-fs-title);
      font-weight: 700;
    }
    .ms__cm-row {
      padding: var(--mf-s2);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-info-bg);
    }
    .ms__feed {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ms__feed li {
      display: flex;
      justify-content: space-between;
      gap: var(--mf-s2);
      padding: var(--mf-s2) 0;
      border-top: 1px solid var(--mf-border-soft);
    }
    .ms__feed li:first-child {
      border-top: 0;
    }
    .ms__when {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ms__empty,
    .ms__note {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .ms__side {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      min-width: 0;
      min-height: 0;
    }
    .ms__side > .ms__card {
      flex: 1 1 0;
    }
    @media (max-width: 1099.98px) {
      .ms__grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    @media (max-width: 767.98px), (max-height: 560.98px) {
      .ms__scroll {
        overflow: visible;
      }
    }
  `,
  template: `
    @if (showAssets()) {
      <section aria-label="Assets by type" data-summary-assets>
        @if (assetTypes().length > 0) {
          <ul class="ms__tiles">
            @for (t of assetTypes(); track t.assetTypeId) {
              <li>
                <a
                  class="ms__tile"
                  data-asset-tile
                  [routerLink]="[]"
                  [queryParams]="{ tab: 'assets', typeId: t.assetTypeId }"
                >
                  <mf-asset-type-chip
                    [iconKey]="t.iconKey"
                    [colourKey]="t.colourKey"
                    [typeId]="t.assetTypeId"
                    [name]="t.assetTypeName"
                    [decorative]="true"
                  />
                  <span class="ms__count">{{ t.count }}</span>
                  <span class="ms__tile-name">{{ t.assetTypeName }}</span>
                </a>
              </li>
            }
          </ul>
        } @else if (assetsLoader.state() === 'ready') {
          <p class="ms__note" data-no-assets>This matter has no assets yet.</p>
        }
      </section>
    }

    <div class="ms__grid">
      <section class="ms__card" aria-labelledby="ms-details-h" data-summary-details>
        <div class="ms__head">
          <h2 class="ms__title" id="ms-details-h">Details</h2>
          @if (canEdit()) {
            <button type="button" class="mf-btn" data-edit-matter (click)="edit.emit()">
              <i class="pi pi-pencil" aria-hidden="true"></i> Edit
            </button>
          }
        </div>
        <div class="ms__scroll" tabindex="0" role="region" aria-label="Matter details">
          <dl class="ms__dl">
            <dt class="ms__cm-row">CM number</dt>
            <dd class="ms__cm-row"><mf-matter-ref [value]="matter().matterRef" /></dd>
            <dt>Client</dt>
            <dd data-client-value>
              @if (canLinkClient()) {
                <a class="pg-link" [routerLink]="['/clients', matter().clientId]"
                  ><span class="pg-mono">{{ matter().clientNumber }}</span>
                  {{ matter().clientName }}</a
                >
              } @else {
                <span class="pg-mono">{{ matter().clientNumber }}</span> {{ matter().clientName }}
              }
            </dd>
            <dt>Matter number</dt>
            <dd class="pg-mono">{{ matter().matterNumber }}</dd>
            <dt>Matter name</dt>
            <dd data-matter-name>{{ matter().name }}</dd>
            <dt>Status</dt>
            <dd><mf-active-badge [active]="matter().isActive" /></dd>
            <dt>Sensitive</dt>
            <dd data-sensitive-value>
              @if (matter().isSensitive) {
                <mf-sensitive-badge /> <span class="pg-muted">Restricted access</span>
              } @else {
                No
              }
            </dd>
            <dt>Primary PM</dt>
            <dd data-managers>
              <span data-primary-manager>{{ matter().primaryManager?.displayName ?? 'None' }}</span>
              @if (canAssign()) {
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  [attr.data-change-managers]="hasManagers() ? '' : null"
                  [attr.data-add-managers]="hasManagers() ? null : ''"
                  aria-label="Change project managers"
                  (click)="changeManagers.emit()"
                >
                  {{ hasManagers() ? 'Change' : 'Add' }}
                </button>
              }
            </dd>
            <dt>Secondary PM</dt>
            <dd>
              <span data-secondary-manager>{{
                matter().secondaryManager?.displayName ?? 'None'
              }}</span>
            </dd>
            <dt>Created</dt>
            <dd>{{ matter().createdAtUtc | mfDate }}</dd>
            @if (matter().modifiedAtUtc) {
              <dt>Last changed</dt>
              <dd>{{ matter().modifiedAtUtc | mfDate }}</dd>
            }
            <dt>AI allowed</dt>
            <dd data-ai-value>{{ ai() }}</dd>
          </dl>
          <mf-custom-fields-view
            [heading]="false"
            [versionId]="matter().formVersionId"
            [values]="matter().formValues ?? {}"
          />
        </div>
      </section>

      <div class="ms__side">
        @if (showActivity()) {
          <section class="ms__card" aria-labelledby="ms-activity-h" data-summary-activity>
            <div class="ms__head">
              <h2 class="ms__title" id="ms-activity-h">Recent activity</h2>
              @if (canSeeActivities()) {
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  data-all-activities
                  (click)="openActivities.emit()"
                >
                  All activities
                </button>
              }
            </div>
            <div class="ms__scroll" tabindex="0" role="region" aria-label="Recent activity">
              @if (activity().length > 0) {
                <ul class="ms__feed">
                  @for (e of activity(); track e.eventId) {
                    <li data-activity-item>
                      <span>{{ text(e) }}</span>
                      <span class="ms__when">{{ when(e) }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="ms__empty" data-no-activity>No recent activity.</p>
              }
            </div>
          </section>
        }
      </div>
    </div>
  `,
})
export class MatterSummary {
  readonly matter = input.required<MatterResponse>();
  /** Counts the changes that make the tiles and the feed load again (a save, a new project). */
  readonly reload = input(0);
  readonly canEdit = input(false);
  readonly canAssign = input(false);
  readonly canLinkClient = input(false);
  readonly canSeeActivities = input(false);
  readonly edit = output<void>();
  readonly changeManagers = output<void>();
  readonly openActivities = output<void>();

  private readonly auth = inject(AuthStore);
  private readonly assetsApi = inject(AssetsClient);
  private readonly overviewApi = inject(MatterOverviewClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly showAssets = computed(() => this.auth.has('Asset.View'));
  /** The recent-activity pane needs what the overview needs: Task.View or Asset.View. */
  protected readonly showActivity = computed(
    () => this.auth.has('Task.View') || this.auth.has('Asset.View'),
  );

  protected readonly assetsLoader = panelLoader(
    () => [this.matter().matterId, this.reload()],
    () => this.assetsApi.getAssetCountsByType(this.matter().matterId),
    { enabled: () => this.showAssets() },
  );
  protected readonly overviewLoader = panelLoader(
    () => [this.matter().matterId, this.reload()],
    () => this.overviewApi.getMatterOverview(this.matter().matterId),
    { enabled: () => this.showActivity() },
  );

  protected readonly assetTypes = computed(() =>
    (this.assetsLoader.data() ?? []).filter((t) => t.count > 0),
  );
  protected readonly activity = computed<MyMattersActivityItem[]>(
    () => (this.overviewLoader.data() as MatterOverview | null)?.activity ?? [],
  );
  protected readonly hasManagers = computed(
    () => !!(this.matter().primaryManager || this.matter().secondaryManager),
  );
  protected readonly ai = computed(() => aiLabel(this.matter().aiAllowed));
  protected readonly text = activityText;

  protected when(e: MyMattersActivityItem): string {
    return activityTime(e.occurredAtUtc, this.clock.now(), this.zone);
  }
}
