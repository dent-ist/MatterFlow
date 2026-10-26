import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AssetResponse,
  AssetsClient,
  BulkAssetDispositionResponse,
} from '../../../api/generated/api-client';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  DISPOSITIONS,
  DispositionCode,
  NOTE_MAX,
  bulkImpactLine,
  bulkReason,
  dispositionLabel,
  impactLine,
  noteRequired,
  whyNot,
} from './asset-disposition';

/** One asset the dialog changes. `openLinkedTaskCount` is null when the viewer may not see tasks (the impact line is then left out). */
export interface DispositionTarget {
  readonly assetId: number;
  readonly name: string;
  readonly code: DispositionCode;
  readonly openLinkedTaskCount: number | null;
  /** Needed for a single change (the list and the record carry it). */
  readonly rowVersion: string;
}

/** What the dialog reports when it is closed after a change: the updated asset (single) or the per-asset results (bulk). */
export interface DispositionOutcome {
  readonly asset?: AssetResponse;
  readonly bulk?: BulkAssetDispositionResponse;
}

/**
 * Change disposition (epic #851, issue #866): the four dispositions as a radio group, a note, and the impact line ("3 open tasks keep this link"). One asset is a single change with its row
 * version; several are one bulk call whose answer lists every asset. Open linked tasks do not block anything: they are stated, and the note says why. Options the person may not choose are
 * disabled with the reason as text. Disposed asks for a note; so does the correction of a disposal.
 */
@Component({
  selector: 'mf-asset-disposition-dialog',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .dd {
      display: grid;
      gap: var(--mf-s3);
    }
    .dd__group {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .dd__legend {
      font-weight: 600;
      padding: 0;
      margin-bottom: var(--mf-s1);
    }
    .dd__option {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0 var(--mf-s2);
      align-items: start;
      padding: var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .dd__option:has(input:checked) {
      border-color: var(--mf-focus);
      background: var(--mf-selected-bg);
    }
    .dd__option input {
      margin-top: 3px;
    }
    .dd__label {
      font-weight: 600;
    }
    .dd__hint,
    .dd__why {
      grid-column: 2;
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .dd__field {
      display: grid;
      gap: var(--mf-s1);
    }
    .dd__field textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 4.5rem;
      resize: vertical;
    }
    .dd__count {
      justify-self: end;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .dd__impact {
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius);
      background: var(--mf-warning-bg);
      color: var(--mf-warning-fg);
      font-weight: 600;
    }
    .dd__summary {
      margin: 0;
      font-weight: 600;
    }
    .dd__list {
      margin: 0;
      padding-left: var(--mf-s5);
      overflow-wrap: anywhere;
    }
    .dd__subject {
      margin: 0;
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <mf-confirm-dialog
      [title]="phase() === 'result' ? 'Result' : 'Change disposition'"
      [confirmLabel]="confirmLabel()"
      [cancelLabel]="phase() === 'result' ? 'Close' : 'Cancel'"
      [showConfirm]="phase() === 'form'"
      [busy]="busy()"
      [error]="error()"
      scrollLabel="Change disposition"
      [(visible)]="visible"
      (confirmed)="run()"
    >
      <div class="dd" data-disposition-dialog>
        @if (phase() === 'form') {
          <p class="dd__subject" data-disposition-subject>{{ subject() }}</p>
          <fieldset class="dd__group">
            <legend class="dd__legend">Disposition</legend>
            @for (d of options(); track d.code) {
              <label class="dd__option" [attr.data-option]="d.code">
                <input
                  type="radio"
                  name="asset-disposition"
                  [value]="d.code"
                  [checked]="choice() === d.code"
                  [disabled]="d.why !== null"
                  (change)="pick(d.code)"
                />
                <span class="dd__label"
                  >{{ d.label }}
                  @if (d.current) {
                    (current)
                  }
                </span>
                <span class="dd__hint">{{ d.hint }}</span>
                @if (d.why) {
                  <span class="dd__why" data-option-why>{{ d.why }}</span>
                }
              </label>
            }
          </fieldset>
          @if (impact(); as line) {
            <p class="dd__impact" role="note" data-disposition-impact>{{ line }}</p>
          }
          <div class="dd__field">
            <label for="disposition-note" class="dd__label"
              >Note
              @if (needsNote()) {
                <span data-note-required>(required)</span>
              } @else {
                <span>(optional)</span>
              }
            </label>
            <textarea
              id="disposition-note"
              class="mf-control"
              rows="3"
              [maxLength]="noteMax"
              [value]="note()"
              [attr.aria-required]="needsNote()"
              (input)="note.set($any($event.target).value)"
            ></textarea>
            <span class="dd__count" aria-hidden="true">{{ note().length }} / {{ noteMax }}</span>
          </div>
        } @else {
          <p class="dd__summary" role="status" data-disposition-summary>{{ summary() }}</p>
          @if (notChanged().length > 0) {
            <div data-disposition-failed>
              <p class="dd__label">Not changed:</p>
              <ul class="dd__list">
                @for (f of notChanged(); track f.assetId) {
                  <li data-disposition-failed-row>{{ name(f.assetId) }}: {{ reason(f) }}</li>
                }
              </ul>
            </div>
          }
        }
      </div>
    </mf-confirm-dialog>
  `,
})
export class AssetDispositionDialog {
  readonly targets = input.required<readonly DispositionTarget[]>();
  readonly canEdit = input(false);
  readonly canDispose = input(false);
  readonly visible = model(false);
  /** Fires after a change was made (the page reloads or updates what it shows). */
  readonly finished = output<DispositionOutcome>();

  private readonly api = inject(AssetsClient);

  protected readonly noteMax = NOTE_MAX;
  protected readonly phase = signal<'form' | 'result'>('form');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly choice = signal<DispositionCode | null>(null);
  protected readonly note = signal('');
  protected readonly bulk = signal<BulkAssetDispositionResponse | null>(null);

  protected readonly single = computed(() =>
    this.targets().length === 1 ? this.targets()[0] : null,
  );
  /** The state the single asset is in; for several assets there is none (every option is open, the server checks each). */
  private readonly from = computed<DispositionCode | null>(() => this.single()?.code ?? null);

  protected readonly subject = computed(() => {
    const one = this.single();
    return one ? one.name : `${this.targets().length} selected assets`;
  });

  protected readonly options = computed(() =>
    DISPOSITIONS.map((d) => ({
      ...d,
      current: this.from() === d.code,
      why:
        this.from() === d.code
          ? 'It is already in this state.'
          : this.from() === null
            ? this.bulkWhy(d.code)
            : whyNot(this.from()!, d.code, this.canEdit(), this.canDispose()),
    })),
  );

  protected readonly needsNote = computed(() => {
    const to = this.choice();
    if (!to) return false;
    const from = this.from();
    return from === null ? to === 'DISPOSED' : noteRequired(from, to);
  });

  protected readonly impact = computed(() => {
    const to = this.choice();
    if (!to) return null;
    const one = this.single();
    return one
      ? impactLine(to, one.openLinkedTaskCount)
      : bulkImpactLine(
          to,
          this.targets().map((t) => t.openLinkedTaskCount),
        );
  });

  protected readonly confirmLabel = computed(() => {
    const n = this.targets().length;
    const to = this.choice();
    return n > 1
      ? `Change ${n} assets`
      : to
        ? `Set ${dispositionLabel(to).toLowerCase()}`
        : 'Change disposition';
  });

  protected readonly notChanged = computed(() => this.bulk()?.results.filter((r) => !r.ok) ?? []);
  protected readonly summary = computed(() => {
    const r = this.bulk();
    if (!r) return '';
    const parts = [`${r.changed} changed`];
    if (r.unchanged > 0) parts.push(`${r.unchanged} already there`);
    if (r.failed > 0) parts.push(`${r.failed} could not be changed`);
    return parts.join(', ') + '.';
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.phase.set('form');
        this.busy.set(false);
        this.error.set('');
        this.choice.set(null);
        this.note.set('');
        this.bulk.set(null);
      });
    });
  }

  /** For a selection: an option is open when the person holds the permission it needs; each asset is still checked by the server. */
  private bulkWhy(to: DispositionCode): string | null {
    if (to === 'PENDING_DISPOSITION' || to === 'DISPOSED')
      return this.canDispose() ? null : 'This needs the permission to dispose assets.';
    return this.canEdit() ? null : 'This needs the permission to edit assets.';
  }

  protected pick(code: DispositionCode): void {
    this.choice.set(code);
    this.error.set('');
  }

  protected name(assetId: number): string {
    return this.targets().find((t) => t.assetId === assetId)?.name ?? `Asset ${assetId}`;
  }

  protected reason(r: { code?: string | undefined; message?: string | undefined }): string {
    return bulkReason(r.code, r.message);
  }

  protected async run(): Promise<void> {
    if (this.busy()) return;
    const to = this.choice();
    if (!to) {
      this.error.set('Choose a disposition.');
      return;
    }
    const note = this.note().trim();
    if (this.needsNote() && !note) {
      this.error.set('Say why: a note is required for this change.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const one = this.single();
      if (one) {
        const asset = await firstValueFrom(
          this.api.changeAssetDisposition(one.assetId, {
            dispositionCode: to,
            note: note || undefined,
            rowVersion: one.rowVersion,
          }),
        );
        this.visible.set(false);
        this.finished.emit({ asset });
      } else {
        const answer = await firstValueFrom(
          this.api.bulkChangeAssetDisposition({
            assetIds: this.targets().map((t) => t.assetId),
            dispositionCode: to,
            note: note || undefined,
          }),
        );
        this.bulk.set(answer);
        this.phase.set('result');
        this.finished.emit({ bulk: answer });
      }
    } catch (e) {
      this.error.set(
        e instanceof Error && e.message
          ? e.message
          : 'Could not change the disposition. Try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
