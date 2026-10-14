import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { FormField, RuleNode, Scalar } from '../rules/types';
import {
  GroupNode,
  LeafNode,
  OperandKind,
  OperatorInfo,
  RuleOp,
  fieldName,
  hasOptions,
  isBuilderSupported,
  isGroup,
  isInputControl,
  makeLeaf,
  normalizeRule,
  operandKind,
  operatorsFor,
  summarizeRule,
} from './designer-model';

/** One condition prepared for the template. */
interface LeafView {
  /** Position in the tree: `[i]` for a root condition, `[i, j]` inside a group. */
  path: number[];
  id: string;
  label: string;
  fieldKey: string;
  /** The referenced field is not in the picker (deleted, a heading, or the field itself). */
  missing: boolean;
  op: RuleOp;
  ops: OperatorInfo[];
  kind: OperandKind;
  options: { key: string; label: string }[];
  isOptionField: boolean;
  isNumeric: boolean;
  isDate: boolean;
  scalar: string | number;
  list: (string | number)[];
}

interface GroupView {
  path: number[];
  id: string;
  label: string;
  op: 'and' | 'or';
  leaves: LeafView[];
}

type ChildView = { leaf: LeafView; group?: undefined } | { group: GroupView; leaf?: undefined };

let nextInstance = 0;

/**
 * Structured condition editor (UX S14). Edits one rule (`showWhen`, `requiredWhen` or an option's
 * `availableWhen`) as ALL/ANY groups of conditions with one nesting level, which stays within the
 * contract's depth limit of 3. Each condition only offers the operators the contract allows for
 * the chosen field's control, and value editors that fit that control.
 *
 * Inputs: `field` (the field that owns the rule), `allFields`, `rule`, `legend`, `issues`,
 * `readOnly`. Output: `ruleChange` (never undefined; the host decides when a rule exists).
 */
@Component({
  selector: 'mf-rule-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  templateUrl: './rule-builder.html',
  styleUrl: './rule-builder.scss',
})
export class RuleBuilder {
  readonly field = input.required<FormField>();
  readonly allFields = input.required<readonly FormField[]>();
  readonly rule = input.required<RuleNode>();
  readonly legend = input('Conditions');
  /** Messages from definition validation for this rule. */
  readonly issues = input<readonly string[]>([]);
  readonly readOnly = input(false);

  readonly ruleChange = output<RuleNode>();

  protected readonly uid = `mf-rb-${nextInstance++}`;

  protected readonly supported = computed(() => isBuilderSupported(this.rule()));

  /** Fields a condition may use: anything that holds an answer, except the owner. */
  protected readonly eligible = computed(() =>
    this.allFields().filter((f) => isInputControl(f.control) && f.key !== this.field().key),
  );

  protected readonly summary = computed(() => summarizeRule(this.rule(), this.allFields()));

  private readonly root = computed<GroupNode>(() => {
    const r = this.rule();
    if (!this.supported()) return { op: 'and', args: [] };
    return isGroup(r) ? r : { op: 'and', args: [r] };
  });

  protected readonly matchOp = computed(() => this.root().op);

  protected readonly children = computed<ChildView[]>(() => {
    const root = this.root();
    const out: ChildView[] = [];
    let n = 0;
    root.args.forEach((child, i) => {
      if (isGroup(child)) {
        out.push({
          group: {
            path: [i],
            id: `${this.uid}-g${i}`,
            label: `Group ${i + 1}`,
            op: child.op,
            leaves: child.args.map((l, j) =>
              this.leafView(l as LeafNode, [i, j], `${i + 1}.${j + 1}`),
            ),
          },
        });
      } else {
        out.push({ leaf: this.leafView(child as LeafNode, [i], String(++n)) });
      }
    });
    return out;
  });

  private leafView(leaf: LeafNode, path: number[], label: string): LeafView {
    const target = this.eligible().find((f) => f.key === leaf.field);
    const control = target?.control;
    const ops = target ? operatorsFor(target.control) : [];
    const value = 'value' in leaf ? leaf.value : undefined;
    return {
      path,
      id: `${this.uid}-c${path.join('-')}`,
      label,
      fieldKey: leaf.field,
      missing: !target,
      op: leaf.op,
      ops,
      kind: operandKind(leaf.op),
      options: (target?.options ?? []).map((o) => ({
        key: o.key,
        label: o.label?.trim() || o.key,
      })),
      isOptionField: !!control && hasOptions(control),
      isNumeric: control === 'NUMBER' || control === 'ASSET_REF' || control === 'USER_REF',
      isDate: control === 'DATE',
      scalar: Array.isArray(value) ? '' : ((value as string | number | undefined) ?? ''),
      list: Array.isArray(value) ? (value as (string | number)[]) : [],
    };
  }

  protected fieldName = fieldName;

  protected isSelected(view: LeafView, key: string): boolean {
    return view.list.includes(key);
  }

  // ---------------------------------------------------------------- edits

  private emit(root: GroupNode): void {
    this.ruleChange.emit(normalizeRule(root));
  }

  private mutate(fn: (root: GroupNode) => void): void {
    const root = structuredClone(this.root()) as GroupNode;
    fn(root);
    this.emit(root);
  }

  private leafAt(root: GroupNode, path: number[]): LeafNode {
    return path.length === 1
      ? (root.args[path[0]] as LeafNode)
      : ((root.args[path[0]] as GroupNode).args[path[1]] as LeafNode);
  }

  private replaceLeaf(path: number[], next: LeafNode): void {
    this.mutate((root) => {
      if (path.length === 1) root.args[path[0]] = next;
      else (root.args[path[0]] as GroupNode).args[path[1]] = next;
    });
  }

  private target(key: string): FormField | undefined {
    return this.eligible().find((f) => f.key === key);
  }

  private newLeaf(): LeafNode | null {
    const first = this.eligible()[0];
    return first ? makeLeaf(first) : null;
  }

  protected setMatch(path: number[], value: string): void {
    const op = value === 'or' ? 'or' : 'and';
    this.mutate((root) => {
      if (path.length === 0) root.op = op;
      else (root.args[path[0]] as GroupNode).op = op;
    });
  }

  protected addCondition(groupPath: number[]): void {
    const leaf = this.newLeaf();
    if (!leaf) return;
    this.mutate((root) => {
      if (groupPath.length === 0) root.args.push(leaf);
      else (root.args[groupPath[0]] as GroupNode).args.push(leaf);
    });
  }

  protected addGroup(): void {
    const leaf = this.newLeaf();
    if (!leaf) return;
    this.mutate((root) => {
      root.args.push({ op: root.op === 'and' ? 'or' : 'and', args: [leaf, structuredClone(leaf)] });
    });
  }

  protected remove(path: number[]): void {
    this.mutate((root) => {
      if (path.length === 1) root.args.splice(path[0], 1);
      else {
        const group = root.args[path[0]] as GroupNode;
        group.args.splice(path[1], 1);
        if (group.args.length === 0) root.args.splice(path[0], 1);
      }
    });
  }

  protected removeGroup(path: number[]): void {
    this.mutate((root) => {
      root.args.splice(path[0], 1);
    });
  }

  protected canRemoveLeaf(): boolean {
    if (this.readOnly()) return false;
    const total = this.children().reduce((n, c) => n + (c.leaf ? 1 : c.group.leaves.length), 0);
    return total > 1;
  }

  protected changeField(view: LeafView, key: string): void {
    const target = this.target(key);
    if (!target) return;
    const prev = this.leafAt(this.root(), view.path);
    this.replaceLeaf(view.path, makeLeaf(target, prev));
  }

  protected changeOp(view: LeafView, op: string): void {
    const target = this.target(view.fieldKey);
    if (!target) return;
    this.replaceLeaf(
      view.path,
      makeLeaf(target, this.leafAt(this.root(), view.path), op as RuleOp),
    );
  }

  private parse(view: LeafView, raw: string): string | number {
    if (view.isNumeric && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
    return raw;
  }

  protected changeScalar(view: LeafView, raw: string): void {
    const prev = this.leafAt(this.root(), view.path);
    this.replaceLeaf(view.path, { ...prev, value: this.parse(view, raw) as Scalar } as LeafNode);
  }

  protected changeList(view: LeafView, raw: string): void {
    const prev = this.leafAt(this.root(), view.path);
    const items = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map((s) => this.parse(view, s));
    this.replaceLeaf(view.path, { ...prev, value: items as Scalar[] } as LeafNode);
  }

  protected toggleListOption(view: LeafView, key: string, checked: boolean): void {
    const prev = this.leafAt(this.root(), view.path);
    const current = view.list.map(String);
    const next = checked
      ? [...current.filter((k) => k !== key), key]
      : current.filter((k) => k !== key);
    // Keep declared option order.
    const ordered = view.options.map((o) => o.key).filter((k) => next.includes(k));
    this.replaceLeaf(view.path, { ...prev, value: ordered } as LeafNode);
  }

  protected resetRule(): void {
    const leaf = this.newLeaf();
    if (leaf) this.ruleChange.emit(leaf);
  }

  protected asString(v: unknown): string {
    return String(v);
  }
}
