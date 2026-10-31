import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface EventTypeDef {
  /** The API code (`COURT_HEARING`, ...). */
  code: string;
  /** The token suffix: `--mf-event-<colourKey>` is the colour, `--mf-event-<colourKey>-bg` its tint. */
  colourKey: string;
  name: string;
  /** SVG path data (24 x 24, stroked) of the fixed icon of the type. */
  paths: readonly string[];
}

/** The eight matter event types with their fixed icons (owner decision; the colours are the `--mf-event-<colourKey>` and `-bg` tokens). */
export const EVENT_TYPES: readonly EventTypeDef[] = [
  {
    code: 'COURT_HEARING',
    colourKey: 'court',
    name: 'Court hearing',
    paths: ['M3 9 12 4l9 5z', 'M5.5 11v6M10 11v6M14 11v6M18.5 11v6M3 20h18M4 17h16'],
  },
  {
    code: 'TRIAL',
    colourKey: 'trial',
    name: 'Trial',
    paths: [
      'M12 3v17M7 20.5h10M4 7h16',
      'M6 7l-3 7a3.2 3.2 0 0 0 6 0zM18 7l-3 7a3.2 3.2 0 0 0 6 0z',
    ],
  },
  {
    code: 'DEPOSITION',
    colourKey: 'deposition',
    name: 'Deposition',
    paths: ['M9 3h6v11H9z', 'M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7'],
  },
  {
    code: 'PRODUCTION_DEADLINE',
    colourKey: 'production',
    name: 'Production deadline',
    paths: ['M3 7l9-4 9 4v10l-9 4-9-4z', 'M3 7l9 4 9-4M12 11v10'],
  },
  {
    code: 'FILING_DEADLINE',
    colourKey: 'filing',
    name: 'Filing deadline',
    paths: [
      'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
      'M14 3v5h5M9 13h6M9 17h4',
    ],
  },
  {
    code: 'MEDIATION',
    colourKey: 'mediation',
    name: 'Mediation or settlement',
    paths: ['M3 6l7 6-7 6M21 6l-7 6 7 6'],
  },
  {
    code: 'CLIENT_MEETING',
    colourKey: 'meeting',
    name: 'Client meeting or call',
    paths: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z'],
  },
  {
    code: 'OTHER',
    colourKey: 'other',
    name: 'Other',
    paths: [
      'M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z',
      'M12 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    ],
  },
];

export function eventType(id: string | null | undefined): EventTypeDef {
  return EVENT_TYPES.find((t) => t.code === id) ?? EVENT_TYPES[EVENT_TYPES.length - 1];
}

/**
 * The icon of an event type in its colour pair (`mf-event-icon`, epic #953 UI-10). With `chip` the name is written next to it (always the word with the icon in a list);
 * alone it is decorative (`aria-hidden`) and the page writes the name. An overdue event adds the warning icon in `warn` mode.
 */
@Component({
  selector: 'mf-event-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="e" [attr.data-type]="def().colourKey" [class.chip]="chip()" [class.lg]="large()">
      <svg
        viewBox="0 0 24 24"
        [attr.width]="large() ? 24 : 16"
        [attr.height]="large() ? 24 : 16"
        aria-hidden="true"
        focusable="false"
      >
        @for (p of def().paths; track p) {
          <path [attr.d]="p" />
        }
      </svg>
      @if (chip()) {
        <span class="t">{{ def().name }}</span>
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .e {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-width: 0;
      color: var(--e-fg);
      background: var(--e-bg);
      border-radius: var(--mf-radius-lg);
      padding: var(--mf-s1);
    }
    .e.lg {
      padding: var(--mf-s2);
      border-radius: var(--mf-radius-xl);
    }
    .e.chip {
      padding: 2px var(--mf-s2) 2px var(--mf-s1);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    svg {
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .t {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .e[data-type='court'] {
      --e-fg: var(--mf-event-court-fg);
      --e-bg: var(--mf-event-court-bg);
    }
    .e[data-type='trial'] {
      --e-fg: var(--mf-event-trial-fg);
      --e-bg: var(--mf-event-trial-bg);
    }
    .e[data-type='deposition'] {
      --e-fg: var(--mf-event-deposition-fg);
      --e-bg: var(--mf-event-deposition-bg);
    }
    .e[data-type='production'] {
      --e-fg: var(--mf-event-production-fg);
      --e-bg: var(--mf-event-production-bg);
    }
    .e[data-type='filing'] {
      --e-fg: var(--mf-event-filing-fg);
      --e-bg: var(--mf-event-filing-bg);
    }
    .e[data-type='mediation'] {
      --e-fg: var(--mf-event-mediation-fg);
      --e-bg: var(--mf-event-mediation-bg);
    }
    .e[data-type='meeting'] {
      --e-fg: var(--mf-event-meeting-fg);
      --e-bg: var(--mf-event-meeting-bg);
    }
    .e[data-type='other'] {
      --e-fg: var(--mf-event-other-fg);
      --e-bg: var(--mf-event-other-bg);
    }
  `,
})
export class EventIcon {
  readonly type = input.required<string | null | undefined>();
  readonly chip = input(false);
  /** A 40 px chip with a 24 px glyph (the type tiles of the calendar item dialog). */
  readonly large = input(false);
  protected readonly def = computed(() => eventType(this.type()));
}
