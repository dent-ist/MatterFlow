import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReportChoicesClient } from '../../../api/generated/api-client';
import { ParametersEditor, parseDefault } from './parameters-editor';
import { ParamDef } from './report-model';

describe('parseDefault', () => {
  it('reads a default by the type of the parameter', () => {
    expect(parseDefault({ name: 'N', type: 'number', label: 'N' }, '12.5')).toBe(12.5);
    expect(parseDefault({ name: 'N', type: 'number', label: 'N' }, 'abc')).toBe('abc');
    expect(parseDefault({ name: 'Y', type: 'yesNo', label: 'Y' }, 'true')).toBe(true);
    expect(parseDefault({ name: 'Y', type: 'yesNo', label: 'Y' }, 'false')).toBe(false);
    expect(parseDefault({ name: 'L', type: 'lookup', label: 'L' }, '7')).toBe(7);
    expect(parseDefault({ name: 'S', type: 'single', label: 'S', valueType: 'int' }, '7')).toBe(7);
    expect(parseDefault({ name: 'S', type: 'single', label: 'S' }, '7')).toBe('7');
    expect(parseDefault({ name: 'D', type: 'date', label: 'D' }, ' today ')).toBe('today');
    expect(parseDefault({ name: 'D', type: 'date', label: 'D' }, '  ')).toBeUndefined();
  });
});

@Component({
  imports: [ParametersEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-parameters-editor
    [defs]="defs"
    [unused]="unused"
    [errors]="errors"
    [reportId]="reportId"
    (defsChange)="changed = $event"
  />`,
})
class Host {
  defs: ParamDef[] = [];
  unused = new Set<string>();
  errors: Record<string, string[]> = {};
  reportId: number | null = 5;
  changed: ParamDef[] | null = null;
}

describe('ParametersEditor', () => {
  const choices = { testReportChoiceQuery: vi.fn() };

  function create(defs: ParamDef[], over: Partial<Host> = {}) {
    TestBed.configureTestingModule({
      providers: [{ provide: ReportChoicesClient, useValue: choices }],
    });
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, { defs }, over);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      host: fixture.componentInstance,
      q: <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!,
    };
  }

  beforeEach(() => choices.testReportChoiceQuery.mockReset());

  it('explains how parameters appear when there are none', () => {
    const { el } = create([]);
    expect(el.querySelector('[data-no-parameters]')!.textContent).toContain(':NAME');
  });

  it('shows one card per parameter with its placeholder, errors and the unused note', () => {
    const { el } = create(
      [
        { name: 'PERIOD', type: 'dateRange', label: 'Period' },
        { name: 'OLD', type: 'text', label: 'Old' },
      ],
      { unused: new Set(['OLD']), errors: { PERIOD: ['Enter a label.'] } },
    );
    expect(el.querySelector('[data-parameter="PERIOD"] legend')!.textContent).toContain(
      ':PERIOD_FROM and :PERIOD_TO',
    );
    expect(
      el.querySelector('[data-parameter="PERIOD"] [data-parameter-errors]')!.textContent,
    ).toContain('Enter a label.');
    expect(el.querySelector('[data-parameter="OLD"] [data-unused]')!.textContent).toContain(
      'Not used in the query',
    );
    expect(el.querySelector('[data-parameter="PERIOD"] [data-unused]')).toBeNull();
  });

  it('labels every control and changes one field at a time without touching the others', () => {
    const { host, el, q } = create([
      { name: 'A', type: 'text', label: 'A' },
      { name: 'B', type: 'text', label: 'B' },
    ]);
    for (const input of Array.from(
      el.querySelectorAll('input:not([type=checkbox]), select, textarea'),
    )) {
      expect(el.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    }
    const label = q<HTMLInputElement>('#param-0-label');
    label.value = 'Alpha';
    label.dispatchEvent(new Event('input'));
    expect(host.changed!.map((d) => d.label)).toEqual(['Alpha', 'B']);
    const required = el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1];
    required.checked = true;
    required.dispatchEvent(new Event('change'));
    expect(host.changed![1].isRequired).toBe(true);
  });

  it('resets the settings when the type changes and shows the ones the new type needs', () => {
    const { host, fixture, q } = create([
      { name: 'A', type: 'text', label: 'Alpha', maxLength: 9 },
    ]);
    const type = q<HTMLSelectElement>('#param-0-type');
    type.value = 'single';
    type.dispatchEvent(new Event('change'));
    expect(host.changed![0]).toMatchObject({
      type: 'single',
      label: 'Alpha',
      optionsKind: 'fixed',
      options: [{ value: '', label: '' }],
    });
    expect(host.changed![0].maxLength).toBeUndefined();

    fixture.componentInstance.defs = host.changed!;
    fixture.changeDetectorRef.markForCheck();
    host.changed = null;
  });

  it('edits a fixed list: add, change and remove a choice', () => {
    const { host, el, q } = create([
      {
        name: 'A',
        type: 'single',
        label: 'A',
        optionsKind: 'fixed',
        options: [{ value: 'x', label: 'X' }],
      },
    ]);
    expect(el.querySelectorAll('[data-fixed-list] [role=group]')).toHaveLength(1);
    q('[data-add-option]').click();
    expect(host.changed![0].options).toEqual([
      { value: 'x', label: 'X' },
      { value: '', label: '' },
    ]);
    const value = q<HTMLInputElement>('[aria-label="Value of choice 1"]');
    value.value = 'y';
    value.dispatchEvent(new Event('input'));
    expect(host.changed![0].options![0]).toEqual({ value: 'y', label: 'X' });
    q('[aria-label="Remove choice 1"]').click();
    expect(host.changed![0].options).toEqual([]);
  });

  it('tests a SELECT list on the saved report and shows the first choices, or the reason in full', async () => {
    choices.testReportChoiceQuery.mockReturnValueOnce(
      of({
        success: true,
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'b' },
        ],
        total: 2,
        truncated: false,
        durationMs: 7,
      }),
    );
    const { fixture, el, q } = create([
      {
        name: 'A',
        type: 'single',
        label: 'A',
        optionsKind: 'query',
        optionsSql: 'SELECT 1',
        valueType: 'int',
      },
    ]);
    q('[data-test-list]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(choices.testReportChoiceQuery).toHaveBeenCalledWith(5, {
      sql: 'SELECT 1',
      valueType: 'int',
    });
    expect(el.querySelector('[data-test-result]')!.textContent).toContain(
      '2 choices in 7 ms: Alpha (a), b',
    );

    choices.testReportChoiceQuery.mockReturnValueOnce(
      of({
        success: false,
        options: [],
        total: 0,
        truncated: false,
        durationMs: 0,
        errorCode: 'CHOICE_COLUMNS',
        error: 'The choice query must return the columns Value and Label.',
      }),
    );
    q('[data-test-list]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-test-result]')!.textContent).toContain(
      'must return the columns Value and Label',
    );

    choices.testReportChoiceQuery.mockReturnValueOnce(throwError(() => new Error('x')));
    q('[data-test-list]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-test-result]')!.textContent).toContain('could not be run');
  });

  it('cannot test a SELECT list before the report is saved, and says so', () => {
    const { el, q } = create(
      [{ name: 'A', type: 'single', label: 'A', optionsKind: 'query', optionsSql: 'SELECT 1' }],
      { reportId: null },
    );
    expect(q<HTMLButtonElement>('[data-test-list]').disabled).toBe(true);
    expect(el.textContent).toContain('Save the report first to test.');
  });

  it('offers lookup kinds, number limits and default keywords for the type', () => {
    const { el, host, q } = create([
      { name: 'P', type: 'lookup', label: 'P', lookupKind: 'pod', lookupMulti: true },
      { name: 'N', type: 'number', label: 'N' },
      { name: 'D', type: 'date', label: 'D' },
    ]);
    expect(
      [...el.querySelectorAll('#param-0-kind option')].map((o) => o.textContent!.trim()),
    ).toEqual(['Matter', 'Client', 'User', 'Pod', 'Role', 'Task type']);
    expect(el.querySelector('[data-parameter="N"] [data-number-settings]')).not.toBeNull();
    expect(
      [...el.querySelectorAll('#param-2-keywords option')].map((o) => o.getAttribute('value')),
    ).toContain('today');
    const kind = q<HTMLSelectElement>('#param-0-kind');
    kind.value = 'user';
    kind.dispatchEvent(new Event('change'));
    expect(host.changed![0].lookupKind).toBe('user');
  });
});
