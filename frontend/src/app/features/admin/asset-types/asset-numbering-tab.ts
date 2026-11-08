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
import { firstValueFrom } from 'rxjs';
import {
  AssetNumberCounterItem,
  AssetTypeResponse,
  AssetTypesClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { DetailsCard } from '../../../shared/ui/details-card';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { Pager } from '../../../shared/ui/pager';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { SearchBox } from '../../../shared/ui/search-box';
import { StateBlock } from '../../../shared/ui/state-block';
import { AssetTailField } from './asset-tail-field';
import { CounterTarget, NextNumbersDialog } from './next-numbers-dialog';
import {
  TAIL_DEFAULT,
  TailCode,
  isTailCode,
  nameTooLong,
  renderTail,
  renderTailPart,
  tailMessage,
  validateTail,
} from './tail-rules';

const SAMPLE_CM = '90003-80008';
const PAGE_SIZES = [25, 50, 100];

/** The code of the first field error of a refused request (`numbering.pattern` carries the PATTERN_* code), else the problem's own code. */
function problemCode(e: unknown): string | undefined {
  if (!(e instanceof ApiError)) return undefined;
  for (const list of Object.values(e.problem?.errors ?? {})) {
    if (list?.[0]?.code) return list[0].code;
  }
  return e.code;
}

/**
 * The Numbering tab of the Asset Type record (#1297, spec 1 and 2): the Automatic Numbering card (switch, the tail after the CM Number, Counter button, Example, Save Numbering) and, while
 * numbering is on or has been, the Next Numbers card (a server paged grid of the counter per matter, a search, Set for a Matter and the Set Next Number dialog). The tail rules are the
 * browser twin of the backend's (`tail-rules.ts`, tested against the shared vectors); a server refusal shows the same sentence by its code.
 */
@Component({
  selector: 'mf-asset-numbering-tab',
  imports: [
    AssetTailField,
    ConfirmDialog,
    DetailsCard,
    MatterRef,
    NextNumbersDialog,
    Pager,
    RecordCell,
    RecordGrid,
    SearchBox,
    StateBlock,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    :host {
      display: grid;
      gap: var(--mf-s3);
      max-width: 720px;
    }
    .an__stack {
      display: grid;
      gap: var(--mf-s3);
      --mf-field-max: 480px;
    }
    .an__check {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      font-weight: 600;
    }
    .an__inner {
      display: grid;
      gap: var(--mf-s3);
      margin-top: var(--mf-s1);
    }
    .an__muted {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .an__label {
      font-weight: 600;
      font-size: var(--mf-fs-sm);
    }
    .an__example {
      margin: 0;
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-md);
      overflow-wrap: anywhere;
    }
    .an__example-cm {
      color: var(--mf-text-muted);
    }
    .an__footer {
      display: flex;
      justify-content: flex-end;
    }
    .nn__bar {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .nn__search {
      width: 320px;
    }
    .nn__grid {
      display: flex;
      flex-direction: column;
    }
    td.nn__cell-name {
      width: 100%;
      max-width: 0;
    }
    td.nn__cell-name,
    td.nn__cell-number {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    td.nn__cell-number {
      max-width: 0;
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-sm);
    }
    .nn__none {
      color: var(--mf-text-muted);
    }
    .nn__empty-line {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
    }
  `,
  template: `
    @if (loadFailed()) {
      <mf-state-block kind="error" data-numbering-error>
        Couldn't load numbering.
        <button mfStateAction type="button" class="mf-btn" (click)="refresh()" data-numbering-retry>
          Retry
        </button>
      </mf-state-block>
    } @else {
      <mf-details-card title="Automatic Numbering" data-numbering-card>
        <form class="an__stack" novalidate (submit)="$event.preventDefault(); requestSave()">
          <div>
            <label class="an__check">
              <input
                type="checkbox"
                [checked]="enabled()"
                [disabled]="readOnly() || busy()"
                (change)="setEnabled($any($event.target).checked)"
                data-numbering-switch
              />
              Number Assets Automatically
            </label>
            <p class="an__muted">
              Each new asset of this type gets a number when it is saved. The number can't be
              changed afterwards.
            </p>
          </div>
          @if (readOnly()) {
            <p class="an__muted" data-numbering-readonly>
              Reactivate this asset type to change numbering.
            </p>
          }
          @if (enabled()) {
            <div class="an__inner">
              <mf-asset-tail-field
                [cmNumber]="cmNumber()"
                [tail]="tail()"
                [error]="shownError()"
                [disabled]="readOnly() || busy()"
                (tailChange)="onTail($event)"
                (blurred)="validating.set(true)"
                (inserted)="validating.set(true)"
              />
              <div>
                <span class="an__label">Counter</span>
                <p class="an__muted" data-counter-text>
                  Restarts at 1 for each matter. {{ '{###}' }} gives 001, {{ '{####}' }} gives 0001.
                </p>
              </div>
              <div>
                <span class="an__label">Example</span>
                <p class="an__example" role="status" data-numbering-example>
                  @if (example(); as e) {
                    <span class="an__example-cm">{{ e.cm }}</span
                    >{{ e.rest }}
                  } @else {
                    <span class="an__muted">Fix the tail to see an example.</span>
                  }
                </p>
                <p class="an__muted" data-example-caption>{{ caption() }}</p>
                @if (hasNumbered()) {
                  <p class="an__muted">
                    Assets that already have a number keep it. A new tail applies to new assets
                    only.
                  </p>
                }
              </div>
            </div>
          }
          <div class="an__footer">
            <button
              type="submit"
              class="mf-btn mf-btn--primary"
              [disabled]="!canSave()"
              data-save-numbering
            >
              Save Numbering
            </button>
          </div>
        </form>
      </mf-details-card>

      @if (showNumbers()) {
        <mf-details-card title="Next Numbers" [count]="total()" data-next-numbers-card>
          <p class="an__muted">
            Use this to continue after folders that already exist on the share. A next number can be
            raised, never lowered.
          </p>
          <div class="nn__bar">
            <div class="nn__search">
              <mf-search-box
                inputId="nn-search"
                label="Search matters"
                placeholder="Search matters..."
                [hideLabel]="true"
                [leadingIcon]="true"
                [value]="search()"
                (searchChange)="onSearch($event)"
              />
            </div>
            @if (!numbersReadOnly()) {
              <button type="button" class="mf-btn" (click)="openFor(null)" data-set-for-matter>
                Set for a Matter
              </button>
            }
          </div>
          @if (state() === 'ready' && total() === 0 && search()) {
            <mf-state-block data-numbers-search-empty>
              No results for "{{ search() }}".
              <button
                mfStateAction
                type="button"
                class="mf-btn"
                (click)="onSearch('')"
                data-clear-search
              >
                Clear Search
              </button>
            </mf-state-block>
          } @else {
            <div class="nn__grid" data-next-numbers-grid>
              <mf-record-grid
                label="Next numbers per matter"
                caption="Next numbers per matter"
                noun="the numbers"
                tableId="asset-type-numbers"
                emptyText="No matter has a counter yet."
                [grid]="grid"
                [rows]="rows()"
                [rowKey]="rowKey"
                [loadState]="state()"
                [empty]="rows().length === 0"
                [bones]="bones"
                [actions]="!numbersReadOnly()"
                (retry)="loadCounters()"
              >
                <div mfEmptyAction>
                  <p class="nn__empty-line">
                    Use Set for a Matter to continue after folders that already exist on the share.
                  </p>
                  @if (!numbersReadOnly()) {
                    <button type="button" class="mf-btn" (click)="openFor(null)">
                      Set for a Matter
                    </button>
                  }
                </div>
                <ng-template mfCell="matterRef" let-c>
                  <td data-matter>
                    <mf-matter-ref [value]="c.matterRef" [copy]="false" />
                  </td>
                </ng-template>
                <ng-template mfCell="matterName" let-c>
                  <td class="nn__cell-name" [attr.title]="c.matterName">{{ c.matterName }}</td>
                </ng-template>
                <ng-template mfCell="highest" let-c>
                  <td
                    class="nn__cell-number"
                    [attr.title]="highestText(c)"
                    [attr.data-highest-of]="c.matterId"
                  >
                    @if (c.highestAssigned > 0) {
                      {{ highestText(c) }}
                    } @else {
                      <span class="nn__none">None</span>
                    }
                  </td>
                </ng-template>
                <ng-template mfCell="next" let-c>
                  <td
                    class="nn__cell-number"
                    [attr.title]="c.nextAssetNumber"
                    [attr.data-next-of]="c.matterId"
                  >
                    {{ c.nextAssetNumber }}
                  </td>
                </ng-template>
                <ng-template mfCell="actions" let-c>
                  <td class="mf-col-actions">
                    <button
                      type="button"
                      class="mf-btn mf-btn--icon"
                      [attr.aria-label]="'Set Next Number for ' + c.matterRef"
                      [attr.title]="'Set Next Number for ' + c.matterRef"
                      (click)="openFor(c)"
                      [attr.data-set-next-of]="c.matterId"
                    >
                      <i class="pi pi-pencil" aria-hidden="true"></i>
                    </button>
                  </td>
                </ng-template>
                <div mfGridFoot>
                  @if (state() === 'ready' && total() > 0) {
                    <mf-pager
                      [page]="page()"
                      [pageSize]="pageSize()"
                      [pageSizes]="pageSizes"
                      [total]="total()"
                      (pageChange)="goTo($event)"
                      (pageSizeChange)="setPageSize($event)"
                    />
                  }
                </div>
              </mf-record-grid>
            </div>
          }
        </mf-details-card>
      }
    }

    <mf-confirm-dialog
      title="Turn Off Numbering"
      confirmLabel="Turn Off Numbering"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="turnOffOpen"
      (confirmed)="save()"
    >
      <p data-turn-off-body>
        New assets of {{ assetType().name }} will no longer get a number. Numbers already assigned
        stay and are never used again, also if you turn numbering back on.
      </p>
    </mf-confirm-dialog>

    <mf-next-numbers-dialog
      [type]="numberedType()"
      [target]="target()"
      [(visible)]="dialogOpen"
      (saved)="loadCounters()"
    />
  `,
})
export class AssetNumberingTab {
  readonly assetType = input.required<AssetTypeResponse>();
  /** The type changed (numbering saved): the page takes the new row version. */
  readonly updated = output<AssetTypeResponse>();
  /** Someone else saved the type meanwhile (409): the page shows its stale banner. */
  readonly conflicted = output<void>();
  /** The tail is being edited and differs from what is saved (the page asks before leaving). */
  readonly dirtyChange = output<boolean>();

  private readonly api = inject(AssetTypesClient);
  private readonly notify = inject(NotificationService);

  protected readonly enabled = signal(false);
  protected readonly tail = signal(TAIL_DEFAULT);
  /** Messages show from the first blur or first insert on; Save is disabled while the tail is invalid either way. */
  protected readonly validating = signal(false);
  protected readonly busy = signal(false);
  protected readonly serverMessage = signal<string | null>(null);
  protected readonly turnOffOpen = signal(false);
  protected readonly loadFailed = signal(false);

  protected readonly readOnly = computed(() => !this.assetType().isActive);
  private readonly saved = computed(() => {
    const n = this.assetType().numbering;
    return { enabled: n?.enabled ?? false, tail: n?.pattern || TAIL_DEFAULT };
  });
  protected readonly dirty = computed(
    () =>
      this.enabled() !== this.saved().enabled ||
      (this.enabled() && this.tail() !== this.saved().tail),
  );
  private readonly rule = computed(() => (this.enabled() ? validateTail(this.tail()) : null));
  private readonly cmNumberText = computed(
    () => this.assetType().numbering?.example?.cmNumber || SAMPLE_CM,
  );
  protected readonly cmNumber = this.cmNumberText;
  private readonly nameLong = computed(
    () => !this.rule() && nameTooLong(this.cmNumberText(), this.tail()),
  );
  protected readonly invalid = computed(() => !!this.rule() || this.nameLong());
  protected readonly shownError = computed<string | null>(() => {
    if (this.serverMessage()) return this.serverMessage();
    if (!this.validating()) return null;
    const rule = this.rule();
    if (rule) return tailMessage(rule);
    return this.nameLong() ? tailMessage({ code: 'PATTERN_TOO_LONG' }, true) : null;
  });
  protected readonly canSave = computed(
    () => this.dirty() && !this.busy() && !this.readOnly() && !(this.enabled() && this.invalid()),
  );

  /** The whole name, the CM Number part and the tail part kept apart so the fixed part reads muted; null while the tail is invalid. */
  protected readonly example = computed(() => {
    const ex = this.assetType().numbering?.example;
    if (this.invalid()) return null;
    const cm = this.cmNumberText();
    const whole = renderTail(cm, this.tail(), ex?.nextCounter ?? 1);
    return whole === null ? null : { cm, rest: renderTailPart(this.tail(), ex?.nextCounter ?? 1) };
  });
  protected readonly caption = computed(() => {
    const ex = this.assetType().numbering?.example;
    return !ex || ex.isSample
      ? `Sample matter ${SAMPLE_CM}.`
      : `Based on matter ${ex.cmNumber} (its next number).`;
  });
  protected readonly hasNumbered = computed(
    () => this.assetType().numbering?.example?.isSample === false,
  );

  // ---- Next Numbers
  protected readonly grid = new RecordGridState(
    'asset-type-numbers',
    signal<readonly RecordGridColumn[]>([
      { key: 'matterRef', label: 'CM Number', locked: true, width: '141px', minWidth: '141px' },
      { key: 'matterName', label: 'Matter Name', locked: true, minWidth: '200px' },
      { key: 'highest', label: 'Highest Used', locked: true, width: '176px', minWidth: '176px' },
      { key: 'next', label: 'Next Number', locked: true, width: '176px', minWidth: '176px' },
    ]),
  );
  protected readonly bones: Record<string, string> = {
    matterRef: '6rem',
    matterName: '12rem',
    highest: '8rem',
    next: '8rem',
  };
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly rows = signal<AssetNumberCounterItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(PAGE_SIZES[0]);
  protected readonly search = signal('');
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly rowKey = (c: AssetNumberCounterItem): number => c.matterId;
  protected readonly dialogOpen = signal(false);
  protected readonly target = signal<CounterTarget | null>(null);

  /** On while numbering is on; off, the card stays (read only) only when counters exist, so the history is not lost. */
  protected readonly showNumbers = computed(
    () => this.saved().enabled || this.total() > 0 || this.search() !== '',
  );
  protected readonly numbersReadOnly = computed(() => !this.saved().enabled);
  protected readonly numberedType = computed(() => ({
    assetTypeId: this.assetType().assetTypeId,
    name: this.assetType().name,
    tail: this.saved().tail,
  }));

  constructor() {
    // A different type (or a reload after a conflict) starts the card afresh.
    let lastId = -1;
    effect(() => {
      const t = this.assetType();
      untracked(() => {
        this.enabled.set(t.numbering?.enabled ?? false);
        this.tail.set(t.numbering?.pattern || TAIL_DEFAULT);
        this.validating.set(false);
        this.serverMessage.set(null);
        if (t.assetTypeId !== lastId) {
          lastId = t.assetTypeId;
          this.search.set('');
          this.page.set(1);
          void this.loadCounters();
        }
      });
    });
    effect(() => {
      const d = this.dirty();
      untracked(() => this.dirtyChange.emit(d));
    });
  }

  protected setEnabled(on: boolean): void {
    this.enabled.set(on);
    this.serverMessage.set(null);
    if (on && this.tail().trim() === '') this.tail.set(TAIL_DEFAULT);
  }

  protected onTail(value: string): void {
    this.tail.set(value);
    this.serverMessage.set(null);
  }

  protected refresh(): void {
    this.loadFailed.set(false);
    void this.loadCounters();
  }

  protected async loadCounters(): Promise<void> {
    this.state.set('loading');
    try {
      const result = await firstValueFrom(
        this.api.listAssetNumberCounters(
          this.assetType().assetTypeId,
          this.search() || undefined,
          this.page(),
          this.pageSize(),
          'matter',
        ),
      );
      this.rows.set(result.items);
      this.total.set(result.total);
      this.state.set('ready');
    } catch {
      this.rows.set([]);
      this.state.set('error');
    }
  }

  protected onSearch(text: string): void {
    const next = text.trim();
    if (next === this.search()) return;
    this.search.set(next);
    this.page.set(1);
    void this.loadCounters();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    void this.loadCounters();
  }

  protected setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    void this.loadCounters();
  }

  protected openFor(item: CounterTarget | null): void {
    this.target.set(item);
    this.dialogOpen.set(true);
  }

  /** The number a matter has used up to now, at the type's current tail (`90003-80008_007`). */
  protected highestText(c: AssetNumberCounterItem): string {
    return renderTail(c.matterRef, this.saved().tail, c.highestAssigned) ?? '';
  }

  /** Save Numbering: turning off asks first (D-34); every other change saves at once. */
  protected requestSave(): void {
    if (!this.canSave()) {
      this.validating.set(true);
      return;
    }
    if (this.saved().enabled && !this.enabled()) {
      this.turnOffOpen.set(true);
      return;
    }
    void this.save();
  }

  /** "Save and Leave" of the page's leave question: saves the numbering; false (the person stays) when it did not save or turning off still has to be confirmed. */
  async saveForLeave(): Promise<boolean> {
    if (!this.canSave()) {
      this.validating.set(true);
      return false;
    }
    if (this.saved().enabled && !this.enabled()) {
      this.turnOffOpen.set(true);
      return false;
    }
    await this.save();
    return !this.dirty();
  }

  protected async save(): Promise<void> {
    const t = this.assetType();
    if (this.busy()) return;
    this.busy.set(true);
    this.serverMessage.set(null);
    const turningOff = !this.enabled();
    try {
      const updated = await firstValueFrom(
        this.api.updateAssetType(t.assetTypeId, {
          name: t.name,
          description: t.description ?? undefined,
          iconKey: t.iconKey,
          colourKey: t.colourKey,
          sortOrder: t.sortOrder,
          isActive: t.isActive,
          rowVersion: t.rowVersion,
          numbering: turningOff
            ? { enabled: false }
            : { enabled: true, pattern: this.tail(), scope: t.numbering?.scope ?? 'MATTER' },
        }),
      );
      this.turnOffOpen.set(false);
      this.notify.success(turningOff ? 'Numbering turned off' : 'Numbering saved', updated.name);
      this.updated.emit(updated);
      void this.loadCounters();
    } catch (e) {
      this.turnOffOpen.set(false);
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** A refusal by its code: a pattern rule shows the spec's sentence under the tail; a stale row version shows the page banner; anything else is a toast. */
  private fail(e: unknown): void {
    const code = problemCode(e);
    if (e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT') {
      this.conflicted.emit();
      return;
    }
    if (isTailCode(code)) {
      this.validating.set(true);
      const token = validateTail(this.tail())?.token;
      const long = code === 'PATTERN_TOO_LONG' && this.tail().length <= 50;
      this.serverMessage.set(tailMessage({ code: code as TailCode, token }, long));
      return;
    }
    this.notify.error(
      'Couldn’t save numbering.',
      e instanceof Error && e.message ? e.message : undefined,
    );
  }
}
