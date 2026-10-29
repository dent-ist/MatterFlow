import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MyMattersClient } from '../../api/generated/api-client';
import { ErrorReference } from '../../shared/ui/error-reference';
import { MyMattersFocus } from './focus';
import { MmFilters, commonArgs } from './my-matters-filters';
import { LoadGroup, panelLoader } from './panel-loader';
import { MmPrefilter, PREFILTERS, PREFILTER_KEYS } from './prefilter';

/**
 * The pre-filter of the Overview's grid (epic #893 issue #942): one dropdown with the old tiles' choices, each option carrying its count ("Overdue (16)"). The counts are
 * the totals of the grid for that choice (`GET /my-matters/summary` with the page's Client, Matter, Role and Scope and the person's Focus), so they follow the same filters
 * as the grid. A native select: keyboard and screen readers work as they do everywhere, the count is part of each option's name, and an option with a count of zero stays
 * selectable but is muted (the word in it still says "(0)"). If the counts cannot be read the options carry their words only and a small "Retry" asks again; with two
 * failures on the page, the page's banner speaks for both.
 */
@Component({
  selector: 'mf-mm-prefilter',
  imports: [ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .pf__select {
      box-sizing: border-box;
      min-width: 13rem;
      max-width: 100%;
      height: var(--mf-row-h-compact, 32px);
      min-height: var(--mf-row-h-compact, 32px);
    }
    /* A zero stays a choice, but quietly. */
    .pf__select option.pf__zero {
      color: var(--mf-text-muted);
    }
    .pf__error {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      color: var(--mf-text-muted);
    }
    .pf__error :is(mf-error-reference) {
      margin: 0;
    }
    .pf__error .mf-btn {
      min-height: 28px;
      padding: 0 var(--mf-s2);
    }
    @media (max-width: 639.98px) {
      :host {
        width: 100%;
      }
      .pf__select {
        flex: 1 1 auto;
        height: 44px;
        min-height: 44px;
      }
      .pf__error .mf-btn {
        min-height: 44px;
      }
    }
  `,
  template: `
    <select
      id="mm-show"
      class="mf-control mf-control--compact pf__select"
      data-prefilter
      aria-label="Show tasks"
      [attr.aria-busy]="loader.busy() ? 'true' : null"
      (change)="showChange.emit($any($event.target).value)"
    >
      @for (o of options(); track o.key) {
        <option
          [value]="o.key"
          [selected]="o.key === show()"
          [class.pf__zero]="o.count === 0"
          [attr.data-prefilter-option]="o.key"
        >
          {{ o.text }}
        </option>
      }
    </select>
    @if (loader.state() === 'error' && !group?.many()) {
      <span class="pf__error" role="alert" data-prefilter-error>
        Counts not loaded.
        <mf-error-reference />
        <button type="button" class="mf-btn" data-prefilter-retry (click)="loader.load()">
          Retry
        </button>
      </span>
    }
  `,
})
export class PrefilterSelect {
  readonly filters = input.required<MmFilters>();
  readonly show = input.required<MmPrefilter>();
  readonly showChange = output<MmPrefilter>();
  /** The count of the chosen option, reported so the grid can say what it shows. */
  readonly counts = computed(() => this.loader.data());

  private readonly api = inject(MyMattersClient);
  private readonly focus = inject(MyMattersFocus);
  protected readonly group = inject(LoadGroup, { optional: true });

  protected readonly loader = panelLoader(
    () => [this.filters(), this.focus.types()],
    () => {
      const a = commonArgs(this.filters());
      const types = this.focus.types();
      return this.api.getMyMattersSummary(
        types.length > 0 ? types : undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      );
    },
  );

  protected readonly options = computed(() => {
    const s = this.loader.data();
    return PREFILTER_KEYS.map((key) => {
      const count = s ? s[PREFILTERS[key].cell].count : null;
      const label = PREFILTERS[key].label;
      return { key, count, text: count === null ? label : `${label} (${count})` };
    });
  });
}
