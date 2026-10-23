import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PreviewResponse } from '../../../api/generated/api-client';
import { PreviewPanel, sampleValuesOf } from './preview-panel';
import { ParamDef } from './report-model';

describe('sampleValuesOf', () => {
  const defs: ParamDef[] = [
    { name: 'N', type: 'number', label: 'N' },
    { name: 'D', type: 'date', label: 'D' },
    { name: 'R', type: 'dateRange', label: 'R' },
    { name: 'Y', type: 'yesNo', label: 'Y' },
    { name: 'S', type: 'single', label: 'S' },
    { name: 'SI', type: 'single', label: 'SI', valueType: 'int' },
    { name: 'M', type: 'multi', label: 'M' },
    { name: 'MI', type: 'multi', label: 'MI', valueType: 'int' },
    { name: 'L', type: 'lookup', label: 'L' },
    { name: 'LM', type: 'lookup', label: 'LM', lookupMulti: true },
    { name: 'T', type: 'text', label: 'T' },
  ];

  it('converts what was typed by type and leaves empty boxes out', () => {
    expect(
      sampleValuesOf(defs, {
        N: '12.5',
        D: '2026-10-01',
        'R.from': '2026-10-01',
        'R.to': '2026-10-31',
        Y: 'true',
        S: 'a',
        SI: '7',
        M: 'a, b;c',
        MI: '1,2',
        L: '4',
        LM: '5, 6',
        T: ' hello ',
      }),
    ).toEqual({
      N: 12.5,
      D: '2026-10-01',
      R: { from: '2026-10-01', to: '2026-10-31' },
      Y: true,
      S: 'a',
      SI: 7,
      M: ['a', 'b', 'c'],
      MI: [1, 2],
      L: 4,
      LM: [5, 6],
      T: 'hello',
    });
    expect(sampleValuesOf(defs, {})).toEqual({});
    expect(sampleValuesOf(defs, { N: 'abc', Y: 'maybe' })).toEqual({});
  });
});

const result = (over: Partial<PreviewResponse> = {}): PreviewResponse => ({
  success: true,
  status: 'Succeeded',
  columns: [
    { name: 'Pod', type: 'text' },
    { name: 'Overdue', type: 'integer' },
  ],
  rows: [
    ['Alpha', 12],
    ['Beta', null],
  ],
  rowCount: 132,
  exceedsCap: false,
  durationMs: 400,
  validationErrors: [],
  parameterErrors: [],
  countsForActivation: false,
  sqlError: undefined,
  sqlErrorLine: undefined,
  rowVersion: undefined,
  ...over,
});

@Component({
  imports: [PreviewPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-preview-panel
    [defs]="defs"
    [result]="r"
    [busy]="busy"
    [blocked]="blocked"
    (run)="ran = $event"
  />`,
})
class Host {
  defs: ParamDef[] = [{ name: 'MAX', type: 'number', label: 'Maximum' }];
  r: PreviewResponse | null = null;
  busy = false;
  blocked = '';
  ran: Record<string, unknown> | null = null;
}

describe('PreviewPanel', () => {
  function create(change: Partial<Host> = {}) {
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, change);
    fixture.detectChanges();
    return fixture;
  }

  it('runs the preview with the typed sample values', () => {
    const fixture = create();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#pp-MAX')!;
    input.value = '5';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('[data-run-preview]')!.click();
    expect(fixture.componentInstance.ran).toEqual({ MAX: 5 });
  });

  it('shows the first rows, the count and the duration, and cells as text', () => {
    const fixture = create({ r: result() });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-preview-ok]')!.textContent).toContain(
      'First 2 of 132 rows in 400 ms',
    );
    expect([...el.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['Pod', 'Overdue']);
    expect(
      [...el.querySelectorAll('tbody tr')[1].querySelectorAll('td')].map((t) => t.textContent),
    ).toEqual(['Beta', '']);
  });

  it('says when the full result would be cut off', () => {
    const fixture = create({ r: result({ exceedsCap: true }) });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'cut off at the row limit',
    );
  });

  it('shows validation errors with line and column, parameter problems and the SQL error in full', () => {
    const fixture = create({
      r: result({
        success: false,
        status: 'Failed',
        columns: [],
        rows: [],
        validationErrors: [
          {
            code: 'MULTIPLE_STATEMENTS',
            message: 'Only one statement.',
            position: 9,
            line: 2,
            column: 1,
          },
        ],
        parameterErrors: [{ name: 'MAX', code: 'OUT_OF_RANGE', message: 'Too big.' }],
        sqlError: 'Divide by zero error encountered.',
        sqlErrorLine: 3,
      }),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-validation-errors]')!.textContent).toContain(
      'Line 2, column 1: Only one statement.',
    );
    expect(el.querySelector('[data-parameter-errors]')!.textContent).toContain('MAX: Too big.');
    expect(el.querySelector('[data-sql-error]')!.textContent).toContain(
      'Divide by zero error encountered. (line 3)',
    );
    expect(el.querySelector('[data-preview-failed]')).not.toBeNull();
    expect(el.querySelector('table')).toBeNull();
  });

  it('cannot run while busy or blocked, and says why', () => {
    const blocked = create({ blocked: 'Save the report first, then preview it.' });
    const button = (blocked.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-run-preview]',
    )!;
    expect(button.disabled).toBe(true);
    expect(
      (blocked.nativeElement as HTMLElement).querySelector('[data-preview-blocked]')!.textContent,
    ).toContain('Save the report first');
    const busy = create({ busy: true });
    expect(
      (busy.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-run-preview]')!
        .textContent,
    ).toContain('Running');
  });
});
