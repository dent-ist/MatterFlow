import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardRecentTask } from '../../../api/generated/api-client';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDate } from '../../../core/time/time';

let nextId = 0;

/** The latest tasks created or completed (UX `RecentTaskList`): number, title, matter reference and date, each row a link to the Task. */
@Component({
  selector: 'mf-recent-task-list',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-labelledby]="id">
      <h2 [id]="id">{{ heading() }}</h2>
      @if (tasks().length === 0) {
        <p class="empty">{{ emptyText() }}</p>
      } @else {
        <ul>
          @for (t of tasks(); track t.taskId) {
            <li>
              <a [routerLink]="['/tasks', t.taskId]">
                <span class="ref">{{ t.taskNumber }}</span>
                <span class="title">{{ t.title }}</span>
                <span class="meta">
                  <span class="matter">{{ t.matterRef }}</span>
                  <span>{{ dateOf(t.atUtc) }}</span>
                </span>
              </a>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      height: 100%;
      box-sizing: border-box;
      padding: var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    h2 {
      margin: 0 0 var(--mf-s3);
      font-size: var(--mf-fs-lg);
    }
    .empty {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li + li {
      border-top: 1px solid var(--mf-border);
    }
    a {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0 var(--mf-s3);
      padding: var(--mf-s2);
      color: var(--mf-text);
      text-decoration: none;
      border-radius: var(--mf-radius);
    }
    a:hover {
      background: var(--mf-selected-bg);
    }
    .ref,
    .matter {
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-sm);
    }
    .ref {
      color: var(--mf-link);
      font-weight: 600;
    }
    .title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      grid-column: 1 / -1;
      display: flex;
      gap: var(--mf-s3);
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
  `,
})
export class RecentTaskList {
  private readonly zone = inject(USER_TIME_ZONE);
  readonly heading = input.required<string>();
  readonly tasks = input.required<readonly DashboardRecentTask[]>();
  readonly emptyText = input('No tasks yet.');
  protected readonly id = `mf-recent-${nextId++}`;

  protected dateOf(instant: string): string {
    return mfDate(instant, this.zone, 'date');
  }
}
