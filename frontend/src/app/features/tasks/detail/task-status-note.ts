import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { TaskResponse } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { formatInstant, formatStatusStamp } from '../../../core/time/time';
import { htmlToPlainText } from '../panels/rich-text';
import { MATTER_INACTIVE_TEXT } from '../../../shared/work-queue/inline-edit';
import { TaskDetailStore } from './task-detail.store';

/** The three states that have a note: the icon (all neutral: grey, never amber) and the words before the date. */
const STATES: Readonly<Record<string, { icon: string; lead: string; label: string }>> = {
  COMPLETED: { icon: 'pi-check-circle', lead: 'Completed', label: 'Completed' },
  CANCELLED: { icon: 'pi-times-circle', lead: 'Cancelled', label: 'Cancelled' },
  ON_HOLD: { icon: 'pi-pause', lead: 'On hold since', label: 'On hold' },
};

/** What the note says, as data: the words that go before the reason, and the reason as plain text. Pure, so it is unit tested in two zones. */
export function statusNoteOf(
  task: TaskResponse,
  zone: string,
  now: Date,
): {
  icon: string;
  label: string;
  lead: string;
  reason: string;
  reasonName: string;
  tooltip: string;
} | null {
  const state = STATES[task.status];
  if (!state) return null;
  // Completed names the completion moment; Cancelled and On Hold the moment the status changed.
  const at = (task.status === 'COMPLETED' ? task.completedAtUtc : null) ?? task.statusChangedAtUtc;
  const who = task.statusReason?.authorName || task.statusChangedBy?.displayName || '';
  const reason = task.status === 'COMPLETED' ? '' : htmlToPlainText(task.statusReason?.bodyHtml);
  const lead = [state.lead, at ? formatStatusStamp(at, zone, now) : '', who ? `by ${who}` : '']
    .filter(Boolean)
    .join(' ');
  const full = at ? formatInstant(at, zone) : '';
  // PM v2 (#877): the structured reason of a hold, beside the free comment.
  const reasonName = task.status === 'ON_HOLD' ? (task.onHoldReason?.name ?? '') : '';
  const tooltip = [
    full ? `${state.label} ${full}${who ? ` by ${who}` : ''}` : lead,
    reasonName ? `Because: ${reasonName}` : '',
    reason,
  ]
    .filter(Boolean)
    .join('\n');
  return { icon: state.icon, label: state.label, lead, reason, reasonName, tooltip };
}

/**
 * The one status note of the Task page (B1, B2, #301, #302): a Completed, Cancelled or On Hold task says who changed it, when, and (for On
 * Hold and Cancelled) why, in one neutral line under the header: `Cancelled Oct 18, 4:03 PM by KE\kekim: Duplicate of an earlier request`.
 * It replaces the closed banner, the reason banner and the two notices of the Workflow. It has no buttons: Reopen task and Resume are the header's
 * actions. A reason longer than two lines is cut with "Show more" (the whole reason is the tooltip and is in the Activity). The one extra
 * sentence is for a closed task in an inactive Matter, which cannot be reopened.
 */
@Component({
  selector: 'mf-task-status-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (note(); as n) {
      @let t = store.task()!;
      <div class="sn" role="note" data-status-note [attr.data-status]="t.status">
        <i class="pi sn__icon" [class]="n.icon" aria-hidden="true"></i>
        <p
          #text
          class="sn__text"
          [class.sn__text--clamped]="!expanded()"
          [attr.title]="n.tooltip"
          data-note-text
        >
          <strong data-note-lead>{{ n.lead }}</strong>
          @if (n.reasonName) {
            <span aria-hidden="true"> - </span><span class="mf-sr-only">. Because </span
            ><span class="sn__reasonname" data-note-reason-name>{{ n.reasonName }}</span>
          }
          @if (n.reason) {
            <span aria-hidden="true">: </span><span class="mf-sr-only">. Reason: </span
            ><span class="sn__reason" data-note-reason>{{ n.reason }}</span>
          }
          @if (matterBlocksReopen()) {
            <span class="sn__extra" data-matter-inactive>{{ inactiveText }}</span>
          }
        </p>
        @if (clampable()) {
          <button
            type="button"
            class="sn__more"
            data-note-more
            [attr.aria-expanded]="expanded()"
            (click)="expanded.set(!expanded())"
          >
            {{ expanded() ? 'Show less' : 'Show more' }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    /* Neutral on purpose (decision T: On Hold is grey): the surface, border and text tokens of a panel, no warning colours. */
    .sn {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      color: var(--mf-text);
      font-size: var(--mf-fs-md);
      line-height: 20px;
    }
    .sn__icon {
      flex: none;
      margin-top: 3px;
      color: var(--mf-text-muted);
    }
    .sn__text {
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
    }
    .sn__reason {
      white-space: pre-line;
    }
    .sn__text--clamped {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
    }
    .sn__extra {
      margin-left: var(--mf-s2);
      color: var(--mf-text-muted);
    }
    .sn__more {
      flex: none;
      min-height: var(--mf-target-min, 2rem);
      margin: -4px 0;
      padding: 0 var(--mf-s2);
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    @media (forced-colors: active) {
      .sn {
        border-color: CanvasText;
      }
    }
  `,
})
export class TaskStatusNote {
  protected readonly store = inject(TaskDetailStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly inactiveText = MATTER_INACTIVE_TEXT;

  protected readonly note = computed(() => {
    const t = this.store.task();
    return t ? statusNoteOf(t, this.zone, this.clock.now()) : null;
  });

  /** A closed task whose Matter is inactive: Reopen task is shown disabled in the header, and the note says why in words. */
  protected readonly matterBlocksReopen = computed(
    () =>
      this.store.closed() &&
      this.store
        .task()
        ?.allowedActions.transitions.some(
          (o) => o.action === 'REOPEN' && !o.permitted && o.blockedReason === 'MATTER_INACTIVE',
        ) === true,
  );

  /** Folded again whenever the words change (another Task, another status). */
  protected readonly expanded = linkedSignal({
    source: () => this.note()?.tooltip ?? '',
    computation: () => false,
  });
  /** True while the text is longer than its two lines (or is open): only then "Show more" is offered. */
  protected readonly clampable = signal(false);
  private readonly text = viewChild<ElementRef<HTMLElement>>('text');

  constructor() {
    effect((onCleanup) => {
      const el = this.text()?.nativeElement;
      this.note(); // the text changed: measure again and fold it
      if (!el) return;
      const measure = (): void => {
        if (!this.expanded()) this.clampable.set(el.scrollHeight > el.clientHeight + 1);
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });
  }
}
