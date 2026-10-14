import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { DateInput } from '../renderer/date-input';
import { DynamicForm } from '../renderer/dynamic-form';
import { FormControl, FormOption, RuleNode } from '../rules/types';
import {
  CONTROL_CATALOG,
  DesignerDefinition,
  DesignerField,
  DesignerIssue,
  Dependent,
  IssueSlot,
  controlLabel,
  defaultValues,
  dependentsOf,
  diagnoseDefinition,
  fieldName,
  hasErrors,
  hasOptions,
  isInputControl,
  isTextFamily,
  makeLeaf,
  moveItem,
  newField,
  slugFieldKey,
  slugOptionKey,
  toRuntimeDefinition,
} from './designer-model';
import { RuleBuilder } from './rule-builder';

let nextInstance = 0;

const num = (raw: string): number | undefined => (raw.trim() === '' ? undefined : Number(raw));

const WHERE: Record<Dependent['where'], string> = {
  showWhen: 'visibility rule',
  requiredWhen: 'required rule',
  option: 'option rule',
  section: 'section',
};

/**
 * Admin form designer (UX S14): palette, canvas, properties, rule builder, live preview and a
 * validation panel. Pure UI over a definition: it never saves anything.
 *
 * Inputs: `definition` (the draft being edited), `saved` (last saved definition; its field keys,
 * option keys and field types are locked), `readOnly` (published versions).
 * Outputs: `definitionChange` (every edit), `issuesChange` (current diagnostics, errors block publish).
 */
@Component({
  selector: 'mf-form-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DynamicForm, DateInput, RuleBuilder, NgTemplateOutlet],
  templateUrl: './form-designer.html',
  styleUrl: './form-designer.scss',
})
export class FormDesigner {
  readonly definition = input.required<DesignerDefinition>();
  readonly saved = input<DesignerDefinition | null>(null);
  readonly readOnly = input(false);
  /**
   * Problems the host learned elsewhere (for example the server's publish validation). They are listed with the local
   * diagnostics and shown inline next to their field, but they do not hide the preview.
   */
  readonly externalIssues = input<readonly DesignerIssue[]>([]);

  readonly definitionChange = output<DesignerDefinition>();
  readonly issuesChange = output<DesignerIssue[]>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly uid = `mf-fd-${nextInstance++}`;

  protected readonly catalog = CONTROL_CATALOG;
  protected readonly controlLabel = controlLabel;
  protected readonly fieldName = fieldName;
  protected readonly hasOptions = hasOptions;
  protected readonly isInputControl = isInputControl;
  protected readonly isTextFamily = isTextFamily;

  private readonly preview = viewChild(DynamicForm);

  protected readonly fields = linkedSignal<DesignerField[]>(() => [...this.definition().fields]);
  protected readonly selected = signal(-1);
  protected readonly announcement = signal('');
  protected readonly blockMessage = signal('');
  protected readonly keyMessage = signal('');
  protected readonly testSubmitted = signal(false);

  private readonly localIssues = computed(() => diagnoseDefinition(this.fields()));
  protected readonly issues = computed(() => [...this.localIssues(), ...this.externalIssues()]);
  protected readonly errorCount = computed(
    () => this.issues().filter((i) => i.severity === 'error').length,
  );
  protected readonly blocked = computed(() => hasErrors(this.localIssues()));

  protected readonly current = computed<DesignerField | null>(
    () => this.fields()[this.selected()] ?? null,
  );

  protected readonly currentIssues = computed(() => {
    const c = this.current();
    return c ? this.issues().filter((i) => i.fieldKey === c.key) : [];
  });

  protected readonly problemCount = computed(() => {
    const m = new Map<string, number>();
    for (const i of this.issues()) {
      if (i.fieldKey && i.severity === 'error') m.set(i.fieldKey, (m.get(i.fieldKey) ?? 0) + 1);
    }
    return m;
  });

  protected readonly sections = computed(() =>
    this.fields().filter((f, i) => f.control === 'SECTION_HEADING' && i !== this.selected()),
  );

  protected readonly eligibleForRules = computed(() => {
    const c = this.current();
    return this.fields().filter((f) => isInputControl(f.control) && f !== c);
  });

  protected readonly previewDefinition = computed(() => toRuntimeDefinition(this.fields()));

  protected readonly previewValues = computed(() => defaultValues(this.fields()), {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  constructor() {
    // Report diagnostics to the host (it disables Publish while errors remain).
    afterNextRender(() => this.issuesChange.emit(this.localIssues()), { injector: this.injector });
  }

  // ---------------------------------------------------------------- helpers

  protected v(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  protected rowId(suffix: string): string {
    return `${this.uid}-${suffix}`;
  }

  protected msgs(slot: IssueSlot): string[] {
    return this.currentIssues()
      .filter((i) => i.slot === slot)
      .map((i) => i.message);
  }

  protected isLocked(f: DesignerField): boolean {
    return !!this.saved()?.fields.some((s) => s.key === f.key);
  }

  protected isOptionLocked(f: DesignerField, o: FormOption): boolean {
    const old = this.saved()?.fields.find((s) => s.key === f.key);
    return !!old?.options?.some((x) => x.key === o.key);
  }

  protected optionRuleIssues(o: FormOption): string[] {
    return this.msgs(`option:${o.key}`);
  }

  protected requiredMode(f: DesignerField): 'never' | 'always' | 'conditional' {
    return f.requiredWhen ? 'conditional' : f.required ? 'always' : 'never';
  }

  protected summary(f: DesignerField): string {
    const parts: string[] = [];
    if (f.requiredWhen) parts.push('required when...');
    else if (f.required) parts.push('required');
    if (f.showWhen) parts.push('shown when...');
    return parts.join(', ');
  }

  protected rowLabel(f: DesignerField): string {
    return f.control === 'HELP_TEXT' ? f.helpText?.trim() || 'Help text' : fieldName(f);
  }

  protected dependentsMessage(list: Dependent[]): string {
    const names = new Map<string, string[]>();
    for (const d of list) {
      const f = this.fields().find((x) => x.key === d.fieldKey);
      const name = f ? fieldName(f) : d.fieldKey;
      names.set(name, [...(names.get(name) ?? []), WHERE[d.where]]);
    }
    return [...names].map(([n, w]) => `${n} (${[...new Set(w)].join(', ')})`).join('; ');
  }

  private commit(next: DesignerField[]): void {
    this.fields.set(next);
    this.definitionChange.emit({ fields: next });
    this.issuesChange.emit(diagnoseDefinition(next));
  }

  private update(index: number, fn: (f: DesignerField) => void): void {
    const next = this.fields().map((f, i) => {
      if (i !== index) return f;
      const copy: DesignerField = { ...f };
      fn(copy);
      for (const k of Object.keys(copy) as (keyof DesignerField)[]) {
        if (copy[k] === undefined) delete copy[k];
      }
      if (copy.validation && Object.values(copy.validation).every((x) => x === undefined)) {
        delete copy.validation;
      }
      return copy;
    });
    this.commit(next);
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(
      () => {
        const el = this.host.nativeElement.querySelector<HTMLElement>(selector);
        const target = el?.matches('input,select,button,textarea')
          ? el
          : el?.querySelector<HTMLElement>('input,select,button,textarea');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  // ---------------------------------------------------------------- canvas

  protected select(index: number): void {
    this.selected.set(index);
    this.blockMessage.set('');
    this.keyMessage.set('');
  }

  protected add(control: FormControl): void {
    if (this.readOnly()) return;
    const fields = this.fields();
    const at = this.selected() >= 0 ? this.selected() + 1 : fields.length;
    const field = newField(control, fields);
    const next = [...fields.slice(0, at), field, ...fields.slice(at)];
    this.commit(next);
    this.selected.set(at);
    this.blockMessage.set('');
    this.announcement.set(
      `Added ${controlLabel(control)} at position ${at + 1} of ${next.length}.`,
    );
    this.focusAfterRender('[data-slot="label"]');
  }

  protected move(index: number, delta: -1 | 1): void {
    const fields = this.fields();
    const to = index + delta;
    if (to < 0 || to >= fields.length) return;
    this.commit(moveItem(fields, index, delta));
    if (this.selected() === index) this.selected.set(to);
    else if (this.selected() === to) this.selected.set(index);
    this.announcement.set(
      `Moved ${this.rowLabel(fields[index])} ${delta < 0 ? 'up' : 'down'} to position ${to + 1} of ${fields.length}.`,
    );
    this.focusAfterRender(`[data-move="${delta < 0 ? 'up' : 'down'}-${to}"]`);
  }

  protected remove(index: number): void {
    const fields = this.fields();
    const f = fields[index];
    const deps = dependentsOf(fields, f.key);
    if (deps.length) {
      this.blockMessage.set(
        `Can't delete ${fieldName(f)}. It is used by: ${this.dependentsMessage(deps)}. Remove those rules first.`,
      );
      return;
    }
    const next = fields.filter((_, i) => i !== index);
    this.commit(next);
    this.selected.set(next.length ? Math.min(index, next.length - 1) : -1);
    this.blockMessage.set('');
    this.announcement.set(`Deleted ${this.rowLabel(f)}.`);
    this.focusAfterRender(
      next.length ? `[data-row="${Math.min(index, next.length - 1)}"]` : '[data-palette]',
    );
  }

  protected indentOf(f: DesignerField): boolean {
    return !!f.section && this.fields().some((s) => s.key === f.section);
  }

  // ---------------------------------------------------------------- properties

  protected setLabel(value: string): void {
    const i = this.selected();
    const f = this.current();
    if (!f) return;
    this.update(i, (c) => {
      if (c.control === 'HELP_TEXT') {
        c.helpText = value;
        return;
      }
      c.label = value;
      // The key follows the label until it is saved, hand-edited, or used by a rule.
      const auto =
        !this.isLocked(f) &&
        f.key === slugFieldKey(f.label ?? '', this.fields(), f.key) &&
        dependentsOf(this.fields(), f.key).length === 0 &&
        value.trim() !== '';
      if (auto) c.key = slugFieldKey(value, this.fields(), f.key);
    });
  }

  protected setKey(value: string): void {
    const f = this.current();
    if (!f || this.isLocked(f)) return;
    const key = value.trim();
    const deps = dependentsOf(this.fields(), f.key);
    if (deps.length) {
      this.keyMessage.set(
        `Can't rename the key while rules use it: ${this.dependentsMessage(deps)}.`,
      );
      return;
    }
    this.keyMessage.set('');
    this.update(this.selected(), (c) => (c.key = key));
  }

  protected setHelp(value: string): void {
    this.update(this.selected(), (c) => (c.helpText = value === '' ? undefined : value));
  }

  protected setSection(value: string): void {
    this.update(this.selected(), (c) => (c.section = value === '' ? undefined : value));
  }

  protected setControl(value: string): void {
    const control = value as FormControl;
    this.update(this.selected(), (c) => {
      c.control = control;
      delete c.defaultValue;
      if (!isInputControl(control)) {
        delete c.required;
        delete c.requiredWhen;
        delete c.validation;
        delete c.options;
        return;
      }
      if (hasOptions(control)) {
        c.options = c.options?.length
          ? c.options
          : [
              { key: 'option_1', label: 'Option 1' },
              { key: 'option_2', label: 'Option 2' },
            ];
      } else {
        delete c.options;
      }
      const v = c.validation;
      if (v) {
        const numeric = control === 'NUMBER' || control === 'DATE';
        c.validation = {
          min: numeric ? v.min : undefined,
          max: numeric ? v.max : undefined,
          maxLength: isTextFamily(control) ? v.maxLength : undefined,
          pattern: isTextFamily(control) ? v.pattern : undefined,
        };
      }
    });
  }

  protected setRequiredMode(mode: string): void {
    const f = this.current();
    if (!f) return;
    this.update(this.selected(), (c) => {
      delete c.requiredWhen;
      c.required = mode === 'always' ? true : undefined;
      if (mode === 'conditional') {
        const first = this.eligibleForRules()[0];
        if (first) c.requiredWhen = makeLeaf(first);
      }
    });
  }

  protected setVisibilityMode(mode: string): void {
    this.update(this.selected(), (c) => {
      delete c.showWhen;
      if (mode === 'conditional') {
        const first = this.eligibleForRules()[0];
        if (first) c.showWhen = makeLeaf(first);
      }
    });
  }

  protected setRule(slot: 'showWhen' | 'requiredWhen', rule: RuleNode): void {
    this.update(this.selected(), (c) => (c[slot] = rule));
  }

  protected setValidation(prop: 'min' | 'max' | 'maxLength' | 'pattern', raw: string): void {
    this.update(this.selected(), (c) => {
      const v = { ...c.validation };
      if (prop === 'pattern') v.pattern = raw === '' ? undefined : raw;
      else if (prop === 'maxLength') v.maxLength = num(raw);
      else if (c.control === 'DATE') v[prop] = raw === '' ? undefined : raw;
      else v[prop] = num(raw);
      c.validation = v;
    });
  }

  protected validationValue(prop: 'min' | 'max' | 'maxLength' | 'pattern'): string | number {
    return this.current()?.validation?.[prop] ?? '';
  }

  protected setDefault(value: string | number | boolean | string[] | undefined): void {
    this.update(this.selected(), (c) => {
      c.defaultValue = value === '' ? undefined : value;
    });
  }

  protected setDefaultNumber(raw: string): void {
    this.setDefault(num(raw));
  }

  protected toggleDefaultOption(key: string, on: boolean): void {
    const f = this.current();
    if (!f) return;
    const now = Array.isArray(f.defaultValue) ? f.defaultValue : [];
    const next = (f.options ?? [])
      .map((o) => o.key)
      .filter((k) => (k === key ? on : now.includes(k)));
    this.setDefault(next.length ? next : undefined);
  }

  protected defaultHas(key: string): boolean {
    const d = this.current()?.defaultValue;
    return Array.isArray(d) && d.includes(key);
  }

  // ---------------------------------------------------------------- options

  private updateOptions(fn: (options: FormOption[]) => FormOption[]): void {
    this.update(this.selected(), (c) => (c.options = fn([...(c.options ?? [])])));
  }

  protected addOption(): void {
    this.updateOptions((opts) => {
      const n = opts.length + 1;
      return [...opts, { key: slugOptionKey(`option_${n}`, opts), label: `Option ${n}` }];
    });
    const count = this.current()?.options?.length ?? 0;
    this.focusAfterRender(`[data-option-label="${count}"]`);
  }

  protected removeOption(i: number): void {
    this.updateOptions((opts) => opts.filter((_, j) => j !== i));
  }

  protected moveOption(i: number, delta: -1 | 1): void {
    this.updateOptions((opts) => moveItem(opts, i, delta));
    this.focusAfterRender(`[data-option-move="${delta < 0 ? 'up' : 'down'}-${i + delta}"]`);
  }

  protected setOptionLabel(i: number, label: string): void {
    const f = this.current();
    this.updateOptions((opts) => {
      const o = opts[i];
      const locked = !!f && this.isOptionLocked(f, o);
      const auto =
        !locked &&
        (/^option_\d+$/.test(o.key) || o.key === slugOptionKey(o.label ?? '', opts, o.key));
      opts[i] = {
        ...o,
        label,
        key: auto && label.trim() ? slugOptionKey(label, opts, o.key) : o.key,
      };
      return opts;
    });
  }

  protected setOptionKey(i: number, key: string): void {
    this.updateOptions((opts) => {
      opts[i] = { ...opts[i], key: key.trim() };
      return opts;
    });
  }

  protected toggleOptionRule(i: number, on: boolean): void {
    this.updateOptions((opts) => {
      const o = { ...opts[i] };
      delete o.availableWhen;
      if (on) {
        const first = this.eligibleForRules()[0];
        if (first) o.availableWhen = makeLeaf(first);
      }
      opts[i] = o;
      return opts;
    });
  }

  protected setOptionRule(i: number, rule: RuleNode): void {
    this.updateOptions((opts) => {
      opts[i] = { ...opts[i], availableWhen: rule };
      return opts;
    });
  }

  // ---------------------------------------------------------------- issues and preview

  protected goTo(issue: DesignerIssue): void {
    if (issue.fieldKey === undefined) return;
    const index = this.fields().findIndex((f) => f.key === issue.fieldKey);
    if (index < 0) return;
    this.select(index);
    this.focusAfterRender(`[data-slot="${issue.slot}"]`);
  }

  protected issueLabel(issue: DesignerIssue): string {
    const f = this.fields().find((x) => x.key === issue.fieldKey);
    return f ? this.rowLabel(f) : 'Form';
  }

  protected testSubmit(): void {
    this.testSubmitted.set(true);
    this.preview()?.validate();
  }
}
