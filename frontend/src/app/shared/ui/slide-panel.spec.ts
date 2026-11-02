import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SlidePanel } from './slide-panel';

@Component({
  imports: [SlidePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button id="opener" type="button">Open</button>
    <mf-slide-panel
      title="New project"
      primaryLabel="Create project"
      [dirty]="dirty()"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="open"
      (submitted)="log.push('save')"
    >
      <input id="first" />
    </mf-slide-panel>`,
})
class Host {
  readonly open = signal(true);
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly log: string[] = [];
}

describe('SlidePanel (MD-01, #1002)', () => {
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  async function start() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('puts Cancel on the left and the primary action on the right', async () => {
    await start();
    const names = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-panel-footer] button'),
    ).map((b) => b.textContent?.trim());
    expect(names).toEqual(['Cancel', 'Create project']);
  });

  it('submits from the primary button and ignores it while busy', async () => {
    const f = await start();
    q('[data-panel-primary] button')!.click();
    expect(f.componentInstance.log).toEqual(['save']);
    f.componentInstance.busy.set(true);
    f.detectChanges();
    q('[data-panel-primary] button')!.click();
    expect(f.componentInstance.log).toEqual(['save']);
  });

  it('closes at once when nothing changed', async () => {
    const f = await start();
    q('[data-panel-cancel] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('asks before it discards unsaved changes', async () => {
    const f = await start();
    f.componentInstance.dirty.set(true);
    f.detectChanges();
    q('[data-panel-cancel] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    expect(q('[data-panel-guard]')).not.toBeNull();
    q('[data-guard-keep] button')!.click();
    f.detectChanges();
    expect(q('[data-panel-guard]')).toBeNull();
    q('[data-panel-close]')!.click();
    f.detectChanges();
    q('[data-guard-discard] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('closes on Esc when clean and shows the guard on Esc when dirty', async () => {
    const f = await start();
    f.componentInstance.dirty.set(true);
    f.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(q('[data-panel-guard]')).not.toBeNull();
    expect(f.componentInstance.open()).toBe(true);
  });

  it('closes on Esc when nothing changed', async () => {
    const f = await start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('leaves an Esc alone that closed a dropdown list inside the panel', async () => {
    const f = await start();
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    document.body.appendChild(list);
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    list.remove();
  });

  it('shows a save error as an alert', async () => {
    const f = await start();
    f.componentInstance.error.set('Could not save');
    f.detectChanges();
    expect(q('[data-panel-error]')?.getAttribute('role')).toBe('alert');
  });
});
