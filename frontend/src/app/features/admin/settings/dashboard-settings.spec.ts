import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import { DashboardSettings } from './dashboard-settings';
import { DashboardSettingsApi } from './dashboard-settings-api';
import {
  DEFAULT_GAUGE_SETTINGS,
  GaugeSettings,
  validateGaugeSettings,
} from './dashboard-settings-model';

describe('validateGaugeSettings', () => {
  const ok = (over: Partial<GaugeSettings> = {}): GaugeSettings => ({
    ...structuredClone(DEFAULT_GAUGE_SETTINGS),
    ...over,
  });

  it('accepts the defaults', () => {
    expect(validateGaugeSettings(ok())).toEqual({});
  });

  it('needs an end after the start, at least one day, rising level hours and whole task counts', () => {
    expect(validateGaugeSettings(ok({ workdayEnd: '07:00' }))['workdayEnd']).toContain('after');
    expect(validateGaugeSettings(ok({ workdayStart: '' }))['workdayStart']).toBeDefined();
    expect(validateGaugeSettings(ok({ workDays: [] }))['workDays']).toBeDefined();
    expect(validateGaugeSettings(ok({ levelHours: [1, 2, 2, 4, 5] }))['levelHours']).toContain(
      'more hours',
    );
    expect(validateGaugeSettings(ok({ levelHours: [1, 2, 3, 4] }))['levelHours']).toBeDefined();
    expect(validateGaugeSettings(ok({ tasksPerLevel: 0 }))['tasksPerLevel']).toBeDefined();
    expect(validateGaugeSettings(ok({ countBonusMax: 9 }))['countBonusMax']).toBeDefined();
  });
});

describe('DashboardSettings form (DB-06)', () => {
  let fixture: ComponentFixture<DashboardSettings>;
  let saved: GaugeSettings | null;
  let saveResult: 'ok' | 'server-error';
  const el = () => fixture.nativeElement as HTMLElement;
  const btn = (sel: string) => el().querySelector(sel) as HTMLButtonElement;

  function type(id: string, value: string) {
    const input = el().querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    saved = null;
    saveResult = 'ok';
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DashboardSettingsApi,
          useValue: {
            load: () => of(structuredClone(DEFAULT_GAUGE_SETTINGS)),
            save: (s: GaugeSettings) => {
              if (saveResult === 'server-error') {
                return throwError(
                  () =>
                    new ApiError(
                      400,
                      'VALIDATION',
                      'Invalid',
                      {
                        errors: {
                          TasksPerLevel: [{ code: 'RANGE', message: 'Too many per level.' }],
                        },
                      },
                      undefined as never,
                    ),
                );
              }
              saved = s;
              return of(s);
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(DashboardSettings);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows the defaults under the fields and starts with Save and Cancel disabled and Reset disabled', () => {
    expect(el().textContent).toContain('Default 08:00');
    expect(el().textContent).toContain('Default Monday to Friday');
    expect(btn('[data-save] button, button[data-save]').disabled).toBe(true);
    expect((el().querySelector('#ds-start') as HTMLInputElement).value).toBe('08:00');
    expect((el().querySelector('[data-basis="WORKING"]') as HTMLInputElement).checked).toBe(true);
  });

  it('saves changed hours and the clock basis (clock hours are selectable)', async () => {
    type('ds-start', '07:30');
    (el().querySelector('[data-basis="CLOCK"]') as HTMLInputElement).click();
    fixture.detectChanges();
    const save = el().querySelector('p-button[data-save] button') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    await fixture.whenStable();
    expect(saved?.workdayStart).toBe('07:30');
    expect(saved?.ageBasis).toBe('CLOCK');
  });

  it('blocks Save and says why when the workday ends before it starts', () => {
    type('ds-end', '07:00');
    expect(el().querySelector('#ds-end-err')?.textContent).toContain('must end after');
    expect((el().querySelector('p-button[data-save] button') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('Reset to default only fills the form; nothing is saved until Save', () => {
    type('ds-per', '8');
    (el().querySelector('p-button[data-reset] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el().querySelector('#ds-per') as HTMLInputElement).value).toBe('5');
    expect(saved).toBeNull();
  });

  it('puts a message from the server under the field it names', async () => {
    saveResult = 'server-error';
    type('ds-per', '9');
    (el().querySelector('p-button[data-save] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('#ds-per-err')?.textContent).toContain('Too many per level.');
  });
});
