import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The text of the tooltip: the whole reason, with "..." when the server cut it at 200 characters (M12.2, #165). */
export function holdTitle(row: {
  status?: string;
  holdReason?: string | null;
  holdReasonTruncated?: boolean;
}) {
  return row.holdReason && (row.status ?? 'ON_HOLD') === 'ON_HOLD'
    ? row.holdReason + (row.holdReasonTruncated ? '...' : '')
    : null;
}

/**
 * What an On Hold row says about the hold (#165, #182), one component for the three places it shows:
 * `mark` is the pause icon at the start of the Ref cell ("On hold" for assistive technology); `reason` is the muted one-line reason under
 * the Status pill (hidden visually in Compact density and on phones, but still read out: the tooltip carries it); `hint` is the
 * "Waiting: reason" line under the title that stands in for it on a phone, where the Status column is scrolled away.
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
      @case ('hint') {
        <span class="line" data-hold-hint [attr.title]="title()">Waiting: {{ reason() }}</span>
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
    :host([data-kind='hint']) .line {
      max-width: none;
    }
    :host([data-kind='hint']) {
      display: none;
    }
    :host(.quiet) .line {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    @media (max-width: 480px) {
      :host([data-kind='hint']) {
        display: block;
      }
      :host([data-kind='reason']) .line {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
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
  readonly kind = input<'mark' | 'reason' | 'hint'>('reason');
  readonly holdReason = input<string | null | undefined>(null);
  readonly truncated = input(false);
  /** Compact density: the line is not drawn, only the tooltip and the accessible text stay. */
  readonly quiet = input(false);

  protected readonly reason = computed(() => this.holdReason() ?? '');
  protected readonly title = computed(() =>
    holdTitle({ holdReason: this.holdReason(), holdReasonTruncated: this.truncated() }),
  );
}
