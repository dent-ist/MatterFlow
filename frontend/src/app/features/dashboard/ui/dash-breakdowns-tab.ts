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
    typeId: i.id ?? null,
    tile: statusTile(i.code),
  }));
}

/** The icon tile of a status row: the status badge colours (tokens), so the tile matches the badges of the task lists. */
function statusTile(code: string | null | undefined): BarItem['tile'] {
  switch (code) {
    case 'NEW':
      return {
        icon: 'pi-plus-circle',
        bg: 'var(--mf-status-new-bg)',
        fg: 'var(--mf-status-new-fg)',
      };
    case 'IN_PROGRESS':
      return {
        icon: 'pi-play-circle',
        bg: 'var(--mf-status-progress-bg)',
        fg: 'var(--mf-status-progress-fg)',
      };
    case 'ON_HOLD':
      return {
        icon: 'pi-pause-circle',
        bg: 'var(--mf-status-hold-bg)',
        fg: 'var(--mf-status-hold-fg)',
      };
    default:
      return null;
  }
}

const PRIORITY_ICONS: Record<string, string> = {
  critical: 'pi-exclamation-triangle',
  high: 'pi-arrow-up',
  normal: 'pi-minus',
  low: 'pi-arrow-down',
};

/**
 * The Breakdowns tab: open tasks by priority, task type and status, and their age (one card each, one title per card), every bar split
 * into not overdue and overdue. The unit and the scope of the numbers are said once in the caption; the region has a visually hidden
 * H2 so the outline stays Breakdowns > Open tasks > Priority / Status / Task type / Age. The cards sit in a grid chosen by the width
 * of the tab (container query): from 1300 px three equal columns (Priority above Status on the left, the Task type card in the middle
 * as tall as its list but never taller than the visible tab, where its list scrolls inside the card under a pinned title because it grows with every new task type,
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
      <h2 id="mf-bd-h" class="sr-only" tabindex="-1" data-skip-target>Open Tasks</h2>
      <p class="caption" data-bd-caption>
        <span class="info"
          ><i class="pi pi-info-circle" aria-hidden="true"></i>Open tasks, now. Not affected by the
          period. Age is the days since a task was created: informational, not a service-level
          target.</span
        >
        <span class="legend" data-bd-legend>
          <span class="key"><span class="sample plain" aria-hidden="true"></span>Not Overdue</span>
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
            heading="Task Type"
            rowHeading="Task Type"
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
        container: bd / inline-size;
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
      /* One compact info row: the unit and the scope said once, and the legend, in a soft band. */
      .caption {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--mf-s1) var(--mf-s4);
        margin: 0 0 var(--mf-s3);
        padding: var(--mf-s2) var(--mf-s3);
        background: var(--mf-surface-alt);
        border: 1px solid var(--mf-border-soft);
        border-radius: var(--mf-radius-lg);
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .info {
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s2);
      }
      .legend {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--mf-s1) var(--mf-s4);
        margin-left: auto;
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
        border-radius: var(--mf-radius);
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
      .scroll {
        display: flex;
        flex-direction: column;
      }
      /* One column below 700 px: the cards keep their own height and the page scrolls (a phone). */
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--mf-s4);
        padding: 2px;
      }
      /* From 700 px of tab width: Priority and Status above, Task Type and Age below; all four cards equal height per row. */
      @container bd (min-width: 700px) {
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      /* From 1000 px: Priority, Status and Age side by side, and the Task Type card under them across the whole width. */
      @container bd (min-width: 1000px) {
        .grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .c-priority {
          grid-column: 1;
          grid-row: 1;
        }
        .c-status {
          grid-column: 2;
          grid-row: 1;
        }
        .c-age {
          grid-column: 3;
          grid-row: 1;
        }
        .c-type {
          grid-column: 1 / -1;
          grid-row: 2;
        }
      }
      /* In a fixed page (desktop) the cards fill the tab: the top row takes the height of its cards, the Task Type card takes the rest
         (at least 12rem) and its list scrolls inside it under the pinned title; shorter than that, the whole region scrolls. */
      @media (min-width: 768px) and (min-height: 561px) {
        /* Under 700 px of tab width the cards stack at their own height and the tab scrolls; from 700 px they fill it. */
        @container bd (min-width: 700px) {
          .bd > .scroll {
            flex: 1 1 0;
            min-height: 0;
          }
          .grid {
            flex: 1 1 auto;
            min-height: 0;
            grid-template-rows: auto minmax(24rem, 1fr);
          }
          .c-type {
            min-height: 0;
          }
        }
        @container bd (min-width: 1000px) {
          .grid {
            grid-template-rows: auto minmax(12rem, 1fr);
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
        tile: {
          icon: PRIORITY_ICONS[found?.color ?? ''] ?? 'pi-flag',
          bg: colors.bg,
          fg: colors.fg,
        },
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
