import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PodWorkSummary } from '../../../api/generated/api-client';
import { QueueFilters } from '../../../shared/work-queue/queue-filters';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';

/** The keys of the Pod Work strip, in order: My Work's vocabulary (K14, #561). */
export type PodStripKey = 'overdue' | 'dueToday' | 'asap' | 'onHold';

const ITEMS: readonly { key: PodStripKey; label: string; alert?: boolean }[] = [
  { key: 'overdue', label: 'Overdue', alert: true },
  { key: 'dueToday', label: 'Due today' },
  { key: 'asap', label: 'ASAP' },
  { key: 'onHold', label: 'On hold' },
];

/** The filter an item applies on the All open tab (the same filters as the matching My Work item). `today` is the calendar day (yyyy-mm-dd) in the viewer's zone. */
export function podStripPatch(key: PodStripKey, today: string): Partial<QueueFilters> {
  switch (key) {
    case 'overdue':
      return { overdue: true };
    case 'dueToday':
      return { dueFrom: today, dueTo: today, overdue: false };
    case 'asap':
      return { asap: true };
    case 'onHold':
      return { status: ['ON_HOLD'] };
  }
}

/** The filters with every strip item's own filter taken out (what another item, or a second click on the pressed one, starts from). */
export function withoutStripFilters(f: QueueFilters): QueueFilters {
  return {
    ...f,
    overdue: null,
    asap: null,
    dueFrom: null,
    dueTo: null,
    status: f.status.length === 1 && f.status[0] === 'ON_HOLD' ? [] : f.status,
  };
}

/** The strip item whose filter is on, so a second click can switch it off; null when the filters are no strip item's. */
export function activePodStripKey(f: QueueFilters, today: string): PodStripKey | null {
  const dueless = !f.dueFrom && !f.dueTo;
  if (
    f.status.length === 1 &&
    f.status[0] === 'ON_HOLD' &&
    f.overdue === null &&
    f.asap === null &&
    dueless
  )
    return 'onHold';
  if (f.overdue === true && f.asap === null && dueless) return 'overdue';
  if (f.asap === true && f.overdue === null && dueless) return 'asap';
  if (f.dueFrom === today && f.dueTo === today && f.overdue === false && f.asap === null)
    return 'dueToday';
  return null;
}

/**
 * The Pod Work summary strip (W5, #561; W11, #563): Overdue, Due today, ASAP and On hold, the pod's own counts (never narrowed by the grid's
 * filters) as toggles. Each applies its filter on the All open tab and a second click switches it off (the page decides, this reports the
 * key). One scrolling row of chips on a phone. Nothing here repeats a tab: the tabs say Unassigned, By member and All open.
 */
@Component({
  selector: 'mf-pod-work-strip',
  imports: [WorkStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-work-strip
      label="Pod summary"
      hint="All open tasks of the pod, not affected by the filters below"
      [items]="items()"
      [interactive]="true"
      [chipRow]="true"
      [active]="active()"
      (pick)="pick.emit($any($event))"
    />
  `,
})
export class PodWorkStrip {
  readonly summary = input<PodWorkSummary | null>(null);
  /** The pressed item. */
  readonly active = input<PodStripKey | null>(null);
  readonly pick = output<PodStripKey>();

  protected readonly items = computed<WorkStripItem[]>(() => {
    const s = this.summary();
    return ITEMS.map((item) => ({ ...item, count: s ? s[item.key] : null }));
  });
}
