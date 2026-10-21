import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  AdminCardList,
  AdminCardSpec,
  ADMIN_CARD_LINES,
  activeCardBadge,
  adminCardLines,
  columnDropOrder,
} from './admin-card-spec';
import { LoadState } from './data-table';
import { rowActions } from './row-actions';

describe('columnDropOrder (#579)', () => {
  it('gives the first optional column the widest threshold and the last the narrowest', () => {
    expect(columnDropOrder(['note', 'updated', 'assets'])).toEqual({
      note: 1280,
      updated: 1100,
      assets: 900,
    });
    expect(columnDropOrder(['a', 'b', 'c', 'd', 'e'])).toEqual({
      a: 1280,
      b: 1100,
      c: 900,
      d: 768,
      e: 640,
    });
    expect(columnDropOrder([])).toEqual({});
  });

  it('refuses more optional columns than thresholds, and a column twice', () => {
    expect(() => columnDropOrder(['a', 'b', 'c', 'd', 'e', 'f'])).toThrow(/at most 5/);
    expect(() => columnDropOrder(['a', 'a'])).toThrow(/twice/);
  });
});

describe('adminCardLines (#579)', () => {
  it('puts the subtitle first and shows three lines at most', () => {
    const spec: AdminCardSpec = {
      title: 'T',
      link: ['/x'],
      rowKey: 1,
      subtitle: 'Sub',
      meta: ['one', 'two', 'three', 'four'],
    };
    expect(adminCardLines(spec).map((l) => l.text)).toEqual(['Sub', 'one', 'two']);
    expect(ADMIN_CARD_LINES).toBe(3);
  });

  it('leaves out empty lines and takes both strings and line objects', () => {
    const lines = adminCardLines({
      title: 'T',
      link: '/x',
      rowKey: 1,
      subtitle: null,
      meta: ['', { text: 'warn', warn: true }, 'plain'],
    });
    expect(lines).toEqual([{ text: 'warn', warn: true }, { text: 'plain' }]);
  });

  it('active badge: words and icon of the table badge', () => {
    expect(activeCardBadge(true)).toEqual({
      text: 'Active',
      tone: 'success',
      icon: 'pi-check-circle',
      active: true,
    });
    expect(activeCardBadge(false).text).toBe('Inactive');
    expect(activeCardBadge(null).text).toBe('Inactive');
  });
});

interface Row {
  id: number;
  name: string;
  active: boolean;
  note: string | null;
  used: number;
}

const ROWS: Row[] = [
  { id: 1, name: 'Source', active: true, note: 'Where it came from', used: 3 },
  { id: 2, name: 'Medium', active: false, note: null, used: 0 },
];
let ran: string[] = [];

@Component({
  imports: [AdminCardList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-card-list
      noun="asset types"
      label="Asset types"
      [items]="rows()"
      [spec]="cardOf"
      [state]="state()"
      [empty]="rows().length === 0"
      [filtered]="filtered()"
      [hidden]="hidden()"
      (retry)="retried = retried + 1"
      (clear)="cleared = cleared + 1"
      (showAll)="shownAll = shownAll + 1"
    >
      <button mfEmptyAction type="button">New asset type</button>
    </mf-admin-card-list>
  `,
})
class Host {
  readonly rows = signal<Row[]>(ROWS);
  readonly state = signal<LoadState>('ready');
  readonly filtered = signal(false);
  readonly hidden = signal(0);
  retried = 0;
  cleared = 0;
  shownAll = 0;
  readonly cardOf = (r: Row): AdminCardSpec => ({
    title: r.name,
    link: ['/admin/asset-types', r.id],
    rowKey: r.id,
    subtitle: r.note,
    badges: [
      activeCardBadge(r.active),
      ...(r.used > 0 ? [{ text: 'In use', tone: 'info' as const }] : []),
    ],
    meta: [
      r.used === 0
        ? 'Not used'
        : {
            text: `${r.used} assets`,
            link: { commands: ['/assets'], queryParams: { type: r.id } },
          },
    ],
    actions: rowActions(
      r.name,
      [
        { id: 'edit', label: 'Edit', run: () => ran.push(`edit ${r.id}`) },
        {
          id: 'deactivate',
          label: 'Deactivate',
          kind: 'state',
          run: () => ran.push(`off ${r.id}`),
        },
        {
          id: 'delete',
          label: 'Delete',
          danger: true,
          reason: 'Used by 3 assets. Deactivate it instead.',
          run: () => ran.push('delete'),
        },
      ],
      { can: () => true },
    ),
  });
}

describe('AdminCardList (#579)', () => {
  function create() {
    ran = [];
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }
  const root = (f: { nativeElement: HTMLElement }) => f.nativeElement;

  it('draws one card per record: the name is the link, badges, lines and the row menu', () => {
    const f = create();
    const cards = root(f).querySelectorAll('li[data-record-card]');
    expect(cards.length).toBe(2);
    const first = cards[0];
    const link = first.querySelector<HTMLAnchorElement>('a[data-card-name]')!;
    expect(link.getAttribute('href')).toBe('/admin/asset-types/1');
    expect(link.textContent?.trim()).toBe('Source');
    expect(first.querySelector('mf-active-badge')?.textContent?.trim()).toBe('Active');
    expect(first.querySelector('mf-badge:not(mf-active-badge mf-badge)')?.textContent?.trim()).toBe(
      'In use',
    );
    const lines = first.querySelectorAll('[data-card-meta]');
    expect(Array.from(lines).map((l) => l.textContent?.trim())).toEqual([
      'Where it came from',
      '3 assets',
    ]);
    expect(first.querySelector('[data-card-meta] a')?.getAttribute('href')).toBe('/assets?type=1');
    const menu = first.querySelector('mf-action-menu button')!;
    expect(menu.getAttribute('aria-label') ?? menu.textContent).toContain('Actions for Source');
    // The second card has no description: two lines less.
    expect(cards[1].querySelectorAll('[data-card-meta]').length).toBe(1);
    expect(cards[1].querySelector('mf-active-badge')?.textContent?.trim()).toBe('Inactive');
  });

  it('shows the table states: no-match with Clear filters and the hidden line, empty with the header action, error with Retry', () => {
    const f = create();
    f.componentInstance.rows.set([]);
    f.componentInstance.filtered.set(true);
    f.componentInstance.hidden.set(4);
    f.detectChanges();
    const state = root(f).querySelector('[data-empty=filtered]')!;
    expect(state.textContent).toContain('No asset types match these filters');
    expect(state.querySelector('[data-hidden-hint]')?.textContent).toContain('4 inactive hidden');
    state.querySelector<HTMLButtonElement>('[data-show-all]')!.click();
    expect(f.componentInstance.shownAll).toBe(1);
    Array.from(state.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Clear filters'))!
      .click();
    expect(f.componentInstance.cleared).toBe(1);

    f.componentInstance.filtered.set(false);
    f.detectChanges();
    expect(root(f).querySelector('[data-empty=none]')?.textContent).toContain(
      'No asset types yet.',
    );
    expect(root(f).querySelector('[data-empty=none] button')?.textContent).toContain(
      'New asset type',
    );

    f.componentInstance.state.set('error');
    f.detectChanges();
    expect(root(f).querySelector('[data-error]')?.textContent).toContain(
      "Couldn't load asset types.",
    );
    root(f).querySelector<HTMLButtonElement>('[data-error] button')!.click();
    expect(f.componentInstance.retried).toBe(1);
  });
});

const activated: string[] = [];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdminCardList],
  template: `<mf-admin-card-list
    noun="people"
    label="People"
    [items]="[1, 2]"
    [spec]="cardOf"
    state="ready"
  />`,
})
class NoAddressHost {
  readonly cardOf = (n: number): AdminCardSpec => ({
    title: `Person ${n}`,
    rowKey: n,
    activate: () => activated.push(`open ${n}`),
    primary:
      n === 1
        ? {
            label: 'Grant access',
            ariaLabel: 'Grant access to Person 1',
            run: () => activated.push('grant 1'),
          }
        : undefined,
  });
}

describe('AdminCardList: a record without an address of its own (#445)', () => {
  it('draws the name as a button that runs activate, and one primary action', () => {
    activated.length = 0;
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(NoAddressHost);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('li[data-record-card]');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('a[data-card-name]')).toBeNull();
    const name = cards[0].querySelector<HTMLButtonElement>('button[data-card-name]')!;
    expect(name.textContent?.trim()).toBe('Person 1');
    name.click();
    expect(activated).toEqual(['open 1']);
    const primary = cards[0].querySelector<HTMLButtonElement>('[data-card-primary] button')!;
    expect(primary.getAttribute('aria-label')).toBe('Grant access to Person 1');
    primary.click();
    expect(activated).toEqual(['open 1', 'grant 1']);
    expect(cards[1].querySelector('[data-card-primary]')).toBeNull();
  });
});
