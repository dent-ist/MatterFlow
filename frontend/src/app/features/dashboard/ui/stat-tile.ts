import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { queueParams } from '../dashboard-links';

export type TileTone = 'danger' | 'warning' | 'info' | 'neutral';

/**
 * Dashboard count tile (UX `mf-stat-tile`): a large number, a label and an optional caption, as one link to the Task Queue with the
 * query the API returned for that number (so the list the user lands on has exactly that many tasks). Not a trend or a score.
 *
 * `emphasis="attention"` is the "Needs attention" look: a coloured left edge and an icon, and the link text says what it opens
 * ("View overdue tasks"). The tone only applies while the number is above zero; colour is never the only carrier (icon and words).
 */
@Component({
  selector: 'mf-stat-tile',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      class="tile"
      routerLink="/tasks"
      [queryParams]="params()"
      [attr.aria-label]="ariaLabel()"
      [attr.data-emphasis]="emphasis()"
      [attr.data-tone]="activeTone()"
    >
      <span class="label">
        @if (icon(); as i) {
          <i class="pi" [class]="i" aria-hidden="true"></i>
        }
        {{ label() }}
      </span>
      <span class="value">{{ value() }}</span>
      @if (caption(); as c) {
        <span class="caption">{{ c }}</span>
      }
      <span class="go" aria-hidden="true">{{ linkText() }} <i class="pi pi-arrow-right"></i></span>
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
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
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
      padding-top: var(--mf-s1);
      font-size: var(--mf-fs-xs);
      color: var(--mf-link);
    }
    /* Needs attention: bigger number, a thick coloured edge and a tinted icon chip. */
    [data-emphasis='attention'] {
      border-left-width: 6px;
      padding: var(--mf-s4);
    }
    [data-emphasis='attention'] .value {
      font-size: 2.25rem;
    }
    [data-emphasis='attention'] .label {
      color: var(--mf-text);
      font-size: var(--mf-fs-md);
    }
    /* Overview: quieter, smaller number. */
    [data-emphasis='quiet'] .value {
      font-size: var(--mf-fs-h2);
    }
    [data-tone='danger'] {
      border-left-color: var(--mf-danger);
      background: var(--mf-danger-bg);
    }
    [data-tone='danger'] .label i,
    [data-tone='danger'] .value {
      color: var(--mf-danger);
    }
    [data-tone='warning'] {
      border-left-color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    [data-tone='warning'] .label i,
    [data-tone='warning'] .value {
      color: var(--mf-warning);
    }
    [data-tone='info'] {
      border-left-color: var(--mf-info);
      background: var(--mf-info-bg);
    }
    [data-tone='info'] .label i,
    [data-tone='info'] .value {
      color: var(--mf-info);
    }
    [data-tone]:hover {
      border-color: var(--mf-primary);
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  /** The Task Queue query string (no leading `?`) behind the number. */
  readonly query = input.required<string>();
  readonly caption = input<string | null>(null);
  /** PrimeIcons class, for example `pi-exclamation-circle`. */
  readonly icon = input<string | null>(null);
  readonly tone = input<TileTone>('neutral');
  readonly emphasis = input<'default' | 'attention' | 'quiet'>('default');
  /** Words after the label of the link, for example "View overdue tasks". */
  readonly linkText = input('View');

  protected readonly params = computed(() => queueParams(this.query()));
  /** Zero is calm: the tone is only shown while there is something to look at. */
  protected readonly activeTone = computed(() =>
    this.value() > 0 && this.tone() !== 'neutral' ? this.tone() : null,
  );
  protected readonly ariaLabel = computed(
    () =>
      `${this.label()}: ${this.value()}. View ${this.value() === 1 ? 'this task' : 'these tasks'} in the Task Queue.`,
  );
}
