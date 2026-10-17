import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { queueParams } from '../dashboard-links';
import { TileDelta } from '../dashboard-deltas';

let nextTileId = 0;

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
        [attr.title]="hint()"
        [attr.aria-describedby]="hint() ? hintId : null"
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
          <i class="pi chip" [class]="i" aria-hidden="true"></i>
        }
        <span class="label-text">{{ label() }}</span>
        @if (link) {
          <i class="pi pi-angle-right go-icon" aria-hidden="true"></i>
        }
      </span>
      <span class="value">{{ value() }}</span>
      @if (caption(); as c) {
        <span class="caption">{{ c }}</span>
      }
      @if (delta(); as dl) {
        <!-- Change since before (S3): glyph, signed number and words; the glyph and the visible words are decoration for a screen reader, which gets the sentence. -->
        <span
          class="delta"
          data-delta
          [attr.data-direction]="dl.direction"
          [attr.data-attention]="dl.attention ? '' : null"
        >
          <span class="delta-glyph" aria-hidden="true">{{ dl.glyph }}</span>
          <span class="delta-text" aria-hidden="true">{{ dl.text }}</span>
          <span class="sr-only">{{ dl.spoken }}</span>
        </span>
      }
      @if (detail(); as d) {
        <span class="detail" data-detail>
          @if (detailIcon(); as di) {
            <i class="pi" [class]="di" aria-hidden="true"></i>
          }
          <span>{{ d }}</span>
        </span>
      }
      @if (hint(); as h) {
        <span class="sr-only" [id]="hintId" data-hint>{{ h }}</span>
      }
      @if (link) {
        <!-- Part of the link's name (what it opens, for voice control and screen readers); not drawn: the arrow and the hover say it. -->
        <span class="go">{{ linkText() }}</span>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .tile {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2px;
      height: 100%;
      box-sizing: border-box;
      padding: var(--mf-s3) var(--mf-s3) var(--mf-s3) var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-1);
      color: var(--mf-text);
      text-decoration: none;
      transition:
        border-color 120ms,
        box-shadow 120ms;
    }
    a.tile:hover {
      border-color: var(--mf-primary);
      box-shadow: var(--mf-shadow-2);
    }
    .label {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      color: var(--mf-text-muted);
    }
    .label-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* A small neutral icon chip: the icon carries the meaning with the words, colour only adds to it. */
    .chip {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .go-icon {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-md);
      opacity: 0.55;
    }
    a.tile:hover .go-icon {
      color: var(--mf-link);
      opacity: 1;
    }
    /* Phone: two tiles per row, so the label may wrap instead of being cut and the chevron goes. */
    @media (max-width: 480px) {
      .go-icon {
        display: none;
      }
      .label-text {
        overflow: visible;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.2;
      }
      .tile {
        padding-right: var(--mf-s2);
      }
    }
    .value {
      margin-top: var(--mf-s1);
      font-size: 1.75rem;
      font-weight: 700;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    /* Captions wrap (never an ellipsis): "Excludes ASAP tasks" must be readable at every width (WCAG 1.4.10). */
    .caption {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
      overflow-wrap: anywhere;
    }
    /* Change since before: the words are always shown with the glyph; only Overdue going up borrows the attention colour. */
    .delta {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      color: var(--mf-text-muted);
      overflow-wrap: anywhere;
    }
    .delta-glyph {
      flex: none;
      font-size: 0.7rem;
      line-height: 1.5;
    }
    .delta[data-attention] {
      color: var(--mf-danger);
    }
    /* A second line that may wrap (the severity of the count): icon and words, so colour is never the only carrier. */
    .detail {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      color: var(--mf-text);
      overflow-wrap: anywhere;
    }
    .detail .pi {
      margin-top: 1px;
      font-size: var(--mf-fs-xs);
    }
    [data-tone='danger'] .detail .pi {
      color: var(--mf-danger);
    }
    .go,
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    /* Needs attention: a coloured edge and a slightly bigger number. */
    [data-emphasis='attention'] {
      border-left-width: 5px;
      padding-left: calc(var(--mf-s4) - 4px);
    }
    [data-emphasis='attention'] .value {
      font-size: 2rem;
    }
    [data-emphasis='attention'] .label {
      color: var(--mf-text);
    }
    /* Overview: quieter, smaller number. */
    [data-emphasis='quiet'] .value {
      font-size: 1.5rem;
    }
    .tile--zero {
      box-shadow: none;
    }
    .tile--zero .value {
      color: var(--mf-text-muted);
    }
    [data-tone='danger'] {
      border-left-color: var(--mf-danger);
      background: var(--mf-danger-bg);
    }
    [data-tone='danger'] .chip,
    [data-tone='danger'] .value {
      color: var(--mf-danger);
    }
    [data-tone='danger'] .chip {
      background: var(--mf-surface);
    }
    [data-tone='warning'] {
      border-left-color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    [data-tone='warning'] .chip,
    [data-tone='warning'] .value {
      color: var(--mf-warning);
    }
    [data-tone='warning'] .chip {
      background: var(--mf-surface);
    }
    [data-tone='info'] {
      border-left-color: var(--mf-info);
      background: var(--mf-info-bg);
    }
    [data-tone='info'] .chip,
    [data-tone='info'] .value {
      color: var(--mf-info);
    }
    /* Neutral attention: a dark edge on the plain surface (no colour meaning). */
    [data-tone='strong'] {
      border-left-color: var(--mf-text);
    }
    [data-tone='strong'] .chip {
      color: var(--mf-text);
    }
    /* ASAP: the quiet blue outline of the pattern standard, never red or amber, and no coloured edge or tinted fill. */
    [data-tone='asap'] {
      border-color: var(--mf-asap, var(--mf-info));
    }
    [data-tone='asap'] .chip,
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
  /** Longer text for the tooltip and the accessible description of the link (for example the resolved end date of a window). */
  readonly hint = input<string | null>(null);
  protected readonly hintId = `mf-tile-hint-${nextTileId++}`;
  /** Change since before (Overdue, Open, Completed, Created): null shows no line. */
  readonly delta = input<TileDelta | null>(null);
  /** A second, wrapping line under the caption (for example "11 Critical, 30 High"), with an optional PrimeIcons class. */
  readonly detail = input<string | null>(null);
  readonly detailIcon = input<string | null>(null);
  /** The order the Task Queue opens in (null: the queue's default). */
  readonly sort = input<{ sort: string; dir: 'asc' | 'desc' } | null>(null);
  /** PrimeIcons class, for example `pi-exclamation-circle`. */
  readonly icon = input<string | null>(null);
  readonly tone = input<TileTone>('neutral');
  readonly emphasis = input<'default' | 'attention' | 'quiet'>('default');
  /** Words after the label of the link, for example "View overdue tasks". */
  readonly linkText = input('View these tasks');

  protected readonly params = computed(() => {
    const order = this.sort();
    return order ? { ...queueParams(this.query()), ...order } : queueParams(this.query());
  });
  /** Zero is calm: the tone is only shown while there is something to look at. */
  protected readonly activeTone = computed(() =>
    this.value() > 0 && this.tone() !== 'neutral' ? this.tone() : null,
  );
}
