import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { TaskTransitionOption } from '../../../api/generated/api-client';
import { DueLabelPipe } from '../../../shared/pipes/due-label.pipe';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { ACTION_LABELS, TaskDetailStore } from './task-detail.store';

const BLOCKED_TEXT: Readonly<Record<string, string>> = {
  MATTER_INACTIVE: "Matter is inactive. This task can't be reopened.",
};

/**
 * Task header (UX S10): number, title, status, priority, due or ASAP, Pod and assignee, Matter reference with copy button
 * and workflow, plus the actions the server allows. The Change status menu lists only the transitions in
 * `allowedActions`; ones the caller lacks permission for are left out, ones blocked by the Matter are disabled with the reason.
 */
@Component({
  selector: 'mf-task-header',
  imports: [MatterRef, PriorityBadge, StatusBadge, DueLabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @if (store.task(); as t) {
      <header class="th" data-task-header>
        <div class="th__top">
          <h1 class="pg-title th__title">
            <span class="pg-mono" data-task-number>{{ t.taskNumber }}</span>
            <span data-task-title>{{ t.title }}</span>
          </h1>
          <div class="pg-actions">
            @if (t.allowedActions.canEdit) {
              <button type="button" class="th__btn" data-edit (click)="edit()">Edit</button>
            }
            @if (items().length > 0) {
              <div class="menu">
                <button
                  type="button"
                  class="th__btn th__btn--primary"
                  data-status-menu
                  aria-haspopup="menu"
                  [attr.aria-expanded]="open()"
                  [attr.aria-controls]="open() ? 'task-status-menu' : null"
                  [disabled]="store.busy()"
                  (click)="toggle()"
                  (keydown)="onMenuKey($event)"
                >
                  Change status <i class="pi pi-chevron-down" aria-hidden="true"></i>
                </button>
                @if (open()) {
                  <ul
                    class="menu__list"
                    id="task-status-menu"
                    role="menu"
                    aria-label="Change status"
                  >
                    @for (o of items(); track o.action) {
                      <li role="none">
                        <button
                          type="button"
                          role="menuitem"
                          class="menu__item"
                          [attr.data-action]="o.action"
                          [disabled]="!o.permitted"
                          [attr.aria-describedby]="o.permitted ? null : 'menu-reason-' + o.action"
                          (click)="choose(o)"
                          (keydown)="onMenuKey($event)"
                        >
                          {{ label(o) }}
                        </button>
                        @if (!o.permitted) {
                          <span class="menu__reason" [id]="'menu-reason-' + o.action">{{
                            reason(o)
                          }}</span>
                        }
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </div>
        </div>

        <div class="th__meta">
          <mf-status-badge [code]="t.status" [label]="t.statusLabel" />
          <mf-priority-badge
            [priorityId]="t.priority.priorityId"
            [label]="t.priority.label"
            [color]="t.priority.color"
          />
          <span data-due
            ><span class="pg-label">Due:</span>
            {{ { dueDate: t.dueDate, dueAtUtc: t.dueAtUtc } | dueLabel: t.status }}</span
          >
          <span data-pod
            ><span class="pg-label">Pod:</span> {{ t.assignedPod?.name ?? 'No pod' }}</span
          >
          <span data-assignee
            ><span class="pg-label">Assignee:</span>
            {{ t.assignedUser?.displayName ?? 'Unassigned' }}</span
          >
          <span class="th__matter" data-matter
            ><span class="pg-label">Matter:</span>
            <mf-matter-ref [value]="t.matter.matterRef" [link]="['/matters', t.matter.matterId]" />
            {{ t.matter.name }}
          </span>
          <span data-workflow
            ><span class="pg-label">Workflow:</span> {{ t.workflow.workflowName }} v{{
              t.workflow.versionNo
            }}
            ({{ t.workflow.isOrdered ? 'ordered' : 'unordered' }}) &middot;
            <span data-progress
              >{{ t.workflow.progress.resolved }} of {{ t.workflow.progress.total }} resolved</span
            ></span
          >
        </div>
      </header>
    }
  `,
  styles: `
    .th {
      position: sticky;
      top: 0;
      z-index: 2;
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s3) 0;
      background: var(--mf-bg);
    }
    .th__top {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mf-s3);
    }
    .th__title {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      overflow-wrap: anywhere;
    }
    .th__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s4);
      margin-top: var(--mf-s2);
    }
    .th__matter {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .th__btn {
      min-height: var(--mf-target-min);
      padding: 0 var(--mf-s4);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .th__btn--primary {
      border-color: var(--mf-primary, var(--mf-link));
      background: var(--mf-primary, var(--mf-link));
      color: var(--mf-primary-contrast, #fff);
    }
    .th__btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .menu {
      position: relative;
    }
    .menu__list {
      position: absolute;
      right: 0;
      z-index: 5;
      min-width: 14rem;
      margin: var(--mf-s1) 0 0;
      padding: var(--mf-s1);
      list-style: none;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-1);
    }
    .menu__item {
      display: block;
      width: 100%;
      min-height: var(--mf-target-min);
      padding: 0 var(--mf-s3);
      border: 0;
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .menu__item:hover:not(:disabled),
    .menu__item:focus-visible {
      background: var(--mf-surface-alt);
    }
    .menu__item:disabled {
      color: var(--mf-text-muted);
      cursor: not-allowed;
    }
    .menu__reason {
      display: block;
      padding: 0 var(--mf-s3) var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class TaskHeader {
  protected readonly store = inject(TaskDetailStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly open = signal(false);

  /** Transitions shown in the menu: not the ones the caller lacks permission for. */
  protected readonly items = computed<TaskTransitionOption[]>(() =>
    (this.store.task()?.allowedActions.transitions ?? []).filter(
      (o) => o.permitted || o.blockedReason !== 'PERMISSION_DENIED',
    ),
  );

  protected label(o: TaskTransitionOption): string {
    return ACTION_LABELS[o.action] ?? o.action;
  }

  protected reason(o: TaskTransitionOption): string {
    return BLOCKED_TEXT[o.blockedReason ?? ''] ?? "This action isn't available right now.";
  }

  protected toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) queueMicrotask(() => this.items_()[0]?.focus());
  }

  protected async choose(o: TaskTransitionOption): Promise<void> {
    this.open.set(false);
    this.host.nativeElement.querySelector<HTMLElement>('[data-status-menu]')?.focus();
    await this.store.requestAction(o.action);
  }

  protected edit(): void {
    this.store.tab.set('details');
    this.store.editing.set(true);
  }

  protected onMenuKey(event: KeyboardEvent): void {
    if (!this.open()) {
      if (
        event.key === 'ArrowDown' &&
        (event.target as HTMLElement).dataset['statusMenu'] !== undefined
      ) {
        event.preventDefault();
        this.toggle();
      }
      return;
    }
    const list = this.items_().filter((b) => !b.disabled);
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.open.set(false);
      this.host.nativeElement.querySelector<HTMLElement>('[data-status-menu]')?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (event.key === 'Tab') {
      this.open.set(false);
    }
  }

  private items_(): HTMLButtonElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[role=menuitem]'),
    );
  }
}
