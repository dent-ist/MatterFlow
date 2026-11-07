import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from '../../core/http/api-error';
import { settle } from '../../shared/testing/org-testing';
import { ddChoose, ddOptionTexts, ddText } from '../../testing/dropdown-testing.spec-util';
import { ReportLookupField } from './report-lookup-field';
import { LookupRecord, ReportLookupSource } from './report-lookup-source';
import { LookupPick, ParamDef } from './report-params';
import { aParam } from './reports-testing';

type Mock = ReturnType<typeof vi.fn>;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReportLookupField],
  template: `<mf-report-lookup
    [def]="def()"
    inputId="rpf-test"
    [error]="error()"
    [(value)]="value"
  />`,
})
class Host {
  readonly def = signal<ParamDef>(
    aParam({ name: 'CLIENT', type: 'lookup', lookupKind: 'client', label: 'Client' }),
  );
  readonly error = signal<string | null>(null);
  readonly value = signal<readonly LookupPick[]>([]);
}

const denied = () =>
  Promise.reject(ApiError.from(new HttpErrorResponse({ status: 403, error: { status: 403 } })));

describe('ReportLookupField (#719)', () => {
  let source: Record<'isSearched' | 'search' | 'list' | 'labels', Mock>;
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const records: LookupRecord[] = [
    { id: 1, label: 'Pod A' },
    { id: 2, label: 'Pod B' },
  ];

  async function create(def: ParamDef, value: readonly LookupPick[] = []): Promise<void> {
    source = {
      isSearched: vi.fn((kind: string | undefined) =>
        ['matter', 'client', 'user'].includes(kind ?? ''),
      ),
      search: vi.fn().mockResolvedValue([{ id: 9, label: '00017 Acme' }]),
      list: vi.fn().mockResolvedValue(records),
      labels: vi.fn().mockResolvedValue([]),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ReportLookupSource, useValue: source }],
    });
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.def.set(def);
    fixture.componentInstance.value.set(value);
    await settle(fixture);
  }

  it('draws the shared typeahead picker for a client or a matter, with the label and (required)', async () => {
    await create(
      aParam({ name: 'C', type: 'lookup', lookupKind: 'client', label: 'Client', required: true }),
    );
    expect(el().querySelector('mf-entity-picker')).not.toBeNull();
    expect(el().querySelector('label')!.textContent).toContain('Client');
    expect(el().querySelector('label')!.textContent).toContain('(required)');
  });

  it('shows a chosen record as its words and keeps the id for the run', async () => {
    await create(aParam({ name: 'C', type: 'lookup', lookupKind: 'client', label: 'Client' }), [
      { id: 9, label: '00017 Acme' },
    ]);
    expect(el().querySelector('[data-chosen]')!.textContent).toContain('00017 Acme');
  });

  it('fetches the words of an id that came from the address, once', async () => {
    await create(aParam({ name: 'C', type: 'lookup', lookupKind: 'client', label: 'Client' }), [
      { id: 9, label: '' },
    ]);
    source.labels.mockResolvedValue([{ id: 9, label: '00017 Acme' }]);
    fixture.componentInstance.value.set([{ id: 9, label: '' }]);
    await settle(fixture);
    expect(source.labels).toHaveBeenCalledWith('client', [9]);
    expect(fixture.componentInstance.value()).toEqual([{ id: 9, label: '00017 Acme' }]);
  });

  it('shows a short kind (a pod) as the plain dropdown, loaded whole once, with Any for an optional one', async () => {
    await create(aParam({ name: 'P', type: 'lookup', lookupKind: 'pod', label: 'Pod' }));
    expect(source.list).toHaveBeenCalledWith('pod');
    expect(ddOptionTexts(el(), 'Pod')).toEqual(['Any', 'Pod A', 'Pod B']);
    ddChoose(el(), 'Pod', '2');
    await settle(fixture);
    expect(fixture.componentInstance.value()).toEqual([{ id: 2, label: 'Pod B' }]);
    expect(ddText(el(), 'Pod')).toBe('Pod B');
  });

  it('takes several pods with the multi dropdown', async () => {
    await create(
      aParam({ name: 'P', type: 'lookup', lookupKind: 'pod', label: 'Pods', multiple: true }),
    );
    ddChoose(el(), 'Pods', '1');
    await settle(fixture);
    expect(fixture.componentInstance.value()).toEqual([{ id: 1, label: 'Pod A' }]);
  });

  it("shows its own line when the read is refused: You don't have access to pods. with Retry, and the rest keeps working", async () => {
    source = undefined as never;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ReportLookupSource,
          useValue: {
            isSearched: () => false,
            list: vi.fn().mockImplementation(denied),
            search: vi.fn(),
            labels: vi.fn().mockResolvedValue([]),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.def.set(
      aParam({ name: 'P', type: 'lookup', lookupKind: 'pod', label: 'Pod' }),
    );
    await settle(fixture);
    const line = el().querySelector('[data-lookup-failure]')!;
    expect(line.textContent).toContain("You don't have access to pods.");
    expect(line.querySelector('[data-lookup-retry]')).not.toBeNull();
  });

  it("says Couldn't load clients. for any other failure and tries again on Retry", async () => {
    await create(
      aParam({ name: 'C', type: 'lookup', lookupKind: 'matter', multiple: true, label: 'Matters' }),
    );
    source.search.mockRejectedValueOnce(new Error('network'));
    // The multi dropdown asks the server as the person types.
    const input = document.createElement('input');
    expect(input).toBeTruthy();
    (
      fixture.debugElement.query((d) => d.name === 'mf-dropdown').componentInstance as {
        searched: { emit(v: string): void };
      }
    ).searched.emit('acme');
    await settle(fixture);
    const line = el().querySelector('[data-lookup-failure]')!;
    expect(line.textContent).toContain("Couldn't load matters.");
    source.search.mockResolvedValue([{ id: 4, label: '00017-00002 Merger' }]);
    (line.querySelector('[data-lookup-retry]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el().querySelector('[data-lookup-failure]')).toBeNull();
    expect(source.search).toHaveBeenLastCalledWith('matter', 'acme');
  });

  it('shows the error of the form under the field and names it for assistive technology', async () => {
    await create(aParam({ name: 'P', type: 'lookup', lookupKind: 'pod', label: 'Pod' }));
    fixture.componentInstance.error.set('Select Pod.');
    await settle(fixture);
    expect(el().querySelector('#rpf-test-error')!.textContent).toContain('Select Pod.');
    expect(
      el().querySelector('button[aria-describedby]')!.getAttribute('aria-describedby'),
    ).toContain('rpf-test-error');
  });

  it('shows only the error line and Retry when a client search is refused, never "No matches." above it (issue #1282)', async () => {
    await create(aParam({ name: 'C', type: 'lookup', lookupKind: 'client', label: 'Client' }));
    source.search.mockImplementation(denied);
    const input = el().querySelector('input')!;
    input.value = 'acme';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    await settle(fixture);
    const line = el().querySelector('[data-lookup-failure]')!;
    expect(line.textContent).toContain("You don't have access to clients.");
    expect(line.querySelector('[data-lookup-retry]')).not.toBeNull();
    expect(el().querySelector('[data-picker-note]')).toBeNull();
    expect(el().textContent).not.toContain('No matches.');
  });

  it('a normal empty search still says No matches.', async () => {
    await create(aParam({ name: 'C', type: 'lookup', lookupKind: 'client', label: 'Client' }));
    source.search.mockResolvedValue([]);
    const input = el().querySelector('input')!;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    await settle(fixture);
    expect(el().querySelector('[data-picker-note]')!.textContent).toContain('No matches.');
    expect(el().querySelector('[data-lookup-failure]')).toBeNull();
  });
});
