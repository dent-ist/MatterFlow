import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { VendorMatterResponse, VendorsClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';
import { MatterRef } from '../../shared/ui/matter-ref';
import { matterLinkOf } from '../../shared/ui/matter-link';
import { NumericDatePipe } from '../../shared/ui/numeric-date';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../shared/ui/record-grid';
import { StateBlock } from '../../shared/ui/state-block';
import { VENDOR_MESSAGES } from './vendor-text';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const BONES: Record<string, string> = {
  matter: '5rem',
  name: '12rem',
  client: '8rem',
  linked: '3rem',
  by: '7rem',
};

/**
 * The Matters tab of the vendor pop-up (epic #1373, issue #1378; mockup `vendor-matters`): the matters the vendor is linked to (`GET /vendors/{id}/matters`, the reverse view), as the shared
 * read-only record grid: CM Number (a link to the matter), Matter, Client, Linked (date) and Linked By. Matters the person may not see (sensitive matters) are not in the list; the tab
 * count is the number listed. It needs `Matter.View` as well as `Vendor.View`: without it the tab says so. Vendors are linked from the matter, so this tab only points there.
 */
@Component({
  selector: 'mf-vendor-matters-tab',
  imports: [RecordGrid, RecordCell, MatterRef, NumericDatePipe, StateBlock, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--mf-frame-min]': 'frameMin()' },
  styles: `
    :host {
      display: block;
    }
    /* The grid table keeps 60 rem as its minimum on a page; inside the 734 px of the dialog tab it takes the width of its frame, the five columns fit. */
    :host ::ng-deep table.tt {
      min-width: 0;
    }
    .vm__head {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
    }
    .vm__title {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-semibold);
    }
    .vm__hint {
      margin: var(--mf-s3) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .vm__clip {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    td.vm__cell {
      max-width: 0;
    }
  `,
  template: `
    <div class="vm__head">
      <h3 class="vm__title">Matters</h3>
      @if (state() === 'ready') {
        <span data-matter-count>{{ rows().length }}</span>
      }
    </div>
    @switch (state()) {
      @case ('forbidden') {
        <mf-state-block icon="pi-lock" data-matters-forbidden>{{ noMatters }}</mf-state-block>
      }
      @case ('error') {
        <mf-state-block kind="error"
          >Couldn't load the matters.
          <p-button mfStateAction label="Retry" severity="secondary" (onClick)="load()"
        /></mf-state-block>
      }
      @default {
        @if (state() === 'ready' && rows().length === 0) {
          <mf-state-block icon="pi-folder" data-matters-empty
            >Not linked to any matter.
            <span mfStateReason
              >Link it from a matter's Summary tab. A vendor with no matters can be deleted.</span
            >
          </mf-state-block>
        } @else {
          <mf-record-grid
            label="Matters of this vendor"
            caption="Matters"
            noun="matters"
            [grid]="grid"
            [rows]="rows()"
            [rowKey]="matterKey"
            [loadState]="state() === 'loading' ? 'loading' : 'ready'"
            [empty]="false"
            [bones]="bones"
          >
            <ng-template mfCell="matter" let-m>
              <td data-matter-ref>
                <mf-matter-ref [value]="m.matterRef" [link]="link(m.matterId)" [copy]="false" />
              </td>
            </ng-template>
            <ng-template mfCell="name" let-m>
              <td class="vm__cell" data-matter-name [attr.title]="m.matterName">
                <span class="vm__clip">{{ m.matterName }}</span>
              </td>
            </ng-template>
            <ng-template mfCell="client" let-m>
              <td class="vm__cell" [attr.title]="m.clientName">
                <span class="vm__clip">{{ m.clientName }}</span>
              </td>
            </ng-template>
            <ng-template mfCell="linked" let-m>
              <td>{{ m.linkedAt | mfNum: 'date' }}</td>
            </ng-template>
            <ng-template mfCell="by" let-m>
              <td class="vm__cell" [attr.title]="m.linkedByName">
                <span class="vm__clip">{{ m.linkedByName }}</span>
              </td>
            </ng-template>
          </mf-record-grid>
          <p class="vm__hint">
            Vendors are linked from the matter: open a matter, Summary, then Edit on the Vendors
            panel.
          </p>
        }
      }
    }
  `,
})
export class VendorMattersTab {
  readonly vendorId = input.required<number>();
  /** The number of matters listed (the tab shows it). */
  readonly countChange = output<number>();

  private readonly api = inject(VendorsClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);

  protected readonly noMatters = VENDOR_MESSAGES.noMatters;
  protected readonly bones = BONES;
  protected readonly matterKey = (m: VendorMatterResponse): number => m.matterId;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<VendorMatterResponse[]>([]);
  /**
   * The record grid frame fills the room its parent gives it; a dialog tab has no fixed room, so the frame is as high as its rows need: the 40 px heading, up to six 44 px rows
   * (more rows scroll inside the frame) and the 2 px of border. Replaces the 412 px minimum of a page.
   */
  protected readonly frameMin = computed(
    () => `${40 + Math.min(Math.max(this.rows().length, 3), 6) * 44 + 2}px`,
  );

  protected readonly defs = computed((): RecordGridColumn[] => [
    {
      key: 'matter',
      label: 'CM Number',
      locked: true,
      width: 'var(--mf-col-ref-w)',
      minWidth: '120px',
    },
    { key: 'name', label: 'Matter', minWidth: '140px' },
    { key: 'client', label: 'Client', width: 'var(--mf-col-client-w)', minWidth: '120px' },
    { key: 'linked', label: 'Linked', width: '88px', minWidth: '88px' },
    { key: 'by', label: 'Linked by', width: '128px', minWidth: '128px' },
  ]);
  /** A fixed layout: the tab is a read-only list, so there is no Columns chooser; the grid state only holds the widths. */
  protected readonly grid = new RecordGridState('vendor-matters', this.defs);

  constructor() {
    effect(() => {
      this.vendorId();
      untracked(() => void this.load());
    });
  }

  protected link(matterId: number): unknown[] | null {
    return matterLinkOf(this.auth, matterId);
  }

  protected async load(): Promise<void> {
    if (!this.auth.has('Matter.View')) {
      this.state.set('forbidden');
      return;
    }
    this.state.set('loading');
    try {
      const rows = await this.quiet.run(() =>
        firstValueFrom(this.api.listVendorMatters(this.vendorId())),
      );
      this.rows.set(rows);
      this.state.set('ready');
      this.countChange.emit(rows.length);
    } catch (err) {
      this.state.set(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error');
    }
  }
}
