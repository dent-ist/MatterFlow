import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { DashboardBreakdownItem, DashboardSummary } from '../../../api/generated/api-client';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { priorityColors } from '../../../shared/ui/priority-badge';
import { BarItem, BarList } from './bar-list';
import { PointerFocus } from './pointer-focus';
import { OVERDUE_CSS, strokeFor } from './breakdown-overdue';
import { Segment, StackedBar } from './stacked-bar';

/** Glossary: sentence case ("No pod", "Other pods"); the API still sends some Title Case labels. */
function sentence(label: string): string {
  if (label === 'No Pod') return 'No pod';
  if (label === 'Other Pods') return 'Other pods';
  if (label === 'Other Task Types') return 'Other task types';
  return label;
}

/** Bars of a breakdown: the count, the overdue part of it and the Task Queue query of the row. */
export function toBars(items: readonly DashboardBreakdownItem[]): BarItem[] {
  return items.map((i) => ({
    label: sentence(i.label),
    count: i.count,
    overdue: i.overdue ?? 0,
    query: i.query ?? null,
    tone: i.code ?? null,
    muted: i.isOther,
    iconKey: i.iconKey ?? null,
  }));
}

/**
 * The Breakdowns tab: open tasks by priority, task type and status, and their age (one card each, one title per card), every bar split
 * into not overdue and overdue. The unit and the scope of the numbers are said once in the caption; the region has a visually hidden
 * H2 so the outline stays Breakdowns > Open tasks > Priority / Status / Task type / Age. The cards sit in a grid chosen by the width
 * of the tab (container query): from 1300 px three equal columns (Priority above Status on the left, the Task type card in the middle
 * at the full height of the tab, where its list scrolls inside the card under a pinned title because it grows with every new task type,
 * and Age on the right), two columns (masonry-like, no card is stretched) from 700 px, else one. The DOM and tab order never change
 * with the width: Priority, Status, Task type, Age (the reading order of the three columns). Each card can show a table, bars or a
 * pie; the choice is remembered per card and per user.
 */
@Component({
  selector: 'mf-dash-breakdowns',
  imports: [BarList, StackedBar, ScrollArea, PointerFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <section class="bd mf-fill" aria-labelledby="mf-bd-h" data-section="breakdowns">
      <h2 id="mf-bd-h" class="sr-only" tabindex="-1" data-skip-target>Open tasks</h2>
      <p class="caption" data-bd-caption>
        Open tasks, now. Not affected by the period.
        <span class="legend" data-bd-legend>
          <span class="key"><span class="sample plain" aria-hidden="true"></span>Not overdue</span>
          <span class="key"><span class="sample od" aria-hidden="true"></span>Overdue</span>
        </span>
      </p>
      <div class="scroll" mfScrollArea="Open task breakdowns" mfPointerFocus data-bd-scroll>
        <div class="grid" data-grid="breakdowns">
          <mf-bar-list
            class="c-priority"
            cardKey="priority"
            heading="Priority"
            rowHeading="Priority"
            [items]="priorities()"
            emptyText="No open tasks."
          />
          <mf-bar-list
            class="c-status"
            cardKey="status"
            heading="Status"
            rowHeading="Status"
            [items]="statuses()"
            emptyText="No open tasks."
          />
          <mf-bar-list
            class="c-type"
            cardKey="task-type"
            heading="Task type"
            rowHeading="Task type"
            [items]="types()"
            emptyText="No open tasks."
          />
          <mf-stacked-bar
            class="c-age"
            cardKey="age"
            heading="Age"
            rowHeading="Age"
            [segments]="aging()"
            emptyText="No open tasks."
            note="Days since the task was created. Informational, not a service-level target."
          />
        </div>
      </div>
    </section>
  `,
  styles: [
    OVERDUE_CSS,
    `
      :host {
        display: block;
        container-type: inline-size;
        margin-bottom: var(--mf-s5);
      }
      :host(.mf-fill) {
        margin-bottom: 0;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      h2:focus {
        outline: none;
      }
      .caption {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--mf-s1) var(--mf-s4);
        margin: 0 0 var(--mf-s3);
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .legend {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--mf-s1) var(--mf-s4);
      }
      .key {
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s2);
        color: var(--mf-text);
      }
      .sample {
        display: inline-block;
        width: 1.25rem;
        height: 0.625rem;
        border-radius: 2px;
      }
      .sample.plain {
        background: var(--mf-primary);
      }
      @media (forced-colors: active) {
        .sample.plain {
          forced-color-adjust: none;
          background: Highlight;
          border: 1px solid CanvasText;
        }
      }
      /* The cards scroll as one region when the tab is shorter than they are. A press with the pointer shows no focus ring on it. */
      .scroll {
        display: flex;
        flex-direction: column;
      }
      /* One column below 700 px; cards keep their own height (nothing is stretched). */
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--mf-s4);
        align-items: start;
      }
      /* Two columns flow top to bottom (Priority and Status, then Task type and Age) without empty space inside or between the cards. */
      @container (min-width: 700px) {
        .grid {
          display: block;
          column-count: 2;
          column-gap: var(--mf-s4);
        }
        .grid > * {
          break-inside: avoid;
          margin-bottom: var(--mf-s4);
        }
      }
      /* Three equal columns from 1300 px of tab width (the tab keeps its 1360 px reading cap): Priority above Status, Task type, Age. */
      @container (min-width: 1300px) {
        .grid {
          display: grid;
          column-count: auto;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          grid-template-rows: auto minmax(min-content, 1fr);
          gap: var(--mf-s4);
          align-items: start;
        }
        .grid > * {
          margin-bottom: 0;
        }
        .c-priority {
          grid-column: 1;
          grid-row: 1;
        }
        .c-status {
          grid-column: 1;
          grid-row: 2;
        }
        .c-type {
          grid-column: 2;
          grid-row: 1 / span 2;
        }
        /* Spans both rows so its height does not decide the height of the Priority row. */
        .c-age {
          grid-column: 3;
          grid-row: 1 / span 2;
        }
      }
      /* In a fixed page the grid fills the tab and the Task type card takes its full height: its list scrolls inside the card, the title
         and the caption stay. Shorter than 30rem of room, the whole region scrolls instead. */
      @media (min-width: 768px) and (min-height: 561px) {
        @container (min-width: 1300px) {
          .bd > .scroll {
            flex: 1 1 0;
            min-height: 0;
          }
          .grid {
            flex: 1 1 0;
            min-height: 30rem;
          }
          /* Its height comes from the grid (the whole tab), never from its own rows: size containment keeps the long list from
             stretching the rows of Priority and Status. */
          .c-type {
            align-self: stretch;
            min-height: 0;
            contain: size;
          }
        }
      }
    `,
  ],
})
export class DashBreakdownsTab {
  private readonly lookups = inject(LookupStore);

  /** The shared dashboard summary (null while it is not loaded). */
  readonly summary = input<DashboardSummary | null>(null);

  protected readonly types = computed(() => toBars(this.summary()?.byTaskType ?? []));
  protected readonly statuses = computed(() => toBars(this.summary()?.byStatus ?? []));
  /** In priority order (most urgent first, as the API sends them), coloured like the priority badges; Low is drawn dotted and lighter than Normal. */
  protected readonly priorities = computed<BarItem[]>(() => {
    const store = this.lookups.priorities();
    return (this.summary()?.byPriority ?? []).map((i) => {
      const found = store.find((p) => p.id === i.id);
      const colors = priorityColors(found?.color);
      return {
        label: i.label,
        count: i.count,
        overdue: i.overdue ?? 0,
        query: i.query ?? null,
        fill: colors.bg,
        outline: colors.fg,
        stroke: strokeFor(found?.color),
      };
    });
  });
  protected readonly aging = computed<Segment[]>(() =>
    (this.summary()?.aging ?? []).map((b) => ({
      label: b.label,
      count: b.count,
      query: b.query,
      overdue: b.overdue ?? 0,
    })),
  );
}
