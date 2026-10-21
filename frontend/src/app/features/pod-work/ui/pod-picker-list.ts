import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PodChoice } from '../../../api/generated/api-client';

/** "23 members": the count with its noun, singular for one. */
export function memberCountText(count: number): string {
  return `${count} ${count === 1 ? 'member' : 'members'}`;
}

/**
 * The facts of one pod in a list row (W3, #558): "23 members . 4 unassigned" and, only while it is above zero, ". 2 overdue". They are
 * information about the work, never a ranking: no colour, no order by load.
 */
export function podFacts(pod: Pick<PodChoice, 'memberCount' | 'unassignedCount' | 'overdueCount'>) {
  const parts = [memberCountText(pod.memberCount), `${pod.unassignedCount} unassigned`];
  if (pod.overdueCount > 0) parts.push(`${pod.overdueCount} overdue`);
  return parts.join(' · ');
}

/** The pods in two groups, "Your pods" first, each alphabetical (the order of the list is never the load). */
export function groupPods(pods: readonly PodChoice[]): { label: string; pods: PodChoice[] }[] {
  const byName = (a: PodChoice, b: PodChoice) => a.name.localeCompare(b.name);
  const groups = [
    { label: 'Your pods', pods: pods.filter((p) => p.isMember).sort(byName) },
    { label: 'Other pods', pods: pods.filter((p) => !p.isMember).sort(byName) },
  ];
  return groups.filter((g) => g.pods.length > 0);
}

/**
 * Pod Work with no pod chosen (W3, #558): the pods as a list of buttons, "Your pods" then "Other pods", alphabetical inside each group,
 * each row with its member, unassigned and (above zero) overdue counts. Choosing one reports its id; the page sets `podId` and moves
 * focus to the title. There is no "All pods" view and no default pod. Reusable for any "choose a pod" surface.
 */
@Component({
  selector: 'mf-pod-picker-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pp" aria-label="Pods" data-pod-list>
      @for (group of groups(); track group.label; let i = $index) {
        <div class="pp__group" role="group" [attr.aria-labelledby]="'pp-group-' + i">
          <h2 class="pp__heading" [id]="'pp-group-' + i">{{ group.label }}</h2>
          @for (pod of group.pods; track pod.podId) {
            <button
              type="button"
              class="pp__row"
              [attr.data-pod]="pod.podId"
              (click)="chosen.emit(pod.podId)"
            >
              <span class="pp__name">{{ pod.name }}{{ pod.isPrimary ? ' (primary)' : '' }}</span
              >{{ ' ' }}<span class="pp__facts">{{ facts(pod) }}</span>
            </button>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .pp {
      display: grid;
      gap: var(--mf-s4);
      max-width: 40rem;
      padding: var(--mf-s2) 0;
    }
    .pp__group {
      display: grid;
      gap: var(--mf-s1);
    }
    .pp__heading {
      margin: 0 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .pp__row {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      min-height: 44px;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius, 4px);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .pp__row:hover {
      background: var(--mf-surface-2, var(--mf-border));
    }
    .pp__row:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .pp__name {
      min-width: 0;
      overflow-wrap: anywhere;
      font-weight: 600;
    }
    .pp__facts {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class PodPickerList {
  readonly pods = input.required<readonly PodChoice[]>();
  readonly chosen = output<number>();

  protected readonly groups = computed(() => groupPods(this.pods()));
  protected facts(pod: PodChoice): string {
    return podFacts(pod);
  }
}
