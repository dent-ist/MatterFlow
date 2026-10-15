import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { queueParams } from '../dashboard-links';

/** `strong` is the neutral attention tone (a dark edge, no colour meaning); `asap` is the blue outlined ASAP treatment of the pattern standard. */
export type TileTone = 'danger' | 'warning' | 'info' | 'strong' | 'asap' | 'neutral';

/**
 * Dashboard count tile (UX `mf-stat-tile`): a large number, a label and an optional caption, as one link to the Task Queue with the
 * query the API returned for that number (so the list the user lands on has exactly that many tasks). Not a trend or a score.
 *
 * `emphasis="attention"` is the "Needs attention" look: a coloured left edge and an icon, and the link text says what it opens
 * ("View overdue tasks"). The tone only applies while the number is above zero; colour is never the only carrier (icon and words).
 *
 * The link's accessible name is its visible content (label, number, caption, link text), so a voice-control user can say what they see
 * (WCAG 2.5.3). A tile that counts zero is not a link: there is nothing to open (DASH-14).
 */
@Component({
  selector: 'mf-stat-tile',
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (value() > 0) {
      <a
        class="tile"
        routerLink="/tasks"
        [queryParams]="params()"
        [attr.data-emphasis]="emphasis()"
        [attr.data-tone]="activeTone()"
      >
        <ng-container *ngTemplateOutlet="body; context: { link: true }" />
      </a>
    } @else {
      <div class="tile tile--zero" [attr.data-emphasis]="emphasis()" [attr.data-zero]="'true'">
        <ng-container *ngTemplateOutlet="body; context: { link: false }" />
      </div>
    }
    <ng-template #body let-link="link">
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
      @if (link) {
        <span class="go"
          >{{ linkText() }} <i class="pi pi-arrow-right" aria-hidden="true"></i
        ></span>
      }
    </ng-template>
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
    a.tile:hover {
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
    .tile--zero .value {
      color: var(--mf-text-muted);
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
    /* Neutral attention: a dark edge on the plain surface (no colour meaning). */
    [data-tone='strong'] {
      border-left-color: var(--mf-text);
    }
    [data-tone='strong'] .label i {
      color: var(--mf-text);
    }
    /* ASAP: the blue outlined treatment of the pattern standard, never red or amber. */
    [data-tone='asap'] {
      border-color: var(--mf-asap, var(--mf-info));
      border-width: 2px;
    }
    [data-tone='asap'] .label i,
    [data-tone='asap'] .value {
      color: var(--mf-asap, var(--mf-info));
    }
    a[data-tone]:hover {
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
  readonly linkText = input('View these tasks');

  protected readonly params = computed(() => queueParams(this.query()));
  /** Zero is calm: the tone is only shown while there is something to look at. */
  protected readonly activeTone = computed(() =>
    this.value() > 0 && this.tone() !== 'neutral' ? this.tone() : null,
  );
}
