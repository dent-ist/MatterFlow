import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WorkStrip } from '../work-queue/work-strip';
import { StripDef, StripMode, stripActiveKey, stripItems, stripPick } from './strip-items';

interface Row {
  active: boolean;
  fields: number;
  pending?: boolean;
}

const CHIPS: StripDef<Row>[] = [
  { key: 'active', label: 'Active', matches: (r) => r.active, params: { status: null } },
  {
    key: 'noFields',
    label: 'No published fields',
    hint: 'Active asset types with no published field',
    alert: true,
    matches: (r) => r.active && r.fields === 0,
    params: { status: null, fields: 'none' },
  },
  { key: 'inactive', label: 'Inactive', matches: (r) => !r.active, params: { status: 'inactive' } },
];

const SEGMENTS: StripDef<Row>[] = [
  { key: 'pending', label: 'Pending', matches: (r) => !!r.pending, params: { status: 'pending' } },
  {
    key: 'active',
    label: 'Active',
    matches: (r) => r.active && !r.pending,
    params: { status: null },
  },
  { key: 'inactive', label: 'Inactive', matches: (r) => !r.active, params: { status: 'inactive' } },
  { key: 'all', label: 'All', params: { status: 'all' } },
];

const ROWS: Row[] = [
  { active: true, fields: 3 },
  { active: true, fields: 0 },
  { active: false, fields: 2 },
  { active: true, fields: 1, pending: true },
];

describe('stripItems (#581)', () => {
  it('counts over the loaded list, zero stays in place, -- (null) while it loads', () => {
    expect(stripItems(ROWS, CHIPS).map((i) => [i.key, i.count])).toEqual([
      ['active', 3],
      ['noFields', 1],
      ['inactive', 1],
    ]);
    expect(stripItems([], CHIPS).map((i) => i.count)).toEqual([0, 0, 0]);
    expect(stripItems(null, CHIPS).map((i) => i.count)).toEqual([null, null, null]);
    expect(stripItems(undefined, CHIPS)[0].count).toBeNull();
  });

  it('carries the hint and the alert in chip mode; a segment is never an alarm', () => {
    const chip = stripItems(ROWS, CHIPS, { mode: 'chips' })[1];
    expect(chip.alert).toBe(true);
    expect(chip.hint).toBe('Active asset types with no published field');
    expect(stripItems(ROWS, CHIPS, { mode: 'segments' })[1].alert).toBeUndefined();
  });

  it('counts "All" as every record in segment mode', () => {
    expect(stripItems(ROWS, SEGMENTS, { mode: 'segments' }).map((i) => i.count)).toEqual([
      1, 2, 1, 4,
    ]);
  });
});

describe('stripActiveKey (#581)', () => {
  const at = (values: Record<string, string>) => (p: string) => values[p] ?? null;

  it('names the item the address stands for exactly', () => {
    expect(stripActiveKey(CHIPS, at({}))).toBe('active');
    expect(stripActiveKey(CHIPS, at({ fields: 'none' }))).toBe('noFields');
    expect(stripActiveKey(CHIPS, at({ status: 'inactive' }))).toBe('inactive');
  });

  it('is none when the filters are something the strip has no item for', () => {
    expect(stripActiveKey(CHIPS, at({ status: 'inactive', fields: 'none' }))).toBeNull();
    expect(stripActiveKey(CHIPS, at({ status: 'all' }))).toBeNull();
    expect(stripActiveKey(SEGMENTS, at({ status: 'all' }))).toBe('all');
  });
});

describe('stripPick (#581)', () => {
  it('chips: a pick replaces the earlier one and the pressed chip again goes home', () => {
    expect(stripPick(CHIPS, 'noFields', 'active')).toEqual({
      key: 'noFields',
      params: { status: null, fields: 'none' },
    });
    expect(stripPick(CHIPS, 'inactive', 'noFields')).toEqual({
      key: 'inactive',
      params: { status: 'inactive', fields: null },
    });
    expect(stripPick(CHIPS, 'inactive', 'inactive')).toEqual({
      key: 'active',
      params: { status: null, fields: null },
    });
  });

  it('segments: one is always pressed, the pressed one stays', () => {
    expect(stripPick(SEGMENTS, 'pending', 'active', { mode: 'segments' })).toEqual({
      key: 'pending',
      params: { status: 'pending' },
    });
    expect(stripPick(SEGMENTS, 'pending', 'pending', { mode: 'segments' })?.key).toBe('pending');
    expect(stripPick(SEGMENTS, 'all', 'pending', { mode: 'segments' })?.params).toEqual({
      status: 'all',
    });
  });

  it('an unknown or inert key changes nothing', () => {
    expect(stripPick(CHIPS, 'nope', 'active')).toBeNull();
    const inert: StripDef<Row>[] = [...CHIPS, { key: 'total', label: 'Total', inert: true }];
    expect(stripPick(inert, 'total', 'active')).toBeNull();
    expect(stripItems(ROWS, inert)[3].inert).toBe(true);
    expect(stripActiveKey(inert, () => null)).toBe('active');
  });
});

@Component({
  imports: [WorkStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-work-strip
    label="Users summary"
    [items]="items()"
    [interactive]="true"
    [segments]="mode === 'segments'"
    [active]="active()"
    (pick)="pick($event)"
  />`,
})
class Host {
  mode: StripMode = 'segments';
  readonly list = signal<readonly Row[] | null>(null);
  readonly address = signal<Record<string, string | null>>({ status: 'pending' });
  readonly items = computed(() => stripItems(this.list(), SEGMENTS, { mode: this.mode }));
  readonly active = computed(() => stripActiveKey(SEGMENTS, (p) => this.address()[p] ?? null));
  pick(key: string): void {
    const to = stripPick(SEGMENTS, key, this.active(), { mode: this.mode });
    if (to) this.address.set(to.params);
  }
}

describe('segments on the strip, end to end (#581)', () => {
  function create() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }
  const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('button'));

  it('shows -- while loading, then counts; exactly one segment is pressed and the choice writes the address', () => {
    const { f, el } = create();
    expect(el.querySelector('ul')!.classList).toContain('seg');
    expect(buttons(el).map((b) => b.querySelector('.n')!.textContent)).toEqual([
      '--',
      '--',
      '--',
      '--',
    ]);
    f.componentInstance.list.set(ROWS);
    f.detectChanges();
    expect(buttons(el).map((b) => b.querySelector('.n')!.textContent)).toEqual([
      '1',
      '2',
      '1',
      '4',
    ]);
    expect(buttons(el).map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    buttons(el)[2].click();
    f.detectChanges();
    expect(f.componentInstance.address()).toEqual({ status: 'inactive' });
    expect(buttons(el).map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    // The pressed segment again stays pressed.
    buttons(el)[2].click();
    f.detectChanges();
    expect(buttons(el)[2].getAttribute('aria-pressed')).toBe('true');
    // The default status leaves the address (null), and Active is pressed again.
    buttons(el)[1].click();
    f.detectChanges();
    expect(f.componentInstance.address()).toEqual({ status: null });
    expect(buttons(el)[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('a muted zero keeps its place', () => {
    const { f, el } = create();
    f.componentInstance.list.set([]);
    f.detectChanges();
    expect(el.querySelector('[data-strip-item="pending"]')!.classList).toContain('zero');
  });
});
