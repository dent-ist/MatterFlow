import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  Signal,
  TemplateRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CopyPart, CopyParts } from './copy-parts';
import { LoadState } from './data-table';
import { ErrorReference } from './error-reference';

/** Below this width (the work lists' 640 px: 639 is cards, 640 is the table) a record list is cards instead of a table (WP12, #275). */
export const RECORD_CARDS_QUERY = '(max-width: 639.98px)';

/**
 * True while the window is narrower than 640 px: the record lists render `mf-record-card-list` then and no table markup at all. Call in an
 * injection context; false where `matchMedia` does not exist (a unit test without a window, which keeps the table).
 */
export function phoneCards(): Signal<boolean> {
  const out = signal(false);
  if (typeof matchMedia !== 'function') return out;
  const query = matchMedia(RECORD_CARDS_QUERY);
  out.set(query.matches);
  const update = () => out.set(query.matches);
  query.addEventListener('change', update);
  inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  return out;
}

/**
 * The card slot of `mf-record-card-list`: `<ng-template [mfRecordCard]="rows()" let-row>...</ng-template>`. The input is the list's items (the
 * list reads them from here, which also types `row` in the template); the content is one `mf-record-card` per item.
 */
@Directive({ selector: 'ng-template[mfRecordCard]' })
export class RecordCardDef<T = unknown> {
  readonly items = input.required<readonly T[]>({ alias: 'mfRecordCard' });
  readonly template = inject<TemplateRef<{ $implicit: T }>>(TemplateRef);

  /** Types `let-row` in the card template as one item. */
  static ngTemplateContextGuard<T>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature is the Angular contract
    _dir: RecordCardDef<T>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature is the Angular contract
    _ctx: unknown,
  ): _ctx is { $implicit: T } {
    return true;
  }
}

/**
 * The cards of the record lists below 640 px (WP12, #275): one `<ul>` of `<li>`, each the page's `mf-record-card`. No record knowledge here:
 * the page supplies the card template (`mfRecordCard`), the noun and the states.
 *
 *   <mf-record-card-list noun="clients" label="Clients" [state]="state()" [empty]="rows().length === 0" [filtered]="..." (retry)="load()" (clear)="clear()">
 *     <p-button mfEmptyAction label="New client" />                       <!-- optional, shown with the first-run text -->
 *     <ng-template [mfRecordCard]="rows()" let-c>
 *       <mf-record-card [name]="c.name" [link]="['/clients', c.clientId]"> ...badges, meta, counts... </mf-record-card>
 *     </ng-template>
 *   </mf-record-card-list>
 *
 * The states are the table's (`mfGridBody`): five skeleton cards and one polite "Loading clients", "You don't have access to clients." (403, no
 * Retry), "Couldn't load clients." with the error reference and Retry (a Retry that works moves focus to the first card's link), the first-run
 * text and the filtered "No clients match these filters" with Clear filters. The table markup of the same list is not rendered at the same
 * time, so assistive technology never meets the content twice.
 */
@Component({
  selector: 'mf-record-card-list',
  imports: [NgTemplateOutlet, CopyParts, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './record-card-list.scss',
  host: { '[attr.aria-busy]': "state() === 'loading' ? 'true' : null" },
  template: `
    @switch (state()) {
      @case ('loading') {
        <p class="mf-sr-only" role="status" aria-busy="true" data-loading>Loading {{ noun() }}</p>
        <ul class="rc-list" aria-hidden="true">
          @for (n of skeletonCards; track n) {
            <li class="rc rc--sk" data-skeleton>
              <span class="rc-sk rc-sk--name"></span>
              <span class="rc-sk rc-sk--meta"></span>
              <span class="rc-sk rc-sk--counts"></span>
            </li>
          }
        </ul>
      }
      @case ('forbidden') {
        <div class="rc-state" data-forbidden>
          <div class="rc-alert" role="alert">You don't have access to {{ noun() }}.</div>
        </div>
      }
      @case ('error') {
        <div class="rc-state" data-error>
          <div class="rc-alert" role="alert">
            Couldn't load {{ noun() }}.
            <mf-error-reference />
          </div>
          <button type="button" class="mf-btn" (click)="onRetry()">Retry</button>
        </div>
      }
      @default {
        @if (empty()) {
          <div class="rc-state" [attr.data-empty]="filtered() ? 'filtered' : 'none'">
            @if (filtered()) {
              <p>No {{ noun() }} match these filters</p>
              <button type="button" class="mf-btn" (click)="clear.emit()">Clear filters</button>
            } @else {
              <p>
                @if (emptyParts(); as parts) {
                  <mf-copy-parts [parts]="parts" />
                } @else {
                  {{ emptyText() || 'No ' + noun() + ' yet.' }}
                }
              </p>
              <ng-content select="[mfEmptyAction]" />
            }
          </div>
        } @else {
          <ul class="rc-list" [attr.aria-label]="label() || null" data-record-cards>
            @for (item of items(); track $index) {
              <li class="rc" data-record-card>
                <ng-container
                  [ngTemplateOutlet]="def()?.template ?? null"
                  [ngTemplateOutletContext]="{ $implicit: item }"
                />
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class RecordCardList {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private focusAfterRetry = false;

  /** The card template and, through its input, the items. */
  protected readonly def = contentChild(RecordCardDef);
  protected readonly items = computed<readonly unknown[]>(() => this.def()?.items() ?? []);

  readonly state = input.required<LoadState>();
  /** True when the loaded list has no rows. */
  readonly empty = input(false);
  /** True while a filter is active: the empty text then offers Clear filters. */
  readonly filtered = input(false);
  /** Plural, lowercase: "clients". */
  readonly noun = input.required<string>();
  /** The accessible name of the list ("Clients"). */
  readonly label = input('');
  /** First-run text; defaults to "No {noun} yet.". */
  readonly emptyText = input('');
  /** First-run text with links in it; replaces `emptyText` when set. */
  readonly emptyParts = input<readonly CopyPart[] | null>(null);

  readonly retry = output<void>();
  readonly clear = output<void>();

  protected readonly skeletonCards = [1, 2, 3, 4, 5];

  constructor() {
    // A Retry that succeeds puts keyboard focus where the cards are.
    effect(() => {
      if (this.state() !== 'ready' || !this.focusAfterRetry) return;
      this.focusAfterRetry = false;
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('li.rc a[href]')?.focus(),
        { injector: this.injector },
      );
    });
  }

  protected onRetry(): void {
    this.focusAfterRetry = true;
    this.retry.emit();
  }
}

/**
 * The anatomy of one card (WP12, #275), inside the `<li>` the list draws:
 *
 *   line 1  the name, the one link of the card (two lines at most, the full text as tooltip)      [badges, top right]
 *   line 2+ `[mfCardMeta]`: muted lines, each one line with an ellipsis (`.rc-line`; `.rc-ref` is the mono, nowrap reference)   [aside]
 *   last    `[mfCardCounts]`: the open and overdue counts (`mf-task-count` with `word`)
 *
 * The link's box is stretched over the whole card (the card is one big target of at least 64 px); the other interactive parts (a client link,
 * the count links, the copy button of `[mfCardAside]`) sit above it. Keyboard and reading order: the name, the aside (the copy button), the
 * meta, the counts. The slots stay empty (and take no room) where a list has nothing for them.
 */
@Component({
  selector: 'mf-record-card',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'rc-card' },
  template: `
    <a class="rc-name" [routerLink]="link()" [attr.title]="name()" data-card-name>{{ name() }}</a>
    <span class="rc-badges"><ng-content select="[mfCardBadges]" /></span>
    <span class="rc-aside"><ng-content select="[mfCardAside]" /></span>
    <div class="rc-meta"><ng-content select="[mfCardMeta]" /></div>
    <div class="rc-counts"><ng-content select="[mfCardCounts]" /></div>
  `,
})
export class RecordCard {
  readonly name = input.required<string>();
  /** Router commands to the record. */
  readonly link = input.required<string | unknown[]>();
}
