import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ReportSchemaClient, SchemaTableResponse } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';

/** `dbo.Task` becomes `[dbo].[Task]`; a closing bracket in a name is doubled, as T-SQL needs. */
export function bracketed(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

/** The text the "Insert" of a table puts in the query. */
export function tableText(t: Pick<SchemaTableResponse, 'schema' | 'name'>): string {
  return `${bracketed(t.schema)}.${bracketed(t.name)}`;
}

const PAGE_SIZE = 40;
const SEARCH_DELAY_MS = 300;

/**
 * The schema browser (spec 9.2, issue #715): a searchable list of the tables and views the report login can read, each opening to its columns
 * (name, type, nullable, primary key). Insert puts the bracketed name at the cursor of the query. The data is metadata through the report
 * login, so a table that reports cannot read is never listed. Every table is one button (`aria-expanded`), so the whole panel is reachable by
 * keyboard; no shortcut is involved.
 */
@Component({
  selector: 'mf-schema-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sb" aria-labelledby="sb-title" data-schema-browser>
      <h2 id="sb-title" class="sb__title">Schema browser</h2>
      <label class="mf-label mf-label--sm" for="sb-search">Search tables and columns</label>
      <input
        id="sb-search"
        class="mf-control mf-control--fill"
        type="search"
        autocomplete="off"
        [value]="search()"
        (input)="onSearch($any($event.target).value)"
        data-schema-search
      />
      <p class="mf-sr-only" role="status" aria-live="polite" data-schema-status>{{ status() }}</p>
      @if (failure(); as f) {
        <p class="sb__error" role="alert" data-schema-failure>
          {{ f }}
          <button type="button" class="mf-btn mf-btn--text" (click)="reload()">Try again</button>
        </p>
      }
      <ul class="sb__tables">
        @for (t of tables(); track t.fullName) {
          <li class="sb__table" [attr.data-table]="t.fullName">
            <div class="sb__row">
              <button
                type="button"
                class="sb__toggle"
                [attr.aria-expanded]="isOpen(t)"
                [attr.aria-controls]="'sb-cols-' + t.name"
                (click)="toggle(t)"
              >
                <i
                  class="pi"
                  [class.pi-chevron-down]="isOpen(t)"
                  [class.pi-chevron-right]="!isOpen(t)"
                  aria-hidden="true"
                ></i>
                <span class="sb__name">{{ t.fullName }}</span>
                @if (t.isView) {
                  <span class="sb__tag">view</span>
                }
              </button>
              <button
                type="button"
                class="mf-btn mf-btn--text sb__insert"
                (click)="insert.emit(tableText(t))"
                [attr.aria-label]="'Insert ' + t.fullName"
              >
                Insert
              </button>
            </div>
            @if (isOpen(t)) {
              <ul class="sb__cols" [id]="'sb-cols-' + t.name">
                @for (c of t.columns; track c.name) {
                  <li class="sb__col">
                    <button
                      type="button"
                      class="sb__colbtn"
                      (click)="insert.emit(bracketed(c.name))"
                      [attr.aria-label]="'Insert ' + c.name"
                    >
                      <span class="sb__colname">{{ c.name }}</span>
                      <span class="sb__type">
                        {{ c.type }}{{ c.isNullable ? ', null' : ''
                        }}{{ c.isPrimaryKey ? ', key' : '' }}
                      </span>
                    </button>
                  </li>
                }
              </ul>
            }
          </li>
        } @empty {
          @if (!loading() && !failure()) {
            <li class="sb__empty" data-schema-empty>No table or column matches.</li>
          }
        }
      </ul>
      @if (tables().length < total()) {
        <button
          type="button"
          class="mf-btn"
          (click)="more()"
          [disabled]="loading()"
          data-schema-more
        >
          Show more ({{ total() - tables().length }} left)
        </button>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .sb {
      display: grid;
      gap: var(--mf-s2);
      align-content: start;
    }

    .sb__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
    }

    .sb__error {
      margin: 0;
      color: var(--mf-danger);
    }

    .sb__tables,
    .sb__cols {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .sb__tables {
      max-height: var(--mf-schema-h, 24rem);
      overflow: auto;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }

    .sb__row {
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--mf-border);
    }

    .sb__toggle,
    .sb__colbtn {
      display: flex;
      flex: 1;
      gap: var(--mf-s2);
      align-items: center;
      min-height: var(--mf-target-min);
      padding: 0 var(--mf-s2);
      border: 0;
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .sb__toggle:hover,
    .sb__colbtn:hover {
      background: var(--mf-surface-alt);
    }

    .sb__name,
    .sb__colname {
      font-family: var(--mf-font-mono);
      overflow-wrap: anywhere;
    }

    .sb__tag,
    .sb__type {
      margin-left: auto;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }

    .sb__cols {
      padding-left: var(--mf-s5);
      border-bottom: 1px solid var(--mf-border);
    }

    .sb__empty {
      padding: var(--mf-s3);
      color: var(--mf-text-muted);
    }
  `,
})
export class SchemaBrowserPanel implements OnDestroy {
  private readonly api = inject(ReportSchemaClient);

  /** The text to put at the cursor of the query. */
  readonly insert = output<string>();

  protected readonly search = signal('');
  protected readonly tables = signal<SchemaTableResponse[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly failure = signal('');
  protected readonly status = signal('');
  private readonly open = signal<ReadonlySet<string>>(new Set());
  private page = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  protected readonly tableText = tableText;
  protected readonly bracketed = bracketed;

  constructor() {
    void this.run(true);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  protected isOpen(t: SchemaTableResponse): boolean {
    return this.open().has(t.fullName);
  }

  protected toggle(t: SchemaTableResponse): void {
    const next = new Set(this.open());
    if (!next.delete(t.fullName)) next.add(t.fullName);
    this.open.set(next);
  }

  protected onSearch(text: string): void {
    this.search.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.page = 1;
      void this.run(true);
    }, SEARCH_DELAY_MS);
  }

  protected more(): void {
    this.page += 1;
    void this.run(false);
  }

  protected reload(): void {
    this.page = 1;
    void this.run(true);
  }

  private async run(replace: boolean): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.failure.set('');
    try {
      const text = this.search().trim();
      const result = await firstValueFrom(
        this.api.searchReportSchema(text || undefined, this.page, PAGE_SIZE),
      );
      if (id !== this.requestId) return;
      this.tables.set(replace ? result.tables : [...this.tables(), ...result.tables]);
      this.total.set(result.total);
      // A search that narrows the list to a few tables opens them, so a column match is visible.
      if (text && result.total <= 5) this.open.set(new Set(result.tables.map((t) => t.fullName)));
      this.status.set(`${result.total} ${result.total === 1 ? 'table matches' : 'tables match'}.`);
    } catch (e) {
      if (id !== this.requestId) return;
      this.failure.set(
        e instanceof ApiError && e.status === 503
          ? 'Reports are not available right now.'
          : 'The schema could not be loaded.',
      );
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
