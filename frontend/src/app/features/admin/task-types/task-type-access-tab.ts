import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Button } from 'primeng/button';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { StateBlock } from '../../../shared/ui/state-block';
import { TagChip } from '../../../shared/ui/tag-chip';
import { Tip } from '../../../shared/ui/tip';
import {
  AccessModel,
  allViewRolesInactive,
  inactiveChosen,
  isLinked,
  isRestricted,
  linkedReason,
  summaryOf,
  viewIds,
} from './task-type-access';
import type { AccessRoleChoice } from './task-types-api';

type ListKey = 'canView' | 'canEdit' | 'canAssign';

interface ListDef {
  key: ListKey;
  label: string;
  /** What the trigger says while the list is empty: what empty means, not "All Roles". */
  empty: string;
  help: string;
}

const LISTS: readonly ListDef[] = [
  {
    key: 'canView',
    label: 'Can View',
    empty: 'Everyone (No Limit)',
    help: 'Roles that can see this task type. Leave empty so everyone can.',
  },
  {
    key: 'canEdit',
    label: 'Can Edit',
    empty: 'No Extra Limit',
    help: 'Roles that can change its tasks and create new ones. Leave empty so everyone who can view can also edit.',
  },
  {
    key: 'canAssign',
    label: 'Can Be Assigned',
    empty: 'No Extra Limit',
    help: 'Roles whose people can be chosen as assignee. Leave empty so any viewer who normally takes tasks can be.',
  },
];

/**
 * The Access tab of the Task Type page (epic #1397, #1402; owner-approved mockup `docs/ux/mockups/task-type-access/`). Three shared multi-selects (Can View, Can Edit,
 * Can Be Assigned) with the chosen roles as removable chips under each; a role chosen in Can Edit or Can Be Assigned shows in Can View at once as a linked chip that cannot be
 * removed there (the server adds it too); a live summary and the "How access works" card. The page owns the model, the save and the confirmation: this component only
 * edits the three lists and reports them.
 */
@Component({
  selector: 'mf-task-type-access-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Dropdown, StateBlock, TagChip, Tip],
  template: `
    @if (enforced() === false && state() === 'ready') {
      <p class="pg-banner" role="status" data-not-enforced-banner>
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <span
          >Access rules are saved but not enforced yet. Everyone can still use this task type until
          Task Type Access is switched on (ask IT).</span
        >
      </p>
    }
    @if (state() === 'loading') {
      <div class="at at--loading" aria-busy="true" data-access-loading>
        <span class="mf-sr-only" role="status">Loading access rules</span>
        <div class="at__fields" aria-hidden="true">
          @for (n of bars; track n) {
            <span class="at__bar"></span>
          }
        </div>
      </div>
    } @else if (state() === 'error') {
      <mf-state-block kind="error" data-access-error>
        Couldn't load the access rules.
        <p-button mfStateAction label="Retry" severity="secondary" (onClick)="retry.emit()" />
      </mf-state-block>
    } @else {
      <div class="at" data-access-tab>
        <div class="at__fields">
          @for (d of lists; track d.key) {
            <div class="at__field" [attr.data-field]="d.key">
              <label [id]="'at-' + d.key + '-label'" [attr.for]="'at-' + d.key">{{
                d.label
              }}</label>
              <mf-dropdown
                field
                fill
                [multi]="true"
                [buttonId]="'at-' + d.key"
                [label]="d.label"
                [placeholder]="d.empty"
                [items]="itemsOf(d.key)"
                [values]="valuesOf(d.key)"
                [invalid]="!!errors()[d.key]"
                [describedBy]="'at-' + d.key + '-help'"
                (valuesChange)="pick(d.key, $event)"
              />
              <ul
                class="at__chips"
                [attr.aria-label]="d.label + ' roles'"
                [attr.data-chips]="d.key"
              >
                @for (r of chipsOf(d.key); track r.id) {
                  <li>
                    @if (r.linked) {
                      <span
                        [mfTip]="r.reason"
                        tabindex="0"
                        [attr.aria-label]="r.reason"
                        data-linked
                      >
                        <mf-tag-chip colour="slate" icon="pi-link">{{ r.name }}</mf-tag-chip>
                      </span>
                    } @else {
                      <mf-tag-chip
                        [colour]="r.inactive ? 'amber' : ''"
                        [icon]="r.inactive ? 'pi-exclamation-triangle' : ''"
                        [name]="r.name"
                        [removeKey]="r.id"
                        [removable]="true"
                        (remove)="drop(d.key, r.id)"
                        >{{ r.name }}{{ r.inactive ? ' (inactive)' : '' }}</mf-tag-chip
                      >
                    }
                  </li>
                }
              </ul>
              <p [id]="'at-' + d.key + '-help'" class="muted hint at__help">{{ d.help }}</p>
              @if (d.key === 'canView') {
                <p class="muted hint at__note">
                  <i class="pi pi-info-circle" aria-hidden="true"></i>
                  Roles in Can Edit or Can Be Assigned are added here (link icon).
                </p>
              }
              @if (errors()[d.key]; as message) {
                <p class="error" role="alert" [attr.data-error]="d.key">
                  <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                  {{ message }}
                </p>
              }
            </div>
          }
        </div>
        <section class="at__card mf-card" aria-labelledby="at-summary-h" data-access-summary-card>
          <h2 id="at-summary-h" class="mf-card__title">Summary</h2>
          <p class="at__summary" aria-live="polite" data-access-summary>
            <i
              class="pi"
              [class.pi-lock]="restricted()"
              [class.pi-users]="!restricted()"
              aria-hidden="true"
            ></i>
            <strong>{{ summary() }}</strong>
          </p>
          @if (inactiveNames().length > 0) {
            <p class="at__warn" data-inactive-note>
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              @if (allInactive()) {
                <span
                  >Every role that can view is inactive, so only a System Admin can see this task
                  type.</span
                >
              } @else {
                <span
                  >{{ inactiveNames().join(', ') }}
                  {{ inactiveNames().length === 1 ? 'is' : 'are' }} inactive, so nobody holds
                  {{ inactiveNames().length === 1 ? 'it' : 'them' }} now.</span
                >
              }
            </p>
          }
          <h3 class="at__sub">How access works</h3>
          <ul class="at__how">
            <li>
              <i class="pi pi-users" aria-hidden="true"></i>
              <span>A person qualifies for a list when any of their roles is in it.</span>
            </li>
            <li>
              <i class="pi pi-eye-slash" aria-hidden="true"></i>
              <span
                >A task type people cannot view is hidden for them everywhere: lists, counts,
                search, notifications and exports.</span
              >
            </li>
            <li>
              <i class="pi pi-shield" aria-hidden="true"></i>
              <span
                >System Admin always sees every task type. Reports have their own permissions and
                are not limited by these rules.</span
              >
            </li>
          </ul>
        </section>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .at {
      display: grid;
      grid-template-columns: minmax(0, 480px) minmax(0, 1fr);
      gap: var(--mf-s5);
      align-items: start;
    }
    .at__fields {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
    }
    .at__field {
      display: grid;
      gap: var(--mf-s1);
      min-width: 0;
    }
    .at__field label {
      font-weight: var(--mf-fw-semibold);
    }
    .at__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .at__chips:empty {
      display: none;
    }
    .at__chips [data-linked] {
      display: inline-flex;
    }
    .at__help,
    .at__note {
      margin: 0;
    }
    .at__note {
      display: flex;
      gap: var(--mf-s1);
      align-items: flex-start;
    }
    .at__note .pi {
      flex: none;
      margin-top: 2px;
      font-size: var(--mf-icon-sm);
    }
    .at__card {
      min-width: 0;
    }
    .at__summary {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      margin: 0 0 var(--mf-s3);
    }
    .at__summary .pi {
      flex: none;
      font-size: var(--mf-icon-md);
      color: var(--mf-text-muted);
    }
    .at__warn {
      display: flex;
      gap: var(--mf-s2);
      align-items: flex-start;
      margin: 0 0 var(--mf-s3);
      color: var(--mf-sem-risk-fg);
    }
    .at__warn .pi {
      flex: none;
      font-size: var(--mf-icon-md);
    }
    .at__sub {
      margin: var(--mf-s3) 0 var(--mf-s2);
      padding-top: var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-semibold);
    }
    .at__how {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .at__how li {
      display: flex;
      gap: var(--mf-s2);
      align-items: flex-start;
    }
    .at__how .pi {
      flex: none;
      margin-top: 1px;
      font-size: var(--mf-icon-md);
      color: var(--mf-text-muted);
    }
    .at__bar {
      display: block;
      height: var(--mf-ctl-h);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .error {
      margin: 0;
    }
  `,
})
export class TaskTypeAccessTab {
  /** Roles that can be chosen (active or not; an inactive one cannot be newly chosen). */
  readonly roles = input.required<readonly AccessRoleChoice[]>();
  readonly model = input.required<AccessModel>();
  /** False while the server does not enforce the rules (the amber banner); null when unknown (a type that is not saved yet). */
  readonly enforced = input<boolean | null>(null);
  readonly state = input<'loading' | 'error' | 'ready'>('ready');
  /** Server refusals by list (`canView`, `canEdit`, `canAssign`), for example a role that is inactive or gone. */
  readonly errors = input<Readonly<Record<string, string>>>({});
  /** The roles that were in the saved lists: an inactive role already there may stay chosen. */
  readonly saved = input<AccessModel>({ canView: [], canEdit: [], canAssign: [] });

  readonly modelChange = output<AccessModel>();
  readonly retry = output<void>();

  protected readonly lists = LISTS;
  protected readonly bars = [0, 1, 2];
  protected readonly summary = computed(() => summaryOf(this.model()));
  protected readonly restricted = computed(() => isRestricted(this.model()));
  protected readonly inactiveNames = computed(() => inactiveChosen(this.model(), this.roles()));
  protected readonly allInactive = computed(() => allViewRolesInactive(this.model(), this.roles()));
  private readonly byId = computed(() => new Map(this.roles().map((r) => [r.roleId, r])));

  private idsOf(key: ListKey): number[] {
    return key === 'canView' ? viewIds(this.model()) : this.model()[key];
  }

  protected valuesOf(key: ListKey): string[] {
    return this.idsOf(key).map(String);
  }

  /** The first row ("Everyone (No Limit)" / "No Extra Limit") clears the list; a role is not choosable when it is inactive and not already saved, or linked into Can View. */
  protected itemsOf(key: ListKey): DropdownItem[] {
    const d = LISTS.find((x) => x.key === key)!;
    const chosen = new Set(this.idsOf(key));
    const saved = new Set([
      ...this.saved().canView,
      ...this.saved().canEdit,
      ...this.saved().canAssign,
    ]);
    return [
      { value: '', label: d.empty },
      ...this.roles().map((r): DropdownItem => {
        const linked = key === 'canView' && isLinked(this.model(), r.roleId);
        const blocked = !r.isActive && !chosen.has(r.roleId) && !saved.has(r.roleId);
        return {
          value: String(r.roleId),
          label: r.name,
          ...(r.memberCount === undefined || !r.isActive ? {} : { count: r.memberCount }),
          ...(!r.isActive
            ? { sub: 'Inactive' }
            : linked
              ? { sub: 'Also in Can Edit or Can Be Assigned' }
              : {}),
          ...(blocked || linked ? { disabled: true } : {}),
        };
      }),
    ];
  }

  protected chipsOf(
    key: ListKey,
  ): { id: number; name: string; linked: boolean; inactive: boolean; reason: string }[] {
    const m = this.model();
    return this.idsOf(key).map((id) => {
      const name = this.byId().get(id)?.name ?? `Role ${id}`;
      const linked = key === 'canView' && isLinked(m, id);
      return {
        id,
        name,
        linked,
        inactive: this.byId().get(id)?.isActive === false,
        reason: linked ? linkedReason(m, id, name) : '',
      };
    });
  }

  protected pick(key: ListKey, values: readonly string[]): void {
    const ids = values.map(Number).filter((n) => Number.isInteger(n));
    this.change({ ...this.model(), [key]: ids });
  }

  protected drop(key: ListKey, id: number): void {
    const next = this.model()[key].filter((x) => x !== id);
    this.change({ ...this.model(), [key]: next });
  }

  private change(next: AccessModel): void {
    this.modelChange.emit(next);
  }
}
