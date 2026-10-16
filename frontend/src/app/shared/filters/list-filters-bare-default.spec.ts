import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { convertToParamMap } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import {
  FilterDef,
  buildChips,
  groupOf,
  parseFilters,
  printText,
  serializeExplicit,
} from './filter-def';
import { ListFilters } from './list-filters';

const OPEN = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

/** The Task Queue's shape: a default that only a plain link gets, because links that carry filters never limited the status. */
const defs: FilterDef[] = [
  { key: 'q', label: 'Title or Ref', column: 'ref', type: 'text', span: 2 },
  {
    key: 'status',
    label: 'Status',
    column: 'status',
    type: 'multiSelect',
    default: OPEN,
    defaultOnlyBare: true,
    valueGroups: [{ label: 'Open', values: OPEN }],
    options: [
      { value: 'NEW', label: 'New' },
      { value: 'IN_PROGRESS', label: 'In progress' },
      { value: 'ON_HOLD', label: 'On hold' },
      { value: 'COMPLETED', label: 'Completed' },
    ],
  },
  { key: 'priority', label: 'Priority', column: 'priority', type: 'multiSelect' },
  { key: 'overdue', label: 'Overdue', type: 'triState' },
];

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Host {
  readonly filters = new ListFilters({ screen: 'bare-demo', defs });
}

describe('a default that only a plain link gets (defaultOnlyBare)', { timeout: 20_000 }, () => {
  let harness: RouterTestingHarness;

  async function open(url: string): Promise<ListFilters> {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    await harness.navigateByUrl('/other');
    return (await harness.navigateByUrl(url, Host)).filters;
  }
  const url = () => TestBed.inject(Router).url;
  /** The address once navigation has settled, with the query parameters in a fixed order (the router keeps the order of arrival). */
  const written = async () => {
    await harness.fixture.whenStable();
    const [path, query = ''] = decodeURIComponent(url()).split('?');
    const parts = query.split('&').filter(Boolean).sort();
    return parts.length ? `${path}?${parts.join('&')}` : path;
  };

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'list', component: Host },
          { path: 'other', component: Blank },
        ]),
        { provide: AuthStore, useValue: { profile: signal({ userId: 5 }) } },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('starts a plain link on the default, shown and not counted', async () => {
    const f = await open('/list');
    expect(f.list('status')).toEqual(OPEN);
    expect(f.activeCount()).toBe(0);
    expect(f.chips()).toEqual([]);
    expect(f.printLine()).toBe('Filters: Status Open');
  });

  it('reads a link with other filters and no status as "every status"', async () => {
    const f = await open('/list?priority=2');
    expect(f.list('status')).toEqual([]);
    expect(f.list('priority')).toEqual(['2']);
    // Every status is a change from the default, so it says so and can be taken back.
    expect(f.chips().map((c) => c.label)).toEqual(['Status: All', 'Priority: 2']);
  });

  it('does not treat sorting or paging as a filter', async () => {
    const f = await open('/list?sort=due&page=2');
    expect(f.list('status')).toEqual(OPEN);
  });

  it('reads status= as every status and a written status as itself', async () => {
    expect((await open('/list?status=')).list('status')).toEqual([]);
    expect((await open('/list?status=NEW')).list('status')).toEqual(['NEW']);
  });

  it('keeps the default in the address when another filter is chosen on a plain link', async () => {
    const f = await open('/list');
    f.set('priority', ['2']);
    expect(await written()).toBe('/list?priority=2&status=IN_PROGRESS&status=NEW&status=ON_HOLD');
    expect(f.list('status')).toEqual(OPEN);
    expect(f.activeCount()).toBe(1);
  });

  it('keeps what is shown when the last other filter goes: all statuses stay all statuses', async () => {
    const f = await open('/list?priority=2');
    f.set('priority', []);
    expect(await written()).toBe('/list?status=');
    expect(f.list('status')).toEqual([]);
  });

  it('writes a status chosen by hand and returns to the plain link when it goes back to the default alone', async () => {
    const f = await open('/list');
    f.set('status', ['COMPLETED']);
    expect(await written()).toBe('/list?status=COMPLETED');

    f.set('status', OPEN);
    expect(await written()).toBe('/list');
  });

  it('Clear filters returns to the plain link', async () => {
    const f = await open('/list?priority=2&status=NEW&overdue=true');
    f.clear();
    expect(await written()).toBe('/list');
    expect(f.activeCount()).toBe(0);
  });

  it('a quick view is a preset that writes the default only when it must', async () => {
    const f = await open('/list?priority=2');
    f.applyPreset({ status: OPEN });
    expect(await written()).toBe('/list');

    f.applyPreset({ status: OPEN, overdue: 'true' });
    expect(await written()).toBe('/list?overdue=true&status=IN_PROGRESS&status=NEW&status=ON_HOLD');

    f.applyPreset({ status: [], priority: ['1'] });
    expect(await written()).toBe('/list?priority=1&status=');
  });

  it('unticking every status writes status= and the chip takes it back to the default', async () => {
    const f = await open('/list');
    f.set('status', []);
    expect(await written()).toBe('/list?status=');
    const chip = f.chips()[0];
    expect(chip.label).toBe('Status: All');
    f.removeChip(chip);
    expect(await written()).toBe('/list');
  });
});

describe('named value groups', () => {
  const status = defs[1];

  it('finds the group a list equals, in any order', () => {
    expect(groupOf(status, ['ON_HOLD', 'NEW', 'IN_PROGRESS'])?.label).toBe('Open');
    expect(groupOf(status, ['NEW'])).toBeUndefined();
    expect(groupOf(status, [...OPEN, 'COMPLETED'])).toBeUndefined();
  });

  it('makes one chip and one print word of a group, and one chip per value otherwise', () => {
    const open = buildChips({ ...status, default: undefined, defaultOnlyBare: false }, OPEN, false);
    expect(open.map((c) => c.label)).toEqual(['Status: Open']);
    expect(open[0].remaining).toEqual([]);
    expect(printText(status, OPEN)).toBe('Status Open');
    expect(printText(status, ['NEW', 'COMPLETED'])).toBe('Status New or Completed');
    const two = buildChips(
      { ...status, default: undefined, defaultOnlyBare: false },
      ['NEW', 'COMPLETED'],
      false,
    );
    expect(two.map((c) => c.label)).toEqual(['Status: New', 'Status: Completed']);
  });

  it('serializes a value explicitly even when it is the default', () => {
    expect(serializeExplicit(status, OPEN)).toEqual({ status: OPEN });
    expect(serializeExplicit(status, [])).toEqual({ status: '' });
  });

  it('parses a plain link to the default and a deep link without it to nothing', () => {
    expect(parseFilters(defs, convertToParamMap({}))['status']).toEqual(OPEN);
    expect(parseFilters(defs, convertToParamMap({ overdue: 'true' }))['status']).toEqual([]);
    expect(parseFilters(defs, convertToParamMap({ status: 'NEW' }))['status']).toEqual(['NEW']);
  });
});
