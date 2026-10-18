import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LoadState } from './data-table';
import { RecordCard, RecordCardDef, RecordCardList, phoneCards } from './record-card-list';
import { TaskCount } from './task-count';

interface Row {
  id: number;
  name: string;
  open: number;
  overdue: number;
}

@Component({
  imports: [RecordCardList, RecordCardDef, RecordCard, TaskCount],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-record-card-list
      noun="clients"
      label="Clients"
      [state]="state()"
      [empty]="rows().length === 0"
      [filtered]="filtered()"
      (retry)="retried = retried + 1"
      (clear)="cleared = cleared + 1"
    >
      <button mfEmptyAction type="button">New client</button>
      <ng-template [mfRecordCard]="rows()" let-r>
        <mf-record-card [name]="r.name" [link]="['/clients', r.id]">
          <span mfCardBadges data-badge>Active</span>
          <button mfCardAside type="button" data-copy>Copy</button>
          <p mfCardMeta class="rc-line">
            <span class="rc-text">meta of {{ r.name }}</span>
          </p>
          <mf-task-count
            mfCardCounts
            kind="open"
            scope="client"
            [word]="true"
            [recordId]="r.id"
            [count]="r.open"
          />
          @if (r.overdue > 0) {
            <mf-task-count
              mfCardCounts
              kind="overdue"
              scope="client"
              [word]="true"
              [recordId]="r.id"
              [count]="r.overdue"
            />
          }
        </mf-record-card>
      </ng-template>
    </mf-record-card-list>
  `,
})
class Host {
  readonly state = signal<LoadState>('ready');
  readonly filtered = signal(false);
  readonly rows = signal<Row[]>([
    { id: 1, name: 'Acme Corp', open: 14, overdue: 3 },
    { id: 2, name: 'Beta Ltd', open: 0, overdue: 0 },
  ]);
  retried = 0;
  cleared = 0;
}

describe('RecordCardList', () => {
  function create() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }
  const el = (f: { nativeElement: HTMLElement }) => f.nativeElement;

  it('is one list of list items, the name first in each card', () => {
    const f = create();
    const list = el(f).querySelector('ul')!;
    expect(list.getAttribute('aria-label')).toBe('Clients');
    const items = list.querySelectorAll(':scope > li');
    expect(items.length).toBe(2);
    const focusable = items[0].querySelectorAll('a[href], button');
    expect(focusable[0].textContent?.trim()).toBe('Acme Corp');
    expect(focusable[0].getAttribute('href')).toBe('/clients/1');
    expect(focusable[0].getAttribute('title')).toBe('Acme Corp');
    // The aside (copy button) follows the name, then the meta and the count links.
    expect(focusable[1].hasAttribute('data-copy')).toBe(true);
    expect(el(f).querySelector('table')).toBeNull();
  });

  it('puts badges, aside, meta and counts in their slots and says what the counts count', () => {
    const f = create();
    const card = el(f).querySelector('mf-record-card')!;
    expect(card.querySelector('.rc-badges [data-badge]')).not.toBeNull();
    expect(card.querySelector('.rc-aside [data-copy]')).not.toBeNull();
    expect(card.querySelector('.rc-meta .rc-line')!.textContent).toContain('meta of Acme Corp');
    const counts = card.querySelectorAll('.rc-counts a');
    expect(Array.from(counts).map((a) => a.textContent?.trim())).toEqual(['14 open', '3 overdue']);
    expect(counts[1].getAttribute('href')).toContain('/tasks?client=1');
    expect(counts[1].getAttribute('href')).toContain('overdue=true');
    // A zero is plain text, and a card without overdue tasks has no overdue count.
    const second = el(f).querySelectorAll('mf-record-card')[1];
    expect(second.querySelectorAll('.rc-counts a').length).toBe(0);
    expect(second.querySelector('.rc-counts')!.textContent).toContain('0 open');
    expect(second.querySelector('[data-count=overdue]')).toBeNull();
  });

  it('shows five skeleton cards and one polite loading sentence while it loads', () => {
    const f = create();
    f.componentInstance.state.set('loading');
    f.detectChanges();
    expect(el(f).querySelectorAll('li[data-skeleton]').length).toBe(5);
    expect(el(f).querySelector('[data-loading]')!.textContent?.trim()).toBe('Loading clients');
    expect(el(f).querySelector('[data-loading]')!.getAttribute('role')).toBe('status');
    expect(el(f).querySelector('mf-record-card-list')!.getAttribute('aria-busy')).toBe('true');
  });

  it('403 names the missing access without Retry; 500 offers Retry', () => {
    const f = create();
    f.componentInstance.state.set('forbidden');
    f.detectChanges();
    expect(el(f).querySelector('[data-forbidden]')!.textContent).toContain(
      "You don't have access to clients.",
    );
    expect(el(f).querySelector('button.mf-btn')).toBeNull();
    f.componentInstance.state.set('error');
    f.detectChanges();
    expect(el(f).querySelector('[data-error]')!.textContent).toContain("Couldn't load clients.");
    el(f).querySelector<HTMLButtonElement>('[data-error] button')!.click();
    expect(f.componentInstance.retried).toBe(1);
  });

  it('empty: the first-run text with the page action; filtered: Clear filters', () => {
    const f = create();
    f.componentInstance.rows.set([]);
    f.detectChanges();
    const empty = el(f).querySelector('[data-empty]')!;
    expect(empty.getAttribute('data-empty')).toBe('none');
    expect(empty.textContent).toContain('No clients yet.');
    expect(empty.querySelector('button')!.textContent).toContain('New client');
    f.componentInstance.filtered.set(true);
    f.detectChanges();
    const filtered = el(f).querySelector('[data-empty]')!;
    expect(filtered.getAttribute('data-empty')).toBe('filtered');
    expect(filtered.textContent).toContain('No clients match these filters');
    filtered.querySelector<HTMLButtonElement>('button')!.click();
    expect(f.componentInstance.cleared).toBe(1);
  });
});

describe('phoneCards', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  function width(px: number) {
    window.matchMedia = ((query: string) => {
      const max = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? Infinity);
      return {
        matches: px <= max,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    }) as never;
    return TestBed.runInInjectionContext(() => phoneCards());
  }

  it('639 is cards, 640 is the table', () => {
    expect(width(639)()).toBe(true);
    expect(width(320)()).toBe(true);
    expect(width(640)()).toBe(false);
    expect(width(768)()).toBe(false);
  });

  it('is false where the browser has no matchMedia', () => {
    (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;
    expect(TestBed.runInInjectionContext(() => phoneCards())()).toBe(false);
  });
});
