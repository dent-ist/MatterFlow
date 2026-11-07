import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssetsClient, MatterResponse } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { ActiveBadge, Badge, SensitiveBadge } from '../../../shared/ui/badge';
import { AssetTypeChip } from '../../../shared/ui/asset-type-chip';
import { StateBlock } from '../../../shared/ui/state-block';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { DetailField, DetailsCard } from '../../../shared/ui/details-card';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { numericInstant, readableInstant } from '../../../shared/ui/numeric-date';
import { personInitials } from '../../../shared/ui/person-initials';
import { shortAccountName } from '../../../shared/ui/person-name';
import { panelLoader } from '../../my-matters/panel-loader';
import { aiLabel } from './matter-ai';
import { IntPipe } from '../../../shared/ui/number-format';

/**
 * The Summary tab of the Matter page (MD-03 #1004, redesigned in MD-42 #1060; mockup `docs/ux/mockups/matter-summary`). The page never scrolls on desktop:
 *
 *   Assets by type: equal tiles, one per type, that scroll sideways instead of wrapping; each opens the Assets tab for the type  [Asset.View]
 *   Details: ONE full-width card (the shared `mf-details-card`, D-44f, #1253) that fits its content, sits at the top and scrolls inside itself when it is taller than the room; its Edit button is in the page header.
 *     Small muted labels over values in 3 columns (card 1100 px and wider) or 2: CM number (one highlighted line), Client, Matter number,
 *     Matter name, Status, Sensitive (only when sensitive), Primary PM, Secondary PM, AI allowed, Created, Last changed, then the custom fields (no heading).
 *
 * Only fields the Matter already has plus AI allowed. The recent activity lives on the Activities tab (owner decision, MD-42).
 */
@Component({
  selector: 'mf-matter-summary',
  imports: [
    StateBlock,
    IntPipe,
    RouterLink,
    ActiveBadge,
    Badge,
    SensitiveBadge,
    AssetTypeChip,
    CustomFieldsView,
    DetailField,
    DetailsCard,
    MatterRef,
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
    /* The strip's room is kept while it loads, so the Details card does not jump when the tiles arrive (layout shift). */
    [data-summary-assets] {
      min-height: 3rem;
    }
    /* No assets: one 52 px card row in the place of the tile strip (D-44x): muted sentence at the left, its text action at the right. */
    .ms__no-assets {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
      height: calc(var(--mf-ctl-h) + 2 * var(--mf-s2));
      padding: 0 var(--mf-s4);
      font-size: var(--mf-fs-md);
    }
    /* The asset strip: equal tiles in one row that scrolls sideways when there are too many. */
    .ms__tiles {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(220px, 320px);
      gap: var(--mf-s2);
      margin: 0;
      padding: 0 0 var(--mf-s1);
      list-style: none;
      overflow-x: auto;
    }
    .ms__tile {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-ctl-h);
      padding: var(--mf-s2) var(--mf-s4);
      color: inherit;
      text-decoration: none;
    }
    .ms__tile-name {
      flex: 1 1 auto;
      font-size: var(--mf-fs-md);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ms__count {
      font-size: var(--mf-fs-figure);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    /* The Details card is the shared mf-details-card (D-44f); it fits its content and scrolls inside when the room is used up. */
    .ms__body {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
    }
    /* The CM number: one highlighted line, number and copy icon on one baseline. */
    .ms__cm {
      display: inline-flex;
      align-items: center;
      min-height: var(--mf-chip-h);
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-sem-info-bg);
      font-weight: 700;
    }
    .ms__avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: var(--mf-radius-pill);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .ms__none {
      color: var(--mf-text-muted);
    }
    .ms__btn {
      margin-block: -4px;
    }
    /* The custom fields (no heading) follow the standard fields inside the card's scroll region. */
    .ms__custom {
      margin-top: var(--mf-s3);
    }
  `,
  template: `
    @if (showAssets()) {
      <section aria-label="Assets by type" data-summary-assets>
        @if (assetsLoader.state() === 'error') {
          <div data-assets-error>
            <mf-state-block kind="error">
              Couldn't load assets.
              <button type="button" mfStateAction class="mf-btn" (click)="assetsLoader.load()">
                Retry
              </button>
            </mf-state-block>
          </div>
        } @else if (assetTypes().length > 0) {
          <ul class="ms__tiles">
            @for (t of assetTypes(); track t.assetTypeId) {
              <li>
                <a
                  class="ms__tile mf-card mf-card--clickable"
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
                  <span class="ms__tile-name">{{ t.assetTypeName }}</span>
                  <span class="ms__count">{{ t.count | mfInt }}</span>
                </a>
              </li>
            }
          </ul>
        } @else if (assetsLoader.state() === 'ready') {
          <div class="ms__no-assets mf-card" data-no-assets>
            <span class="ms__none">No assets yet.</span>
            @if (canCreateAsset()) {
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-new-asset
                (click)="newAsset.emit()"
              >
                New Asset
              </button>
            }
          </div>
        }
      </section>
    }

    <div class="ms__body">
      <mf-details-card
        title="Details"
        class="ms__details"
        data-summary-details
        threeColumns
        scrollLabel="Matter details, scrollable"
      >
        <div mfDetailField label="CM Number">
          <span class="ms__cm"><mf-matter-ref [value]="matter().matterRef" /></span>
        </div>
        <div mfDetailField label="Client">
          <span data-client-value>
            @if (canLinkClient()) {
              <a class="mf-link" [routerLink]="['/clients', matter().clientId]"
                ><span class="pg-mono">{{ matter().clientNumber }}</span>
                {{ matter().clientName }}</a
              >
            } @else {
              <span
                ><span class="pg-mono">{{ matter().clientNumber }}</span>
                {{ matter().clientName }}</span
              >
            }
          </span>
        </div>
        <div mfDetailField label="Matter Number">
          <span class="pg-mono">{{ matter().matterNumber }}</span>
        </div>
        <div mfDetailField label="Matter Name">
          <span data-matter-name>{{ matter().name }}</span>
        </div>
        <div mfDetailField label="Status">
          <mf-active-badge [active]="matter().isActive" />
        </div>
        @if (matter().isSensitive) {
          <div mfDetailField label="Sensitive">
            <span data-sensitive-value>
              <!-- "Restricted access" is the chip's tooltip; the chip can be reached with Tab and says it to a screen reader. -->
              <span
                tabindex="0"
                title="Restricted access: only its project managers, people assigned one of its tasks and people who may see all sensitive matters can see it."
                data-sensitive-chip
              >
                <mf-sensitive-badge describedBy="matter-sensitive-note" />
                <span class="mf-sr-only">Restricted access</span>
              </span>
            </span>
          </div>
        }
        <div mfDetailField label="Primary PM" data-managers>
          @if (matter().primaryManager; as p) {
            <span class="ms__avatar" aria-hidden="true">{{ initials(p.displayName) }}</span>
            <span data-primary-manager>{{ person(p.displayName) }}</span>
          } @else {
            <span class="ms__none" data-primary-manager>None</span>
          }
          @if (canAssign()) {
            <button
              type="button"
              class="mf-btn mf-btn--text ms__btn"
              [attr.data-change-managers]="matter().primaryManager ? '' : null"
              [attr.data-add-managers]="matter().primaryManager ? null : ''"
              [attr.aria-label]="matter().primaryManager ? 'Change PMs' : 'Add a Primary PM'"
              (click)="changeManagers.emit()"
            >
              {{ matter().primaryManager ? 'Change' : 'Add' }}
            </button>
          }
        </div>
        <div mfDetailField label="Secondary PM">
          @if (matter().secondaryManager; as s) {
            <span class="ms__avatar" aria-hidden="true">{{ initials(s.displayName) }}</span>
            <span data-secondary-manager>{{ person(s.displayName) }}</span>
          } @else {
            <span class="ms__none" data-secondary-manager>None</span>
            @if (canAssign()) {
              <button
                type="button"
                class="mf-btn mf-btn--text ms__btn"
                data-add-secondary-manager
                aria-label="Add a Secondary PM"
                (click)="changeManagers.emit()"
              >
                Add
              </button>
            }
          }
        </div>
        <div mfDetailField label="AI Allowed">
          <span data-ai-value>
            <mf-badge tone="neutral" icon="pi-sparkles">{{ ai() }}</mf-badge>
          </span>
        </div>
        <div mfDetailField label="Created">
          <span [attr.title]="long(matter().createdAtUtc)" data-created>
            {{ stamp(matter().createdAtUtc) }}
          </span>
        </div>
        <div mfDetailField label="Last Updated">
          <span [attr.title]="long(matter().modifiedAtUtc)" data-modified>
            @if (matter().modifiedAtUtc; as m) {
              {{ stamp(m) }}
            } @else {
              <span class="ms__none">-</span>
            }
          </span>
        </div>
        <div class="ms__custom">
          <mf-custom-fields-view
            [heading]="false"
            [versionId]="matter().formVersionId"
            [values]="matter().formValues ?? {}"
          />
        </div>
      </mf-details-card>
    </div>
  `,
})
export class MatterSummary {
  readonly matter = input.required<MatterResponse>();
  /** Counts the changes that make the asset tiles load again (a save, a new project). */
  readonly reload = input(0);
  readonly canAssign = input(false);
  readonly canLinkClient = input(false);
  readonly changeManagers = output<void>();
  /** The empty asset bar's New Asset button. */
  readonly newAsset = output<void>();

  private readonly auth = inject(AuthStore);
  private readonly assetsApi = inject(AssetsClient);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);

  protected readonly showAssets = computed(() => this.auth.has('Asset.View'));
  protected readonly canCreateAsset = computed(
    () => this.auth.has('Asset.Create') && this.matter().isActive,
  );

  protected readonly assetsLoader = panelLoader(
    () => [this.matter().matterId, this.reload()],
    () => this.assetsApi.getAssetCountsByType(this.matter().matterId),
    { enabled: () => this.showAssets() },
  );

  protected readonly assetTypes = computed(() =>
    (this.assetsLoader.data() ?? []).filter((t) => t.count > 0),
  );
  protected readonly ai = computed(() => aiLabel(this.matter().aiAllowed));

  /** `MM/DD hh:mm AM/PM` (the year only when it is not this year, D-60); the long form with the zone is the tooltip. */
  protected stamp(instant: string | undefined): string {
    return instant ? numericInstant(instant, this.clock.now(), this.zone) : '';
  }

  protected long(instant: string | undefined): string | null {
    return instant ? `${readableInstant(instant, this.zone)} (${this.zone})` : null;
  }

  /** A person's name: the display name, or the account without its domain. */
  protected person(name: string): string {
    return shortAccountName(name);
  }

  protected initials(name: string): string {
    return personInitials(name);
  }
}
