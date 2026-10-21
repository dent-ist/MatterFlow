import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CustomFieldFormState,
  CustomFieldFormSummary,
  FormOwnerKind,
  FormsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { AdminCardList, AdminCardSpec } from '../../../shared/ui/admin-card-spec';
import { AdminColumn, adminListState } from '../../../shared/ui/admin-list-state';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { LoadState } from '../../../shared/ui/data-table';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { rowActions } from '../../../shared/ui/row-actions';
import { CUSTOM_FIELD_OBJECTS } from './custom-field-form-designer-api';
import { DrillReturn } from '../../../shared/work-queue/drill';
import { ADMIN_LIST, AdminListLeave } from '../list-return';
import { FormStatusCell } from '../shared/form-status-cell';

/** One object (Client, Matter or Project) with what its custom-field form holds. */
interface Row {
  key: string;
  label: string;
  icon: string;
  kind: FormOwnerKind;
  summary: CustomFieldFormSummary | null;
}

/** The icon of each object: the one of its menu item. */
const ICONS: Record<string, string> = {
  client: 'pi pi-building',
  matter: 'pi pi-briefcase',
  project: 'pi pi-folder',
};

/** The loaded cell class and the skeleton bone of each column: one definition for the table and its loading rows (#575). */
const COLUMNS: readonly AdminColumn[] = [
  { cls: 'mf-cell-name', bone: '8rem' },
  { cls: 'mf-cell-muted', bone: '7rem' },
  { cls: 'mf-cell-muted', bone: '6rem' },
  { cls: 'mf-cell-badge', bone: '10rem' },
  { cls: 'mf-cell-actions', bone: '1.5rem' },
];

/**
 * Admin: Custom Fields (UX S18, #644). On the admin list shell: the three objects that carry custom fields (Client, Matter, Project), each
 * with the numbers of its form (fields and how many are required, the published version and its date, Published / Draft / none) in 44 px rows,
 * the object name as the one link (to the form designer), ONE overflow menu (Edit fields, History with `Audit.View`) and cards below 640 px.
 * It reads one endpoint that creates nothing; the form definition of an object that has none is provisioned by the first Edit fields. Needs
 * `CustomField.Manage`.
 */
@Component({
  selector: 'mf-custom-fields-page',
  imports: [
    ActionMenu,
    ActivityDrawer,
    AdminCardList,
    AdminListShell,
    FormStatusCell,
    GridBody,
    MfDatePipe,
    RouterLink,
    RowLink,
    ScrollArea,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Custom Fields"
      icon="pi pi-sliders-h"
      description="Extra fields on Clients, Matters and Projects. Publishing a new version never changes saved values."
      tableId="custom-fields-table"
    >
      <div class="mf-sr-only" role="status" aria-live="polite" data-announce>
        {{ announcement() }}
      </div>
      @if (phone()) {
        <mf-admin-card-list
          noun="objects"
          label="Objects with custom fields"
          [items]="rows()"
          [spec]="cardOf"
          [listId]="listId"
          [state]="ls.state()"
          [empty]="ls.empty()"
          [filtered]="false"
          (retry)="load()"
        />
      } @else {
        <div class="mf-table-wrap" mfScrollArea="Custom fields list">
          <div class="mf-scroll">
            <table class="mf-grid" id="custom-fields-table" data-objects>
              <caption class="mf-sr-only">
                Objects with custom fields
              </caption>
              <thead>
                <tr>
                  <th class="mf-cell-name" scope="col">Object</th>
                  <th class="mf-cell-muted" scope="col">Fields</th>
                  <th class="mf-cell-muted" scope="col">Published</th>
                  <th class="mf-cell-badge" scope="col">Form</th>
                  <th class="mf-cell-actions" scope="col">
                    <span class="mf-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody
                mfGridBody
                noun="objects"
                [columnSpec]="columns"
                [state]="ls.state()"
                [empty]="ls.empty()"
                [filtered]="false"
                (retry)="load()"
              >
                @for (r of rows(); track r.key) {
                  <tr [attr.data-row]="r.label">
                    <td class="mf-cell-name">
                      <a
                        class="mf-name cf-link"
                        [routerLink]="['/admin/custom-fields', r.key, 'form']"
                        [mfRowLink]="listId"
                        [rowKey]="r.key"
                        [state]="leave.state()"
                        [attr.title]="r.label"
                        data-open
                      >
                        <i [class]="r.icon" aria-hidden="true"></i>
                        {{ r.label }}</a
                      >
                    </td>
                    <td class="mf-cell-muted" data-fields>{{ fieldsText(r) }}</td>
                    <td class="mf-cell-muted" data-published [attr.title]="publishedTitle(r)">
                      @if (r.summary?.publishedVersion; as v) {
                        v{{ v }}
                        @if (r.summary?.publishedAtUtc; as at) {
                          &middot; {{ at | mfDate: 'date' }}
                        }
                      } @else {
                        Not published
                      }
                    </td>
                    <td class="mf-cell-badge" data-status>
                      <mf-form-status-cell
                        [publishedVersion]="r.summary?.publishedVersion ?? null"
                        [draftVersion]="r.summary?.draftVersion ?? null"
                      />
                    </td>
                    <td class="mf-cell-actions" [attr.data-actions-of]="r.key">
                      @if (menus().get(r.key); as menu) {
                        <mf-action-menu
                          [floating]="true"
                          [label]="menu.label"
                          [items]="menu.items"
                        />
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
      @if (activity(); as r) {
        <mf-activity-drawer
          objectType="FormDefinition"
          [objectId]="r.summary!.formId!"
          [name]="r.label + ' custom fields'"
          [visible]="true"
          (visibleChange)="!$event && closeActivity()"
        />
      }
    </mf-admin-list-shell>
  `,
  styles: `
    .cf-link {
      text-decoration: none;
    }
    .cf-link i {
      margin-right: var(--mf-s2);
      color: var(--mf-text-muted);
    }
  `,
})
export class CustomFieldsPage implements OnInit {
  private readonly forms = inject(FormsClient);
  private readonly auth = inject(AuthStore);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly drill = inject(DrillReturn);

  protected readonly listId = ADMIN_LIST.customFields.id;
  protected readonly leave = inject(AdminListLeave);
  protected readonly phone = phoneCards();
  protected readonly columns = COLUMNS;

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<Row[]>([]);
  protected readonly announcement = signal('');
  protected readonly activity = signal<Row | null>(null);
  protected readonly ls = adminListState({ state: this.state, rows: this.rows });

  constructor() {
    // Back from a designer puts focus on the Object link of the row that was left (#645).
    restoreRowFocus(this.listId, () => this.state() === 'ready');
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const list = await firstValueFrom(this.forms.listCustomFieldForms());
      this.rows.set(
        CUSTOM_FIELD_OBJECTS.map((o) => ({
          key: o.key,
          label: o.label,
          icon: ICONS[o.key],
          kind: o.kind,
          summary: list.find((s) => s.ownerKind === o.kind) ?? null,
        })),
      );
      this.state.set('ready');
    } catch (error) {
      this.state.set(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error');
    }
  }

  /** "8 fields, 2 required", "1 field", or "No fields yet"; the published version's numbers. */
  protected fieldsText(r: Row): string {
    const s = r.summary;
    if (!s || s.publishedVersion === undefined || s.publishedVersion === null) {
      return 'No fields yet';
    }
    const fields = s.fieldCount === 1 ? '1 field' : `${s.fieldCount} fields`;
    return s.requiredCount > 0 ? `${fields}, ${s.requiredCount} required` : fields;
  }

  /** "Published by Kim Lee" for the cell's tooltip. */
  protected publishedTitle(r: Row): string | null {
    const by = r.summary?.publishedByName;
    return by ? `Published by ${by}` : null;
  }

  protected readonly menus = computed(() => {
    const map = new Map<string, ReturnType<typeof rowActions>>();
    for (const r of this.rows()) {
      const formId = r.summary?.formId;
      map.set(
        r.key,
        rowActions(
          `${r.label} custom fields`,
          [
            {
              id: 'fields',
              label: 'Edit fields',
              icon: 'pi-pencil',
              permission: 'CustomField.Manage',
              run: () => this.go(r),
            },
            {
              id: 'history',
              label: 'History',
              icon: 'pi-history',
              permission: 'Audit.View',
              reason: formId == null ? 'No fields have been added yet.' : undefined,
              run: () => this.activity.set(r),
            },
          ],
          { can: (permission) => this.auth.has(permission) },
        ),
      );
    }
    return map;
  });

  /** The phone card of an object: the same data and the same menu as the table row. */
  protected readonly cardOf = (r: Row): AdminCardSpec => ({
    title: r.label,
    link: ['/admin/custom-fields', r.key, 'form'],
    rowKey: r.key,
    state: this.leave.state(),
    badges: [this.formBadge(r)],
    meta: [this.fieldsText(r), this.publishedLine(r)],
    actions: this.menus().get(r.key) ?? null,
  });

  private formBadge(r: Row): {
    text: string;
    tone: 'success' | 'warning' | 'neutral';
    icon: string;
  } {
    switch (r.summary?.state) {
      case CustomFieldFormState.Published:
        return {
          text: `Published v${r.summary.publishedVersion}`,
          tone: 'success',
          icon: 'pi-check-circle',
        };
      case CustomFieldFormState.Draft:
        return { text: `Draft v${r.summary.draftVersion}`, tone: 'warning', icon: 'pi-file-edit' };
      default:
        return { text: 'No fields yet', tone: 'neutral', icon: 'pi-info-circle' };
    }
  }

  private publishedLine(r: Row): string {
    const s = r.summary;
    if (s?.publishedVersion == null)
      return s?.draftVersion != null ? `Draft v${s.draftVersion} in progress` : 'Not published';
    return s.draftVersion != null
      ? `Draft v${s.draftVersion} in progress`
      : `Version ${s.publishedVersion}`;
  }

  private go(r: Row): void {
    // The menu entry leaves the row like its name link does: Back puts focus on the Object link of the row.
    this.drill.leaveRow(this.listId, r.key);
    void this.router.navigate(['/admin/custom-fields', r.key, 'form'], {
      state: { ...this.leave.state(), keepRow: true },
    });
  }

  protected closeActivity(): void {
    const r = this.activity();
    this.activity.set(null);
    if (!r) return;
    afterNextRender(
      () =>
        document
          .querySelector<HTMLElement>(`[data-actions-of="${r.key}"] button[data-overflow]`)
          ?.focus(),
      { injector: this.injector },
    );
  }
}
