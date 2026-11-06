import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import { DashboardSettings } from './dashboard-settings';
import {
  DashboardSettingsAdminView,
  SettingsDashboardClient,
} from '../../../api/generated/api-client';
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
  let setBody: { gauge: GaugeSettings; rowVersion: string } | null;
  let resetVersion: string | null;
  let failWith: ApiError | null;
  const el = () => fixture.nativeElement as HTMLElement;

  const view = (over: Partial<DashboardSettingsAdminView> = {}): DashboardSettingsAdminView => ({
    gauge: { ...structuredClone(DEFAULT_GAUGE_SETTINGS) },
    defaults: { ...structuredClone(DEFAULT_GAUGE_SETTINGS) },
    isCustom: false,
    rowVersion: '',
    timeZoneId: 'America/New_York',
    updatedAtUtc: undefined,
    updatedBy: undefined,
    ...over,
  });

  function type(id: string, value: string) {
    const input = el().querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  const saveButton = () => el().querySelector('p-button[data-save] button') as HTMLButtonElement;

  async function create(initial = view()) {
    setBody = null;
    resetVersion = null;
    failWith = null;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SettingsDashboardClient,
          useValue: {
            getDashboardSettings: () => of(initial),
            setDashboardSettings: (body: { gauge: GaugeSettings; rowVersion: string }) => {
              if (failWith) return throwError(() => failWith);
              setBody = body;
              return of(view({ gauge: body.gauge, isCustom: true, rowVersion: 'V2' }));
            },
            resetDashboardSettings: (rowVersion: string) => {
              resetVersion = rowVersion;
              return of(view());
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(DashboardSettings);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the defaults under the fields, the firm time zone, and starts with Save disabled', async () => {
    await create();
    expect(el().textContent).toContain('Default 08:00');
    expect(el().textContent).toContain('Default Monday to Friday');
    expect(el().querySelector('[data-ds-meta]')?.textContent).toContain('America/New_York');
    expect(saveButton().disabled).toBe(true);
    expect((el().querySelector('#ds-start') as HTMLInputElement).value).toBe('08:00');
    expect((el().querySelector('[data-basis="WORKING"]') as HTMLInputElement).checked).toBe(true);
  });

  it('shows the working days as seven toggle chips and saves a changed day (#1209)', async () => {
    await create();
    const chips = Array.from(
      el().querySelectorAll<HTMLButtonElement>('[data-day-toggles] button[data-key]'),
    );
    expect(chips.map((c) => c.textContent!.trim())).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(chips.map((c) => c.getAttribute('aria-label'))[0]).toBe('Monday');
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'true',
      'true',
      'true',
      'false',
      'false',
    ]);
    chips[5].click();
    fixture.detectChanges();
    expect(chips[5].getAttribute('aria-pressed')).toBe('true');
    saveButton().click();
    await fixture.whenStable();
    expect(setBody?.gauge.workDays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('saves changed hours and the clock basis (clock hours are selectable) with an empty version for the first save', async () => {
    await create();
    type('ds-start', '07:30');
    (el().querySelector('[data-basis="CLOCK"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(saveButton().disabled).toBe(false);
    saveButton().click();
    await fixture.whenStable();
    expect(setBody?.gauge.workdayStart).toBe('07:30');
    expect(setBody?.gauge.ageBasis).toBe('CLOCK');
    expect(setBody?.rowVersion).toBe('');
  });

  it('sends the version of a stored value, and sends a reset when the form is back at the defaults', async () => {
    await create(
      view({
        isCustom: true,
        rowVersion: 'V1',
        gauge: { ...DEFAULT_GAUGE_SETTINGS, tasksPerLevel: 8 },
      }),
    );
    type('ds-per', '5');
    saveButton().click();
    await fixture.whenStable();
    expect(resetVersion).toBe('V1');
    expect(setBody).toBeNull();
  });

  it('blocks Save and says why when the workday ends before it starts', async () => {
    await create();
    type('ds-end', '07:00');
    expect(el().querySelector('#ds-end-err')?.textContent).toContain('must end after');
    expect(saveButton().disabled).toBe(true);
  });

  it('Reset to default only fills the form; nothing is saved until Save', async () => {
    await create();
    type('ds-per', '8');
    (el().querySelector('p-button[data-reset] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el().querySelector('#ds-per') as HTMLInputElement).value).toBe('5');
    expect(setBody).toBeNull();
  });

  it('puts a message from the server under the field it names', async () => {
    await create();
    type('ds-per', '9');
    failWith = new ApiError(
      400,
      'VALIDATION',
      'Invalid',
      { errors: { TasksPerLevel: [{ code: 'RANGE', message: 'Too many per level.' }] } },
      undefined as never,
    );
    saveButton().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('#ds-per-err')?.textContent).toContain('Too many per level.');
  });

  it('offers Reload latest after a version conflict', async () => {
    await create();
    type('ds-per', '9');
    failWith = new ApiError(409, 'CONCURRENCY_CONFLICT', 'Changed', undefined, undefined as never);
    saveButton().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[data-server-error]')?.textContent).toContain(
      'Someone else changed',
    );
    expect(el().querySelector('[data-reload]')).not.toBeNull();
  });
});
