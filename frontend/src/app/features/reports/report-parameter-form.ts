import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DateInput } from 'form-engine';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ReportChoicesClient } from '../../api/generated/api-client';
import { QuietRequests } from '../../core/http/interceptors';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import {
  DEFAULT_DATE_PRESETS,
  DATE_PRESETS,
  matchingPreset,
  presetRange,
  todayInZone,
} from '../../shared/filters/date-presets';
import { Dropdown, DropdownItem } from '../../shared/ui/dropdown';
import { Segmented } from '../../shared/ui/segmented';
import { TextField } from '../../shared/ui/text-field';
import { ReportLookupField } from './report-lookup-field';
import {
  DateRangeValue,
  FieldValue,
  FormValues,
  LookupPick,
  OptionLabels,
  ParamDef,
  asList,
  asPicks,
  asRange,
  asText,
  groupDigits,
  validate,
} from './report-params';

/** The state of the options of one single or multi choice parameter whose list comes from the report's own query. */
interface ChoiceState {
  readonly state: 'loading' | 'ready' | 'error';
  readonly options: readonly { value: string; label: string }[];
  readonly truncated: boolean;
}

const PRESET_KEYS = DEFAULT_DATE_PRESETS;
const PRESET_ITEMS: DropdownItem[] = DATE_PRESETS.filter((p) => PRESET_KEYS.includes(p.key)).map(
  (p) => ({ value: p.key, label: p.label }),
);

/** A search box is offered in a list of more than this many options (spec 3.2). */
const SEARCH_FROM = 8;

/**
 * The parameter form of the run page (issue #719, spec 3.2 and 3.3 of `ui-spec-user-pages.md`): one shared control per parameter type, in the
 * report's order, inside the Parameters card with Reset and the one primary button, Run Report, which becomes Cancel while a run is live.
 *
 *   number     a text box with thousands commas after blur       date      the date input of the app (typing or the calendar)
 *   date range two date inputs and a Presets dropdown            text      `mf-text-field`
 *   single     `mf-dropdown` (field)                              multi      `mf-dropdown` multi (field)
 *   yes / no   the segmented control (Any, Yes, No)              lookup    `mf-report-lookup` (picker, select or dropdown by kind)
 *
 * The form owns what is touched and what the server said about a field; the values are the parent's (`values`). Messages are the fixed sentences of
 * spec 3.3 under the field (red, `role="alert"`), never a banner. A list whose choices come from the report's query is fetched when the form opens.
 */
@Component({
  selector: 'mf-report-parameter-form',
  imports: [Button, DateInput, Dropdown, ReportLookupField, Segmented, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    .rpf__fields {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s4);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
      /* A field fills its column here (the shared field is 480 px at most). */
      --mf-field-max: none;
    }
    @container (min-width: 1040px) {
      .rpf__fields {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .rpf__wide {
      grid-column: 1 / -1;
    }
    .rpf__legend {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .rpf__num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .rpf__pair {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--mf-s3);
    }
    .rpf__date {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      flex: 0 0 16rem;
      gap: var(--mf-s1);
      width: 16rem;
      min-width: 0;
    }
    .rpf__date mf-date-input {
      min-width: 0;
    }
    .rpf__sub {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .rpf__presets {
      flex: none;
      align-self: flex-end;
    }
    .rpf__actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s3);
      margin-top: var(--mf-s4);
    }
    .rpf__actions--bare {
      margin-top: 0;
    }
    .rpf__note {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
    }
  `,
  template: `
    <form
      [class.mf-card]="defs().length > 0"
      novalidate
      data-parameter-form
      (submit)="onSubmit($event)"
    >
      @if (defs().length > 0) {
        <h2 class="mf-card__title">Parameters</h2>
        <fieldset class="rpf__fields" [disabled]="running()">
          <legend class="rpf__legend">Parameters</legend>
          @for (d of defs(); track d.name) {
            <div
              class="rpf__field"
              [class.rpf__wide]="isWide(d)"
              [attr.data-param]="d.name"
              [attr.data-type]="d.type"
            >
              @switch (d.type) {
                @case ('text') {
                  <mf-text-field
                    [label]="d.label"
                    [inputId]="idOf(d)"
                    [required]="d.required"
                    [help]="d.helpText ?? ''"
                    [error]="errorOf(d)"
                    [value]="textOf(d)"
                    (valueChange)="setText(d, $event)"
                    (focusout)="touch(d)"
                  />
                }
                @case ('lookup') {
                  <mf-report-lookup
                    [reportId]="reportId()"
                    [def]="d"
                    [inputId]="idOf(d)"
                    [error]="errorOf(d)"
                    [disabled]="running()"
                    [value]="picksOf(d)"
                    (valueChange)="setPicks(d, $event)"
                    (focusout)="touch(d)"
                  />
                }
                @default {
                  <div class="mf-field">
                    <label class="mf-field__label" [attr.for]="idOf(d)" [id]="idOf(d) + '-label'"
                      >{{ d.label }}
                      @if (d.required) {
                        <span class="mf-field__req">(required)</span>
                      }
                    </label>
                    @switch (d.type) {
                      @case ('number') {
                        <input
                          class="mf-control mf-control--fill rpf__num"
                          type="text"
                          inputmode="decimal"
                          autocomplete="off"
                          [id]="idOf(d)"
                          [value]="textOf(d)"
                          [attr.aria-invalid]="errorOf(d) ? 'true' : null"
                          [attr.aria-describedby]="describedBy(d)"
                          (input)="setText(d, $any($event.target).value)"
                          (focus)="plainNumber(d, $event)"
                          (blur)="groupedNumber(d, $event)"
                        />
                      }
                      @case ('date') {
                        <mf-date-input
                          [inputId]="idOf(d)"
                          [label]="d.label"
                          [isoValue]="textOf(d) || null"
                          [showHint]="false"
                          [showError]="false"
                          [invalid]="!!errorOf(d)"
                          [describedBy]="describedBy(d) ?? ''"
                          (isoChange)="setText(d, $event ?? '')"
                          (textInvalid)="badDate(d.name, $event)"
                          (focusout)="touch(d)"
                        />
                      }
                      @case ('dateRange') {
                        <div
                          class="rpf__pair"
                          role="group"
                          [attr.aria-labelledby]="idOf(d) + '-label'"
                        >
                          <div class="rpf__date">
                            <label class="rpf__sub" [attr.for]="idOf(d)">From</label>
                            <mf-date-input
                              [inputId]="idOf(d)"
                              [label]="d.label + ' from'"
                              [isoValue]="rangeOf(d).from || null"
                              [showHint]="false"
                              [showError]="false"
                              [invalid]="!!errorOf(d)"
                              [describedBy]="describedBy(d) ?? ''"
                              (isoChange)="setRange(d, 'from', $event ?? '')"
                              (textInvalid)="badDate(d.name + '.from', $event)"
                              (focusout)="touch(d)"
                            />
                          </div>
                          <div class="rpf__date">
                            <label class="rpf__sub" [attr.for]="idOf(d) + '-to'">To</label>
                            <mf-date-input
                              [inputId]="idOf(d) + '-to'"
                              [label]="d.label + ' to'"
                              [isoValue]="rangeOf(d).to || null"
                              [showHint]="false"
                              [showError]="false"
                              [invalid]="!!errorOf(d)"
                              [describedBy]="describedBy(d) ?? ''"
                              (isoChange)="setRange(d, 'to', $event ?? '')"
                              (textInvalid)="badDate(d.name + '.to', $event)"
                              (focusout)="touch(d)"
                            />
                          </div>
                          <mf-dropdown
                            class="rpf__presets"
                            field
                            [label]="d.label + ' presets'"
                            placeholder="Presets"
                            [items]="presetItems"
                            [value]="presetOf(d)"
                            (valueChange)="applyPreset(d, $event)"
                          />
                        </div>
                      }
                      @case ('single') {
                        <mf-dropdown
                          field
                          fill
                          [buttonId]="idOf(d)"
                          [label]="d.label"
                          placeholder="Select..."
                          [items]="itemsOf(d)"
                          [search]="itemsOf(d).length > searchFrom"
                          [value]="textOf(d)"
                          [invalid]="!!errorOf(d)"
                          [disabled]="choiceOf(d)?.state === 'loading'"
                          [describedBy]="describedBy(d)"
                          (valueChange)="setText(d, $event)"
                          (focusout)="touch(d)"
                        />
                      }
                      @case ('multi') {
                        <mf-dropdown
                          field
                          fill
                          [multi]="true"
                          [buttonId]="idOf(d)"
                          [label]="d.label"
                          placeholder="Select..."
                          [items]="itemsOf(d)"
                          [search]="itemsOf(d).length > searchFrom"
                          [values]="listOf(d)"
                          [invalid]="!!errorOf(d)"
                          [disabled]="choiceOf(d)?.state === 'loading'"
                          [describedBy]="describedBy(d)"
                          (valuesChange)="setList(d, $event)"
                          (focusout)="touch(d)"
                        />
                      }
                      @case ('yesNo') {
                        <div
                          mfSegmented
                          role="group"
                          [attr.aria-label]="d.label"
                          [attr.aria-describedby]="describedBy(d)"
                          [attr.data-yes-no]="d.name"
                        >
                          @for (o of yesNoOptions(d); track o.value) {
                            <button
                              type="button"
                              class="mf-btn"
                              [attr.data-answer]="o.value"
                              [attr.aria-pressed]="textOf(d) === o.value"
                              (click)="setText(d, o.value); touch(d)"
                            >
                              {{ o.label }}
                            </button>
                          }
                        </div>
                      }
                    }
                    @if (choiceOf(d); as c) {
                      @if (c.state === 'loading') {
                        <p class="mf-field__help" data-choices-loading>Loading...</p>
                      } @else if (c.state === 'error') {
                        <p
                          class="mf-field__error"
                          role="alert"
                          [id]="idOf(d) + '-choices'"
                          data-choices-error
                        >
                          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                          Couldn't load options.
                          <button
                            type="button"
                            class="mf-btn mf-btn--text"
                            data-choices-retry
                            (click)="loadChoices(d)"
                          >
                            Retry
                          </button>
                        </p>
                      } @else if (c.truncated) {
                        <p class="mf-field__help" data-choices-truncated>
                          Showing the first {{ c.options.length }} options.
                        </p>
                      }
                    }
                    @if (d.helpText) {
                      <p class="mf-field__help" [id]="idOf(d) + '-help'">{{ d.helpText }}</p>
                    }
                    @if (errorOf(d); as e) {
                      <p class="mf-field__error" role="alert" [id]="idOf(d) + '-error'">
                        <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
                      </p>
                    }
                  </div>
                }
              }
            </div>
          }
        </fieldset>
      }
      <div class="rpf__actions" [class.rpf__actions--bare]="defs().length === 0">
        @if (running()) {
          <p-button
            type="button"
            label="Cancel"
            severity="secondary"
            data-cancel-run
            (onClick)="cancelRun.emit()"
          >
            <ng-template #icon>
              <i
                class="p-button-icon p-button-icon-left pi pi-spin pi-spinner"
                aria-hidden="true"
              ></i>
            </ng-template>
          </p-button>
        } @else {
          @if (defs().length > 0) {
            <button type="button" class="mf-btn mf-btn--text" data-reset (click)="onReset()">
              Reset
            </button>
          }
          <p-button type="submit" label="Run Report" data-run-report />
        }
      </div>
    </form>
  `,
})
export class ReportParameterForm {
  private readonly api = inject(ReportChoicesClient);
  private readonly quiet = inject(QuietRequests);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly reportId = input.required<number>();
  readonly defs = input.required<readonly ParamDef[]>();
  /** The values of the fields; the form writes every change back. */
  readonly values = model.required<FormValues>();
  /** The per-parameter messages of a 422 from the server (by parameter name); each goes away when its field changes. */
  readonly serverErrors = input<Readonly<Record<string, string>>>({});
  /** A run is live: the fields are disabled and the button is Cancel. */
  readonly running = input(false);

  /** Run Report was pressed (or Enter in a field) and every field is ready. */
  readonly run = output<void>();
  readonly cancelRun = output<void>();
  readonly resetValues = output<void>();
  /** The words of the options of the lists (fixed and fetched), for the summary bar. */
  readonly optionLabels = output<OptionLabels>();

  protected readonly searchFrom = SEARCH_FROM;
  protected readonly presetItems = PRESET_ITEMS;

  private readonly touched = signal<ReadonlySet<string>>(new Set());
  private readonly submitted = signal(false);
  private readonly dirty = signal<ReadonlySet<string>>(new Set());
  private readonly badDates = signal<ReadonlySet<string>>(new Set());
  private readonly choices = signal<Readonly<Record<string, ChoiceState>>>({});

  /** What is wrong with the fields right now (whether or not it is shown yet). */
  readonly problems = computed(() => {
    const out: Record<string, string> = validate(this.defs(), this.values());
    for (const d of this.defs()) {
      const bad =
        this.badDates().has(d.name) ||
        this.badDates().has(`${d.name}.from`) ||
        this.badDates().has(`${d.name}.to`);
      if (bad) out[d.name] = `${d.label} must be a date (MM/DD/YYYY).`;
    }
    return out;
  });

  constructor() {
    // A new set of parameters starts clean: nothing touched, the choices of the query-driven lists fetched.
    effect(() => {
      const defs = this.defs();
      untracked(() => {
        this.touched.set(new Set());
        this.submitted.set(false);
        this.dirty.set(new Set());
        this.badDates.set(new Set());
        this.choices.set({});
        for (const d of defs) if (this.fromQuery(d)) void this.loadChoices(d);
      });
    });
    // A new answer from the server shows again, even for a field that was edited since the last one.
    effect(() => {
      this.serverErrors();
      untracked(() => this.dirty.set(new Set()));
    });
    effect(() => {
      const labels: Record<string, Record<string, string>> = {};
      for (const d of this.defs()) {
        const words: Record<string, string> = {};
        for (const o of d.options) words[o.value] = o.label;
        for (const o of this.choices()[d.name]?.options ?? []) words[o.value] = o.label;
        labels[d.name] = words;
      }
      this.optionLabels.emit(labels);
    });
  }

  // ---- what the template reads

  protected idOf(d: ParamDef): string {
    return `rpf-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }
  protected isWide(d: ParamDef): boolean {
    return d.type === 'dateRange' || (takesMany(d) && this.listLength(d) > 6);
  }
  protected textOf(d: ParamDef): string {
    return asText(this.values()[d.name]);
  }
  protected listOf(d: ParamDef): readonly string[] {
    return asList(this.values()[d.name]);
  }
  protected rangeOf(d: ParamDef): DateRangeValue {
    return asRange(this.values()[d.name]);
  }
  protected picksOf(d: ParamDef): readonly LookupPick[] {
    return asPicks(this.values()[d.name]);
  }
  protected choiceOf(d: ParamDef): ChoiceState | null {
    return this.fromQuery(d) ? (this.choices()[d.name] ?? null) : null;
  }
  protected itemsOf(d: ParamDef): DropdownItem[] {
    const options = this.fromQuery(d) ? (this.choices()[d.name]?.options ?? []) : d.options;
    const items = options.map((o) => ({ value: o.value, label: o.label }));
    return d.type === 'single' && !d.required && items.length > 0
      ? [{ value: '', label: 'Any' }, ...items]
      : items;
  }
  protected yesNoOptions(d: ParamDef): { value: string; label: string }[] {
    const yes = { value: 'yes', label: 'Yes' };
    const no = { value: 'no', label: 'No' };
    return d.required ? [yes, no] : [{ value: 'any', label: 'Any' }, yes, no];
  }
  protected presetOf(d: ParamDef): string {
    const r = this.rangeOf(d);
    if (!r.from || !r.to) return '';
    return matchingPreset(r, todayInZone(this.clock.now(), this.zone), PRESET_KEYS) ?? '';
  }
  protected describedBy(d: ParamDef): string | null {
    const id = this.idOf(d);
    const parts = [this.errorOf(d) ? `${id}-error` : null, d.helpText ? `${id}-help` : null].filter(
      Boolean,
    );
    return parts.length > 0 ? parts.join(' ') : null;
  }

  /** The message shown under a field: what is wrong once the field was left or Run was pressed, else what the server said (until the field changes). */
  protected errorOf(d: ParamDef): string | null {
    const shown = this.submitted() || this.touched().has(d.name);
    const own = shown ? this.problems()[d.name] : undefined;
    if (own) return own;
    return this.dirty().has(d.name) ? null : (this.serverErrors()[d.name] ?? null);
  }

  // ---- what the template does

  protected setText(d: ParamDef, text: string): void {
    this.write(d, text);
  }
  protected setList(d: ParamDef, list: readonly string[]): void {
    this.write(d, [...list]);
  }
  protected setPicks(d: ParamDef, picks: readonly LookupPick[]): void {
    this.write(d, [...picks]);
  }
  protected setRange(d: ParamDef, side: 'from' | 'to', iso: string): void {
    this.write(d, { ...this.rangeOf(d), [side]: iso });
  }
  protected applyPreset(d: ParamDef, key: string): void {
    const range = presetRange(key, todayInZone(this.clock.now(), this.zone));
    if (range) {
      this.write(d, { from: range.from, to: range.to });
      this.touch(d);
    }
  }
  protected touch(d: ParamDef): void {
    if (!this.touched().has(d.name)) this.touched.set(new Set([...this.touched(), d.name]));
  }
  protected badDate(key: string, bad: boolean): void {
    const next = new Set(this.badDates());
    if (bad) next.add(key);
    else next.delete(key);
    this.badDates.set(next);
  }
  protected plainNumber(d: ParamDef, event: Event): void {
    const input = event.target as HTMLInputElement;
    const plain = input.value.replace(/,/g, '');
    if (plain !== input.value) {
      input.value = plain;
      this.write(d, plain);
    }
  }
  protected groupedNumber(d: ParamDef, event: Event): void {
    const input = event.target as HTMLInputElement;
    const grouped = groupDigits(input.value.trim());
    input.value = grouped;
    this.write(d, grouped);
    this.touch(d);
  }

  protected onReset(): void {
    this.touched.set(new Set());
    this.submitted.set(false);
    this.dirty.set(new Set());
    this.badDates.set(new Set());
    this.resetValues.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.running()) return;
    if (this.check()) this.run.emit();
  }

  /** Shows every message and returns whether the form can run; the first field with a message takes the focus. */
  check(): boolean {
    this.submitted.set(true);
    const ok = Object.keys(this.problems()).length === 0;
    if (!ok) this.focusFirstProblem();
    return ok;
  }

  /** The first field with a message takes the keyboard focus (spec 3.3). */
  focusFirstProblem(): void {
    const names = this.defs()
      .map((d) => d.name)
      .filter((n) => this.problems()[n] || this.serverErrors()[n]);
    const first = names[0];
    if (!first) return;
    queueMicrotask(() => {
      const field = this.host.nativeElement.querySelector<HTMLElement>(`[data-param="${first}"]`);
      field?.querySelector<HTMLElement>('input, button, select, textarea')?.focus();
    });
  }

  // ---- choices from the report's own query

  protected async loadChoices(d: ParamDef): Promise<void> {
    this.setChoice(d, { state: 'loading', options: [], truncated: false });
    try {
      const list = await this.quiet.run(() =>
        firstValueFrom(this.api.getReportChoices(this.reportId(), d.name)),
      );
      this.setChoice(d, {
        state: 'ready',
        options: list.options.map((o) => ({ value: o.value, label: o.label })),
        truncated: list.truncated,
      });
    } catch {
      this.setChoice(d, { state: 'error', options: [], truncated: false });
    }
  }

  private setChoice(d: ParamDef, state: ChoiceState): void {
    this.choices.set({ ...this.choices(), [d.name]: state });
  }

  private fromQuery(d: ParamDef): boolean {
    return (d.type === 'single' || d.type === 'multi') && d.choicesSource === 'query';
  }

  private listLength(d: ParamDef): number {
    return d.type === 'lookup' ? this.picksOf(d).length : this.listOf(d).length;
  }

  private write(d: ParamDef, value: FieldValue): void {
    this.values.set({ ...this.values(), [d.name]: value });
    this.dirty.set(new Set([...this.dirty(), d.name]));
  }
}

const takesMany = (d: ParamDef): boolean => d.type === 'multi' || d.multiple;
