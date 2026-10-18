import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  ClientResponse,
  ClientSummaryResponse,
  ClientsClient,
  MatterResponse,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ActiveBadge } from '../../../shared/ui/badge';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { dateDaysAgo } from '../../../shared/work-queue/queue-filters';
import { recordStripItems } from '../../../shared/work-queue/record-strip';
import { DUE_SOON_DAYS } from '../../../shared/work-queue/work-vocabulary';
import { WorkStrip } from '../../../shared/work-queue/work-strip';

/** How many matters the table lists (the summary's `topMatters` holds at most this many). */
export const OVERVIEW_MATTERS = 5;

/** Why New matter is unavailable for an inactive client (the same words as the header's button). */
const INACTIVE_REASON = 'This client is inactive. Set it active to add matters.';

/** One row of the overview's matters table; the counts are null without `Task.View`. */
export interface OverviewMatter {
  matterId: number;
  reference: string;
  name: string;
  isActive: boolean;
  open: number | null;
  overdue: number | null;
}

/** The rows from the summary's top matters (most open tasks first, as the API orders them). */
export function rowsFromSummary(summary: ClientSummaryResponse): OverviewMatter[] {
  return (summary.topMatters ?? []).slice(0, OVERVIEW_MATTERS).map((m) => ({
    matterId: m.matterId,
    reference: m.reference,
    name: m.name,
    isActive: m.isActive,
    open: m.openTasks,
    overdue: m.overdue,
  }));
}

/** The rows from the client's matter list, for a viewer who cannot see task numbers. */
export function rowsFromMatters(matters: readonly MatterResponse[]): OverviewMatter[] {
  return matters.slice(0, OVERVIEW_MATTERS).map((m) => ({
    matterId: m.matterId,
    reference: m.matterRef,
    name: m.name,
    isActive: m.isActive,
    open: null,
    overdue: null,
  }));
}

/**
 * The Overview tab of a client (C1, #261): the summary strip (links into the Task Queue scoped to the client, the tasks of all its
 * matters), the matters with the most open tasks (top 5 from `GET /clients/{id}/summary`) with a link to all of them, a muted
 * `Created ... - Last changed ...` line and the custom fields. Without `Task.View` the strip is absent and the table lists the first matters
 * with reference, name and status only; without `Matter.View` there is no table. A failed load of the numbers shows inline with Retry; the
 * rest of the tab stays.
 */
@Component({
  selector: 'mf-client-overview',
  imports: [
    WorkStrip,
    RouterLink,
    Button,
    ActiveBadge,
    CustomFieldsView,
    ErrorReference,
    MfDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './client-overview.scss',
  template: `
    <div class="ov" data-client-overview>
      <h2 class="mf-sr-only">Overview</h2>
      @if (canSeeTasks()) {
        @if (failed()) {
          <div class="ov-alert" role="alert" data-overview-error>
            Couldn't load the task numbers.
            <mf-error-reference />
            <p-button label="Retry" severity="secondary" data-retry (onClick)="load()" />
          </div>
        } @else if (loading()) {
          <div class="ov-skel ov-skel--strip" aria-hidden="true" data-overview-skeleton>
            @for (i of five; track i) {
              <span class="ov-bar"></span>
            }
          </div>
        } @else {
          <mf-work-strip label="Client tasks" [items]="stripItems()" />
        }
      }

      @if (canSeeMatters()) {
        <section class="ov-matters" aria-labelledby="ov-matters-h" data-overview-matters>
          <h3 id="ov-matters-h" class="ov-h">
            {{ canSeeTasks() ? 'Matters with the most open tasks' : 'Matters' }}
          </h3>
          @if (client().matterCount === 0) {
            <p class="ov-empty" data-no-matters>
              No matters yet.
              @if (canCreate() && client().isActive) {
                <a
                  class="mf-btn"
                  routerLink="/matters/new"
                  [queryParams]="{ clientId: client().clientId }"
                  data-new-matter
                  >New matter</a
                >
              } @else if (!client().isActive) {
                <span class="ov-muted" data-inactive-reason>{{ reason }}</span>
              }
            </p>
          } @else if (loading()) {
            <div class="ov-skel" aria-hidden="true" data-overview-skeleton>
              @for (i of five; track i) {
                <span class="ov-bar ov-bar--row"></span>
              }
            </div>
          } @else if (failed()) {
            <p class="ov-muted" data-matters-unavailable>The matters could not be loaded.</p>
          } @else if (rows().length === 0) {
            <p class="ov-empty" data-no-open>No matter has open tasks.</p>
          } @else {
            <table class="ov-table" data-top-matters>
              <thead>
                <tr>
                  <th scope="col">Matter</th>
                  <th scope="col">Name</th>
                  @if (canSeeTasks()) {
                    <th scope="col" class="ov-num">Open</th>
                    <th scope="col" class="ov-num">Overdue</th>
                  }
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (m of rows(); track m.matterId) {
                  <tr [attr.data-matter]="m.matterId">
                    <td class="ov-ref">
                      <a class="ov-link pg-mono" [routerLink]="['/matters', m.matterId]">{{
                        m.reference
                      }}</a>
                    </td>
                    <td class="ov-name">
                      <span class="ov-clamp" [attr.title]="m.name">{{ m.name }}</span>
                    </td>
                    @if (canSeeTasks()) {
                      <td class="ov-num" data-label="Open">{{ m.open ?? '--' }}</td>
                      <td class="ov-num" [attr.data-label]="m.overdue ? null : 'Overdue'">
                        @if (m.overdue) {
                          <span class="ov-overdue">
                            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                            {{ m.overdue }} overdue
                          </span>
                        } @else {
                          <span class="ov-muted">{{ m.overdue ?? '--' }}</span>
                        }
                      </td>
                    }
                    <td class="ov-status"><mf-active-badge [active]="m.isActive" /></td>
                  </tr>
                }
              </tbody>
            </table>
          }
          @if (client().matterCount > 0) {
            <a
              class="ov-all"
              routerLink="."
              [queryParams]="{ tab: 'matters' }"
              queryParamsHandling="merge"
              data-view-all
              >View all {{ client().matterCount }}
              {{ client().matterCount === 1 ? 'matter' : 'matters' }}</a
            >
          }
        </section>
      }

      <p class="ov-when" data-created-line>
        Created {{ client().createdAtUtc | mfDate: 'date' }}
        @if (client().modifiedAtUtc) {
          - Last changed {{ client().modifiedAtUtc | mfDate: 'date' }}
        }
      </p>

      <mf-custom-fields-view
        [versionId]="client().formVersionId"
        [values]="client().formValues ?? {}"
      />
    </div>
  `,
})
export class ClientOverview {
  readonly client = input.required<ClientResponse>();

  private readonly api = inject(ClientsClient);
  private readonly matters = inject(MattersClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly reason = INACTIVE_REASON;
  protected readonly five = [0, 1, 2, 3, 4];
  protected readonly canSeeTasks = computed(() => this.auth.has('Task.View'));
  protected readonly canSeeMatters = computed(() => this.auth.has('Matter.View'));
  protected readonly canCreate = computed(() => this.auth.has('Matter.Create'));
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly summary = signal<ClientSummaryResponse | null>(null);
  protected readonly plain = signal<OverviewMatter[]>([]);

  protected readonly rows = computed<OverviewMatter[]>(() => {
    const s = this.summary();
    return this.canSeeTasks() ? (s ? rowsFromSummary(s) : []) : this.plain();
  });

  protected readonly stripItems = computed(() =>
    recordStripItems(
      this.summary(),
      { kind: 'client', id: this.clientId() },
      { dueSoonTo: dateDaysAgo(this.clock.now(), -DUE_SOON_DAYS, this.zone) },
    ),
  );

  private readonly clientId = computed(() => this.client().clientId);

  constructor() {
    effect(() => {
      this.clientId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    const id = this.clientId();
    this.loading.set(true);
    this.failed.set(false);
    try {
      if (this.canSeeTasks()) {
        this.summary.set(
          await this.quiet.runInline(() => firstValueFrom(this.api.getClientSummary(id))),
        );
      } else if (this.canSeeMatters() && this.client().matterCount > 0) {
        const page = await this.quiet.runInline(() =>
          firstValueFrom(
            this.matters.listMatters(
              undefined,
              id,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              1,
              OVERVIEW_MATTERS,
              undefined,
            ),
          ),
        );
        this.plain.set(rowsFromMatters(page.items));
      }
    } catch {
      this.failed.set(true);
    } finally {
      if (id === this.clientId()) this.loading.set(false);
    }
  }
}
