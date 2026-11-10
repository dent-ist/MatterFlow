import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReportChoicesClient } from '../../api/generated/api-client';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { settle } from '../../shared/testing/org-testing';
import { ddChoose, ddOptionTexts, ddText } from '../../testing/dropdown-testing.spec-util';
import { ReportLookupSource } from './report-lookup-source';
import { ReportParameterForm } from './report-parameter-form';
import { FormValues, ParamDef, defaultValues } from './report-params';
import { aParam } from './reports-testing';

type Mock = ReturnType<typeof vi.fn>;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReportParameterForm],
  template: `<mf-report-parameter-form
    [reportId]="5"
    [defs]="defs()"
    [(values)]="values"
    [serverErrors]="serverErrors()"
    [running]="running()"
    (run)="runs = runs + 1"
    (cancelRun)="cancels = cancels + 1"
    (resetValues)="resets = resets + 1"
    (optionLabels)="labels = $event"
  />`,
})
class Host {
  readonly defs = signal<readonly ParamDef[]>([]);
  readonly values = signal<FormValues>({});
  readonly serverErrors = signal<Record<string, string>>({});
  readonly running = signal(false);
  runs = 0;
  cancels = 0;
  resets = 0;
  labels: unknown = {};
}

describe('ReportParameterForm (#719)', () => {
  let choices: Record<'getReportChoices', Mock>;
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const host = (): Host => fixture.componentInstance;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const field = (name: string): HTMLElement => q(`[data-param="${name}"]`);
  const submit = async (): Promise<void> => {
    q('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
  };

  async function create(defs: ParamDef[], values?: FormValues): Promise<void> {
    choices = {
      getReportChoices: vi.fn().mockReturnValue(
        of({
          options: [
            { value: '1', label: 'Alpha' },
            { value: '2', label: 'Beta' },
          ],
          truncated: false,
        }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ReportChoicesClient, useValue: choices },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        {
          provide: ReportLookupSource,
          useValue: {
            isSearched: () => false,
            list: vi.fn().mockResolvedValue([]),
            search: vi.fn(),
            labels: vi.fn(),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(Host);
    host().defs.set(defs);
    host().values.set(values ?? defaultValues(defs));
    await settle(fixture);
  }

  const typeInto = async (input: HTMLInputElement, value: string): Promise<void> => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture);
  };

  it('draws a Parameters card with one field per parameter in order, labels above, (required) after the label of a required one', async () => {
    await create([
      aParam({ name: 'A', type: 'text', label: 'Client Name', required: true }),
      aParam({ name: 'B', type: 'number', label: 'Minimum Hours' }),
    ]);
    expect(q('.mf-card__title').textContent).toBe('Parameters');
    expect(
      Array.from(el().querySelectorAll('[data-param]')).map((f) => f.getAttribute('data-param')),
    ).toEqual(['A', 'B']);
    expect(field('A').querySelector('label')!.textContent).toContain('(required)');
    expect(field('B').querySelector('label')!.textContent).not.toContain('(required)');
  });

  it('has no card for a report without parameters, only the Run Report button', async () => {
    await create([]);
    expect(el().querySelector('.mf-card')).toBeNull();
    expect(q('[data-run-report]')).not.toBeNull();
    expect(el().querySelector('[data-reset]')).toBeNull();
  });

  it('uses a shared control per type and no native select, checkbox or radio', async () => {
    await create([
      aParam({ name: 'T', type: 'text', label: 'Text' }),
      aParam({ name: 'N', type: 'number', label: 'Number' }),
      aParam({ name: 'D', type: 'date', label: 'Day' }),
      aParam({ name: 'R', type: 'dateRange', label: 'Period' }),
      aParam({ name: 'S', type: 'single', label: 'One', options: [{ value: 'a', label: 'A' }] }),
      aParam({ name: 'M', type: 'multi', label: 'Many', options: [{ value: 'a', label: 'A' }] }),
      aParam({ name: 'Y', type: 'yesNo', label: 'Open' }),
      aParam({ name: 'P', type: 'lookup', lookupKind: 'pod', label: 'Pod' }),
    ]);
    expect(field('T').querySelector('mf-text-field')).not.toBeNull();
    expect(field('N').querySelector('input[inputmode="decimal"]')).not.toBeNull();
    expect(field('D').querySelector('mf-date-input')).not.toBeNull();
    expect(field('R').querySelectorAll('mf-date-input')).toHaveLength(2);
    expect(field('S').querySelector('mf-dropdown')).not.toBeNull();
    expect(field('M').querySelector('mf-dropdown')).not.toBeNull();
    // Issue #1284: every dropdown of the form fills its column.
    expect(field('S').querySelector('mf-dropdown')!.hasAttribute('fill')).toBe(true);
    expect(field('M').querySelector('mf-dropdown')!.hasAttribute('fill')).toBe(true);
    expect(field('Y').querySelector('[mfSegmented], .mf-seg, [data-yes-no]')).not.toBeNull();
    expect(field('P').querySelector('mf-report-lookup')).not.toBeNull();
    expect(el().querySelector('select, input[type=checkbox], input[type=radio]')).toBeNull();
  });

  it('writes what is typed into the values and shows thousands commas after leaving a number', async () => {
    await create([aParam({ name: 'N', type: 'number', label: 'Amount' })]);
    const input = field('N').querySelector('input')!;
    await typeInto(input, '1234567.5');
    expect(host().values()['N']).toBe('1234567.5');
    input.dispatchEvent(new Event('blur'));
    await settle(fixture);
    expect(input.value).toBe('1,234,567.5');
    input.dispatchEvent(new Event('focus'));
    expect(input.value).toBe('1234567.5');
  });

  it('answers a yes/no with Any, Yes, No when optional and with Yes, No when required', async () => {
    await create([
      aParam({ name: 'Y', type: 'yesNo', label: 'Billable' }),
      aParam({ name: 'Z', type: 'yesNo', label: 'Open', required: true }),
    ]);
    expect(
      Array.from(field('Y').querySelectorAll('button')).map((b) => b.textContent!.trim()),
    ).toEqual(['Any', 'Yes', 'No']);
    expect(
      Array.from(field('Z').querySelectorAll('button')).map((b) => b.textContent!.trim()),
    ).toEqual(['Yes', 'No']);
    (field('Y').querySelector('[data-answer="no"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(host().values()['Y']).toBe('no');
    expect(field('Y').querySelector('[data-answer="no"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('offers the fixed options of a single list, with Any when it is optional, and writes the choice', async () => {
    await create([
      aParam({
        name: 'S',
        type: 'single',
        label: 'Status',
        options: [
          { value: 'o', label: 'Open' },
          { value: 'c', label: 'Closed' },
        ],
      }),
    ]);
    expect(ddOptionTexts(el(), 'Status')).toEqual(['Any', 'Open', 'Closed']);
    ddChoose(el(), 'Status', 'c');
    await settle(fixture);
    expect(host().values()['S']).toBe('c');
    expect(ddText(el(), 'Status')).toBe('Closed');
  });

  it('applies a date preset to both ends of a range', async () => {
    await create([aParam({ name: 'R', type: 'dateRange', label: 'Period' })]);
    const today = new Date().toISOString().slice(0, 10);
    ddChoose(el(), 'Period presets', 'today');
    await settle(fixture);
    const range = host().values()['R'] as { from: string; to: string };
    expect(range.from.length).toBe(10);
    expect(range.from).toBe(range.to);
    expect(Math.abs(Date.parse(range.from) - Date.parse(today))).toBeLessThanOrEqual(86_400_000);
  });

  describe('messages', () => {
    const defs = () => [
      aParam({ name: 'A', type: 'text', label: 'Client Name', required: true }),
      aParam({ name: 'B', type: 'number', label: 'Hours', min: 1, max: 24 }),
    ];

    it('show nothing before the person touches a field or presses Run Report', async () => {
      await create(defs());
      expect(el().querySelector('.mf-field__error')).toBeNull();
    });

    it('stop Run Report: every message under its field, the first one takes the focus, nothing runs', async () => {
      await create(defs(), { A: '', B: '99' });
      await submit();
      expect(host().runs).toBe(0);
      expect(field('A').querySelector('.mf-field__error')!.textContent).toContain(
        'Enter Client Name.',
      );
      expect(field('B').querySelector('.mf-field__error')!.textContent).toContain(
        'Hours must be between 1 and 24.',
      );
      expect(field('B').querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
      await new Promise((r) => setTimeout(r));
      expect(document.activeElement).toBe(field('A').querySelector('input'));
    });

    it('let a valid form run', async () => {
      await create(defs(), { A: 'Acme', B: '5' });
      await submit();
      expect(host().runs).toBe(1);
    });

    it("show a field's message after the person leaves it", async () => {
      await create(defs());
      field('B')
        .querySelector('input')!
        .dispatchEvent(new Event('focusout', { bubbles: true }));
      await settle(fixture);
      expect(field('B').querySelector('.mf-field__error')).toBeNull(); // empty and not required
      const text = field('A');
      text.querySelector('input')!.dispatchEvent(new Event('focusout', { bubbles: true }));
      await settle(fixture);
      expect(text.querySelector('.mf-field__error')!.textContent).toContain('Enter Client Name.');
    });

    it('place the messages of the server under their fields and take one away when its field changes', async () => {
      await create(defs(), { A: 'Acme', B: '5' });
      host().serverErrors.set({ B: 'Hours is too high for this report.' });
      await settle(fixture);
      expect(field('B').querySelector('.mf-field__error')!.textContent).toContain('too high');
      await typeInto(field('B').querySelector('input')!, '6');
      expect(field('B').querySelector('.mf-field__error')).toBeNull();
    });
  });

  describe('Run Report and Cancel', () => {
    it('is the one primary button, last; Reset sits before it and restores the defaults through the parent', async () => {
      await create([aParam({ name: 'A', type: 'text', label: 'Name' })]);
      const buttons = Array.from(q('.rpf__actions').querySelectorAll('button')).map((b) =>
        b.textContent!.trim(),
      );
      expect(buttons).toEqual(['Reset', 'Run Report']);
      q('[data-reset]').click();
      expect(host().resets).toBe(1);
    });

    it('turns into Cancel while a run is live, and the fields are disabled', async () => {
      await create([aParam({ name: 'A', type: 'text', label: 'Name' })]);
      host().running.set(true);
      await settle(fixture);
      const buttons = Array.from(q('.rpf__actions').querySelectorAll('button')).map((b) =>
        b.textContent!.trim(),
      );
      expect(buttons).toEqual(['Cancel']);
      // The spinner is decoration: the button's name is exactly "Cancel" (#1325).
      const spinner = q('[data-cancel-run] .pi-spinner');
      expect(spinner.getAttribute('aria-hidden')).toBe('true');
      expect(q('fieldset').hasAttribute('disabled')).toBe(true);
      q('[data-cancel-run]').querySelector('button')!.click();
      expect(host().cancels).toBe(1);
    });
  });

  describe("lists that come from the report's own query", () => {
    const query = () =>
      aParam({
        name: 'S',
        type: 'multi',
        label: 'Status',
        choicesSource: 'query',
        valueType: 'int',
      });

    it('are fetched when the form opens and offered as options; their words go to the summary', async () => {
      await create([query()]);
      expect(choices.getReportChoices).toHaveBeenCalledWith(5, 'S');
      expect(ddOptionTexts(el(), 'Status')).toEqual(['Alpha', 'Beta']);
      expect(host().labels).toEqual({ S: { '1': 'Alpha', '2': 'Beta' } });
    });

    it('say so when the list was cut', async () => {
      await create([]);
      choices.getReportChoices.mockReturnValue(
        of({ options: [{ value: '1', label: 'Alpha' }], truncated: true }),
      );
      host().defs.set([query()]);
      await settle(fixture);
      expect(q('[data-choices-truncated]').textContent).toContain('Showing the first 1 options.');
    });

    it("show Couldn't load options. with Retry when the fetch fails, and fetch again on Retry", async () => {
      await create([]);
      choices.getReportChoices.mockReturnValue(throwError(() => new Error('boom')));
      host().defs.set([query()]);
      await settle(fixture);
      expect(q('[data-choices-error]').textContent).toContain("Couldn't load options.");
      choices.getReportChoices.mockReturnValue(
        of({ options: [{ value: '1', label: 'Alpha' }], truncated: false }),
      );
      q('[data-choices-retry]').click();
      await settle(fixture);
      expect(el().querySelector('[data-choices-error]')).toBeNull();
      expect(choices.getReportChoices).toHaveBeenCalledTimes(2);
    });
  });
});
