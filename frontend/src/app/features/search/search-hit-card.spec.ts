import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync, existsSync } from 'node:fs';
import { provideRouter } from '@angular/router';
import { PrioritiesClient, SearchHit, StatusLabelsClient } from '../../api/generated/api-client';
import { FakePrioritiesClient, FakeStatusLabelsClient } from '../../core/lookups/lookups-testing';
import { aHit } from '../../shared/testing/search-testing';
import { RecordCardDef, RecordCardList } from '../../shared/ui/record-card-list';
import { SearchHitCard, hitCardLines } from './search-hit-card';

@Component({
  imports: [RecordCardList, RecordCardDef, SearchHitCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>Search results</h1>
      <mf-record-card-list noun="results" label="Search results" state="ready" [empty]="false">
        <ng-template [mfRecordCard]="hits()" let-hit
          ><mf-search-hit-card [hit]="hit"
        /></ng-template>
      </mf-record-card-list>
    </main>
  `,
})
class Host {
  readonly hits = signal<SearchHit[]>([]);
}

const client = aHit({
  type: 'client',
  id: 1,
  reference: '00343',
  label: 'Acme Corp',
  secondary: undefined,
  path: '/clients/1',
  matterRef: undefined,
  matterName: undefined,
});
const matter = aHit({ isSensitive: true });
const project = aHit({
  type: 'project',
  id: 3,
  reference: undefined,
  label: 'Phase 1',
  secondary: '00343-00012 Merger Review',
  path: '/projects/3',
});
const task = aHit({
  type: 'task',
  id: 1042,
  reference: 'TSK-1042',
  label: 'Process custodian data',
  secondary: 'Pat Partner',
  path: '/tasks/1042',
  status: 'NEW',
});
const asset = aHit({
  type: 'asset',
  id: 9,
  reference: 'https://evidence.example.com/ws/12345',
  label: 'Custodian laptop',
  secondary: 'Laptop',
  path: '/assets/9',
});

describe('SearchHitCard (one card for all five hit types, #472)', () => {
  function create(hits: SearchHit[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PrioritiesClient, useClass: FakePrioritiesClient },
        { provide: StatusLabelsClient, useClass: FakeStatusLabelsClient },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.componentInstance.hits.set(hits);
    fixture.detectChanges();
    return fixture;
  }
  const cards = (f: { nativeElement: HTMLElement }) =>
    Array.from(f.nativeElement.querySelectorAll<HTMLElement>('mf-record-card'));
  const meta = (card: HTMLElement) => card.querySelector('[data-card-meta]');

  afterEach(() => document.body.replaceChildren());

  it('puts the name first as the one link of the card, with the full name as its tooltip', () => {
    const f = create([matter, client, project, task, asset]);
    const links = cards(f).map((c) => c.querySelector('a[data-card-name]')!);
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Merger Review',
      'Acme Corp',
      'Phase 1',
      'Process custodian data',
      'Custodian laptop',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/matters/7',
      '/clients/1',
      '/projects/3',
      '/tasks/1042?from=search',
      '/assets/9',
    ]);
    expect(links[0].getAttribute('title')).toBe('Merger Review');
    for (const card of cards(f)) expect(card.querySelectorAll('a[href]').length).toBe(1);
    expect(f.nativeElement.querySelector('table')).toBeNull();
  });

  it('matter: reference then the client, the Sensitive badge and the Active badge', () => {
    const card = cards(create([matter]))[0];
    expect(meta(card)!.textContent).toContain('00343-00012');
    expect(meta(card)!.textContent).toContain('Acme Corp');
    expect(card.querySelector('.rc-badges')!.textContent).toContain('Sensitive');
    expect(card.querySelector('.rc-badges')!.textContent).toContain('Active');
    expect(card.querySelector('[data-sensitive-marker]')).toBeNull();
  });

  it('client: the number only', () => {
    const card = cards(create([client]))[0];
    expect(meta(card)!.textContent!.trim()).toBe('00343');
    expect(card.querySelector('[data-card-context]')).toBeNull();
  });

  it('project: no reference, the matter number and name', () => {
    const lines = hitCardLines(project);
    expect(lines.reference).toBeNull();
    expect(lines.context).toEqual(['00343-00012', 'Merger Review']);
    const card = cards(create([project]))[0];
    expect(card.querySelector('[data-card-reference]')).toBeNull();
    expect(meta(card)!.textContent).toContain('00343-00012 · Merger Review');
  });

  it('task: reference, matter and the status as a badge; never the requestor; a lock for a sensitive matter', () => {
    const f = create([{ ...task, isSensitive: true }]);
    const card = cards(f)[0];
    expect(card.querySelector('[data-card-reference]')!.textContent).toBe('TSK-1042');
    expect(meta(card)!.textContent).toContain('00343-00012 · Merger Review');
    expect(meta(card)!.textContent).not.toContain('Pat Partner');
    expect(card.querySelector('.rc-badges [data-status]')!.textContent).toContain('New');
    expect(card.querySelector('.rc-badges')!.textContent).not.toContain('Active');
    const lock = card.querySelector('[data-sensitive-marker]')!;
    expect(lock.getAttribute('aria-label')).toBe('Sensitive matter');
    expect(lock.getAttribute('role')).toBe('img');
    expect(card.querySelector('.rc-badges')!.textContent).not.toContain('Sensitive');
    // The task link remembers this page as its origin.
    expect(card.querySelector('a[data-card-name]')!.getAttribute('href')).toContain('from=search');
  });

  it('asset: type and matter on the line, the URL reference only as a tooltip, never as text', () => {
    const card = cards(create([asset]))[0];
    expect(card.textContent).not.toContain('https://');
    expect(card.querySelector('[data-card-reference]')).toBeNull();
    expect(meta(card)!.textContent).toContain('Laptop · 00343-00012 · Merger Review');
    expect(meta(card)!.getAttribute('title')).toBe('https://evidence.example.com/ws/12345');
  });

  it('an inactive record carries the Inactive badge', () => {
    const card = cards(create([{ ...client, isActive: false }]))[0];
    expect(card.querySelector('.rc-badges')!.textContent).toContain('Inactive');
  });

  it('a hit without a matter (a person who may not view matters) has no matter text and no gap', () => {
    const card = cards(
      create([{ ...task, matterRef: undefined, matterName: undefined, status: 'NEW' }]),
    )[0];
    expect(meta(card)!.textContent!.trim()).toBe('TSK-1042');
    expect(card.querySelector('.rc-sep')).toBeNull();
    const bare = cards(
      create([{ ...asset, secondary: undefined, matterRef: undefined, matterName: undefined }]),
    )[0];
    expect(meta(bare)).toBeNull();
  });

  it('a long name stays one link with the full text as its tooltip (the card clamps it to two lines)', () => {
    const name = 'Custodian laptop with a very long descriptive name '.repeat(8).trim();
    const card = cards(create([{ ...asset, label: name }]))[0];
    const link = card.querySelector('a[data-card-name]')!;
    expect(link.getAttribute('title')).toBe(name);
    expect(link.classList.contains('rc-name')).toBe(true);
  });

  it('is a list item of a named list, one Tab stop per card', () => {
    const f = create([matter, client, task]);
    const list = f.nativeElement.querySelector('ul')!;
    expect(list.getAttribute('aria-label')).toBe('Search results');
    expect(list.querySelectorAll(':scope > li').length).toBe(3);
    const stops = f.nativeElement.querySelectorAll(
      'a[href], button, [tabindex]:not([tabindex="-1"])',
    );
    expect(stops.length).toBe(3);
  });

  it('has no axe violation (names, roles, list structure) when axe is available', async () => {
    const path = process.env['E2E_AXE_PATH'];
    if (!path || !existsSync(path)) return; // axe is optional in the unit run; the e2e of #473 repeats it on the real page
    (0, eval)(readFileSync(path, 'utf8'));
    const axe = (
      globalThis as unknown as {
        axe: {
          run: (
            c: Element,
            o: unknown,
          ) => Promise<{ violations: { id: string }[]; passes: unknown[] }>;
        };
      }
    ).axe;
    const f = create([matter, client, project, { ...task, isSensitive: true }, asset]);
    const result = await axe.run(f.nativeElement, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.passes.length).toBeGreaterThan(0); // axe really ran
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
