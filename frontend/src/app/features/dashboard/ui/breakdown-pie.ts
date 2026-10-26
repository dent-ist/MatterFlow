import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PieChart } from '../../../shared/charts/pie-chart';
import { ChartSlice } from '../../../shared/charts/chart-types';
import { queueParams } from '../dashboard-links';
import { overdueParams } from './breakdown-overdue';
import { PieSlice } from './breakdown-slices';

/**
 * The pie view of a Breakdowns card: the shared pie (hand-written SVG, no chart library; loaded only when someone asks for the pie) with the Task Queue
 * links of the dashboard. A slice and its legend row open the queue filtered like the bar, and the overdue part of a slice opens the same list with
 * `overdue=true`, so the counts and the lists always agree.
 */
@Component({
  selector: 'mf-breakdown-pie',
  imports: [PieChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-pie-chart
      [heading]="heading()"
      [slices]="chartSlices()"
      [emptyText]="emptyText()"
      [unit]="unit()"
      secondaryLabel="overdue"
    />
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class BreakdownPie {
  readonly heading = input.required<string>();
  readonly slices = input.required<readonly PieSlice[]>();
  readonly emptyText = input('Nothing to show.');
  readonly unit = input('tasks');

  protected readonly chartSlices = computed<ChartSlice[]>(() =>
    this.slices().map((s) => {
      const od = overdueParams(s.query);
      return {
        label: s.label,
        count: s.count,
        overdue: s.overdue,
        link: s.query ? { commands: ['/tasks'], queryParams: queueParams(s.query) } : null,
        overdueLink: od ? { commands: ['/tasks'], queryParams: od } : null,
        fill: s.fill,
        outline: s.outline,
        dashed: s.dashed,
      };
    }),
  );
}
