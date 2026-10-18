import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { DRILL_SOURCES, listUrl, parseFrom } from '../../../shared/work-queue/drill';
import { TaskTransitionOption } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { MATTER_INACTIVE_TEXT } from '../../../shared/work-queue/inline-edit';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { RecordAction, RecordHeader } from '../../../shared/ui/record-header';
import { Crumb } from '../../../shared/ui/page-header';
import { TaskDetailStore } from './task-detail.store';
import { TaskFacts } from './task-facts';

/** Why a status action is shown but cannot be used (the server's `blockedReason`). */
function blockedText(action: string, reason: string | undefined): string {
  if (reason !== 'MATTER_INACTIVE')
    return "You can view this task but you don't have permission to do that.";
  return action === 'REOPEN'
    ? MATTER_INACTIVE_TEXT
    : action === 'COMPLETE'
      ? "The matter is inactive, so this task can't be completed."
      : "The matter is inactive, so this task can't be changed.";
}

/**
 * Task header (H1 to H3 and H6, #296 to #299): the shared record header (`mf-record-header`, as the Client, Matter and Project pages) with
 * the crumb `Tasks > matter > TSK-n` (the list the task was opened from, `?from=`, replaces `Tasks`; the matter only for people who may open
 * it), `TSK-n  title` as the page's `h1` at the H2 size (one line, two at most, the full title as tooltip), one muted context line (Matter,
 * Client, Task type, Workflow) and the Sensitive note; then the facts strip (`mf-task-facts`). Actions are data (`RecordAction`): Edit, Activity,
 * the primary Complete task (Reopen task on a closed task) and the overflow with Put on hold or Resume, Copy link and Cancel task (set
 * apart, last). Status, Priority and Assignee stay the inline menus of the facts strip. A user who can change nothing sees a "View only" line.
 */
@Component({
  selector: 'mf-task-header',
  imports: [RecordHeader, RouterLink, MatterRef, TaskTypeIcon, TaskFacts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @if (store.task(); as t) {
      <div class="th" data-task-header>
        <mf-record-header
          kind="task"
          [parents]="parents()"
          [current]="t.taskNumber"
          [ref]="t.taskNumber"
          [name]="t.title"
          [sensitive]="t.matter.isSensitive"
          [backTo]="backTo()"
          [actions]="actions()"
        >
          <mf-task-type-icon
            mfIcon
            class="th__icon"
            size="md"
            [iconKey]="t.taskType.iconKey"
            [attr.title]="t.taskType.name"
            data-title-icon
          />
          <span mfContext class="th__ctx" data-context [attr.title]="contextText()">
            <span data-matter
              >Matter
              <mf-matter-ref
                [value]="t.matter.matterRef"
                [link]="auth.canLink('matter') ? ['/matters', t.matter.matterId] : null"
                [copy]="false"
              />
              {{ t.matter.name }}</span
            >
            <span class="th__sep" aria-hidden="true">&middot;</span>
            <span data-client
              >Client
              @if (auth.canLink('client')) {
                <a class="pg-link pg-mono" [routerLink]="['/clients', t.matter.clientId]">{{
                  t.matter.clientNumber
                }}</a>
              } @else {
                <span class="pg-mono">{{ t.matter.clientNumber }}</span>
              }
            </span>
            <span class="th__sep" aria-hidden="true">&middot;</span>
            <span data-task-type>{{ t.taskType.name }}</span>
            <span class="th__sep" aria-hidden="true">&middot;</span>
            <span data-workflow
              >{{ t.workflow.workflowName }} v{{ t.workflow.versionNo }} ({{
                t.workflow.isOrdered ? 'ordered' : 'unordered'
              }})</span
            >
          </span>
        </mf-record-header>
        <mf-task-facts />
        @if (store.viewOnly()) {
          <p class="th__view-only" data-view-only>
            <i class="pi pi-eye" aria-hidden="true"></i>
            View only: you don't have permission to edit tasks.
          </p>
        }
      </div>
    }
  `,
  styles: `
    .th {
      margin-bottom: var(--mf-s3);
    }
    /* The type icon is centred on the first line of the title (the title is 1.3 times its font size tall). */
    .th__icon {
      margin-top: calc((var(--rh-fs, 22px) * 1.3 - 1.25rem) / 2);
      color: var(--mf-text-muted);
    }
    .th__sep {
      margin: 0 var(--mf-s2);
    }
    .th__view-only {
      margin: var(--mf-s2) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class TaskHeader {
  protected readonly store = inject(TaskDetailStore);
  protected readonly auth = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  /** The list the task was opened from (`?from=`, whitelisted); null for any other value or none (M7). */
  private readonly from = toSignal(
    this.route.queryParamMap.pipe(map((q) => parseFrom(q.get('from')))),
    { initialValue: parseFrom(this.route.snapshot.queryParamMap.get('from')) },
  );
  private readonly source = computed(() => {
    const from = this.from();
    return from ? DRILL_SOURCES[from] : null;
  });
  /** The exact list view when the browser still knows it (history state `returnTo`), else the plain list path. */
  private readonly listTree = computed(() => {
    const from = this.from();
    if (!from) return this.router.parseUrl('/tasks');
    const state: unknown = typeof history === 'undefined' ? null : history.state;
    const returnTo = (state as { returnTo?: unknown } | null)?.returnTo;
    return this.router.parseUrl(listUrl(from, returnTo));
  });

  /** "Back to My Work" on a phone: the list the task was opened from, with focus returning to the row (`restoreFocus`). */
  protected readonly backTo = computed(() => {
    const src = this.source();
    return src
      ? { label: src.label, link: this.listTree(), state: { restoreFocus: true } }
      : { label: 'Tasks', link: '/tasks' };
  });

  /** `Tasks > 00343-00012 Merger Review > TSK-1`: the list the person came from, then the matter for people who may open it. */
  protected readonly parents = computed<Crumb[]>(() => {
    const t = this.store.task();
    if (!t) return [];
    const source = this.source();
    const list: Crumb = {
      label: source?.label ?? 'Tasks',
      link: this.listTree(),
      // From a list the crumb brings the person back to the row they left, as "Back to ..." does.
      state: source ? { restoreFocus: true } : undefined,
    };
    return this.auth.canLink('matter')
      ? [
          list,
          {
            label: `${t.matter.matterRef} ${t.matter.name}`,
            link: ['/matters', t.matter.matterId],
          },
        ]
      : [list];
  });

  /** The whole context line as one sentence: its tooltip, because the line is cut at the window's edge. */
  protected readonly contextText = computed(() => {
    const t = this.store.task();
    if (!t) return null;
    const w = t.workflow;
    return [
      `Matter ${t.matter.matterRef} ${t.matter.name}`,
      `Client ${t.matter.clientNumber}`,
      t.taskType.name,
      `${w.workflowName} v${w.versionNo} (${w.isOrdered ? 'ordered' : 'unordered'})`,
    ].join(' \u00b7 ');
  });

  private option(action: string): TaskTransitionOption | null {
    const o = this.store.task()?.allowedActions.transitions.find((x) => x.action === action);
    // A transition the person lacks the permission for is left out; one the Matter blocks is shown disabled with the reason.
    return o && (o.permitted || o.blockedReason !== 'PERMISSION_DENIED') ? o : null;
  }

  /** One status action as a header or overflow entry. */
  private statusAction(
    action: 'COMPLETE' | 'REOPEN' | 'HOLD' | 'RESUME' | 'CANCEL',
    entry: Pick<RecordAction, 'id' | 'role' | 'label' | 'icon' | 'danger' | 'separated' | 'hint'>,
  ): RecordAction[] {
    const o = this.option(action);
    if (!o) return [];
    return [
      {
        ...entry,
        disabled: !o.permitted,
        reason: o.permitted ? undefined : blockedText(action, o.blockedReason),
        run: () => {
          if (!this.store.busy()) void this.store.requestAction(action);
        },
      },
    ];
  }

  /** The header's action set (C3, #255): Edit, Activity, the primary action, and the overflow. Permission-gated; the page adds nothing else. */
  protected readonly actions = computed<RecordAction[]>(() => {
    const t = this.store.task();
    if (!t) return [];
    const list: RecordAction[] = [];
    if (t.allowedActions.canEdit) {
      list.push({ id: 'edit', role: 'edit', label: 'Edit', run: () => this.edit() });
    }
    list.push({
      id: 'activity',
      role: 'activity',
      label: 'Activity',
      icon: 'pi-history',
      run: () => this.store.activityOpen.set(true),
    });
    if (this.store.closed()) {
      list.push(
        ...this.statusAction('REOPEN', {
          id: 'reopen',
          role: 'primary',
          label: 'Reopen task',
          icon: 'pi-replay',
        }),
      );
    } else {
      list.push(
        ...this.statusAction('COMPLETE', {
          id: 'complete',
          role: 'primary',
          label: 'Complete task',
          icon: 'pi-check-circle',
          hint: this.store.completeHint(),
        }),
      );
    }
    list.push(
      ...this.statusAction('HOLD', {
        id: 'hold',
        role: 'secondary',
        label: 'Put on hold',
        icon: 'pi-pause',
      }),
      ...this.statusAction('RESUME', {
        id: 'resume',
        role: 'secondary',
        label: 'Resume',
        icon: 'pi-play',
      }),
      {
        id: 'copy-link',
        role: 'secondary',
        label: 'Copy link',
        icon: 'pi-link',
        run: () => void this.copyLink(t.taskId),
      },
      ...this.statusAction('CANCEL', {
        id: 'cancel',
        role: 'state',
        label: 'Cancel task',
        icon: 'pi-times-circle',
        danger: true,
        separated: true,
      }),
    );
    return list;
  });

  protected edit(): void {
    this.store.editOrigin.set('header');
    this.store.editing.set(true);
  }

  private async copyLink(taskId: number): Promise<void> {
    const url = new URL(`/tasks/${taskId}`, location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      this.notify.success('Link copied.');
    } catch {
      this.notify.error('The link could not be copied.', url);
    }
  }
}
