import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const DAY_MS = 86_400_000;

/**
 * "On hold for 6 days because Waiting for client data" (PM v2, #877): the aging of a hold in whole calendar-agnostic days since the status
 * changed, with the structured reason when there is one. Null when nothing is known about the hold. Pure; `now` is injectable.
 */
export function holdSentence(
  row: { onHoldReasonName?: string | null; statusChangedAtUtc?: Date | string | null },
  now: number = Date.now(),
): string | null {
  const since = row.statusChangedAtUtc ? new Date(row.statusChangedAtUtc).getTime() : NaN;
  const reason = row.onHoldReasonName?.trim();
  if (Number.isNaN(since)) return reason ? `On hold because ${reason}` : null;
  const days = Math.max(0, Math.floor((now - since) / DAY_MS));
  const aging =
    days === 0 ? 'On hold since today' : `On hold for ${days} ${days === 1 ? 'day' : 'days'}`;
  return reason ? `${aging} because ${reason}` : aging;
}

/** The text of the tooltip: the aging sentence with the structured reason, then the whole comment, with "..." when the server cut it at 200 characters (M12.2, #165). */
export function holdTitle(
  row: {
    status?: string;
    holdReason?: string | null;
    holdReasonTruncated?: boolean;
    onHoldReasonName?: string | null;
    statusChangedAtUtc?: Date | string | null;
  },
  now: number = Date.now(),
) {
  if ((row.status ?? 'ON_HOLD') !== 'ON_HOLD') return null;
  const comment = row.holdReason ? row.holdReason + (row.holdReasonTruncated ? '...' : '') : null;
  const sentence = holdSentence(row, now);
  return [sentence, comment].filter(Boolean).join('\n') || null;
}

/**
 * What an On Hold row says about the hold (#165, #182), one component for the three places it shows:
 * `mark` is the pause icon at the start of the Ref cell ("On hold" for assistive technology); `reason` is the muted one-line reason under
 * the Status pill (hidden visually in Compact density, but still read out: the tooltip carries it); `chip` is the reason's own line on a
 * phone card (pause icon and the reason; the "Waiting: ..." line under the title is gone since the cards, #192).
 */
@Component({
  selector: 'mf-hold-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-kind]': 'kind()', '[class.quiet]': 'quiet()' },
  template: `
    @switch (kind()) {
      @case ('mark') {
        <i
          class="pi pi-pause"
          role="img"
          aria-label="On hold"
          [attr.title]="title()"
          data-hold-mark
        ></i>
      }
      @case ('chip') {
        <span class="line" data-hold-chip [attr.title]="title()"
          ><i class="pi pi-pause" aria-hidden="true"></i>
          @if (!reasonName()) {
            <span class="mf-sr-only">On hold: </span>
          }
          {{ chipText() }}</span
        >
      }
      @default {
        <span class="line" data-hold-reason [attr.title]="title()">{{ reason() }}</span>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    :host([data-kind='mark']) {
      display: inline-block;
      margin-right: var(--mf-s1);
      color: var(--mf-text-muted);
    }
    .pi {
      font-size: var(--mf-fs-xs);
    }
    .line {
      display: block;
      max-width: 22ch;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      /* 26 px pill + 13 px line + padding keep the On Hold row at 44 px (#210). */
      line-height: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    :host([data-kind='chip']) .line {
      max-width: none;
      line-height: 18px;
    }
    :host([data-kind='chip']) .pi {
      margin-right: var(--mf-s1);
    }
    :host(.quiet) .line {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    @media (forced-colors: active) {
      .line,
      :host([data-kind='mark']) {
        color: CanvasText;
      }
    }
  `,
})
export class HoldNote {
  readonly kind = input<'mark' | 'reason' | 'chip'>('reason');
  readonly holdReason = input<string | null | undefined>(null);
  readonly truncated = input(false);
  /** PM v2 (#877): the structured reason (preferred over the comment in the one-line text) and the instant the status changed (aging). */
  readonly reasonName = input<string | null | undefined>(null);
  readonly since = input<Date | string | null | undefined>(null);
  /** Compact density: the line is not drawn, only the tooltip and the accessible text stay. */
  readonly quiet = input(false);

  protected readonly reason = computed(() => this.reasonName() || this.holdReason() || '');
  /** The phone card's line: the whole aging sentence ("On hold for 6 days because ..."), else the reason. */
  protected readonly sentence = computed(() =>
    holdSentence({ onHoldReasonName: this.reasonName(), statusChangedAtUtc: this.since() }),
  );
  protected readonly chipText = computed(
    () => (this.reasonName() && this.sentence()) || this.reason(),
  );
  protected readonly title = computed(() =>
    holdTitle({
      holdReason: this.holdReason(),
      holdReasonTruncated: this.truncated(),
      onHoldReasonName: this.reasonName(),
      statusChangedAtUtc: this.since(),
    }),
  );
}
