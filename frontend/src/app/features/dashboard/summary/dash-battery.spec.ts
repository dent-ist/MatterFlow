import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CapacityPerson, CapacitySummary } from '../dash-v4-contract';
import { capacityOf, fixturePeople } from '../dash-v4-fixtures';
import { DashBattery } from './dash-battery';
import { DashV4Api } from './dash-v4-api';

describe('DashBattery (DB-05)', () => {
  let fixture: ComponentFixture<DashBattery>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = (sel: string) => el().querySelector(sel)?.textContent?.trim();
  let capacityCalls = 0;
  let peopleCalls = 0;

  function create(
    summary: CapacitySummary | 'error',
    people: CapacityPerson[] = fixturePeople(12),
  ) {
    capacityCalls = 0;
    peopleCalls = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DashV4Api,
          useValue: {
            capacity: () => {
              capacityCalls++;
              return summary === 'error' ? throwError(() => new Error('x')) : of(summary);
            },
            people: () => {
              peopleCalls++;
              return of(people);
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(DashBattery);
    fixture.componentRef.setInput('scope', 'all');
    fixture.detectChanges();
  }

  it('says Capacity used NN% with the API number, 8 of 12 can take work now, and a legend that adds up to 12', () => {
    const summary = capacityOf(fixturePeople(12), 3);
    create(summary);
    expect(text('[data-battery-big]')).toBe(`Capacity used ${summary.usedPercent}%`);
    expect(text('[data-battery-summary]')).toBe('8 of 12 can take work now');
    const counts = Array.from(el().querySelectorAll('[data-battery-legend] li b')).map((b) =>
      Number(b.textContent),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
    expect(el().querySelectorAll('[data-battery-legend] li')).toHaveLength(6);
    expect((el().querySelector('[data-battery-fill]') as HTMLElement).style.width).toBe(
      `${summary.freePercent}%`,
    );
    expect(text('[data-battery-rate]')).toBe('3 assigned in the last hour');
  });

  it('hides the rate hint when the API does not send it', () => {
    create({ ...capacityOf(fixturePeople(12)), assignedLastHour: undefined });
    expect(el().querySelector('[data-battery-rate]')).toBeNull();
  });

  it('shows a neutral After hours state when the API sends no percentage', () => {
    create({ ...capacityOf(fixturePeople(12)), usedPercent: null, canTakeWork: 0 });
    expect(text('[data-battery-big]')).toBe('After hours');
    expect(el().textContent).not.toContain('100%');
  });

  it('shows the empty state for no workers, without the People button', () => {
    create(capacityOf([], 0));
    expect(el().querySelector('[data-battery-empty]')).not.toBeNull();
    expect(el().querySelector('[data-people-open]')).toBeNull();
  });

  it('shows an error with one Retry that reads again', () => {
    create('error');
    expect(el().querySelector('[data-battery-error]')).not.toBeNull();
    (el().querySelector('[data-battery-retry]') as HTMLButtonElement).click();
    expect(capacityCalls).toBe(2);
  });

  it('reads the People list only when the popover opens, then searches it on the client', () => {
    create(capacityOf(fixturePeople(12), 3));
    expect(peopleCalls).toBe(0);
    (el().querySelector('[data-people-open]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(peopleCalls).toBe(1);
    expect(el().querySelector('[data-people]')?.getAttribute('role')).toBe('dialog');
    expect(el().querySelectorAll('[data-person]')).toHaveLength(12);
    const input = el().querySelector('[data-people-search]') as HTMLInputElement;
    input.value = 'priya';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el().querySelectorAll('[data-person]')).toHaveLength(1);
    expect(peopleCalls).toBe(1);
    (el().querySelector('[data-people-close]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('[data-people]')).toBeNull();
  });

  it('reads again when the refresh key changes', () => {
    create(capacityOf(fixturePeople(12), 3));
    fixture.componentRef.setInput('refreshKey', 1);
    fixture.detectChanges();
    expect(capacityCalls).toBe(2);
  });
});
