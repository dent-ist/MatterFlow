import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CapacityPerson, DashboardCapacity } from '../../../api/generated/api-client';
import { capacityOf, somePeople } from './dash-testing';
import { DashBattery } from './dash-battery';
import { DashV4Api } from './dash-v4-api';

describe('DashBattery (DB-05)', () => {
  let fixture: ComponentFixture<DashBattery>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = (sel: string) => el().querySelector(sel)?.textContent?.trim();
  let capacityCalls = 0;
  let peopleCalls = 0;

  function create(summary: DashboardCapacity | 'error', people: CapacityPerson[] = somePeople(12)) {
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

  it('shows the remaining percentage inside the battery with the API number, the free slots, and a legend that adds up to 12', () => {
    const summary = capacityOf(somePeople(12), 3);
    create(summary);
    expect(text('[data-battery-big]')).toBe(`${summary.freePercent}%`);
    expect(el().querySelector('[data-battery-bar]')!.getAttribute('aria-label')).toContain(
      `Remaining capacity ${summary.freePercent} percent`,
    );
    expect(el().textContent).not.toContain('Capacity used');
    expect(text('[data-battery-word]')).toMatch(/Healthy|Watch|Low|Critical/);
    expect(text('[data-battery-summary]')).toBe(`${summary.freeSlots} free slots`);
    expect(el().querySelector('[data-battery-waiting]')).toBeNull();
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

  it('has People as an icon-only button named People in the title row, and no ring around the percentage', () => {
    create(capacityOf(somePeople(12), 3));
    const btn = el().querySelector('[data-people-open]') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('');
    expect(btn.getAttribute('aria-label')).toBe('People');
    expect(btn.closest('.ph')).not.toBeNull();
    expect(btn.querySelector('i.pi-users')).not.toBeNull();
    const val = el().querySelector('[data-battery-big]') as HTMLElement;
    expect(val.classList.contains('val')).toBe(true);
  });

  it('hides the rate hint when the API does not send it', () => {
    create({ ...capacityOf(somePeople(12)), assignedLastHour: undefined });
    expect(el().querySelector('[data-battery-rate]')).toBeNull();
  });

  it('shows a neutral After hours state only when the setting is off and nobody is at work', () => {
    const evening = somePeople(6).map((p) => ({ ...p, state: 'OFF_HOURS' as const }));
    create(capacityOf(evening, 0, { countOffHours: false }));
    expect(text('[data-battery-big]')).toBe('After hours');
    expect(el().textContent).not.toContain('100%');
  });

  it('shows a percentage, not After hours, in the evening when everybody off hours is counted', () => {
    const evening = somePeople(6).map((p) => ({ ...p, state: 'OFF_HOURS' as const, load: 1 }));
    create(capacityOf(evening, 0));
    expect(text('[data-battery-big]')).toBe('67%');
    expect(el().textContent).not.toContain('After hours');
    expect(text('[data-battery-legend] li[data-state="OFF_HOURS"]')).toContain('Off Hours');
  });

  it('says the unassigned waiting as a button that selects the Unassigned card, and N tasks over capacity in red only above zero', () => {
    create({ ...capacityOf(somePeople(12), 3, { unassignedWaiting: 9 }), overCapacityTasks: 3 });
    const waiting = el().querySelector<HTMLButtonElement>('[data-battery-waiting]')!;
    expect(waiting.textContent!.trim()).toBe('9 unassigned waiting');
    expect(text('[data-battery-summary]')!.replace(/\s+/g, ' ')).toMatch(
      /^9 unassigned waiting, \d+ free slots$/,
    );
    let shown = 0;
    fixture.componentInstance.showUnassigned.subscribe(() => shown++);
    waiting.click();
    expect(shown).toBe(1);
    expect(text('[data-battery-over]')).toBe('3 tasks over capacity');
  });

  it('shows no over capacity line at zero', () => {
    create({ ...capacityOf(somePeople(12), 3), overCapacityTasks: 0 });
    expect(el().querySelector('[data-battery-over]')).toBeNull();
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
    create(capacityOf(somePeople(12), 3));
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
    create(capacityOf(somePeople(12), 3));
    fixture.componentRef.setInput('refreshKey', 1);
    fixture.detectChanges();
    expect(capacityCalls).toBe(2);
  });
});
