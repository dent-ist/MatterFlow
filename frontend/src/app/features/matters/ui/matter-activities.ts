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
import { firstValueFrom } from 'rxjs';
import { AuditSearchClient, AuditSearchItem } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { GridFrame } from '../../../shared/ui/grid-frame';
import { friendlyText } from '../../../shared/ui/audit-format';
import { auditObjectLink, auditObjectText } from '../../admin/audit/audit-links';
import { stampText } from '../../admin/audit/audit-rows';
import { StateBlock } from '../../../shared/ui/state-block';
import { IntPipe } from '../../../shared/ui/number-format';

/**
 * The Kind dropdown of the Activities tab: a word for the audit object types that belong together. The choice is sent to the server as the object type filter, so paging
 * stays right. Production, Spec and Note events come from the Productions and Notes modules (object types Production, ProductionSpec and Note).
 */
export const ACTIVITY_KINDS: readonly { value: string; label: string; types: string }[] = [
  { value: '', label: 'All kinds', types: '' },
  { value: 'matter', label: 'Matter', types: 'Matter' },
  {
    value: 'tasks',
    label: 'Tasks',
    types: 'Task,TaskStepInstance,StepInstance,FormValueSet,TaskAsset',
  },
  { value: 'comments', label: 'Comments', types: 'TaskComment' },
  { value: 'assets', label: 'Assets', types: 'Asset' },
  { value: 'projects', label: 'Projects', types: 'Project' },
  { value: 'productions', label: 'Productions', types: 'Production,ProductionComment' },
  { value: 'specs', label: 'Specs', types: 'ProductionSpec' },
  { value: 'notes', label: 'Notes', types: 'Note,NoteTemplate' },
];

const seenKey = (matterId: number) => `mf.matter-activity-seen.${matterId}`;

/**
 * The Activities tab of a Matter (MD-07, #1008; owner decision AQ.7): everything the audit trail holds for the matter (the matter itself, its tasks, comments, assets,
 * projects, productions, specs and notes) in the My Matters grid style: When, Who and one What cell that ends with the object as a link when it has a page, newest first,
 * a Kind dropdown and a banner "N new since your last visit" (the last visit is remembered in this browser only). A record the viewer may not see keeps the server's
 * label "Restricted record". Needs `Audit.View` (the tab is not offered without it).
 */
@Component({
  selector: 'mf-matter-activities',
  imports: [IntPipe, StateBlock, GridFrame, Dropdown, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    /* The tab's control row above the frame, like every Matter tab (LC-08, theme guide 11.2): the only control is the Kind dropdown. */
    .ma__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
    }
    .ma__banner {
      margin: 0 var(--mf-s3) var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
    }
    td.ma__when {
      white-space: nowrap;
      color: var(--mf-text-muted);
    }
    .ma__obj {
      margin-left: var(--mf-s1);
    }
    .ma__new {
      margin-left: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
      font-size: var(--mf-fs-xs);
    }
    /* The columns are the shared record grid (pg-table, 44 px rows, 40 px header; #1214): the What cell stops at two lines. */
    .ma__muted {
      margin: 0;
      padding: var(--mf-s3);
      color: var(--mf-text-muted);
    }
  `,
  template: `
    <div class="ma__bar">
      <h2 class="mf-sr-only">Activities</h2>
      <mf-dropdown
        buttonId="ma-kind"
        label="Kind"
        prefix="Kind:"
        [items]="kindItems"
        [value]="kind()"
        (valueChange)="setKind($event)"
        neutralValue=""
      />
    </div>
    <mf-grid-frame scrollLabel="Matter activities">
      <div frameStatus>
        @if (newCount() > 0) {
          <p class="ma__banner" role="status" data-new-banner>
            {{ newCount() | mfInt }} new since your last visit
          </p>
        }
      </div>
      @switch (state()) {
        @case ('loading') {
          <p class="ma__muted" role="status" aria-busy="true">Loading activities</p>
        }
        @case ('error') {
          <mf-state-block kind="error" data-error>
            Couldn't load activities.
            <button mfStateAction type="button" class="mf-btn" (click)="fetch(true)">Retry</button>
          </mf-state-block>
        }
        @default {
          @if (items().length === 0) {
            <mf-state-block data-empty>No activity yet.</mf-state-block>
          } @else {
            <table class="pg-table tt" data-activities>
              <caption class="mf-sr-only">
                Activities of this matter, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Who</th>
                </tr>
              </thead>
              <tbody>
                @for (e of items(); track e.auditEventId) {
                  <tr data-activity-row [attr.data-object-type]="e.object.type">
                    <td class="ma__when">
                      <time [attr.datetime]="e.occurredAtUtc">{{ stamp(e) }}</time>
                    </td>
                    <td>
                      <div class="pg-name" [attr.title]="what(e) + ' ' + objectText(e)">
                        {{ what(e) }}
                        @if (link(e); as l) {
                          <a
                            class="pg-link ma__obj"
                            data-object-link
                            [routerLink]="l.commands"
                            [queryParams]="l.queryParams"
                            >{{ objectText(e) }}</a
                          >
                        } @else {
                          <span class="ma__obj" data-object-text>{{ objectText(e) }}</span>
                        }
                        @if (isNew(e)) {
                          <span class="ma__new" data-new>New</span>
                        }
                      </div>
                    </td>
                    <td>{{ e.actor.displayName }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      }
      <div frameFoot>
        @if (nextCursor() !== null) {
          <button type="button" class="mf-btn" data-show-more (click)="fetch(false)">
            Show more
          </button>
        }
      </div>
    </mf-grid-frame>
  `,
})
export class MatterActivities {
  readonly matterId = input.required<number>();

  private readonly api = inject(AuditSearchClient);
  private readonly auth = inject(AuthStore);
  private readonly zone = inject(USER_TIME_ZONE);
  /** The highest event id the person had seen when this visit began (0 when there was no earlier visit). */
  private seenBefore = 0;
  private turn = 0;

  protected readonly kindItems: DropdownItem[] = ACTIVITY_KINDS.map((k) => ({
    value: k.value,
    label: k.label,
  }));
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly items = signal<AuditSearchItem[]>([]);
  protected readonly nextCursor = signal<number | null>(null);
  protected readonly kind = signal('');
  protected readonly newCount = computed(() => this.items().filter((e) => this.isNew(e)).length);

  constructor() {
    effect(() => {
      const id = this.matterId();
      untracked(() => {
        this.seenBefore = this.readSeen(id);
        void this.fetch(true).then(() => this.rememberVisit(id));
      });
    });
  }

  protected setKind(value: string): void {
    this.kind.set(value);
    void this.fetch(true);
  }

  protected isNew(e: AuditSearchItem): boolean {
    return this.seenBefore > 0 && e.auditEventId > this.seenBefore;
  }

  protected stamp(e: AuditSearchItem): string {
    return stampText(e, this.zone);
  }

  /** The event as a sentence, without the object (the link follows it). */
  protected what(e: AuditSearchItem): string {
    return friendlyText(e.summary) || 'Event';
  }

  protected objectText = auditObjectText;

  protected link(e: AuditSearchItem) {
    return auditObjectLink(e, (permission) => this.auth.has(permission));
  }

  private readSeen(id: number): number {
    try {
      return Number(localStorage.getItem(seenKey(id))) || 0;
    } catch {
      return 0;
    }
  }

  private rememberVisit(id: number): void {
    if (this.kind() !== '') return;
    const newest = Math.max(0, ...this.items().map((e) => e.auditEventId));
    if (newest === 0) return;
    try {
      localStorage.setItem(seenKey(id), String(newest));
    } catch {
      // Private window or blocked storage: the banner simply never appears.
    }
  }

  protected async fetch(first: boolean): Promise<void> {
    const mine = ++this.turn;
    if (first) {
      this.state.set('loading');
      this.nextCursor.set(null);
    }
    const types = ACTIVITY_KINDS.find((k) => k.value === this.kind())?.types || undefined;
    try {
      const page = await firstValueFrom(
        this.api.searchAuditEvents(
          types,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          first ? undefined : (this.nextCursor() ?? undefined),
          50,
          this.matterId(),
        ),
      );
      if (mine !== this.turn) return;
      this.items.update((list) => (first ? page.items : [...list, ...page.items]));
      this.nextCursor.set(page.nextCursor ?? null);
      this.state.set('ready');
    } catch {
      if (mine === this.turn) this.state.set('error');
    }
  }
}
