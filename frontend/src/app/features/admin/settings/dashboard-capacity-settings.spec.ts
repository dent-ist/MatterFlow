import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import {
  DashboardCapacityAdminView,
  SettingsDashboardClient,
} from '../../../api/generated/api-client';
import { DashboardCapacitySettings } from './dashboard-capacity-settings';

describe('DashboardCapacitySettings (DB-16)', () => {
  let fixture: ComponentFixture<DashboardCapacitySettings>;
  let setBody: { countOffHours: boolean; rowVersion: string } | null;
  let resetVersion: string | null;
  let failWith: ApiError | null;
  const el = () => fixture.nativeElement as HTMLElement;
  const box = () => el().querySelector<HTMLInputElement>('[data-count-off-hours]')!;
  const button = (name: string) =>
    el().querySelector<HTMLButtonElement>(`p-button[data-capacity-${name}] button`)!;

  const view = (over: Partial<DashboardCapacityAdminView> = {}): DashboardCapacityAdminView => ({
    countOffHours: true,
    defaultCountOffHours: true,
    isCustom: false,
    rowVersion: '',
    updatedAtUtc: undefined,
    updatedBy: undefined,
    ...over,
  });

  async function create(initial = view()) {
    setBody = null;
    resetVersion = null;
    failWith = null;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SettingsDashboardClient,
          useValue: {
            getDashboardCapacitySettings: () => of(initial),
            setDashboardCapacitySettings: (body: {
              countOffHours: boolean;
              rowVersion: string;
            }) => {
              if (failWith) return throwError(() => failWith);
              setBody = body;
              return of(
                view({ countOffHours: body.countOffHours, isCustom: true, rowVersion: 'V2' }),
              );
            },
            resetDashboardCapacitySettings: (rowVersion: string) => {
              resetVersion = rowVersion;
              return of(view());
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(DashboardCapacitySettings);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows one checkbox, on by default, with a one-line explanation, and Save disabled until a change', async () => {
    await create();
    expect(el().textContent).toContain('Count people outside work hours as available');
    expect(box().checked).toBe(true);
    expect(box().getAttribute('aria-describedby')).toBe('cs-off-hours-help');
    expect(el().querySelector('#cs-off-hours-help')!.textContent).toContain('After hours');
    expect(button('save').disabled).toBe(true);
    expect(button('reset').disabled).toBe(true);
  });

  it('saves the unchecked box with an empty version for the first save', async () => {
    await create();
    box().click();
    fixture.detectChanges();
    expect(button('save').disabled).toBe(false);
    button('save').click();
    await fixture.whenStable();
    expect(setBody).toEqual({ countOffHours: false, rowVersion: '' });
  });

  it('sends the version of a stored value and sends a reset when the box is back at the default', async () => {
    await create(view({ countOffHours: false, isCustom: true, rowVersion: 'V1' }));
    expect(box().checked).toBe(false);
    box().click();
    fixture.detectChanges();
    button('save').click();
    await fixture.whenStable();
    expect(resetVersion).toBe('V1');
    expect(setBody).toBeNull();
  });

  it('Reset to default only fills the form; Cancel discards', async () => {
    await create(view({ countOffHours: false, isCustom: true, rowVersion: 'V1' }));
    button('reset').click();
    fixture.detectChanges();
    expect(box().checked).toBe(true);
    expect(resetVersion).toBeNull();
    button('cancel').click();
    fixture.detectChanges();
    expect(box().checked).toBe(false);
  });

  it('a stale version says someone else changed it and offers Reload latest', async () => {
    await create();
    failWith = new ApiError(409, 'CONCURRENCY_CONFLICT', 'Changed', undefined, undefined as never);
    box().click();
    fixture.detectChanges();
    button('save').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[data-capacity-server-error]')!.textContent).toContain(
      'Someone else changed this setting',
    );
    expect(el().querySelector('[data-capacity-reload]')).not.toBeNull();
  });
});
