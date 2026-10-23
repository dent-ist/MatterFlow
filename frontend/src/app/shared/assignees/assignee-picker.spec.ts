import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { UsersLookupClient } from '../../api/generated/api-client';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { PickerOption } from '../ui/entity-picker';
import { AssigneePicker } from './assignee-picker';
import { aLookupItem } from './assignee-testing';

@Component({
  imports: [AssigneePicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-assignee-picker
    inputId="ap"
    [podId]="podId()"
    [taskTypeId]="3"
    [debounceMs]="0"
    [(selected)]="selected"
  />`,
})
class Host {
  readonly podId = signal<number | null>(null);
  readonly selected = signal<PickerOption | null>(null);
}

describe('AssigneePicker (Edit task, Create task)', () => {
  let fixture: ComponentFixture<Host>;
  let lookup: ReturnType<typeof vi.fn>;
  const el = () => fixture.nativeElement as HTMLElement;
  const input = () => el().querySelector<HTMLInputElement>('#ap')!;
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 5));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const options = () => Array.from(el().querySelectorAll<HTMLElement>('[role=option]'));

  beforeEach(async () => {
    lookup = vi.fn((_q?: string, _l?: number, podId?: number) =>
      of(
        podId
          ? [
              aLookupItem({
                userId: 4,
                displayName: 'Sam Kim',
                openTaskCount: 3,
                reason: '3 open tasks, never assigned',
              }),
            ]
          : [
              aLookupItem({ userId: 8, displayName: 'Ann Ames', openTaskCount: 0 }),
              aLookupItem({
                userId: 9,
                displayName: 'Bo Bell',
                openTaskCount: 2,
                availability: { state: 'OUT_OF_OFFICE', outUntil: '2099-03-21T12:00:00Z' },
              }),
            ],
      ),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: UsersLookupClient, useValue: { lookupUsers: lookup } },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
      ],
    });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('opens on focus with the Suggested heading, the counts and the tooltip reason', async () => {
    input().focus();
    await settle();
    expect(lookup).toHaveBeenCalledWith(undefined, 6, undefined, 3, true);
    expect(el().querySelector('[data-assignee-heading]')!.textContent).toContain('Suggested');
    expect(options().map((o) => o.querySelector('.mf-picker__name')!.textContent)).toEqual([
      'Ann Ames',
      'Bo Bell',
    ]);
    expect(options()[1].querySelector('[data-option-hint]')!.textContent).toContain('2 open');
    expect(options()[1].querySelector('[data-option-flag]')!.textContent).toMatch(
      /Out of office until Mar 2[01], 2099/,
    );
    expect(el().querySelector('[data-search-all]')).toBeNull();
  });

  it('in a Pod it lists the members and a last "Search all users" choice that switches to everyone', async () => {
    fixture.componentInstance.podId.set(2);
    fixture.detectChanges();
    input().focus();
    await settle();
    expect(lookup).toHaveBeenCalledWith(undefined, 50, 2, 3, undefined);
    expect(options()[0].textContent).toContain('Sam Kim');
    expect(el().querySelector('[data-assignee-heading]')).toBeNull();
    const all = el().querySelector<HTMLElement>('[data-search-all]')!;
    expect(all.textContent).toContain('Search all users');

    all.closest('li')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle();
    expect(lookup).toHaveBeenLastCalledWith(undefined, 6, undefined, 3, true);
    expect(el().querySelector('[data-search-all]')).toBeNull();
    expect(input()).not.toBeNull();
  });

  it('typing searches everyone (25 shown), and the keyboard picks: arrows then Enter', async () => {
    input().focus();
    await settle();
    input().value = 'User 1';
    input().dispatchEvent(new Event('input'));
    await settle();
    expect(lookup).toHaveBeenLastCalledWith('User 1', 25, undefined, 3, undefined);

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(input().getAttribute('aria-activedescendant')).toBe('ap-opt-1');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(fixture.componentInstance.selected()).toEqual({
      id: 9,
      label: 'Bo Bell',
      flag: expect.stringContaining('Out of office until'),
    });
    expect(el().querySelector('[data-chosen]')!.textContent).toContain('Bo Bell');
  });

  it('Escape closes the list and Change brings the search back', async () => {
    input().focus();
    await settle();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el().querySelector('[role=listbox]')).toBeNull();

    fixture.componentInstance.selected.set({ id: 8, label: 'Ann Ames' });
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('#ap-change')!.click();
    await settle();
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(input()).not.toBeNull();
  });
});
