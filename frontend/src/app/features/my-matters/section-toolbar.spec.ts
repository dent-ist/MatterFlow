import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SectionDir } from './section-prefs';
import { SectionToolbar } from './section-toolbar';
import { TypeOption } from './section-types';

const OPTIONS: TypeOption[] = [
  { id: 1, name: 'Review', iconKey: 'eye', colourKey: 'blue', active: true },
  { id: 2, name: 'Production', iconKey: 'send', colourKey: 'green', active: true },
];

@Component({
  imports: [SectionToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-mm-section-toolbar
    label="Needs my attention"
    [options]="options"
    [types]="types()"
    [sort]="sort()"
    [dir]="dir()"
    (typesChange)="types.set($event)"
    (sortChange)="sort.set($event)"
    (dirChange)="dir.set($event)"
  />`,
})
class Host {
  readonly options = OPTIONS;
  readonly types = signal<number[]>([]);
  readonly sort = signal('');
  readonly dir = signal<SectionDir>('asc');
}

describe('SectionToolbar (#857)', () => {
  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('says All types by default and offers every type', () => {
    const { el } = setup();
    expect(el.querySelector('summary')?.textContent).toContain('All types');
    expect(el.querySelectorAll('[data-type-option]').length).toBe(2);
    expect(el.querySelector('[data-chips]')).toBeNull();
  });

  it('chooses a type, shows its chip and clears again', async () => {
    const { fixture, el, host } = setup();
    el.querySelector<HTMLInputElement>('[data-type-option="2"]')!.click();
    fixture.detectChanges();
    expect(host.types()).toEqual([2]);
    expect(el.querySelector('summary')?.textContent).toContain('Production');
    expect(el.querySelectorAll('[data-chip]').length).toBe(1);
    el.querySelector<HTMLButtonElement>('[data-clear-all]')!.click();
    fixture.detectChanges();
    expect(host.types()).toEqual([]);
  });

  it('names the direction button after what it does and needs a sort first', () => {
    const { fixture, el, host } = setup();
    const dir = el.querySelector<HTMLButtonElement>('[data-dir]')!;
    expect(dir.disabled).toBe(true);
    host.sort.set('type');
    fixture.detectChanges();
    expect(dir.disabled).toBe(false);
    expect(dir.getAttribute('aria-label')).toBe('Sorted ascending, change to descending');
    dir.click();
    expect(host.dir()).toBe('desc');
  });

  it('emits the sort the person picks', () => {
    const { fixture, el, host } = setup();
    const select = el.querySelector<HTMLSelectElement>('[data-sort]')!;
    select.value = 'priority';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(host.sort()).toBe('priority');
  });
});
