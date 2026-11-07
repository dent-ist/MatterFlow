import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { ApiError } from '../../core/http/api-error';
import { Dropdown, DropdownItem } from '../../shared/ui/dropdown';
import { EntityPicker, PickerOption } from '../../shared/ui/entity-picker';
import { SearchSelect } from '../../shared/ui/search-select';
import { DEFAULT_MAX_SELECTED, LookupPick, ParamDef } from './report-params';
import { LookupKind, LookupRecord, LookupTarget, ReportLookupSource } from './report-lookup-source';

/** What each lookup kind is called in the words of the control ("Couldn't load clients."). */
const THINGS: Record<string, string> = {
  matter: 'matters',
  client: 'clients',
  user: 'users',
  pod: 'pods',
  role: 'roles',
  taskType: 'task types',
};

type Mode = 'picker' | 'select' | 'multi' | 'list';

/**
 * The control of one lookup parameter (matter, client, user, pod, role, task type; issue #719, spec 3.2). Which shared control it draws depends on the
 * kind and on whether the parameter takes several: a matter or client is chosen with the typeahead picker (`mf-entity-picker`), a user with the
 * searchable select, several of a long kind with the multi dropdown that asks the server as the person types, and a short kind (pod, role, task type)
 * with the plain dropdown. Where the records come from is `ReportLookupSource` (the reports-owned endpoint) and nothing else. A read that fails shows this control's own line
 * under it, "Couldn't load clients." (or "You don't have access to clients." for a 403, which the reports-owned endpoint answers only when the report was withdrawn) with Retry; the rest of the form keeps working.
 */
@Component({
  selector: 'mf-report-lookup',
  imports: [Dropdown, EntityPicker, SearchSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mode() === 'picker') {
      <mf-entity-picker
        [label]="def().label"
        [inputId]="inputId()"
        [required]="def().required"
        [help]="def().helpText ?? ''"
        [error]="error()"
        [failed]="!!failure()"
        [locked]="disabled()"
        [placeholder]="'Search ' + things()"
        [search]="search"
        [selected]="single()"
        (selectedChange)="pick($event)"
      />
    } @else {
      <div class="mf-field">
        <label class="mf-field__label" [attr.for]="inputId()"
          >{{ def().label }}
          @if (def().required) {
            <span class="mf-field__req">(required)</span>
          }
        </label>
        @switch (mode()) {
          @case ('select') {
            <mf-search-select
              [label]="def().label"
              [hideLabel]="true"
              [inputId]="inputId()"
              [allLabel]="def().required ? 'Select...' : 'Any ' + singular()"
              [search]="search"
              [failed]="!!failure()"
              [selected]="single()"
              (selectedChange)="pick($event)"
            />
          }
          @case ('multi') {
            <mf-dropdown
              field
              fill
              [multi]="true"
              [search]="true"
              [searchLabel]="'Search ' + things()"
              [buttonId]="inputId()"
              [label]="def().label"
              placeholder="Select..."
              [items]="multiItems()"
              [values]="valueIds()"
              [invalid]="!!error()"
              [disabled]="disabled()"
              [describedBy]="describedBy()"
              (searched)="searchMore($event)"
              (valuesChange)="pickMany($event)"
            />
          }
          @default {
            <mf-dropdown
              field
              fill
              [multi]="!!def().multiple"
              [buttonId]="inputId()"
              [label]="def().label"
              [placeholder]="loading() ? 'Loading...' : 'Select...'"
              [items]="listItems()"
              [value]="valueIds()[0] || ''"
              [values]="valueIds()"
              [invalid]="!!error()"
              [disabled]="disabled() || loading()"
              [describedBy]="describedBy()"
              (valueChange)="pickOne($event)"
              (valuesChange)="pickMany($event)"
            />
          }
        }
        @if (def().helpText; as help) {
          <p class="mf-field__help" [id]="inputId() + '-help'">{{ help }}</p>
        }
        @if (error(); as e) {
          <p class="mf-field__error" role="alert" [id]="inputId() + '-error'">
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
          </p>
        }
      </div>
    }
    @if (failure(); as why) {
      <p
        class="mf-field__error rl-fail"
        role="alert"
        [id]="inputId() + '-failure'"
        data-lookup-failure
      >
        <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
        {{
          why === 'denied'
            ? "You don't have access to " + things() + '.'
            : "Couldn't load " + things() + '.'
        }}
        <button type="button" class="mf-btn mf-btn--text" data-lookup-retry (click)="retry()">
          Retry
        </button>
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .rl-fail {
      margin-top: var(--mf-s1);
    }
  `,
})
export class ReportLookupField {
  private readonly source = inject(ReportLookupSource);

  /** The report the parameter belongs to: the reports-owned lookup endpoint is asked per report and parameter. */
  readonly reportId = input.required<number>();
  readonly def = input.required<ParamDef>();
  readonly inputId = input.required<string>();
  readonly error = input<string | null>(null);
  readonly disabled = input(false);
  /** The chosen records (at most one unless the parameter takes several). */
  readonly value = model<readonly LookupPick[]>([]);

  private readonly target = computed<LookupTarget>(() => ({
    reportId: this.reportId(),
    parameter: this.def().name,
  }));
  protected readonly kind = computed(() => (this.def().lookupKind ?? 'matter') as LookupKind);
  protected readonly things = computed(() => THINGS[this.kind()] ?? 'records');
  protected readonly singular = computed(() => {
    const t = this.things();
    return t.endsWith('ses') ? t : t.replace(/s$/, '');
  });
  protected readonly mode = computed<Mode>(() => {
    if (!this.source.isSearched(this.kind())) return 'list';
    if (this.def().multiple) return 'multi';
    return this.kind() === 'user' ? 'select' : 'picker';
  });

  protected readonly failure = signal<'denied' | 'failed' | null>(null);
  protected readonly loading = signal(false);
  /** The short kinds: every record (loaded once). The long kinds: the rows of the last search. */
  private readonly records = signal<readonly LookupRecord[]>([]);
  /** Words of every record seen, by id, so a chosen record keeps its words when the list changes. */
  private readonly known = signal<ReadonlyMap<number, LookupRecord>>(new Map());
  private lastSearch = '';

  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    const parts = [
      this.error() ? `${id}-error` : null,
      this.failure() ? `${id}-failure` : null,
      this.def().helpText ? `${id}-help` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  });

  protected readonly valueIds = computed(() => this.value().map((p) => String(p.id)));
  protected readonly single = computed<PickerOption | null>(() => {
    const p = this.value()[0];
    return p ? { id: p.id, label: p.label || this.known().get(p.id)?.label || `#${p.id}` } : null;
  });

  protected readonly listItems = computed<DropdownItem[]>(() => {
    const items = this.records().map((r) => ({ value: String(r.id), label: r.label }));
    return this.def().multiple || this.def().required
      ? items
      : [{ value: '', label: 'Any' }, ...items];
  });
  protected readonly multiItems = computed<DropdownItem[]>(() => {
    const chosen = this.value().map((p) => ({
      value: String(p.id),
      label: p.label || this.known().get(p.id)?.label || `#${p.id}`,
    }));
    const ids = new Set(chosen.map((c) => c.value));
    const more = this.records()
      .filter((r) => !ids.has(String(r.id)))
      .map((r) => ({ value: String(r.id), label: r.label }));
    return [...chosen, ...more];
  });

  /** The typeahead of the picker and the searchable select: a failed read becomes this control's line and an empty list. */
  protected readonly search = async (text: string): Promise<PickerOption[]> => {
    try {
      const rows = await this.source.search(this.target(), text);
      this.remember(rows);
      this.failure.set(null);
      return rows.map((r) => ({ id: r.id, label: r.label, inactive: r.inactive }));
    } catch (error) {
      this.fail(error);
      return [];
    }
  };

  constructor() {
    // A short kind is loaded whole when the control appears.
    effect(() => {
      if (this.mode() === 'list') untracked(() => void this.loadList());
    });
    // Ids that came from the address or a default have no words yet: fetch them once.
    effect(() => {
      const missing = this.value().filter((p) => !p.label);
      if (missing.length > 0) untracked(() => void this.fillLabels(missing.map((p) => p.id)));
    });
  }

  protected pick(option: PickerOption | null): void {
    this.value.set(option ? [{ id: option.id, label: option.label }] : []);
  }

  protected pickOne(value: string): void {
    const record = this.records().find((r) => String(r.id) === value);
    this.value.set(record ? [{ id: record.id, label: record.label }] : []);
  }

  protected pickMany(values: readonly string[]): void {
    const words = new Map<string, string>();
    for (const i of [...this.multiItems(), ...this.listItems()]) words.set(i.value, i.label);
    const max = this.def().maxSelected ?? DEFAULT_MAX_SELECTED;
    // The server refuses more than the limit; the form says so under the field, so the list is kept whole here.
    this.value.set(
      values
        .filter((v) => v !== '')
        .map((v) => ({ id: Number(v), label: words.get(v) ?? '' }))
        .slice(0, max + 1),
    );
  }

  protected searchMore(text: string): void {
    this.lastSearch = text;
    void this.runSearch(text);
  }

  protected retry(): void {
    this.failure.set(null);
    if (this.mode() === 'list') void this.loadList();
    else if (this.mode() === 'multi') void this.runSearch(this.lastSearch);
  }

  private async loadList(): Promise<void> {
    this.loading.set(true);
    try {
      const rows = await this.source.list(this.target());
      this.remember(rows);
      this.records.set(rows);
      this.failure.set(null);
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading.set(false);
    }
  }

  private async runSearch(text: string): Promise<void> {
    try {
      const rows = await this.source.search(this.target(), text);
      this.remember(rows);
      this.records.set(rows);
      this.failure.set(null);
    } catch (error) {
      this.fail(error);
    }
  }

  private async fillLabels(ids: readonly number[]): Promise<void> {
    try {
      const rows = await this.source.labels(this.target(), ids);
      this.remember(rows);
      const words = new Map(rows.map((r) => [r.id, r.label] as const));
      this.value.set(
        this.value().map((p) => (p.label ? p : { id: p.id, label: words.get(p.id) ?? `#${p.id}` })),
      );
    } catch (error) {
      this.fail(error);
      this.value.set(this.value().map((p) => (p.label ? p : { id: p.id, label: `#${p.id}` })));
    }
  }

  private remember(rows: readonly LookupRecord[]): void {
    const next = new Map(this.known());
    for (const r of rows) next.set(r.id, r);
    this.known.set(next);
  }

  private fail(error: unknown): void {
    this.failure.set(error instanceof ApiError && error.status === 403 ? 'denied' : 'failed');
  }
}
