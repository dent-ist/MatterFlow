import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssetsClient, MatterResponse } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { ActiveBadge, Badge, SensitiveBadge } from '../../../shared/ui/badge';
import { AssetTypeChip } from '../../../shared/ui/asset-type-chip';
import { StateBlock } from '../../../shared/ui/state-block';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { DetailField, DetailsCard, DetailsGroup } from '../../../shared/ui/details-card';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { TagChip } from '../../../shared/ui/tag-chip';
import { Tip } from '../../../shared/ui/tip';
import { MatterTeamPanel } from './matter-team-panel';
import { MatterPathValue } from './matter-path-value';
import { numericInstant, readableInstant } from '../../../shared/ui/numeric-date';
import { personInitials } from '../../../shared/ui/person-initials';
import { shortAccountName } from '../../../shared/ui/person-name';
import { panelLoader } from '../../my-matters/panel-loader';
import { aiLabel } from './matter-ai';
import { IntPipe } from '../../../shared/ui/number-format';

/**
 * The Summary tab of the Matter page (MD-03 #1004, redesigned in MD-42 #1060 and again in #1376; mockup `docs/ux/mockups/matter-summary`, side column `docs/design/mockups/vendor-management`).
 * The page never scrolls on desktop:
 *
 *   Assets by type: equal tiles, one per type, that scroll sideways instead of wrapping; each opens the Assets tab for the type  [Asset.View]
 *   Below: Details at the left, a side column of 340 px at the right (the Team panel first; the Vendors panel, #1379, goes under it).
 *   Details: ONE card (the shared `mf-details-card`, D-44f) that fits its content, sits at the top and scrolls inside itself when it is taller than the room; its Edit button is in the page header.
 *     The fields are grouped under quiet sub-headings (D-11a, `mfDetailsGroup`) in two columns of groups:
 *       Matter (CM Number, Client, Matter Number, Matter Name) and Classification (Matter Types as chips, Matter Category, Current State) at the left;
 *       Management (Status, Sensitive only when sensitive, Primary PM, Secondary PM, AI Allowed) and Paths (DMS and DFS, each with Copy right beside the value) at the right;
 *     then the custom fields (no heading), and Created and Last Updated as one quiet muted line under the card's scrolling body (it never scrolls away).
 *   An unset Matter Category is muted "Not set" with the text button "Set Category" for a person who may edit the matter.
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
    DetailsGroup,
    MatterTeamPanel,
    TagChip,
    MatterRef,
    MatterPathValue,
    Tip,
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
    /* The strip's room is kept while it loads (one 52 px row, as the "No assets yet." card), so the Details card does not jump when the tiles arrive (layout shift). */
    [data-summary-assets] {
      min-height: calc(var(--mf-ctl-h) + 2 * var(--mf-s2));
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
    /* Details at the left, the side column (340 px, Team first, Vendors under it) at the right. The row is the room that is left under the tiles: the Details card fits its content and
       scrolls inside itself when that is more than the room; the side column scrolls on its own only if both panels are open and full on a short window. */
    .ms__body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      grid-template-rows: minmax(0, 1fr);
      align-items: start;
      gap: var(--mf-s3);
      flex: 1 1 0;
      min-height: 0;
    }
    .ms__details {
      max-height: 100%;
      min-width: 0;
    }
    .ms__side {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      min-height: 0;
      max-height: 100%;
      overflow-y: auto;
    }
    /* Two columns of groups (D-44f: two columns); a column holds its groups one under the other, so the sub-headings line up across the two when the groups are as long. */
    .ms__groups {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s4) var(--mf-s5);
    }
    .ms__col {
      min-width: 0;
    }
    .ms__col > section + section {
      margin-top: 0;
    }
    /* Created and Last Updated: one quiet line under the scrolling fields, on the card's own padding. */
    .ms__record {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
      margin: var(--mf-s3) 0 0;
      padding-top: var(--mf-s2);
      border-top: 1px solid var(--mf-border-soft);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
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
    /* A person with the Change / Add button: one line (a wide field's value is a block, so the line is its own flex box). */
    .ms__pm {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      min-height: var(--mf-chip-h);
    }
    /* Matter Type and Current State: plain text on one line with an ellipsis; the full name (and "(inactive)") is the tooltip (D-45). */
    .ms__clip {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ms__btn {
      margin-block: -4px;
    }
    /* The Matter Types: small chips that wrap; the chip is whole, a long name is cut inside it with the full name as the tooltip (D-45). */
    .ms__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s2);
      min-width: 0;
    }
    /* The custom fields (no heading) follow the groups inside the card's scroll region. */
    .ms__custom {
      margin-top: var(--mf-s4);
    }
    .ms__custom:empty {
      display: none;
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
        scrollLabel="Matter details, scrollable"
      >
        <div class="ms__groups">
          <div class="ms__col">
            <section mfDetailsGroup heading="Matter">
              <div mfDetailField label="CM Number">
                <span class="ms__cm"><mf-matter-ref [value]="matter().matterRef" /></span>
              </div>
              <div mfDetailField label="Matter Number">
                <span class="pg-mono">{{ matter().matterNumber }}</span>
              </div>
              <div mfDetailField label="Client" wide>
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
              <div mfDetailField label="Matter Name" wide>
                <span class="ms__clip" data-matter-name [mfTip]="matter().name">{{
                  matter().name
                }}</span>
              </div>
            </section>
            <section mfDetailsGroup heading="Classification">
              <div mfDetailField label="Matter Types" wide>
                @if (matter().matterTypes.length > 0) {
                  <span class="ms__chips" data-matter-type>
                    @for (t of matter().matterTypes; track t.id) {
                      <mf-tag-chip [mfTip]="listTip(t)" data-matter-type-chip>{{
                        t.name
                      }}</mf-tag-chip>
                    }
                  </span>
                } @else {
                  <span class="ms__none" data-matter-type>Not set</span>
                }
              </div>
              <div mfDetailField label="Matter Category">
                @if (matter().matterCategory; as c) {
                  <span class="ms__clip" data-matter-category [mfTip]="listTip(c)">{{
                    c.name
                  }}</span>
                } @else {
                  <span class="ms__none" data-matter-category>Not set</span>
                  @if (canEdit()) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text ms__btn"
                      data-set-category
                      (click)="editMatter.emit()"
                    >
                      Set Category
                    </button>
                  }
                }
              </div>
              <div mfDetailField label="Current State">
                @if (matter().currentState; as t) {
                  <span class="ms__clip" data-current-state [mfTip]="listTip(t)">{{ t.name }}</span>
                } @else {
                  <span class="ms__none" data-current-state>Not set</span>
                }
              </div>
            </section>
          </div>
          <div class="ms__col">
            <section mfDetailsGroup heading="Management">
              <div mfDetailField label="Status">
                <mf-active-badge [active]="matter().isActive" />
              </div>
              <div mfDetailField label="AI Allowed">
                <span data-ai-value>
                  <mf-badge tone="neutral" icon="pi-sparkles">{{ ai() }}</mf-badge>
                </span>
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
              <div mfDetailField label="Primary PM" wide data-managers>
                <span class="ms__pm">
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
                      [attr.aria-label]="
                        matter().primaryManager ? 'Change PMs' : 'Add a Primary PM'
                      "
                      (click)="changeManagers.emit()"
                    >
                      {{ matter().primaryManager ? 'Change' : 'Add' }}
                    </button>
                  }
                </span>
              </div>
              <div mfDetailField label="Secondary PM" wide>
                <span class="ms__pm">
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
                </span>
              </div>
            </section>
            <section mfDetailsGroup heading="Paths">
              <div mfDetailField label="DMS Path" wide data-dms-path>
                <mf-matter-path-value label="DMS Path" [value]="matter().dmsPath" />
              </div>
              <div mfDetailField label="DFS Path" wide data-dfs-path>
                <mf-matter-path-value label="DFS Path" [value]="matter().dfsPath" />
              </div>
            </section>
          </div>
        </div>
        <div class="ms__custom">
          <mf-custom-fields-view
            [heading]="false"
            [versionId]="matter().formVersionId"
            [values]="matter().formValues ?? {}"
          />
        </div>
        <p mfDetailsFoot class="ms__record" data-record-line>
          <span
            >Created
            <span [attr.title]="long(matter().createdAtUtc)" data-created>{{
              stamp(matter().createdAtUtc)
            }}</span></span
          >
          <span
            >Last Updated
            <span [attr.title]="long(matter().modifiedAtUtc)" data-modified>
              @if (matter().modifiedAtUtc; as m) {
                {{ stamp(m) }}
              } @else {
                -
              }
            </span></span
          >
        </p>
      </mf-details-card>

      <div class="ms__side" data-summary-side>
        <mf-matter-team-panel
          [matterId]="matter().matterId"
          [matterRef]="matter().matterRef"
          [matterName]="matter().name"
          [canEdit]="canEdit()"
        />
      </div>
    </div>
  `,
})
export class MatterSummary {
  readonly matter = input.required<MatterResponse>();
  /** Counts the changes that make the asset tiles load again (a save, a new project). */
  readonly reload = input(0);
  readonly canAssign = input(false);
  /** The person may edit the matter (`Matter.Edit`): "Set Category" shows, and the Team panel offers Edit. */
  readonly canEdit = input(false);
  readonly canLinkClient = input(false);
  readonly changeManagers = output<void>();
  /** "Set Category": the page opens the Edit Matter dialog. */
  readonly editMatter = output<void>();
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

  /** The tooltip of a Matter Type or Current State: the full name, with " (inactive)" for an item an administrator has since deactivated (the cell shows the plain name). */
  protected listTip(t: { name: string; isActive: boolean }): string {
    return t.isActive ? t.name : `${t.name} (inactive)`;
  }

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
