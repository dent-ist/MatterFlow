import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dropdown, DropdownItem } from '../shared/ui/dropdown';
import {
  ddChoose,
  ddOptionTexts,
  ddOptionValues,
  ddSelect,
  ddText,
  ddValue,
} from './dropdown-testing.spec-util';

@Component({
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-dropdown
    label="Status"
    [items]="items"
    [value]="value()"
    (valueChange)="value.set($event)"
  />`,
})
class Host {
  readonly items: DropdownItem[] = [
    { value: '', label: 'All' },
    { value: 'active', label: 'Active', count: 12 },
    { value: 'inactive', label: 'Inactive' },
  ];
  readonly value = signal('');
}

describe('dropdown spec helper', () => {
  function mount() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }

  it('reads the chosen value and text of a dropdown by its label', () => {
    const { el } = mount();
    expect(ddValue(el, 'Status')).toBe('');
    expect(ddText(el, 'Status')).toBe('All');
  });

  it('lists the option texts and values, and closes the list again', () => {
    const { el } = mount();
    expect(ddOptionTexts(el, 'Status')).toEqual(['All', 'Active 12', 'Inactive']);
    expect(ddOptionValues(el, 'Status')).toEqual(['', 'active', 'inactive']);
    expect(document.body.querySelector('.dd-panel')).toBeNull();
  });

  it('chooses an option by value or by text, and answers like a native select', () => {
    const { fixture, el, host } = mount();
    ddChoose(el, 'Status', 'inactive');
    expect(host.value()).toBe('inactive');
    fixture.detectChanges();
    const select = ddSelect(el, 'Status');
    expect(select.value).toBe('inactive');
    select.value = 'Active';
    select.dispatchEvent(new Event('change'));
    expect(host.value()).toBe('active');
  });
});
