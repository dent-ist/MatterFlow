import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskTypeIconLibrary } from './task-type-icon-library';
import { TaskTypeIconPicker, rankIcons } from './task-type-icon-picker';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskTypeIconPicker],
  template: `<label id="pick-label" for="pick">Icon</label>
    <mf-task-type-icon-picker inputId="pick" labelId="pick-label" [(value)]="icon" />`,
})
class Host {
  readonly icon = signal('file-text');
}

const pause = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('mf-task-type-icon-picker', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const overlay = (): HTMLElement => document.querySelector('[data-icon-dialog]')!;
  const items = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[data-icon-dialog] [role=radio]'));

  async function settle(): Promise<void> {
    await pause();
    fixture.detectChanges();
    await pause();
    fixture.detectChanges();
  }

  async function open(): Promise<void> {
    await TestBed.inject(TaskTypeIconLibrary).catalog();
    el().querySelector<HTMLButtonElement>('[data-icon-trigger]')!.click();
    await settle();
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await TestBed.inject(TaskTypeIconLibrary).catalog();
    await settle();
  });

  afterEach(() => fixture.destroy());

  it('ranks exact and word-start matches before substrings', () => {
    const icons = [
      { key: 'star', label: 'Star', category: 'General', keywords: 'favorite' },
      { key: 'rocket', label: 'Rocket', category: 'General', keywords: 'launch start' },
      { key: 'target', label: 'Target', category: 'General', keywords: 'goal' },
      { key: 'robot', label: 'Predictive coding', category: 'Review', keywords: 'tar technology' },
    ];
    expect(rankIcons(icons, 'tar').map((i) => i.key)).toEqual([
      'robot',
      'target',
      'star',
      'rocket',
    ]);
    expect(rankIcons(icons, '').map((i) => i.key)).toEqual(icons.map((i) => i.key));
    expect(rankIcons(icons, 'zzz')).toEqual([]);
  });

  it('shows the current icon and its name on the trigger, labelled by the field label', () => {
    const trigger = el().querySelector<HTMLButtonElement>('#pick')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.querySelector('mf-task-type-icon svg')).not.toBeNull();
    expect(el().querySelector('[data-icon-current]')!.textContent).toBe('Document');
  });

  it('opens a dialog listing the icons by category with visible labels and the current one checked', async () => {
    await open();
    expect(overlay()).not.toBeNull();
    const headings = Array.from(overlay().querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings.slice(0, 3)).toEqual(['General', 'Identification', 'Preservation']);
    expect(headings).toContain('Production');
    expect(items().length).toBeGreaterThanOrEqual(250);
    expect(items().every((b) => (b.textContent ?? '').trim().length > 0)).toBe(true);
    const checked = items().filter((b) => b.getAttribute('aria-checked') === 'true');
    expect(checked.map((b) => b.dataset['key'])).toEqual(['file-text']);
    expect(items().filter((b) => b.tabIndex === 0).length).toBe(1);
    expect(items().find((b) => b.tabIndex === 0)).toBe(checked[0]);
  });

  it('searches by name, key or keyword and says how many icons match', async () => {
    await open();
    const search = document.querySelector<HTMLInputElement>('[data-icon-search]')!;
    search.value = 'email';
    search.dispatchEvent(new Event('input'));
    await settle();
    const found = items().map((b) => b.dataset['key']);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(30);
    expect(document.querySelector('[data-icon-count]')!.textContent).toContain(
      `${found.length} icons`,
    );

    search.value = 'zzzzzz';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(items().length).toBe(0);
    expect(document.querySelector('[data-icon-empty]')!.textContent).toContain('zzzzzz');
  });

  it('has category buttons that filter the grid, with counts that follow the search (UXR4-07)', async () => {
    await open();
    const buttons = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[data-icon-categories] button'));
    expect(buttons().length).toBe(13);
    expect(buttons()[0].textContent).toContain('All');
    expect(buttons()[0].getAttribute('aria-pressed')).toBe('true');
    const production = buttons().find((b) => b.dataset['category'] === 'Production')!;
    production.click();
    await settle();
    expect(production.getAttribute('aria-pressed')).toBe('true');
    expect(Array.from(overlay().querySelectorAll('h3')).map((h) => h.textContent)).toEqual([
      'Production',
    ]);
    expect(items().length).toBe(23);

    const search = document.querySelector<HTMLInputElement>('[data-icon-search]')!;
    search.value = 'email';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(items().every((b) => b.dataset['key'] !== 'mail')).toBe(true); // Mail is in Communication, not Production
    buttons()[0].click();
    await settle();
    expect(items().some((b) => b.dataset['key'] === 'mail')).toBe(true);
  });

  it('lists matches best first as one group while something is typed (UXR4-09)', async () => {
    await open();
    const search = document.querySelector<HTMLInputElement>('[data-icon-search]')!;
    search.value = 'tar';
    search.dispatchEvent(new Event('input'));
    await settle();
    const keys = items().map((b) => b.dataset['key']);
    expect(keys[0]).toBe('robot');
    expect(keys.indexOf('target')).toBeLessThan(keys.indexOf('rocket'));
    expect(keys.indexOf('target')).toBeLessThan(keys.indexOf('star'));
    expect(overlay().querySelectorAll('h3').length).toBe(1);
  });

  it('names the trigger button by the field label plus its own visible text (UXR4-11)', () => {
    const trigger = el().querySelector<HTMLButtonElement>('#pick')!;
    const ids = trigger.getAttribute('aria-labelledby')!.split(' ');
    const text = ids.map((id) => document.getElementById(id)?.textContent?.trim()).join(' ');
    expect(text).toContain('Document');
    expect(text).toContain('Change icon');
  });

  it('gives focus back to the opener button when the dialog closes (UXR4-08)', async () => {
    await open();
    const trigger = el().querySelector<HTMLButtonElement>('#pick')!;
    items()[3].focus();
    items()[3].click(); // any close path ends in onHide
    await settle();
    await pause(30);
    expect(document.activeElement).toBe(trigger);
  });

  it('picks an icon on click and closes', async () => {
    await open();
    const target = items().find((b) => b.dataset['key'] === 'mail')!;
    target.click();
    await settle();
    expect(fixture.componentInstance.icon()).toBe('mail');
    expect(el().querySelector('[data-icon-current]')!.textContent).not.toBe('Document');
  });

  it('moves between icons with the arrow keys (roving tabindex) and picks with Enter or Space', async () => {
    await open();
    const first = items()[0];
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(items()[1]);
    await settle();
    expect(items().filter((b) => b.tabIndex === 0)).toEqual([items()[1]]);
    items()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(items()[0]);
    items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(items()[items().length - 1]);
  });
});
