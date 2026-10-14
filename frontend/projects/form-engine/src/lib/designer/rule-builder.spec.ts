import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FormField, RuleNode } from '../rules/types';
import { RuleBuilder } from './rule-builder';

const FIELDS: FormField[] = [
  { key: 'owner', control: 'TEXT', label: 'Owner' },
  { key: 'ocr', control: 'CHECKBOX', label: 'Requires OCR?' },
  { key: 'qty', control: 'NUMBER', label: 'Quantity' },
  {
    key: 'tags',
    control: 'MULTISELECT',
    label: 'Tags',
    options: [
      { key: 'a', label: 'Alpha' },
      { key: 'b', label: 'Beta' },
    ],
  },
  { key: 'heading', control: 'SECTION_HEADING', label: 'Heading' },
];

describe('RuleBuilder', () => {
  let fixture: ComponentFixture<RuleBuilder>;
  let emitted: RuleNode[];
  const el = (): HTMLElement => fixture.nativeElement;
  const last = (): RuleNode => emitted.at(-1)!;

  async function create(rule: RuleNode, issues: string[] = []): Promise<void> {
    fixture = TestBed.createComponent(RuleBuilder);
    fixture.componentRef.setInput('field', FIELDS[0]);
    fixture.componentRef.setInput('allFields', FIELDS);
    fixture.componentRef.setInput('rule', rule);
    fixture.componentRef.setInput('legend', 'Show only when');
    fixture.componentRef.setInput('issues', issues);
    emitted = [];
    fixture.componentInstance.ruleChange.subscribe((r) => emitted.push(r));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function choose(sel: string, value: string): Promise<void> {
    const s = el().querySelector<HTMLSelectElement>(sel)!;
    s.value = value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const options = (sel: string): string[] =>
    Array.from(el().querySelectorAll<HTMLOptionElement>(`${sel} option`)).map((o) => o.value);

  it('lists answer-bearing fields only, never the owner, headings or help text', async () => {
    await create({ op: 'isTrue', field: 'ocr' });
    expect(options('select[aria-label="Condition 1 field"]')).toEqual(['ocr', 'qty', 'tags']);
  });

  it('offers only valid operators for the chosen field type', async () => {
    await create({ op: 'isTrue', field: 'ocr' });
    expect(options('select[aria-label="Condition 1 comparison"]')).toEqual([
      'isTrue',
      'isFalse',
      'isEmpty',
      'isNotEmpty',
    ]);
    await choose('select[aria-label="Condition 1 field"]', 'qty');
    expect(last()).toEqual({ op: 'eq', field: 'qty', value: 0 });
  });

  it('shows comparison operators for numbers but not for options', async () => {
    await create({ op: 'eq', field: 'qty', value: 3 });
    expect(options('select[aria-label="Condition 1 comparison"]')).toContain('gte');
    expect(options('select[aria-label="Condition 1 comparison"]')).not.toContain('contains');
  });

  it('switches operator and value editors together', async () => {
    await create({ op: 'eq', field: 'qty', value: 3 });
    await choose('select[aria-label="Condition 1 comparison"]', 'in');
    expect(last()).toEqual({ op: 'in', field: 'qty', value: [] });

    await create({ op: 'in', field: 'qty', value: [] });
    const input = el().querySelector<HTMLInputElement>('input[aria-label^="Condition 1 values"]')!;
    input.value = '1, 2, 3';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(last()).toEqual({ op: 'in', field: 'qty', value: [1, 2, 3] });
  });

  it('adds conditions and groups with ALL/ANY, within the allowed depth', async () => {
    await create({ op: 'isTrue', field: 'ocr' });
    expect(el().querySelector('select[id$="-match"]')).toBeNull();
    (el().querySelector('.rb__actions button') as HTMLButtonElement).click();
    expect(last()).toMatchObject({ op: 'and', args: [{ op: 'isTrue' }, { op: 'isTrue' }] });

    await create({
      op: 'and',
      args: [
        { op: 'isTrue', field: 'ocr' },
        { op: 'isFalse', field: 'ocr' },
      ],
    });
    await choose('select[id$="-match"]', 'or');
    expect(last()).toMatchObject({ op: 'or' });

    await create({
      op: 'or',
      args: [
        { op: 'isTrue', field: 'ocr' },
        { op: 'isFalse', field: 'ocr' },
      ],
    });
    const buttons = el().querySelectorAll<HTMLButtonElement>('.rb__actions button');
    buttons[1].click();
    const group = (last() as { args: RuleNode[] }).args[2] as { op: string; args: unknown[] };
    expect(group.op).toBe('and'); // opposite of the root's "or"
    expect(group.args.length).toBe(2);
  });

  it('removes conditions but never the last one', async () => {
    await create({
      op: 'and',
      args: [
        { op: 'isTrue', field: 'ocr' },
        { op: 'eq', field: 'qty', value: 1 },
      ],
    });
    (el().querySelector('button[aria-label="Remove condition 1"]') as HTMLButtonElement).click();
    expect(last()).toEqual({ op: 'eq', field: 'qty', value: 1 });

    await create({ op: 'isTrue', field: 'ocr' });
    expect(
      (el().querySelector('button[aria-label="Remove condition 1"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('edits option-based values and shows a plain-language summary', async () => {
    await create({ op: 'contains', field: 'tags', value: 'a' });
    expect(el().querySelector('.rb__summary')!.textContent).toContain('Tags includes "Alpha"');
    await choose('select[aria-label="Condition 1 value"]', 'b');
    expect(last()).toEqual({ op: 'contains', field: 'tags', value: 'b' });
  });

  it('shows validation messages and flags a missing field', async () => {
    await create({ op: 'isTrue', field: 'gone' }, ['This rule uses a field that does not exist.']);
    expect(el().querySelector('.rb__errors')!.textContent).toContain('does not exist');
    const select = el().querySelector('select[aria-label="Condition 1 field"]')!;
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.textContent).toContain('Missing field (gone)');
  });

  it('does not edit rules it cannot represent', async () => {
    await create({ op: 'not', arg: { op: 'isTrue', field: 'ocr' } });
    expect(el().textContent).toContain("can't edit");
    (el().querySelector('.rb__btn') as HTMLButtonElement).click();
    expect(last()).toEqual({ op: 'isTrue', field: 'ocr' });
  });
});
