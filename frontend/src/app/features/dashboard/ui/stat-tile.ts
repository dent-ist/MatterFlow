import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { queueParams } from '../dashboard-links';

/**
 * Dashboard count tile (UX `mf-stat-tile`): a large number, a label and an optional caption, as one link to the Task Queue with the
 * query the API returned for that number (so the list the user lands on has exactly that many tasks). Not a trend or a score.
 */
@Component({
  selector: 'mf-stat-tile',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="tile" routerLink="/tasks" [queryParams]="params()" [attr.aria-label]="ariaLabel()">
      <span class="label">{{ label() }}</span>
      <span class="value">{{ value() }}</span>
      @if (caption(); as c) {
        <span class="caption">{{ c }}</span>
      }
      <span class="go" aria-hidden="true">View <i class="pi pi-arrow-right"></i></span>
    </a>
  `,
  styles: `
    :host {
      display: block;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s1);
      height: 100%;
      box-sizing: border-box;
      padding: var(--mf-s3) var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      color: var(--mf-text);
      text-decoration: none;
    }
    .tile:hover {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
    }
    .label {
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      color: var(--mf-text-muted);
    }
    .value {
      font-size: var(--mf-fs-h1);
      font-weight: 700;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .caption {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    .go {
      margin-top: auto;
      font-size: var(--mf-fs-xs);
      color: var(--mf-link);
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  /** The Task Queue query string (no leading `?`) behind the number. */
  readonly query = input.required<string>();
  readonly caption = input<string | null>(null);
  protected readonly params = computed(() => queueParams(this.query()));
  protected readonly ariaLabel = computed(
    () =>
      `${this.label()}: ${this.value()}. View ${this.value() === 1 ? 'this task' : 'these tasks'} in the Task Queue.`,
  );
}
